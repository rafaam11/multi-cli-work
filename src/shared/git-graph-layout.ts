/** The topology-bearing subset of a commit. `GitGraphCommit` satisfies it structurally. */
export interface GitGraphTopology {
  hash: string;
  parents: string[];
}

export interface GitGraphNode {
  hash: string;
  row: number;
  lane: number;
  colorIndex: number;
}

export interface GitGraphEdge {
  fromRow: number;
  /** The parent's row, or null when the parent has not been paged in yet. */
  toRow: number | null;
  fromLane: number;
  toLane: number;
  colorIndex: number;
  /** True for a merge's second and later parents. */
  isMerge: boolean;
}

export interface GitGraphLayout {
  nodes: GitGraphNode[];
  edges: GitGraphEdge[];
  laneCount: number;
}

/**
 * Assigns every commit a lane and a colour in one pass over the topo-ordered log.
 *
 * A lane slot holds the hash of the commit expected to occupy that column next, so by the time a
 * commit is reached its slot is already reserved by whichever child first named it. The commit hands
 * its lane and colour to its first parent — that is what keeps a branch's mainline a straight,
 * single-coloured column — while the extra parents of a merge fan out into lanes of their own. A
 * slot is freed the moment its commit is consumed, so lanes are reused densely rather than growing
 * without bound.
 *
 * Pure and deterministic, so appending a page leaves the lanes and colours above it untouched.
 */
export function layoutGitGraph(commits: readonly GitGraphTopology[]): GitGraphLayout {
  const rowOf = new Map<string, number>();
  commits.forEach((commit, row) => rowOf.set(commit.hash, row));

  const lanes: (string | null)[] = [];
  const colorOf = new Map<string, number>();
  const nodes: GitGraphNode[] = [];
  const edges: GitGraphEdge[] = [];
  let nextColor = 0;
  let laneCount = 0;

  const firstFreeLane = (): number => {
    const free = lanes.indexOf(null);
    return free === -1 ? lanes.length : free;
  };

  const claim = (lane: number, hash: string): void => {
    lanes[lane] = hash;
    if (lane >= laneCount) laneCount = lane + 1;
  };

  // `inherit` is null when the caller wants a fresh colour. Resolving that here rather than at the
  // call site is what stops a palette entry being spent on a parent that another child already
  // coloured — spend it eagerly and every later branch shifts along the palette.
  const placeParent = (hash: string, preferred: number, inherit: number | null): number => {
    let lane = lanes.indexOf(hash);
    if (lane === -1) {
      lane = preferred >= lanes.length || lanes[preferred] === null ? preferred : firstFreeLane();
      claim(lane, hash);
    }
    if (!colorOf.has(hash)) colorOf.set(hash, inherit ?? nextColor++);
    return lane;
  };

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      // A branch tip that no loaded child pointed at, so it opens its own lane and colour.
      lane = firstFreeLane();
      claim(lane, commit.hash);
      if (!colorOf.has(commit.hash)) colorOf.set(commit.hash, nextColor++);
    }
    const colorIndex = colorOf.get(commit.hash) ?? 0;
    nodes.push({ hash: commit.hash, row, lane, colorIndex });
    lanes[lane] = null;

    commit.parents.forEach((parent, index) => {
      const isMerge = index > 0;
      const parentLane = isMerge
        ? placeParent(parent, firstFreeLane(), null)
        : placeParent(parent, lane, colorIndex);
      edges.push({
        fromRow: row,
        toRow: rowOf.get(parent) ?? null,
        fromLane: lane,
        toLane: parentLane,
        // A merge's side edge belongs to the branch it dives into; the mainline edge stays this
        // commit's colour even when the parent it lands on is coloured differently.
        colorIndex: isMerge ? colorOf.get(parent) ?? colorIndex : colorIndex,
        isMerge,
      });
    });
  });

  return { nodes, edges, laneCount };
}
