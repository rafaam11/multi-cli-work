import os from "node:os";
import path from "node:path";
import type {
  ActivePullRequestReview,
  PullRequestReviewAnnotation,
  PullRequestReviewAnnotationSet,
  PullRequestReviewRegistryV2,
} from "../../shared/github-types";
import { readJsonStore, updateJsonStore, type JsonStoreSnapshot, type JsonStoreSpec } from "../storage/json-store";

export const REVIEW_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "pr-reviews.json");
export class ReviewRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewRegistryError";
  }
}

const REVIEW_KEYS = ["id", "projectId", "remoteName", "pullRequestNumber", "headSha", "worktreeId", "sessionId", "agent", "promptDelivered", "startedAt", "updatedAt"];
const ANNOTATION_KEYS = ["id", "headSha", "path", "side", "line", "lineText", "body", "status", "createdAt", "updatedAt", "sentAt"];
const SET_KEYS = ["projectId", "remoteName", "pullRequestNumber", "items"];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewRegistryError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exact(item: Record<string, unknown>, keys: readonly string[], label: string): void {
  const unknown = Object.keys(item).filter((field) => !keys.includes(field));
  if (unknown.length) throw new ReviewRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function required(item: Record<string, unknown>, field: string, label: string): string {
  if (typeof item[field] !== "string" || !item[field]) throw new ReviewRegistryError(`${label}.${field} must be a non-empty string`);
  return item[field] as string;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new ReviewRegistryError(`${label} is invalid`);
  return value as number;
}

function parseReview(value: unknown, key: string): ActivePullRequestReview {
  const item = record(value, `Review ${key}`);
  exact(item, REVIEW_KEYS, `Review ${key}`);
  const id = required(item, "id", `Review ${key}`);
  if (id !== key) throw new ReviewRegistryError(`Review key ${key} does not match id ${id}`);
  if (item.agent !== "claude" && item.agent !== "codex") throw new ReviewRegistryError(`Review ${key}.agent is invalid`);
  if (typeof item.promptDelivered !== "boolean") throw new ReviewRegistryError(`Review ${key}.promptDelivered must be boolean`);
  return {
    id,
    projectId: required(item, "projectId", `Review ${key}`),
    remoteName: required(item, "remoteName", `Review ${key}`),
    pullRequestNumber: positiveInteger(item.pullRequestNumber, `Review ${key}.pullRequestNumber`),
    headSha: required(item, "headSha", `Review ${key}`),
    worktreeId: required(item, "worktreeId", `Review ${key}`),
    sessionId: required(item, "sessionId", `Review ${key}`),
    agent: item.agent,
    promptDelivered: item.promptDelivered,
    startedAt: required(item, "startedAt", `Review ${key}`),
    updatedAt: required(item, "updatedAt", `Review ${key}`),
  };
}

function parseAnnotation(value: unknown, key: string): PullRequestReviewAnnotation {
  const item = record(value, `Annotation ${key}`);
  exact(item, ANNOTATION_KEYS, `Annotation ${key}`);
  const id = required(item, "id", `Annotation ${key}`);
  if (id !== key) throw new ReviewRegistryError(`Annotation key ${key} does not match id ${id}`);
  if (item.side !== "LEFT" && item.side !== "RIGHT") throw new ReviewRegistryError(`Annotation ${key}.side is invalid`);
  if (item.status !== "draft" && item.status !== "sent") throw new ReviewRegistryError(`Annotation ${key}.status is invalid`);
  if (item.sentAt !== null && typeof item.sentAt !== "string") throw new ReviewRegistryError(`Annotation ${key}.sentAt is invalid`);
  return {
    id,
    headSha: required(item, "headSha", `Annotation ${key}`),
    path: required(item, "path", `Annotation ${key}`),
    side: item.side,
    line: positiveInteger(item.line, `Annotation ${key}.line`),
    lineText: typeof item.lineText === "string" ? item.lineText : (() => { throw new ReviewRegistryError(`Annotation ${key}.lineText must be a string`); })(),
    body: required(item, "body", `Annotation ${key}`),
    status: item.status,
    createdAt: required(item, "createdAt", `Annotation ${key}`),
    updatedAt: required(item, "updatedAt", `Annotation ${key}`),
    sentAt: item.sentAt as string | null,
  };
}

export function annotationSetKey(projectId: string, remoteName: string, pullRequestNumber: number): string {
  return `${encodeURIComponent(projectId)}:${encodeURIComponent(remoteName)}:${pullRequestNumber}`;
}

function parseSet(value: unknown, key: string): PullRequestReviewAnnotationSet {
  const item = record(value, `Annotation set ${key}`);
  exact(item, SET_KEYS, `Annotation set ${key}`);
  const set: PullRequestReviewAnnotationSet = {
    projectId: required(item, "projectId", `Annotation set ${key}`),
    remoteName: required(item, "remoteName", `Annotation set ${key}`),
    pullRequestNumber: positiveInteger(item.pullRequestNumber, `Annotation set ${key}.pullRequestNumber`),
    items: Object.fromEntries(Object.entries(record(item.items, `Annotation set ${key}.items`)).map(([id, annotation]) => [id, parseAnnotation(annotation, id)])),
  };
  if (annotationSetKey(set.projectId, set.remoteName, set.pullRequestNumber) !== key) {
    throw new ReviewRegistryError(`Annotation set key ${key} does not match its context`);
  }
  return set;
}

export function parseReviewRegistry(value: unknown): PullRequestReviewRegistryV2 {
  const item = record(value, "Review registry");
  const schemaVersion = item.schemaVersion;
  exact(item, schemaVersion === 1 ? ["schemaVersion", "updatedAt", "reviews"] : ["schemaVersion", "updatedAt", "reviews", "annotationSets"], "Review registry");
  const reviews = Object.fromEntries(Object.entries(record(item.reviews, "Review registry reviews")).map(([id, review]) => [id, parseReview(review, id)]));
  if (schemaVersion === 1) {
    const annotationSets: Record<string, PullRequestReviewAnnotationSet> = {};
    for (const review of Object.values(reviews)) {
      const key = annotationSetKey(review.projectId, review.remoteName, review.pullRequestNumber);
      annotationSets[key] ??= {
        projectId: review.projectId,
        remoteName: review.remoteName,
        pullRequestNumber: review.pullRequestNumber,
        items: {},
      };
    }
    return { schemaVersion: 2, updatedAt: String(item.updatedAt), reviews, annotationSets };
  }
  if (schemaVersion !== 2) throw new ReviewRegistryError(`Unsupported review registry schema: ${String(schemaVersion)}`);
  return {
    schemaVersion: 2,
    updatedAt: String(item.updatedAt),
    reviews,
    annotationSets: Object.fromEntries(Object.entries(record(item.annotationSets, "Review registry annotationSets")).map(([key, set]) => [key, parseSet(set, key)])),
  };
}

const STORE: JsonStoreSpec<PullRequestReviewRegistryV2> = {
  label: "PR review registry",
  parse: parseReviewRegistry,
  empty: () => ({ schemaVersion: 2, updatedAt: new Date().toISOString(), reviews: {}, annotationSets: {} }),
  error: (message, options) => new ReviewRegistryError(message, options),
  isContentError: (error) => error instanceof ReviewRegistryError,
};

export interface ReviewRegistryOptions { registryPath?: string; }
const pathOf = (options: ReviewRegistryOptions) => options.registryPath ?? REVIEW_REGISTRY_PATH;

export async function readReviewRegistry(options: ReviewRegistryOptions = {}): Promise<{ registry: PullRequestReviewRegistryV2 } & Omit<JsonStoreSnapshot<PullRequestReviewRegistryV2>, "value">> {
  const snapshot = await readJsonStore(STORE, pathOf(options));
  const { value: registry, ...rest } = snapshot;
  return { registry, ...rest };
}

export function updateReviewRegistry(
  update: (registry: PullRequestReviewRegistryV2) => PullRequestReviewRegistryV2,
  options: ReviewRegistryOptions = {},
) {
  return updateJsonStore(STORE, pathOf(options), update);
}

export function upsertReview(review: ActivePullRequestReview, options: ReviewRegistryOptions = {}) {
  return updateReviewRegistry((registry) => ({
    ...registry,
    updatedAt: review.updatedAt,
    reviews: { ...registry.reviews, [review.id]: review },
  }), options);
}

export function removeReviewAndAnnotations(id: string, now: string, options: ReviewRegistryOptions = {}) {
  return updateReviewRegistry((registry) => {
    const review = registry.reviews[id];
    const reviews = { ...registry.reviews };
    delete reviews[id];
    if (!review) return { ...registry, updatedAt: now, reviews };
    const key = annotationSetKey(review.projectId, review.remoteName, review.pullRequestNumber);
    const set = registry.annotationSets[key];
    if (!set) return { ...registry, updatedAt: now, reviews };
    const items = Object.fromEntries(Object.entries(set.items).filter(([, annotation]) => annotation.headSha !== review.headSha));
    return {
      ...registry,
      updatedAt: now,
      reviews,
      annotationSets: { ...registry.annotationSets, [key]: { ...set, items } },
    };
  }, options);
}

/** Backward-compatible name for callers that only remove a review. */
export const removeReview = removeReviewAndAnnotations;
