// Inbox classification and GitHub response handling, against a synthetic
// fixture modelled on the screenshot cases in docs/PLAN.md. Run via:  npm test
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { buildInbox, truncatedSources } from "../packages/shared/src/inbox.ts";
import { buildQuery, interpretGraphql } from "../packages/shared/src/github.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/inbox.json", import.meta.url), "utf8"));
const raw = fixture.data;
const now = Date.parse("2026-09-28T12:00:00Z");
const items = buildInbox(raw, { staleDays: 30, now });
const byNumber = (repo, n) => items.find((item) => item.repo === repo && item.number === n);
const placement = (repo, n) => {
  const item = byNumber(repo, n);
  return item && [item.section, item.label];
};

// Review requests: direct beats team, team-only goes to the team section.
assert.deepEqual(placement("acme/api", 88), ["review", undefined]);
assert.deepEqual(placement("Acme/Web", 12), ["review", undefined]);
assert.deepEqual(placement("acme/infra", 5), ["team", undefined]);
assert.equal(items.filter((item) => item.id === "PR_api_88").length, 1);

// Screenshot cases: conflicts with CI pending, approved with a stuck check suite.
assert.deepEqual(placement("acme/website", 204), ["waiting", "awaitingCi"]);
assert.deepEqual(placement("acme/landing", 157), ["waiting", "awaitingCi"]);

assert.deepEqual(placement("acme/docs", 9), ["drafts", "notReady"]);
assert.deepEqual(placement("acme/cli", 40), ["ready", "readyToMerge"]);
assert.deepEqual(placement("acme/cli", 41), ["action", "changesRequested"]);
assert.deepEqual(placement("acme/cli", 42), ["action", "checksFailing"]);
assert.deepEqual(placement("acme/cli", 43), ["action", "outOfDate"]);
assert.deepEqual(placement("acme/cli", 45), ["ready", "inMergeQueue"]);
assert.deepEqual(placement("acme/cli", 46), ["waiting", "awaitingApproval"]);
assert.deepEqual(placement("acme/cli", 47), ["waiting", "awaitingApproval"]);

// Stale filter: only authored PRs, and 0 turns it off.
assert.equal(byNumber("acme/docs", 3), undefined);
assert.equal(buildInbox(raw, { staleDays: 0, now }).find((i) => i.id === "PR_docs_3")?.section, "drafts");
{
  const muchLater = Date.parse("2027-06-01T00:00:00Z");
  const later = buildInbox(raw, { staleDays: 30, now: muchLater });
  assert.equal(later.filter((item) => item.section === "review").length, 2);
  assert.equal(later.filter((item) => item.section === "team").length, 1);
  assert.equal(later.filter((item) => !["review", "team"].includes(item.section)).length, 0);
}

// UNKNOWN merge state: previous section kept, fallback without one.
assert.deepEqual(placement("acme/cli", 44), ["waiting", "awaitingApproval"]);
{
  const previous = { items: [{ ...byNumber("acme/cli", 44), section: "ready", label: "readyToMerge" }], truncated: [] };
  const again = buildInbox(raw, { previous, staleDays: 30, now });
  const item = again.find((i) => i.id === "PR_cli_44");
  assert.deepEqual([item.section, item.label], ["ready", "readyToMerge"]);
}

// Checks x/y: check runs + status contexts; SKIPPED/NEUTRAL count as passed.
assert.deepEqual(byNumber("acme/api", 88).checks, { passed: 10, total: 10, state: "success" });
assert.deepEqual(byNumber("Acme/Web", 12).checks, { passed: 6, total: 9, state: "failure" });
assert.deepEqual(byNumber("acme/cli", 40).checks, { passed: 6, total: 6, state: "success" });
assert.deepEqual(byNumber("acme/website", 204).checks, { passed: 3, total: 5, state: "pending" });
assert.equal(byNumber("acme/infra", 5).checks, undefined);

// Review requests for the viewer only; team requests count on team PRs.
assert.equal(byNumber("acme/api", 88).lastReviewRequestAt, "2026-09-25T09:00:00Z");
assert.equal(byNumber("acme/infra", 5).lastReviewRequestAt, "2026-09-24T09:00:00Z");

// Keys are lowercase and match any sub-page.
assert.equal(byNumber("Acme/Web", 12).key, "acme/web#12");
assert.equal(byNumber("acme/api", 88).comments, 3);

assert.deepEqual(truncatedSources(raw), ["authored"]);

// Query: one alias per requested source, the fragment always present.
{
  const query = buildQuery(["review", "authored"]);
  assert.match(query, /review: search\(type: ISSUE_ADVANCED/);
  assert.match(query, /authored: search\(/);
  assert.doesNotMatch(query, /team: search\(/);
  assert.match(query, /fragment Pr on PullRequest/);
}

// GitHub responses.
{
  const ok = interpretGraphql(200, fixture, null, now);
  assert.equal(ok.ok, true);
  assert.equal(ok.ssoRequired, false);
  assert.equal(ok.retryAfter, undefined);

  const sso = interpretGraphql(200, { ...fixture, errors: [{ type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement." }] }, null, now);
  assert.equal(sso.ok && sso.ssoRequired, true);
  assert.equal(interpretGraphql(200, fixture, "partial-results; organizations=123", now).ssoRequired, true);

  const limited = interpretGraphql(200, { data: null, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }, null, now);
  assert.deepEqual(limited, { ok: false, error: { kind: "rate-limited", until: now + 60_000 } });

  const exhausted = interpretGraphql(200, { data: { ...raw, rateLimit: { cost: 2, remaining: 1, resetAt: "2026-09-28T13:00:00Z" } } }, null, now);
  assert.equal(exhausted.ok && exhausted.retryAfter, Date.parse("2026-09-28T13:00:00Z"));

  const broken = interpretGraphql(502, { errors: [{ message: "Something went wrong" }] }, null, now);
  assert.deepEqual(broken, { ok: false, error: { kind: "github", message: "Something went wrong" } });
}

console.log("inbox: ok");
