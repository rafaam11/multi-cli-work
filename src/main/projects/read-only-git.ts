import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAX_CONCURRENT_QUERIES = 4;
let active = 0;
const waiting: Array<() => void> = [];

/** One process-wide budget at the command boundary, shared by nested workspace queries.
 * Mutating Git commands deliberately bypass this pool. Never enqueue an outer workflow here. */
export async function runReadOnlyGit(
  args: string[],
  options: { windowsHide?: boolean; timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (active < MAX_CONCURRENT_QUERIES) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await execute("git", args, options);
  } finally {
    const next = waiting.shift();
    if (next) next(); // Transfer this slot directly; new arrivals cannot overtake a waiter.
    else active--;
  }
}
