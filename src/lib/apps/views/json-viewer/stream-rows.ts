/**
 * Bounded lazy row projection over streaming parser events.
 * Containers keep child counts and source spans; child rows are materialized
 * only when a caller requests a window.
 */
import {
  STREAM_ROW_BUFFER_LIMIT,
  type StreamEvent,
  type StreamCheckpoint,
  type ScalarKind,
  type ContainerKind,
} from "./stream-protocol";

export interface StreamRow {
  id: number;
  parentId: number | null;
  kind: ScalarKind | ContainerKind;
  depth: number;
  start: number;
  end: number;
  name: string | null;
  preview: string;
  childCount: number;
  aggregate: boolean;
  skipped: boolean;
  expanded: boolean;
}

export interface ReadRowsResult {
  rows: StreamRow[];
  nextOffset: number;
  truncated: boolean;
}

export interface StreamRowModelOptions {
  rowLimit?: number;
  aggregateThreshold?: number;
}

const DEFAULT_AGGREGATE_THRESHOLD = 2_000;

export class StreamRowModel {
  readonly #rows: StreamRow[] = [];
  readonly #byId = new Map<number, StreamRow>();
  readonly #children = new Map<number, number[]>();
  readonly #pendingNames = new Map<number, string>();
  readonly #checkpoints: StreamCheckpoint[] = [];
  readonly #rowLimit: number;
  readonly #aggregateThreshold: number;
  #stack: number[] = [];
  #nextId = 0;
  #truncated = false;

  constructor(options: StreamRowModelOptions = {}) {
    this.#rowLimit = options.rowLimit ?? STREAM_ROW_BUFFER_LIMIT;
    this.#aggregateThreshold = options.aggregateThreshold ?? DEFAULT_AGGREGATE_THRESHOLD;
  }

  get size(): number {
    return this.#rows.length;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  get checkpoints(): readonly StreamCheckpoint[] {
    return this.#checkpoints;
  }

  addCheckpoint(checkpoint: StreamCheckpoint): void {
    const previous = this.#checkpoints.at(-1);
    if (!previous || checkpoint.offset > previous.offset) this.#checkpoints.push(checkpoint);
  }

  append(events: readonly StreamEvent[]): void {
    for (const event of events) {
      if (this.#rows.length >= this.#rowLimit) {
        this.#truncated = true;
        return;
      }
      this.#appendEvent(event);
    }
  }

