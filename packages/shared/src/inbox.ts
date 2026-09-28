// Raw search results → one PrItem per PR, each in the section GitHub's Inbox
// would show it in. The rules are a heuristic (GitHub doesn't document
// them); see "Sections" in docs/PLAN.md. The first matching rule wins.

import type { InboxError, RawInbox, RawPullRequest, Source } from "./github.ts";
import { prKey } from "./prs.ts";
import type { SectionId } from "./settings.ts";

export type StatusLabel =
  | "notReady"
  | "inMergeQueue"
  | "awaitingCi"
  | "checksFailing"
  | "changesRequested"
  | "mergeConflicts"
  | "outOfDate"
  | "awaitingApproval"
  | "readyToMerge";

export type ChecksState = "success" | "failure" | "pending";

export interface Checks {
  passed: number;
  total: number;
  state: ChecksState;
}

export interface PrItem {
  id: string;
  key: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  updatedAt: string;
  headRefOid: string;
  comments: number;
  checks?: Checks;
  section: SectionId;
  label?: StatusLabel;
  lastReviewRequestAt?: string;
}

export interface Inbox {
  items: PrItem[];
  truncated: Source[];
  viewer?: string;
  fetchedAt?: number;
  attemptedAt?: number;
  error?: InboxError;
  ssoRequired?: boolean;
}

