import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyAuthError, passwordProblem } from "../src/lib/authMessages.ts";

test("codes map to plain text", () => {
  assert.match(friendlyAuthError("invalid_credentials", "x"), /do not match/);
  assert.match(friendlyAuthError("weak_password", "x"), /at least 10 characters/);
  assert.match(friendlyAuthError("over_email_send_rate_limit", "x"), /Too many emails/);
});

test("older message-only errors are recognised", () => {
  assert.match(friendlyAuthError(undefined, "Invalid login credentials"), /do not match/);
  assert.match(friendlyAuthError(null, "User already registered"), /already exists/);
  assert.match(friendlyAuthError(undefined, "TypeError: Failed to fetch"), /could not reach/);
});

test("unknown errors never leak raw text", () => {
  const out = friendlyAuthError("weird_code", "stack trace at line 3");
  assert.doesNotMatch(out, /stack|line 3/);
});

test("password policy mirrors the production settings", () => {
  assert.match(passwordProblem("short1"), /at least 10/);
  assert.match(passwordProblem("onlyletterslong"), /letters and numbers/);
  assert.match(passwordProblem("1234567890123"), /letters and numbers/);
  assert.equal(passwordProblem("machine-sound-42"), null);
});
