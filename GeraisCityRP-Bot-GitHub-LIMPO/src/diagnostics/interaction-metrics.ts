export class InteractionMetrics {
  private samples: number[] = [];
  private completed = 0;
  private failures = 0;
  private readonly limit: number;
  constructor(limit = 200) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid sample limit");
    this.limit = limit;
  }
  record(durationMs: number, failed: boolean): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.completed++;
    if (failed) this.failures++;
    this.samples.push(durationMs);
    if (this.samples.length > this.limit) this.samples.shift();
  }
  summary() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length
      ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!) : null;
    return { completed: this.completed, failures: this.failures, sampleSize: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
  }
}
export const interactionMetrics = new InteractionMetrics();
