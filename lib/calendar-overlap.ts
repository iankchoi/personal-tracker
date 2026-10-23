import type { PositionedEvent } from "./calendar-layout";

/** A `PositionedEvent` with its side-by-side column assignment for rendering overlapping events. */
export type ColumnedEvent = PositionedEvent & { column: number; columnCount: number };

/**
 * Assigns each event in `positioned` a `column` (0-indexed) and a shared
 * `columnCount` for every event in its overlap cluster, so overlapping
 * events can be rendered as side-by-side, equal-width columns instead of
 * stacked full-width blocks.
 *
 * Classic sweep-line column assignment, swept by `top` (ties broken by
 * longer `height` first, so the widest-reaching event claims column 0):
 * walk the events in order, maintaining the set of columns currently "open"
 * (occupied by an event that hasn't ended yet, half-open interval — an
 * event ending exactly when the next starts does NOT keep its column open).
 *
 * Column numbers are retired for the rest of a cluster's lifetime once
 * assigned — even if the event occupying a column ends and every other
 * still-open column remains occupied, that freed column is *not* handed to
 * the next incoming event. It only becomes available again once the whole
 * cluster closes (every column empties out simultaneously), at which point
 * the next event starts a brand-new cluster at column 0. This is what makes
 * transitive clusters work: if A overlaps B and B overlaps C but A and C
 * don't overlap each other, A ending before C starts must not let C reuse
 * A's column — A, B, and C are all still one connected overlap cluster, and
 * giving C a fresh column keeps every member of that cluster at a distinct,
 * stable column for its entire rendered lifetime. `columnCount` for a
 * cluster is therefore the total number of distinct columns it ever opened
 * (`openColumns.length`, which only grows via push and is reset to 0 only
 * on a full closure), not the smaller number that would suffice to avoid
 * visual overlap at any single instant.
 */
export function layoutColumns(positioned: PositionedEvent[]): ColumnedEvent[] {
  const sorted = [...positioned].sort((a, b) => {
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    return b.height - a.height;
  });

  const result: ColumnedEvent[] = [];

  // Columns currently open in the cluster being swept. A `null` entry is a
  // column whose occupant has ended but hasn't yet been reclaimed by a full
  // cluster closure (see the eviction step below) — it stays retired, not
  // reusable, until then.
  let openColumns: (PositionedEvent | null)[] = [];
  let cluster: Omit<ColumnedEvent, "columnCount">[] = [];

  const closeCluster = () => {
    const columnCount = openColumns.length;
    for (const member of cluster) {
      result.push({ ...member, columnCount });
    }
    cluster = [];
    openColumns = [];
  };

  for (const event of sorted) {
    // Evict any column whose occupant ended at or before this event's
    // start — half-open interval, so equality evicts.
    for (let i = 0; i < openColumns.length; i++) {
      const occupant = openColumns[i];
      if (occupant !== null && occupant.top + occupant.height <= event.top) {
        openColumns[i] = null;
      }
    }

    // If that eviction just emptied every column, the previous cluster has
    // fully closed: stamp its members with the final column count and
    // start fresh.
    if (cluster.length > 0 && openColumns.every((slot) => slot === null)) {
      closeCluster();
    }

    // Still inside an open cluster (or starting a brand-new one): always
    // claim a fresh column rather than reusing one freed by eviction above.
    const column = openColumns.length;
    openColumns.push(event);
    cluster.push({ ...event, column });
  }

  if (cluster.length > 0) {
    closeCluster();
  }

  return result;
}
