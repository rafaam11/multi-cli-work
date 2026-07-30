import GithubSlugger from "github-slugger";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string;
  checked?: boolean | null;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

export interface MarkdownTaskMarker {
  checked: boolean;
  marker: "[ ]" | "[x]" | "[X]";
  markerOffset: number;
}

export interface MarkdownHeading {
  text: string;
  slug: string;
  sourceOffset: number | null;
}

export interface MarkdownAnalysis {
  tasks: MarkdownTaskMarker[];
  headings: MarkdownHeading[];
}

export type MarkdownLinkTarget =
  | { kind: "anchor"; anchor: string }
  | { kind: "external"; url: string }
  | { kind: "file"; relativePath: string; anchor: string | null }
  | { kind: "blocked"; reason: string };

const processor = unified().use(remarkParse).use(remarkGfm);

function headingText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  if (typeof node.alt === "string") return node.alt;
  return node.children?.map(headingText).join("") ?? "";
}

function taskMarkerAt(source: string, node: MarkdownNode): MarkdownTaskMarker | null {
  if (typeof node.checked !== "boolean") return null;
  const start = node.position?.start?.offset;
  if (typeof start !== "number") return null;
  const newline = source.indexOf("\n", start);
  const line = source.slice(start, newline === -1 ? source.length : newline).replace(/\r$/, "");
  const match = /^(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\]/.exec(line);
  if (!match) return null;
  const markerIndex = match[0].lastIndexOf("[");
  const marker = match[0].slice(markerIndex) as MarkdownTaskMarker["marker"];
  return { checked: node.checked, marker, markerOffset: start + markerIndex };
}

/** Parse once so task inputs and headings use the same source order as the GFM renderer. */
export function analyzeMarkdown(source: string): MarkdownAnalysis {
  const root = processor.parse(source) as MarkdownNode;
  const tasks: MarkdownTaskMarker[] = [];
  const headings: MarkdownHeading[] = [];
  const slugger = new GithubSlugger();

  const visit = (node: MarkdownNode) => {
    if (node.type === "listItem") {
      const task = taskMarkerAt(source, node);
      if (task) tasks.push(task);
    }
    if (node.type === "heading") {
      const text = headingText(node);
      headings.push({
        text,
        slug: slugger.slug(text),
        sourceOffset: node.position?.start?.offset ?? null,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return { tasks, headings };
}

export function toggleMarkdownTask(source: string, taskIndex: number, checked: boolean): string {
  const task = analyzeMarkdown(source).tasks[taskIndex];
  if (!task) throw new RangeError(`Markdown task ${taskIndex} does not exist`);
  const marker = checked ? "[x]" : "[ ]";
  return `${source.slice(0, task.markerOffset)}${marker}${source.slice(task.markerOffset + task.marker.length)}`;
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function blocked(reason: string): MarkdownLinkTarget {
  return { kind: "blocked", reason };
}

/** Resolve renderer links without exposing a filesystem path or a browser navigation primitive. */
export function resolveMarkdownLink(currentRelativePath: string, rawHref: string): MarkdownLinkTarget {
  const href = rawHref.trim();
  if (!href) return blocked("빈 링크는 열 수 없습니다.");
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return blocked("허용되지 않은 링크 형식입니다.");
      return { kind: "external", url: url.toString() };
    } catch {
      return blocked("올바르지 않은 외부 링크입니다.");
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return blocked("http/https 외의 링크 형식은 열 수 없습니다.");
  if (href.startsWith("/") || href.startsWith("\\")) return blocked("프로젝트 루트 밖의 경로는 열 수 없습니다.");

  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const rawAnchor = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const anchor = rawAnchor ? decode(rawAnchor) : null;
  if (rawAnchor && anchor === null) return blocked("올바르지 않은 문서 앵커입니다.");
  if (rawPath === "") {
    return anchor ? { kind: "anchor", anchor } : blocked("빈 링크는 열 수 없습니다.");
  }
  if (rawPath.includes("?")) return blocked("로컬 파일 링크에는 query를 사용할 수 없습니다.");

  const decodedPath = decode(rawPath);
  if (decodedPath === null || /[\0\r\n]/.test(decodedPath)) return blocked("올바르지 않은 파일 경로입니다.");
  const normalizedPath = decodedPath.replace(/\\/g, "/");
  if (normalizedPath.startsWith("/")) return blocked("프로젝트 루트 밖의 경로는 열 수 없습니다.");

  const currentParts = currentRelativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  currentParts.pop();
  for (const part of normalizedPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (currentParts.length === 0) return blocked("프로젝트 루트 밖의 경로는 열 수 없습니다.");
      currentParts.pop();
      continue;
    }
    currentParts.push(part);
  }
  if (currentParts.length === 0) return blocked("파일 경로를 확인해 주세요.");
  return { kind: "file", relativePath: currentParts.join("/"), anchor };
}
