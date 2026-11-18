export interface PerfSample {
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  maxEntities: number;
  avgEntities: number;
  /** JS time spent in simulation + scene update + render submission per frame. */
  avgWorkMs: number;
  p95WorkMs: number;
}

/** Records frame times and entity counts with a fixed-size buffer (no per-frame allocation). */
export class PerfMonitor {
  private readonly frameMs: Float32Array;
  private readonly workMs: Float32Array;
  private count = 0;
  private cursor = 0;
  private totalMs = 0;
  private totalFrames = 0;
  private entitySum = 0;
  private entityMax = 0;

  constructor(capacity = 60 * 200) {
    this.frameMs = new Float32Array(capacity);
    this.workMs = new Float32Array(capacity);
  }

  private workSum = 0;

  record(frameMs: number, entities: number, workMs = 0): void {
    this.frameMs[this.cursor] = frameMs;
    this.workMs[this.cursor] = workMs;
    this.workSum += workMs;
    this.cursor = (this.cursor + 1) % this.frameMs.length;
    this.count = Math.min(this.count + 1, this.frameMs.length);
    this.totalMs += frameMs;
    this.totalFrames++;
    this.entitySum += entities;
    if (entities > this.entityMax) this.entityMax = entities;
  }

  reset(): void {
    this.count = 0;
    this.cursor = 0;
    this.totalMs = 0;
    this.totalFrames = 0;
    this.entitySum = 0;
    this.entityMax = 0;
    this.workSum = 0;
  }

  sample(): PerfSample {
    const arr = Array.from(this.frameMs.subarray(0, this.count)).sort((a, b) => a - b);
    const pct = (p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]! : 0);
    const work = Array.from(this.workMs.subarray(0, this.count)).sort((a, b) => a - b);
    return {
      avgWorkMs: this.totalFrames ? this.workSum / this.totalFrames : 0,
      p95WorkMs: work.length ? work[Math.min(work.length - 1, Math.floor(work.length * 0.95))]! : 0,
      frames: this.totalFrames,
      avgFps: this.totalMs > 0 ? (this.totalFrames * 1000) / this.totalMs : 0,
      p95FrameMs: pct(0.95),
      p99FrameMs: pct(0.99),
      maxFrameMs: arr.length ? arr[arr.length - 1]! : 0,
      maxEntities: this.entityMax,
      avgEntities: this.totalFrames ? this.entitySum / this.totalFrames : 0,
    };
  }
}
