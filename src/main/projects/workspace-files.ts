import fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_EXTENSIONS, type FileTreeEntry, type WorkspaceFileContent } from "../../shared/file-explorer-types";

/** More than this is unreadable in a text pane anyway; the reader says it was cut. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Images round-trip as one base64 string, so the cap is generous but still bounded. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 4096;

function normalizeForCompare(value: string): string {
  return path.win32.normalize(value).replaceAll("/", "\\").toLocaleLowerCase("en-US");
}

function withinRoot(normalizedRoot: string, normalizedCandidate: string): boolean {
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}

/**
 * Resolves a renderer-supplied relative path against a project/worktree root, rejecting anything
 * that steps outside it — including via a symlink or junction, which `path.resolve` alone would
 * not catch (the resolved *string* can stay inside the root while the real target does not).
 */
async function resolveWithinRoot(rootPath: string, relativePath: string): Promise<string> {
  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) throw new Error("Path is too long");
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error("Invalid path");
  const resolvedRoot = path.resolve(rootPath);
  const target = path.resolve(resolvedRoot, relativePath);
  const normalizedRoot = normalizeForCompare(resolvedRoot);
  if (!withinRoot(normalizedRoot, normalizeForCompare(target))) {
    throw new Error("Path escapes the project root");
  }
  const real = await fs.realpath(target).catch(() => target);
  if (!withinRoot(normalizedRoot, normalizeForCompare(real))) {
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

export async function listWorkspaceDirectory(rootPath: string, relativePath: string): Promise<FileTreeEntry[]> {
  const target = await resolveWithinRoot(rootPath, relativePath);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read directory: ${(error as Error).message}`);
  }
  return entries
    .filter((entry) => entry.name !== ".git")
    .map(
      (entry): FileTreeEntry => ({
        name: entry.name,
        relativePath: relativeChildPath(relativePath, entry.name),
        kind: entry.isDirectory() ? "directory" : "file",
        extension: entry.isDirectory() ? null : extensionOf(entry.name),
      }),
    )
    .sort((left, right) =>
      left.kind !== right.kind ? (left.kind === "directory" ? -1 : 1) : left.name.localeCompare(right.name),
    );
}

export async function readWorkspaceFile(rootPath: string, relativePath: string): Promise<WorkspaceFileContent> {
  const target = await resolveWithinRoot(rootPath, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a file");
  const extension = extensionOf(path.basename(target));
  const isImage = extension !== null && IMAGE_EXTENSIONS.includes(extension);
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  const truncated = stat.size > maxBytes;
  const buffer = await fs.readFile(target);
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
  return {
    relativePath,
    encoding: isImage ? "base64" : "utf8",
    content: isImage ? slice.toString("base64") : slice.toString("utf8"),
    truncated,
    sizeBytes: stat.size,
  };
}

export async function writeWorkspaceFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("File is too large to save");
  const target = await resolveWithinRoot(rootPath, relativePath);
  await fs.writeFile(target, content, "utf8");
}
