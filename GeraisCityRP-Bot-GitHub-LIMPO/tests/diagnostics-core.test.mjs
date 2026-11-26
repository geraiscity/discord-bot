import test from "node:test";
import assert from "node:assert/strict";
import { InteractionMetrics } from "../src/diagnostics-core.ts";

test("metrics use bounded recent samples and count exceptions since startup", () => {
  const metrics = new InteractionMetrics(3);
  assert.equal(metrics.summary().p95, null);
  metrics.record(1, false);
  metrics.record(50, true);
  metrics.record(10, false);
  metrics.record(20, false);
  assert.deepEqual(metrics.summary(), {completed: 4, failures: 1, sampleSize: 3, p50: 20, p95: 50});
});
test("invalid durations are ignored", () => {
  const metrics = new InteractionMetrics();
  metrics.record(-1, true);
  metrics.record(NaN, false);
  assert.equal(metrics.summary().completed, 0);
});