  readRows(offset: number, max: number): ReadRowsResult {
    const start = Math.max(0, Math.floor(offset));
    const count = Math.max(0, Math.min(Math.floor(max), 10_000));
    const rows = this.#rows.slice(start, start + count).map((row) => ({ ...row }));
    return { rows, nextOffset: start + rows.length, truncated: this.#truncated };
  }

  visibleRows(openIds: ReadonlySet<number>, start = 0, count = 1_000): ReadRowsResult {
    const flattened: StreamRow[] = [];
    const roots = this.#children.get(-1) ?? [];
    const stack = roots.slice().reverse();
    while (stack.length > 0 && flattened.length <= start + count) {
      const id = stack.pop();
      if (id === undefined) continue;
      const row = this.#byId.get(id);
      if (!row) continue;
      flattened.push(row);
      if (openIds.has(id) && !row.aggregate) {
        const children = this.#children.get(id) ?? [];
        if (row.childCount >= this.#aggregateThreshold) {
          const aggregate = this.#aggregateRow(row, children.length);
          flattened.push(aggregate);
          if (!openIds.has(aggregate.id)) continue;
        }
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const childId = children[i];
          if (childId !== undefined) stack.push(childId);
        }
      }
    }
    const rows = flattened
      .slice(start, start + count)
      .map((row) => ({ ...row, expanded: openIds.has(row.id) }));
    return { rows, nextOffset: start + rows.length, truncated: this.#truncated };
  }

  visibleCount(openIds: ReadonlySet<number>): number {
    const roots = this.#children.get(-1) ?? [];
    return roots.reduce((total, id) => total + this.#visibleCountOf(id, openIds), 0);
  }

  #visibleCountOf(id: number, openIds: ReadonlySet<number>): number {
    const row = this.#byId.get(id);
    if (!row || !openIds.has(id) || row.aggregate || row.childCount === 0) return 1;
    const children = this.#children.get(id) ?? [];
    if (row.childCount >= this.#aggregateThreshold) {
      const aggregateId = -row.id - 1;
      return (
        1 +
        (openIds.has(aggregateId)
          ? children.reduce((total, childId) => total + this.#visibleCountOf(childId, openIds), 0)
          : 1)
      );
    }
    return (
      1 + children.reduce((total, childId) => total + this.#visibleCountOf(childId, openIds), 0)
    );
  }

  childrenOf(id: number, offset = 0, max = 200): ReadRowsResult {
    const row = this.#byId.get(id);
    const ids = this.#children.get(id) ?? [];
    const start = Math.max(0, Math.floor(offset));
    const count = Math.max(0, Math.min(Math.floor(max), 10_000));
    if (row && start === 0 && row.childCount >= this.#aggregateThreshold && !row.aggregate) {
      const aggregate = this.#aggregateRow(row, ids.length);
      return { rows: [aggregate], nextOffset: 1, truncated: this.#truncated };
    }
    const rows = ids.slice(start, start + count).flatMap((childId) => {
      const child = this.#byId.get(childId);
      return child ? [{ ...child }] : [];
    });
    return { rows, nextOffset: start + rows.length, truncated: this.#truncated };
  }

  nearestCheckpoint(offset: number): StreamCheckpoint | undefined {
    let low = 0;
    let high = this.#checkpoints.length - 1;
    let best: StreamCheckpoint | undefined;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const checkpoint = this.#checkpoints[mid];
      if (!checkpoint) break;
      if (checkpoint.offset <= offset) {
        best = checkpoint;
        low = mid + 1;
      } else high = mid - 1;
    }
    return best;
  }

  #appendEvent(event: StreamEvent): void {
    if (event.type === "end") {
      const id = this.#stack.pop();
      if (id !== undefined) {
        const row = this.#byId.get(id);
        if (row) row.end = event.end;
      }
      return;
    }
    const parentId = this.#stack.at(-1) ?? null;
    const parent = parentId === null ? null : this.#byId.get(parentId);
    let kind: StreamRow["kind"];
    let preview = "";
    let skipped = false;
    if (event.type === "start") kind = event.kind;
    else if (event.type === "key") {
      if (parentId !== null) this.#pendingNames.set(parentId, event.preview);
      return;
    } else {
      kind = event.kind;
      preview = event.preview;
      skipped = event.skipped;
    }
    const row: StreamRow = {
      id: this.#nextId++,
      parentId,
      kind,
      depth: event.depth,
      start: event.start,
      end: event.end,
      name: parentId === null ? null : (this.#pendingNames.get(parentId) ?? null),
      preview,
      childCount: 0,
      aggregate: false,
      skipped,
      expanded: false,
    };
    this.#rows.push(row);
    this.#byId.set(row.id, row);
    if (parentId !== null) this.#pendingNames.delete(parentId);
    const siblingIds = this.#children.get(parentId ?? -1) ?? [];
    siblingIds.push(row.id);
    this.#children.set(parentId ?? -1, siblingIds);
    if (parent) parent.childCount += 1;
    if (event.type === "start") this.#stack.push(row.id);
  }

  #aggregateRow(row: StreamRow, childCount: number): StreamRow {
    return {
      id: -row.id - 1,
      parentId: row.id,
      kind: row.kind,
      depth: row.depth + 1,
      start: row.start,
      end: row.end,
      name: null,
      preview: `${row.childCount} items`,
      childCount,
      aggregate: true,
      skipped: false,
      expanded: false,
    };
  }
}
