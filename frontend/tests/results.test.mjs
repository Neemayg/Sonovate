import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountNextAction,
  activityFeed,
  attentionReason,
  checkResults,
  groupBaselineUploads,
  matchesResultFilter,
  neighbours,
  overviewCounts,
  resultSummary,
  thresholdVaries,
} from "../src/lib/results.ts";

const pred = (o) => ({
  created_at: "2026-11-10T10:00:00Z",
  decision: "below_threshold",
  log_score: 1.0,
  score: Math.exp(1.0),
  threshold: 1.2,
  window_count: 6,
  sensitivity: "standard",
  baseline_count: 30,
  ...o,
});
const entry = (id, kind, created_at, predictions = []) => ({
  id,
  kind,
  created_at,
  recorded_at: null,
  original_filename: `${id}.wav`,
  duration_seconds: 60,
  predictions,
});

test("checkResults keeps the latest stored result per check, in check order", () => {
  const entries = [
    entry("b1", "baseline", "2026-11-01T00:00:00Z"),
    entry("c2", "analysis", "2026-11-03T00:00:00Z", [pred({ decision: "above_threshold", log_score: 1.5 })]),
    entry("c1", "analysis", "2026-11-02T00:00:00Z", [
      pred({ created_at: "2026-11-02T01:00:00Z", decision: "above_threshold", log_score: 1.4 }),
      pred({ created_at: "2026-11-02T02:00:00Z", decision: "below_threshold", log_score: 0.9 }),
    ]),
    entry("c3", "analysis", "2026-11-04T00:00:00Z"),
  ];
  const numbers = new Map([["c1", 1], ["c2", 2], ["c3", 3], ["b1", 1]]);
  const r = checkResults(entries, numbers);
  assert.deepEqual(r.map((x) => x.recordingId), ["c1", "c2"]);
  assert.equal(r[0].above, false);
  assert.equal(r[0].logScore, 0.9);
  assert.equal(r[1].threshold, 1.2);
});

test("a missing log score falls back to the log of the stored score", () => {
  const r = checkResults([entry("c1", "analysis", "2026-11-02T00:00:00Z", [pred({ log_score: null, score: Math.E ** 2 })])], new Map([["c1", 1]]));
  assert.ok(Math.abs(r[0].logScore - 2) < 1e-12);
});

test("summary counts and wording never claim health or a fault", () => {
  const s = resultSummary([{ above: true }, { above: false }, { above: true }]);
  assert.equal(s.analysed, 3);
  assert.equal(s.above, 2);
  assert.equal(s.within, 1);
  assert.equal(s.headline, "2 of 3 checks were above this machine's expected acoustic range.");
  for (const x of [[], [{ above: false }], [{ above: true }], [{ above: true }, { above: false }]]) {
    const t = resultSummary(x);
    assert.doesNotMatch(`${t.headline} ${t.interpretation}`, /healthy|probability|failure|diagnos/i);
  }
  assert.match(resultSummary([{ above: false }]).interpretation, /does not confirm/);
  assert.match(resultSummary([{ above: true }]).headline, /^1 of 1 check was above/);
});

test("filters and neighbours", () => {
  assert.equal(matchesResultFilter({ above: true }, "above"), true);
  assert.equal(matchesResultFilter({ above: true }, "within"), false);
  assert.equal(matchesResultFilter({ above: false }, "all"), true);
  const list = [{ recordingId: "a" }, { recordingId: "b" }, { recordingId: "c" }];
  assert.deepEqual(neighbours(list, "b"), { previous: list[0], next: list[2], index: 1 });
  assert.deepEqual(neighbours(list, "a").previous, null);
  assert.deepEqual(neighbours(list, "z"), { previous: null, next: null, index: -1 });
});

test("thresholdVaries detects differing applied thresholds", () => {
  assert.equal(thresholdVaries([{ threshold: 1 }, { threshold: 1 }]), false);
  assert.equal(thresholdVaries([{ threshold: 1 }, { threshold: 1.1 }]), true);
});

const machine = (o) => ({ id: o.name, name: "M", analysable: true, baselineCount: 30, alert: false, latestCheck: null, ...o });
const check = (above, created_at = "2026-11-10T00:00:00Z") => ({ above, created_at, recording_id: `r-${created_at}` });

test("attention: alert outranks a single flagged check; records-only never needs attention", () => {
  assert.equal(attentionReason(machine({ alert: true, latestCheck: check(false) })), "alert");
  assert.equal(attentionReason(machine({ latestCheck: check(true) })), "latest_above");
  assert.equal(attentionReason(machine({ latestCheck: check(false) })), null);
  assert.equal(attentionReason(machine({ analysable: false, alert: true })), null);
});

test("overview counts are exact", () => {
  const c = overviewCounts([
    machine({ name: "a", alert: true }),
    machine({ name: "b", latestCheck: check(true) }),
    machine({ name: "c", baselineCount: 4 }),
    machine({ name: "d", analysable: false, baselineCount: 0 }),
  ]);
  assert.deepEqual(c, { machines: 4, attention: 2, ready: 2 });
});

test("account next action follows the operator journey", () => {
  assert.equal(accountNextAction([]).kind, "register");
  const alerting = machine({ name: "Z", alert: true, latestCheck: check(true) });
  const next = accountNextAction([machine({ name: "A", baselineCount: 3 }), alerting]);
  assert.equal(next.kind, "attention");
  assert.equal(next.recordingId, alerting.latestCheck.recording_id);
  assert.equal(accountNextAction([machine({ name: "A", baselineCount: 3 }), machine({ name: "B", baselineCount: 7 })]).machine.name, "B");
  assert.equal(accountNextAction([machine({ name: "A" })]).kind, "first_check");
  const older = machine({ name: "Old", latestCheck: check(false, "2026-11-01T00:00:00Z") });
  const newer = machine({ name: "New", latestCheck: check(false, "2026-11-09T00:00:00Z") });
  const routine = accountNextAction([newer, older]);
  assert.equal(routine.kind, "check");
  assert.equal(routine.machine.name, "Old");
  assert.equal(accountNextAction([machine({ name: "X", analysable: false })]).kind, "records_only");
});

test("baseline uploads group per machine and day; feed is newest first", () => {
  const g = groupBaselineUploads([
    { machineId: "m", machineName: "M", created_at: "2026-11-10T09:00:00" },
    { machineId: "m", machineName: "M", created_at: "2026-11-10T11:00:00" },
    { machineId: "m", machineName: "M", created_at: "2026-11-12T09:00:00" },
    { machineId: "n", machineName: "N", created_at: "2026-11-10T09:00:00" },
  ]);
  assert.equal(g.length, 3);
  const m10 = g.find((x) => x.machineId === "m" && x.count === 2);
  assert.equal(m10.at, "2026-11-10T11:00:00");
  const feed = activityFeed(g, 2);
  assert.equal(feed.length, 2);
  assert.equal(feed[0].at, "2026-11-12T09:00:00");
});
