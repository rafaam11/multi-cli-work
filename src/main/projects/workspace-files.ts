import fs from "node:fs/promises";
import path from "node:path";
import {
  IMAGE_EXTENSIONS,
  needsRunConfirmation,
  type FileTreeEntry,
  type WorkspaceChangedPath,
  type WorkspaceChangedPaths,
  type WorkspaceFileContent,
} from "../../shared/file-explorer-types";
import type { AgentEditEntry } from "../providers/agent-edits";

/** More than this is unreadable in a text pane anyway; the reader says it was cut. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Images round-trip as one base64 string, so the cap is generous but still bounded. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 4096;

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

export function normalizeForCompare(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return path.win32.normalize(value).replaceAll("/", "\\").toLocaleLowerCase("en-US");
  return path.posix.normalize(value.replaceAll("\\", "/"));
}

export function isWorkspaceExecutable(
  fileName: string,
  mode: number,
  isFile: boolean,
  platform: NodeJS.Platform,
): boolean {
  if (!isFile) return false;
  return platform === "win32" ? extensionOf(fileName) === "exe" : (mode & 0o111) !== 0;
}

export function withinRoot(normalizedRoot: string, normalizedCandidate: string, platform: NodeJS.Platform): boolean {
  const separator = platform === "win32" ? "\\" : "/";
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${separator}`);
}

/**
 * Filters the in-memory agent-edit index down to one project/worktree root and converts its
 * absolute paths to root-relative, forward-slashed paths. Unlike `resolveWithinRoot`, this never
 * touches the filesystem (no symlink realpath check): the index only ever holds paths an agent
 * itself wrote to via its own tool calls, so plain prefix matching on the normalized strings is
 * enough — there is no untrusted input here to defend against.
 */
export function changedPathsForRoot(
  rootPath: string,
  agentEdits: ReadonlyMap<string, AgentEditEntry>,
  baselineMs: number,
  platform: NodeJS.Platform = process.platform,
): WorkspaceChangedPaths {
  const resolvedRoot = path.resolve(rootPath);
  const normalizedRoot = normalizeForCompare(resolvedRoot, platform);
  const agentPaths: WorkspaceChangedPath[] = [];
  for (const [absolutePath, entry] of agentEdits) {
    if (!withinRoot(normalizedRoot, normalizeForCompare(absolutePath, platform), platform)) continue;
    agentPaths.push({
      relativePath: path.relative(resolvedRoot, absolutePath).split(path.sep).join("/"),
      kind: entry.kind,
      at: entry.at,
    });
  }
  return { agentPaths, baselineMs };
}

/**
 * Resolves a renderer-supplied relative path against a project/worktree root, rejecting anything
 * that steps outside it — including via a symlink or junction, which `path.resolve` alone would
 * not catch (the resolved *string* can stay inside the root while the real target does not).
 */
async function resolveWithinRoot(
  rootPath: string,
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) throw new Error("Path is too long");
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error("Invalid path");
  const resolvedRoot = path.resolve(rootPath);
  const target = path.resolve(resolvedRoot, relativePath);
  const normalizedResolvedRoot = normalizeForCompare(resolvedRoot, platform);
  if (!withinRoot(normalizedResolvedRoot, normalizeForCompare(target, platform), platform)) {
    throw new Error("Path escapes the project root");
  }
  const realRoot = await fs.realpath(resolvedRoot).catch(() => resolvedRoot);
  const real = await fs.realpath(target).catch(() => target);
  if (!withinRoot(normalizeForCompare(realRoot, platform), normalizeForCompare(real, platform), platform)) {
    throw new Error("Path escapes the project root");
  }
  return target;
}

function extensionOf(name: string): string | null {
  const ext = path.extname(name);
  return ext.length > 1 ? ext.slice(1).toLocaleLowerCase("en-US") : null;
}

function relativeChildPath(parentRelativePath: string, childName: string): string {
  return parentRelativePath ? `${parentRelativePath}/${childName}` : childName;
}

function parentRelativePathOf(relativePath: string): string {
  const cut = relativePath.lastIndexOf("/");
  return cut < 0 ? "" : relativePath.slice(0, cut);
}