export const AUTHORED_SECTIONS: ReadonlySet<SectionId> = new Set(["drafts", "waiting", "action", "ready"]);
export const SECTION_SOURCE: Record<SectionId, Source> = {
  review: "review",
  team: "team",
  drafts: "authored",
  waiting: "authored",
  action: "authored",
  ready: "authored",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSED_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RUNNING_SUITE_STATES = new Set(["QUEUED", "IN_PROGRESS"]);

type Placement = Pick<PrItem, "section" | "label">;

export interface BuildOptions {
  previous?: Inbox;
  staleDays: number;
  now: number;
}

export function buildInbox(raw: RawInbox, { previous, staleDays, now }: BuildOptions): PrItem[] {
  const viewer = raw.viewer.login;
  const previousById = new Map(previous?.items.map((item) => [item.id, item]));
  const staleBefore = staleDays > 0 ? now - staleDays * DAY_MS : -Infinity;
  const seen = new Set<string>();
  const items: PrItem[] = [];

  const add = (source: Source, placementOf: (pr: RawPullRequest) => Placement | undefined) => {
    for (const pr of pullRequests(raw, source)) {
      if (seen.has(pr.id)) continue;
      const placement = placementOf(pr);
      if (!placement) continue;
      seen.add(pr.id);
      const item = toItem(pr, placement, lastReviewRequestFor(pr, viewer, source === "team"));
      if (item) items.push(item);
    }
  };

  add("review", () => ({ section: "review" }));
  add("team", () => ({ section: "team" }));
  add("authored", (pr) =>
    Date.parse(pr.updatedAt) < staleBefore ? undefined : classifyAuthored(pr, previousById.get(pr.id))
  );
  return items;
}

export function truncatedSources(raw: RawInbox): Source[] {
  return (["review", "team", "authored"] as const).filter((source) => {
    const search = raw[source];
    return search ? search.issueCount > search.nodes.length : false;
  });
}

function pullRequests(raw: RawInbox, source: Source): RawPullRequest[] {
  return (raw[source]?.nodes ?? []).filter((node): node is RawPullRequest => !!node && "id" in node);
}

export function classifyAuthored(pr: RawPullRequest, previous?: PrItem): Placement {
  if (pr.isDraft) return { section: "drafts", label: "notReady" };
  if (pr.isInMergeQueue) return { section: "ready", label: "inMergeQueue" };
  const rollup = rollupOf(pr);
  if (rollup?.state === "PENDING" || checkSuitesRunning(pr)) return { section: "waiting", label: "awaitingCi" };
  if (rollup?.state === "FAILURE" || rollup?.state === "ERROR") return { section: "action", label: "checksFailing" };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { section: "action", label: "changesRequested" };
  if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN") {
    if (previous && AUTHORED_SECTIONS.has(previous.section)) return { section: previous.section, label: previous.label };
    return { section: "waiting", label: "awaitingApproval" };
  }
  if (pr.mergeable === "CONFLICTING") return { section: "action", label: "mergeConflicts" };
  if (pr.mergeStateStatus === "BEHIND") return { section: "action", label: "outOfDate" };
  if (pr.reviewDecision === "REVIEW_REQUIRED") return { section: "waiting", label: "awaitingApproval" };
  const approvedOrNotRequired = pr.reviewDecision === "APPROVED" || pr.reviewDecision === null;
  if (approvedOrNotRequired && (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS")) {
    return { section: "ready", label: "readyToMerge" };
  }
  return { section: "waiting", label: "awaitingApproval" };
}

function lastCommit(pr: RawPullRequest) {
  return pr.commits.nodes.at(-1)?.commit;
}

function rollupOf(pr: RawPullRequest) {
  return lastCommit(pr)?.statusCheckRollup ?? undefined;
}

function checkSuitesRunning(pr: RawPullRequest): boolean {
  return (lastCommit(pr)?.checkSuites?.nodes ?? []).some((suite) => !!suite && RUNNING_SUITE_STATES.has(suite.status));
}

export function checksOf(pr: RawPullRequest): Checks | undefined {
  const rollup = rollupOf(pr);
  if (!rollup) return undefined;
  const { contexts } = rollup;
  const total = contexts.checkRunCount + contexts.statusContextCount;
  if (total === 0) return undefined;
  const passed = [...(contexts.checkRunCountsByState ?? []), ...(contexts.statusContextCountsByState ?? [])]
    .filter(({ state }) => PASSED_STATES.has(state))
    .reduce((sum, { count }) => sum + count, 0);
  const state: ChecksState =
    rollup.state === "SUCCESS" ? "success" : rollup.state === "FAILURE" || rollup.state === "ERROR" ? "failure" : "pending";
  return { passed, total, state };
}

// A request "for you" names the viewer, or any team when the PR came from the
// team search: that search already guarantees you're in a requested team.
export function lastReviewRequestFor(pr: RawPullRequest, viewer: string, acceptTeams: boolean): string | undefined {
  let latest: string | undefined;
  for (const event of pr.timelineItems.nodes) {
    const reviewer = event?.requestedReviewer;
    if (!event?.createdAt || !reviewer) continue;
    const forYou = reviewer.__typename === "User" ? reviewer.login === viewer : acceptTeams && reviewer.__typename === "Team";
    if (forYou && (!latest || event.createdAt > latest)) latest = event.createdAt;
  }
  return latest;
}

function toItem(pr: RawPullRequest, placement: Placement, lastReviewRequestAt: string | undefined): PrItem | undefined {
  const key = prKey(pr.url);
  if (!key) return undefined;
  const checks = checksOf(pr);
  return {
    id: pr.id,
    key,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    author: pr.author?.login ?? "ghost",
    updatedAt: pr.updatedAt,
    headRefOid: pr.headRefOid,
    comments: pr.totalCommentsCount ?? 0,
    section: placement.section,
    ...(placement.label ? { label: placement.label } : {}),
    ...(checks ? { checks } : {}),
    ...(lastReviewRequestAt ? { lastReviewRequestAt } : {}),
  };
}

// With SSO partial results, an org whose PRs all vanished at once is more
// likely hidden than done, so its PRs are kept from the previous inbox.
// ponytail: guesses by owner, so an org's last PR lingers until SSO is fixed;
// matching the X-GitHub-SSO org ids against owner databaseIds would be exact.
export function hiddenBySso(previous: readonly PrItem[], current: readonly PrItem[]): PrItem[] {
  const ownerOf = (item: PrItem) => item.repo.split("/")[0];
  const visibleOwners = new Set(current.map(ownerOf));
  return previous.filter((item) => !visibleOwners.has(ownerOf(item)));
}

export function itemsIn(items: readonly PrItem[], sections: ReadonlySet<SectionId>): PrItem[] {
  return items.filter((item) => sections.has(item.section));
}

export function isConfigError(error: InboxError | undefined): boolean {
  return error?.kind === "no-token" || error?.kind === "unauthorized";
}
