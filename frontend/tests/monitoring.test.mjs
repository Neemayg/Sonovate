import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTENTION_ORDER,
  STATE_LABEL,
  formatDuration,
  monitoringState,
  nextAction,
  recordingLabel,
  recordingNumbers,
  recordingShortLabel,
  stateSummary,
} from "../src/lib/monitoring.ts";

const m = (o) => ({ analysable: true, baselineCount: 0, checksWithResult: 0, alert: false, ...o });

test("states follow the machine lifecycle", () => {
  assert.equal(monitoringState(m({ analysable: false, alert: true })), "records_only");
  assert.equal(monitoringState(m({ baselineCount: 9 })), "baseline_incomplete");
  assert.equal(monitoringState(m({ baselineCount: 10 })), "ready_first_check");
  assert.equal(monitoringState(m({ baselineCount: 30, checksWithResult: 2 })), "monitoring");
  assert.equal(monitoringState(m({ baselineCount: 30, checksWithResult: 3, alert: true })), "alert");
});

test("an alert wins even if baselines were later deleted", () => {
  assert.equal(monitoringState(m({ baselineCount: 4, checksWithResult: 3, alert: true })), "alert");
});

test("status language never claims health", () => {
  for (const label of Object.values(STATE_LABEL)) assert.doesNotMatch(label, /health|fine|ok\b|normal/i);
  assert.match(stateSummary("monitoring", 30), /does not confirm/);
  assert.equal(stateSummary("baseline_incomplete", 7), "3 more normal recordings needed before the first check.");
  assert.equal(stateSummary("baseline_incomplete", 9), "1 more normal recording needed before the first check.");
});

test("next actions point at the right section", () => {
  assert.deepEqual(nextAction("baseline_incomplete"), { label: "Add baseline recordings", anchor: "baseline" });
  assert.equal(nextAction("ready_first_check").anchor, "check");
  assert.equal(nextAction("alert").anchor, "alert");
  assert.ok(ATTENTION_ORDER.alert < ATTENTION_ORDER.baseline_incomplete);
  assert.ok(ATTENTION_ORDER.ready_first_check < ATTENTION_ORDER.monitoring);
});

test("recordings are numbered per kind by upload order and labelled without filenames", () => {
  const recs = [
    { id: "c", kind: "baseline", created_at: "2026-11-03T10:00:00Z", recorded_at: null },
    { id: "a", kind: "baseline", created_at: "2026-11-01T10:00:00Z", recorded_at: null },
    { id: "y", kind: "analysis", created_at: "2026-11-05T10:00:00Z", recorded_at: null },
    { id: "x", kind: "analysis", created_at: "2026-11-04T10:00:00Z", recorded_at: null },
  ];
  const n = recordingNumbers(recs);
  assert.equal(n.get("a"), 1);
  assert.equal(n.get("c"), 2);
  assert.equal(n.get("x"), 1);
  assert.equal(n.get("y"), 2);
  assert.match(recordingLabel(recs[0], n.get("c")), /^Normal reference 2 · /);
  assert.match(recordingLabel(recs[2], n.get("y")), /^Check 2 · /);
  assert.match(recordingLabel(recs[2]), /^Check · /);
  assert.equal(recordingShortLabel(recs[2], 2), "Check 2");
  assert.equal(recordingShortLabel(recs[0], 2), "Normal reference 2");
});

test("formatDuration", () => {
  assert.equal(formatDuration(10), "10 s");
  assert.equal(formatDuration(60), "1 min");
  assert.equal(formatDuration(65.2), "1 min 5 s");
  assert.equal(formatDuration(null), "—");
});
