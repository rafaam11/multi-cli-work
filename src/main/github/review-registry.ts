import os from "node:os";
import path from "node:path";
import type { ActivePullRequestReview, PullRequestReviewRegistryV1 } from "../../shared/github-types";
import { readJsonStore, updateJsonStore, type JsonStoreSnapshot, type JsonStoreSpec } from "../storage/json-store";

export const REVIEW_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "pr-reviews.json");
export class ReviewRegistryError extends Error { constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "ReviewRegistryError"; } }
const KEYS = ["id","projectId","remoteName","pullRequestNumber","headSha","worktreeId","sessionId","agent","promptDelivered","startedAt","updatedAt"];
function parseReview(value: unknown, key: string): ActivePullRequestReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewRegistryError(`Review ${key} must be an object`);
  const item = value as Record<string, unknown>; const unknown = Object.keys(item).filter((field) => !KEYS.includes(field));
  if (unknown.length) throw new ReviewRegistryError(`Review ${key} contains unknown fields: ${unknown.join(", ")}`);
  const required = (field: string) => { if (typeof item[field] !== "string" || !item[field]) throw new ReviewRegistryError(`Review ${key}.${field} must be a non-empty string`); return item[field] as string; };
  const id = required("id"); if (id !== key) throw new ReviewRegistryError(`Review key ${key} does not match id ${id}`);
  if (!Number.isInteger(item.pullRequestNumber) || (item.pullRequestNumber as number) < 1) throw new ReviewRegistryError(`Review ${key}.pullRequestNumber is invalid`);
  if (item.agent !== "claude" && item.agent !== "codex") throw new ReviewRegistryError(`Review ${key}.agent is invalid`);
  if (typeof item.promptDelivered !== "boolean") throw new ReviewRegistryError(`Review ${key}.promptDelivered must be boolean`);
  return { id, projectId: required("projectId"), remoteName: required("remoteName"), pullRequestNumber: item.pullRequestNumber as number, headSha: required("headSha"), worktreeId: required("worktreeId"), sessionId: required("sessionId"), agent: item.agent, promptDelivered: item.promptDelivered, startedAt: required("startedAt"), updatedAt: required("updatedAt") };
}
export function parseReviewRegistry(value: unknown): PullRequestReviewRegistryV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewRegistryError("Review registry must be an object");
  const item = value as Record<string, unknown>; const unknown = Object.keys(item).filter((key) => !["schemaVersion","updatedAt","reviews"].includes(key));
  if (unknown.length) throw new ReviewRegistryError(`Review registry contains unknown fields: ${unknown.join(", ")}`);
  if (item.schemaVersion !== 1 || !item.reviews || typeof item.reviews !== "object" || Array.isArray(item.reviews)) throw new ReviewRegistryError("Invalid review registry");
  return { schemaVersion: 1, updatedAt: String(item.updatedAt), reviews: Object.fromEntries(Object.entries(item.reviews as Record<string, unknown>).map(([key, review]) => [key, parseReview(review, key)])) };
}
const STORE: JsonStoreSpec<PullRequestReviewRegistryV1> = { label: "PR review registry", parse: parseReviewRegistry, empty: () => ({ schemaVersion: 1, updatedAt: new Date().toISOString(), reviews: {} }), error: (message, options) => new ReviewRegistryError(message, options), isContentError: (error) => error instanceof ReviewRegistryError };
export interface ReviewRegistryOptions { registryPath?: string; }
const pathOf = (options: ReviewRegistryOptions) => options.registryPath ?? REVIEW_REGISTRY_PATH;
export async function readReviewRegistry(options: ReviewRegistryOptions = {}): Promise<{ registry: PullRequestReviewRegistryV1 } & Omit<JsonStoreSnapshot<PullRequestReviewRegistryV1>, "value">> { const snapshot = await readJsonStore(STORE, pathOf(options)); const { value: registry, ...rest } = snapshot; return { registry, ...rest }; }
export async function upsertReview(review: ActivePullRequestReview, options: ReviewRegistryOptions = {}) { return updateJsonStore(STORE, pathOf(options), (registry) => ({ ...registry, updatedAt: review.updatedAt, reviews: { ...registry.reviews, [review.id]: review } })); }
export async function removeReview(id: string, now: string, options: ReviewRegistryOptions = {}) { return updateJsonStore(STORE, pathOf(options), (registry) => { const reviews = { ...registry.reviews }; delete reviews[id]; return { ...registry, updatedAt: now, reviews }; }); }