/** Windows' reserved device names, rejected on every platform — see workspaceEntryName. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_NAME_CHARACTERS = /[\\/:*?"<>|]/;

/**
 * Checks a name typed in the renderer before it becomes a file. Windows' rules apply everywhere:
 * a repository shared with a Windows machine cannot hold `aux.ts` or `a:b`, so accepting one on
 * Linux would only create a file nobody there can check out.
 */
export function workspaceEntryName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error("Name must not be empty");
  if (name.length > 255) throw new Error("Name is too long");
  if (INVALID_NAME_CHARACTERS.test(name)) throw new Error('Name must not contain \\ / : * ? " < > |');
  // Covers the NUL byte that would truncate the path, and every other control character with it.
  if ([...name].some((character) => character < " ")) throw new Error("Name must not contain control characters");
  if (name === "." || name === "..") throw new Error("Name is invalid");
  if (name.endsWith(".")) throw new Error("Name must not end with a dot");
  if (WINDOWS_RESERVED_NAME.test(name)) throw new Error(`"${name}" is a name Windows reserves`);
  return name;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

export async function listWorkspaceDirectory(
  rootPath: string,
  relativePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<FileTreeEntry[]> {
  const target = await resolveWithinRoot(rootPath, relativePath, platform);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read directory: ${(error as Error).message}`);
  }
  const result = await Promise.all(
    entries.filter((entry) => entry.name !== ".git").map(async (entry): Promise<FileTreeEntry> => {
      const extension = entry.isDirectory() ? null : extensionOf(entry.name);
      const stat = entry.isFile() ? await fs.stat(path.join(target, entry.name)) : null;
      const executable = isWorkspaceExecutable(entry.name, stat?.mode ?? 0, entry.isFile(), platform);
      return {
        name: entry.name,
        relativePath: relativeChildPath(relativePath, entry.name),
        kind: entry.isDirectory() ? "directory" : "file",
        extension,
        executable,
        mtimeMs: stat?.mtimeMs ?? 0,
      };
    }),
  );
  return result.sort((left, right) =>
      left.kind !== right.kind ? (left.kind === "directory" ? -1 : 1) : left.name.localeCompare(right.name),
    );
}

/**
 * Absolute on-disk path of a workspace file, validated to stay inside the root (same traversal +
 * symlink checks as every read/write). The html preview turns this into a `file://` URL, so it must
 * confirm the target is a real file before the WebContentsView is pointed at it.
 */
export async function resolveWorkspaceFilePath(rootPath: string, relativePath: string): Promise<string> {
  const target = await resolveWithinRoot(rootPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a file");
  return target;
}

export async function readWorkspaceFile(rootPath: string, relativePath: string): Promise<WorkspaceFileContent> {
  const target = await resolveWithinRoot(rootPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a file");
  const extension = extensionOf(path.basename(target));
  const isImage = extension !== null && IMAGE_EXTENSIONS.includes(extension);
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  const truncated = stat.size > maxBytes;
  // Do not accidentally read a huge binary just to discard most of it in the renderer.
  const handle = await fs.open(target, "r");
  const slice = Buffer.alloc(Math.min(stat.size, maxBytes));
  try {
    await handle.read(slice, 0, slice.length, 0);
  } finally {
    await handle.close();
  }
  const encoding: "utf8" | "base64" = isImage || !isUtf8Text(slice) ? "base64" : "utf8";
  return {
    relativePath,
    encoding,
    content: encoding === "base64" ? slice.toString("base64") : slice.toString("utf8"),
    truncated,
    sizeBytes: stat.size,
  };
}

export interface OpenWorkspaceEntryOptions {
  /** True once the renderer has shown the run-confirmation modal and the user accepted it. */
  confirmedRun: boolean;
}

/**
 * Opens a file with its OS-associated program — the same result as double-clicking it in the
 * platform's file explorer. A fixed set of extensions the OS would *run* rather than merely display
 * (see `needsRunConfirmation`) requires `options.confirmedRun`; the policy decision stays here so the
 * renderer can only ever raise the confirmation modal, never bypass it. Generalizes the former
 * exe-only `runWorkspaceExecutable`, which the single-click "실행" flow now goes through as well.
 */
export async function openWorkspaceEntry(
  rootPath: string,
  relativePath: string,
  options: OpenWorkspaceEntryOptions,
  openPath: (target: string) => Promise<string | void>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const target = await resolveWithinRoot(rootPath, relativePath, platform);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a file");
  const name = path.basename(target);
  const executable = isWorkspaceExecutable(name, stat.mode, true, platform);
  if (needsRunConfirmation(name, platform, executable) && !options.confirmedRun) {
    throw new Error("Running this file requires confirmation");
  }
  const result = await openPath(target);
  if (result) throw new Error(result);
}

/**
 * Absolute on-disk path of any workspace entry, file or folder. The context menu copies it and
 * hands it to the OS shell, so it goes through the same root guard as every read.
 */
export async function resolveWorkspaceEntryPath(rootPath: string, relativePath: string): Promise<string> {
  const target = await resolveWithinRoot(rootPath, relativePath);
  await fs.stat(target);
  return target;
}

/** Creates an empty file or folder under `parentRelativePath`, returning its relative path. */
export async function createWorkspaceEntry(
  rootPath: string,
  parentRelativePath: string,
  rawName: string,
  kind: "file" | "directory",
): Promise<string> {
  const name = workspaceEntryName(rawName);
  const parent = await resolveWithinRoot(rootPath, parentRelativePath);
  const target = path.join(parent, name);
  try {
    // Neither call replaces an existing entry: mkdir without `recursive` and open with `wx` both
    // fail on EEXIST, so a typo cannot silently empty a file that is already there.
    if (kind === "directory") await fs.mkdir(target);
    else await (await fs.open(target, "wx")).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`"${name}" already exists`);
    throw error;
  }
  return relativeChildPath(parentRelativePath, name);
}

/** Renames in place — the entry keeps its parent. Returns the new relative path. */
export async function renameWorkspaceEntry(
  rootPath: string,
  relativePath: string,
  rawName: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (!relativePath) throw new Error("The root folder cannot be renamed");
  const name = workspaceEntryName(rawName);
  const target = await resolveWithinRoot(rootPath, relativePath, platform);
  const destination = path.join(path.dirname(target), name);
  // fs.rename replaces the destination without asking, so an existing name has to be refused
  // first. A rename that only changes letter case is the one collision that is really the same
  // entry, and Windows needs it to go through.
  const sameEntry = normalizeForCompare(destination, platform) === normalizeForCompare(target, platform);
  if (!sameEntry && (await pathExists(destination))) throw new Error(`"${name}" already exists`);
  await fs.rename(target, destination);
  return relativeChildPath(parentRelativePathOf(relativePath), name);
}

/** How many "name copy N" attempts before giving up rather than looping on a hostile directory. */
const MAX_COPY_ATTEMPTS = 100;

/** Copies an entry next to itself as "name copy", then "name copy 2". Returns the new path. */
export async function duplicateWorkspaceEntry(rootPath: string, relativePath: string): Promise<string> {
  if (!relativePath) throw new Error("The root folder cannot be duplicated");
  const target = await resolveWithinRoot(rootPath, relativePath);
  const stat = await fs.stat(target);
  const parent = path.dirname(target);
  const base = path.basename(target);
  // A folder keeps its whole name; a file keeps its extension so the copy stays the same type.
  const extension = stat.isDirectory() ? "" : path.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  let name = `${stem} copy${extension}`;
  for (let attempt = 2; await pathExists(path.join(parent, name)); attempt += 1) {
    if (attempt > MAX_COPY_ATTEMPTS) throw new Error("Too many copies of this name already exist");
    name = `${stem} copy ${attempt}${extension}`;
  }
  await fs.cp(target, path.join(parent, name), { recursive: true, errorOnExist: true, force: false });
  return relativeChildPath(parentRelativePathOf(relativePath), name);
}

/**
 * Moves an entry to the OS recycle bin. `trashItem` is injected the way openWorkspaceEntry takes
 * `openPath`: the guard belongs here, the electron shell call does not.
 */
export async function trashWorkspaceEntry(
  rootPath: string,
  relativePath: string,
  trashItem: (target: string) => Promise<void>,
): Promise<void> {
  if (!relativePath) throw new Error("The root folder cannot be deleted");
  const target = await resolveWithinRoot(rootPath, relativePath);
  await fs.lstat(target);
  await trashItem(target);
}

export async function writeWorkspaceFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("File is too large to save");
  const target = await resolveWithinRoot(rootPath, relativePath);
  await fs.writeFile(target, content, "utf8");
}
