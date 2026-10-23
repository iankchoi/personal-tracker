import type { CalendarTaskItem } from "./calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "./google-calendar";

/**
 * The only thing `layoutColumns` actually reads: a block's vertical extent in
 * grid pixels, as a half-open interval `[top, top + height)`. Everything else
 * rides along untouched, which is what lets one call lay out events and tasks
 * together in the same cluster (see `PositionedGridItem`).
 */
export type PositionedBlock = { top: number; height: number };

/**
 * A positioned Day/Week grid block — either a timed event (from
 * `layoutTimedEvents`) or a timed task (given a synthetic fixed height, since
 * tasks carry no duration). Tagged so a renderer can route each to its own
 * visual treatment after both have been laid out as one combined list.
 */
export type PositionedGridItem =
  | ({ kind: "event"; item: GoogleCalendarEvent } & PositionedBlock)
  | ({ kind: "task"; item: CalendarTaskItem } & PositionedBlock);

/** A laid-out block with its side-by-side column assignment. */
export type Columned<T extends PositionedBlock> = T & { column: number; columnCount: number };

/** A `PositionedGridItem` with its side-by-side column assignment. */
export type ColumnedGridItem = Columned<PositionedGridItem>;

/**
 * Assigns each block in `positioned` a `column` (0-indexed) and a shared
 * `columnCount` for every block in its overlap cluster, so overlapping
 * events/tasks render as side-by-side, equal-width columns instead of stacked
 * full-width blocks that hide each other.
 *
 * This is standard greedy interval-graph coloring with cluster-wide peak
 * tracking, swept by `top` (ties broken by longer `height` first, so the
 * widest-reaching block claims column 0):
 *
 * 1. Before placing a block, evict every column whose occupant has already
 *    ended (`top + height <= block.top` — the interval is half-open, so a
 *    block ending exactly when the next starts does *not* keep its column).
 * 2. If that eviction emptied every column, the previous cluster has fully
 *    closed: stamp its members and start fresh at column 0.
 * 3. Otherwise place the block in the lowest-indexed *free* column, reusing a
 *    slot an evicted occupant vacated rather than growing the array forever.
 * 4. `columnCount` for a cluster is its **peak simultaneous occupancy** — the
 *    most columns ever non-empty at one instant during the cluster's run —
 *    not the number of distinct slots the cluster ever allocated. Those two
 *    numbers only coincide when no reuse happened, so the peak is tracked as
 *    its own running maximum rather than derived from the array's length
 *    after the fact.
 *
 * Reusing freed slots (step 3) is what keeps a chain of staggered,
 * back-to-back-ish events — an ordinary busy day — from growing `columnCount`
 * without bound: `a:[0,90) b:[60,150) c:[120,180)` is one connected cluster
 * (a–b overlap, b–c overlap) but is never more than 2 deep at any instant, so
 * all three share `columnCount: 2`, with `a` and `c` both in column 0. Widths
 * stay readable, and no two blocks that are open at the same time ever share
 * a column.
 */
export function layoutColumns<T extends PositionedBlock>(positioned: T[]): Columned<T>[] {
  const sorted = [...positioned].sort((a, b) => {
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    return b.height - a.height;
  });

  const result: Columned<T>[] = [];

  // Columns currently occupied in the cluster being swept, indexed by column
  // number. A `null` entry is a free slot — its previous occupant ended, and
  // the next incoming block may claim it.
  let openColumns: (PositionedBlock | null)[] = [];
  let cluster: (T & { column: number })[] = [];
  // Peak number of simultaneously-occupied columns seen since this cluster's
  // run began. Never decreases while the cluster is open.
  let clusterPeak = 0;

  const occupiedCount = () => openColumns.reduce((count, slot) => (slot === null ? count : count + 1), 0);

  const closeCluster = () => {
    for (const member of cluster) {
      result.push({ ...member, columnCount: clusterPeak } as Columned<T>);
    }
    cluster = [];
    openColumns = [];
    clusterPeak = 0;
  };

  for (const block of sorted) {
    // Evict any column whose occupant ended at or before this block's start —
    // half-open interval, so equality evicts.
    for (let i = 0; i < openColumns.length; i++) {
      const occupant = openColumns[i];
      if (occupant !== null && occupant.top + occupant.height <= block.top) {
        openColumns[i] = null;
      }
    }

    // If that eviction just emptied every column, the previous cluster has
    // fully closed: stamp its members with the peak and start fresh.
    if (cluster.length > 0 && openColumns.every((slot) => slot === null)) {
      closeCluster();
    }

    // Reuse the lowest-indexed free slot; only grow the array when every
    // column is still occupied.
    let column = openColumns.indexOf(null);
    if (column === -1) {
      column = openColumns.length;
      openColumns.push(block);
    } else {
      openColumns[column] = block;
    }

    clusterPeak = Math.max(clusterPeak, occupiedCount());
    cluster.push({ ...block, column });
  }

  if (cluster.length > 0) {
    closeCluster();
  }

  return result;
}
