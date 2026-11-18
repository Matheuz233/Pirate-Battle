import { pointInRect, segmentIntersectsRect, type Rect } from '../core/math';

const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Grid flow field toward a target (the player). Enemies that cannot see the player
 * follow the gradient around islands. Cheap enough to rebuild a few times per second.
 */
export class FlowField {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly cost: Float32Array;
  private readonly heap: number[] = [];
  private targetCell = -1;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
    obstacles: readonly Rect[],
    clearance: number,
  ) {
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.cost = new Float32Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * cellSize;
        const y = (r + 0.5) * cellSize;
        const edge = x < clearance * 0.5 || y < clearance * 0.5 || x > width - clearance * 0.5 || y > height - clearance * 0.5;
        this.blocked[r * this.cols + c] = edge || obstacles.some((o) => pointInRect(x, y, o, clearance)) ? 1 : 0;
      }
    }
  }

  cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return r * this.cols + c;
  }

  /** Dijkstra from the target cell. Skips work if the target cell did not change. */
  update(targetX: number, targetY: number, force = false): void {
    const target = this.nearestFree(this.cellOf(targetX, targetY));
    if (!force && target === this.targetCell) return;
    this.targetCell = target;
    this.cost.fill(Infinity);
    this.cost[target] = 0;
    const heap = this.heap;
    heap.length = 0;
    heap.push(target);
    while (heap.length) {
      // Small grids: a linear-scan priority queue is simple and fast enough.
      let best = 0;
      for (let i = 1; i < heap.length; i++) {
        if ((this.cost[heap[i]!] ?? Infinity) < (this.cost[heap[best]!] ?? Infinity)) best = i;
      }
      const cell = heap[best]!;
      heap[best] = heap[heap.length - 1]!;
      heap.pop();
      const cc = cell % this.cols;
      const cr = (cell - cc) / this.cols;
      const base = this.cost[cell]!;
      for (const [dc, dr, w] of NEIGHBORS) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const n = nr * this.cols + nc;
        if (this.blocked[n]) continue;
        // Prevent diagonal corner cutting.
        if (dc !== 0 && dr !== 0 && (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc])) continue;
        const next = base + w;
        if (next < this.cost[n]!) {
          if (this.cost[n] === Infinity) heap.push(n);
          this.cost[n] = next;
        }
      }
    }
  }

  /** Returns the world-space point an agent at (x, y) should steer toward. */
  nextWaypoint(x: number, y: number): { x: number; y: number } | null {
    const cell = this.nearestFree(this.cellOf(x, y));
    const cc = cell % this.cols;
    const cr = (cell - cc) / this.cols;
    let best = -1;
    let bestCost = this.cost[cell] ?? Infinity;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const n = nr * this.cols + nc;
      if (this.blocked[n]) continue;
      if (dc !== 0 && dr !== 0 && (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc])) continue;
      const c = this.cost[n]!;
      if (c < bestCost) {
        bestCost = c;
        best = n;
      }
    }
    if (best < 0) return null;
    const bc = best % this.cols;
    const br = (best - bc) / this.cols;
    return { x: (bc + 0.5) * this.cellSize, y: (br + 0.5) * this.cellSize };
  }

  isBlockedAt(x: number, y: number): boolean {
    return this.blocked[this.cellOf(x, y)] === 1;
  }

  private nearestFree(cell: number): number {
    if (!this.blocked[cell]) return cell;
    const cc = cell % this.cols;
    const cr = (cell - cc) / this.cols;
    for (let radius = 1; radius < Math.max(this.cols, this.rows); radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const n = nr * this.cols + nc;
          if (!this.blocked[n]) return n;
        }
      }
    }
    return cell;
  }
}

export function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  obstacles: readonly Rect[],
  pad: number,
): boolean {
  for (const o of obstacles) {
    if (segmentIntersectsRect(x0, y0, x1, y1, o, pad)) return false;
  }
  return true;
}
