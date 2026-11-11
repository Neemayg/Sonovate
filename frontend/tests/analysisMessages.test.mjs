import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyAnalysisError } from "../src/lib/analysisMessages.ts";

test("known service codes get plain text and a retry hint", () => {
  for (const code of ["rate_limited", "model_busy", "unreachable", "analysis_in_progress", "upstream_unavailable"]) {
    assert.equal(friendlyAnalysisError(code, "raw").retryable, true, code);
  }
  assert.equal(friendlyAnalysisError("unauthenticated", "raw").retryable, false);
  assert.match(friendlyAnalysisError("model_busy", "raw").message, /saved/);
});

test("invalid audio codes keep the service detail and are not retryable", () => {
  const e = friendlyAnalysisError("wrong_duration", "Recording must be 10 to 60 s.");
  assert.equal(e.retryable, false);
  assert.match(e.message, /10 to 60 s/);
});

test("baseline_invalid keeps the message naming the baseline", () => {
  assert.equal(friendlyAnalysisError("baseline_invalid", "Baseline x.wav is missing.").message, "Baseline x.wav is missing.");
});

test("unknown codes fall back to the service message", () => {
  const e = friendlyAnalysisError("something_new", "Readable message.");
  assert.equal(e.message, "Readable message.");
  assert.equal(e.retryable, true);
});
