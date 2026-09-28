// Closed PR tabs stay closed until new commits or a new review request.
// Run via:  npm test
import assert from "node:assert";
import { activeDismissals, dismissalOf, hasChangedSince } from "../packages/shared/src/dismissals.ts";

const item = (extra = {}) => ({
  id: "PR_1",
  key: "acme/api#1",
  headRefOid: "aaa",
  lastReviewRequestAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
  comments: 0,
  section: "review",
  ...extra,
});

const dismissal = dismissalOf(item(), 1000);
assert.deepEqual(dismissal, { headRefOid: "aaa", lastReviewRequestAt: "2026-09-20T10:00:00Z", dismissedAt: 1000 });

assert.equal(hasChangedSince(dismissal, item()), false);
assert.equal(hasChangedSince(dismissal, item({ headRefOid: "bbb" })), true);
assert.equal(hasChangedSince(dismissal, item({ lastReviewRequestAt: "2026-09-21T10:00:00Z" })), true);
assert.equal(hasChangedSince(dismissal, item({ lastReviewRequestAt: "2026-09-19T10:00:00Z" })), false);
assert.equal(hasChangedSince(dismissal, item({ comments: 12, updatedAt: "2026-09-28T10:00:00Z", checks: { state: "failure" } })), false);

{
  const noRequest = dismissalOf(item({ lastReviewRequestAt: undefined }), 1000);
  assert.equal("lastReviewRequestAt" in noRequest, false);
  assert.equal(hasChangedSince(noRequest, item({ lastReviewRequestAt: undefined })), false);
  assert.equal(hasChangedSince(noRequest, item()), true);
}

{
  const dismissed = { PR_1: dismissal, PR_gone: dismissal, PR_pushed: { ...dismissal, headRefOid: "old" } };
  const items = [item(), item({ id: "PR_pushed" })];
  assert.deepEqual(Object.keys(activeDismissals(dismissed, items)), ["PR_1"]);
}

console.log("dismissals: ok");
