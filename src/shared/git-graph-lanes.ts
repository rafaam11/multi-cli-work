import type { GitGraphCommit } from "./api-types";

export interface GitGraphLaneRow {
  lane: number;
  lanesBefore: string[];
  lanesAfter: string[];
}

/** Computes stable topology lanes for the currently loaded prefix of the log. */
export function computeGitGraphLanes(commits: GitGraphCommit[]): GitGraphLaneRow[] {
  let lanes: string[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(commit.hash);
    }
    const lanesBefore = [...lanes];
    const next = [...lanes];
    if (commit.parents.length === 0) next.splice(lane, 1);
    else {
      next[lane] = commit.parents[0];
      for (const parent of commit.parents.slice(1)) {
        if (!next.includes(parent)) next.splice(lane + 1, 0, parent);
      }
    }
    lanes = next.filter((hash, index) => next.indexOf(hash) === index);
    return { lane, lanesBefore, lanesAfter: [...lanes] };
  });
}
