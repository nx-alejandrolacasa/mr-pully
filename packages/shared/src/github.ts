// GitHub client: one GraphQL request with an aliased search per source, and
// the error mapping the popup and badge rely on. Plain fetch works without
// host permissions because api.github.com answers CORS from any origin.

export type Source = "review" | "team" | "authored";

export const SEARCH_QUERIES: Record<Source, string> = {
  review: "is:pr is:open archived:false user-review-requested:@me",
  team: "is:pr is:open archived:false team-review-requested-user:@me",
  authored: "is:pr is:open archived:false author:@me",
};

export const SEARCH_LIMIT = 50;
const GRAPHQL_URL = "https://api.github.com/graphql";
const USER_URL = "https://api.github.com/user";
const REQUEST_TIMEOUT_MS = 20_000;

const PR_FIELDS = `
  id number title url isDraft isInMergeQueue reviewDecision mergeable mergeStateStatus
  totalCommentsCount updatedAt createdAt headRefOid
  repository { nameWithOwner }
  author { login }
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 10) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
  }
  commits(last: 1) { nodes { commit {
    statusCheckRollup { state contexts(first: 1) {
      checkRunCount statusContextCount
      checkRunCountsByState { state count }
      statusContextCountsByState { state count }
    } }
    checkSuites(first: 20) { nodes { status conclusion app { slug } } }
  } } }
`;

export function buildQuery(sources: readonly Source[]): string {
  const searches = sources.map(
    (source) =>
      `${source}: search(type: ISSUE_ADVANCED, query: ${JSON.stringify(SEARCH_QUERIES[source])}, first: ${SEARCH_LIMIT}) {
    issueCount
    nodes { ...Pr }
  }`
  );
  return `query Inbox {
  viewer { login }
  rateLimit { cost remaining resetAt }
  ${searches.join("\n  ")}
}
fragment Pr on PullRequest {${PR_FIELDS}}`;
}

export interface StateCount {
  state: string;
  count: number;
}

export interface RawPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  isInMergeQueue: boolean;
  reviewDecision: string | null;
  mergeable: string;
  mergeStateStatus: string;
  totalCommentsCount: number | null;
  updatedAt: string;
  createdAt: string;
  headRefOid: string;
  repository: { nameWithOwner: string };
  author: { login: string } | null;
  timelineItems: {
    nodes: ({ createdAt?: string; requestedReviewer?: { __typename: string; login?: string; slug?: string } | null } | null)[];
  };
  commits: {
    nodes: ({
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: {
            checkRunCount: number;
            statusContextCount: number;
            checkRunCountsByState: StateCount[] | null;
            statusContextCountsByState: StateCount[] | null;
          };
        } | null;
        checkSuites: { nodes: ({ status: string; conclusion: string | null; app: { slug: string } | null } | null)[] } | null;
      };
    } | null)[];
  };
}

export interface RawSearch {
  issueCount: number;
  nodes: (RawPullRequest | Record<string, never> | null)[];
}

export interface RawInbox {
  viewer: { login: string };
  rateLimit: { cost: number; remaining: number; resetAt: string } | null;
  review?: RawSearch | null;
  team?: RawSearch | null;
  authored?: RawSearch | null;
}

export type InboxError =
  | { kind: "no-token" }
  | { kind: "unauthorized" }
  | { kind: "rate-limited"; until: number }
  | { kind: "network" }
  | { kind: "github"; message: string };

export type FetchResult =
  | { ok: true; data: RawInbox; ssoRequired: boolean; retryAfter?: number }
  | { ok: false; error: InboxError };

interface GraphqlResponse {
  data?: RawInbox | null;
  errors?: { type?: string; message?: string }[];
}

export async function fetchInbox(token: string, sources: readonly Source[]): Promise<FetchResult> {
  if (!token) return { ok: false, error: { kind: "no-token" } };
  let response: Response;
  let body: GraphqlResponse;
  try {
    response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: buildQuery(sources) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) return { ok: false, error: { kind: "unauthorized" } };
    const rateLimitedUntil = rateLimitFromHeaders(response);
    if (rateLimitedUntil !== undefined) return { ok: false, error: { kind: "rate-limited", until: rateLimitedUntil } };
    body = (await response.json()) as GraphqlResponse;
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  return interpretGraphql(response.status, body, response.headers.get("X-GitHub-SSO"), Date.now());
}

function rateLimitFromHeaders(response: Response): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (retryAfter > 0) return Date.now() + retryAfter * 1000;
  const reset = Number(response.headers.get("X-RateLimit-Reset"));
  if (response.headers.get("X-RateLimit-Remaining") === "0" && reset > 0) return reset * 1000;
  return response.status === 429 ? Date.now() + 60_000 : undefined;
}

export function interpretGraphql(
  status: number,
  body: GraphqlResponse,
  ssoHeader: string | null,
  now: number
): FetchResult {
  const errors = body.errors ?? [];
  if (errors.some((e) => e.type === "RATE_LIMITED")) {
    const resetAt = Date.parse(body.data?.rateLimit?.resetAt ?? "");
    return { ok: false, error: { kind: "rate-limited", until: Number.isFinite(resetAt) ? resetAt : now + 60_000 } };
  }
  const data = body.data;
  if (!data?.viewer) {
    const message = errors[0]?.message ?? `HTTP ${status}`;
    return { ok: false, error: { kind: "github", message } };
  }
  const ssoRequired =
    ssoHeader?.startsWith("partial-results") === true || errors.some((e) => /SAML|SSO/i.test(e.message ?? ""));
  const rateLimit = data.rateLimit;
  const exhausted = rateLimit !== null && rateLimit.remaining < rateLimit.cost;
  const retryAfter = exhausted ? Date.parse(rateLimit.resetAt) : undefined;
  return { ok: true, data, ssoRequired, ...(retryAfter !== undefined && Number.isFinite(retryAfter) ? { retryAfter } : {}) };
}

export type TokenCheck =
  | { ok: true; login: string; scopes: string[] | null }
  | { ok: false; error: InboxError };

// Classic tokens report their scopes in X-OAuth-Scopes; fine-grained tokens
// don't send the header, which comes back as `scopes: null`.
export async function checkToken(token: string): Promise<TokenCheck> {
  if (!token) return { ok: false, error: { kind: "no-token" } };
  try {
    const response = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) return { ok: false, error: { kind: "unauthorized" } };
    const rateLimitedUntil = rateLimitFromHeaders(response);
    if (rateLimitedUntil !== undefined) return { ok: false, error: { kind: "rate-limited", until: rateLimitedUntil } };
    if (!response.ok) return { ok: false, error: { kind: "github", message: `HTTP ${response.status}` } };
    const user = (await response.json()) as { login: string };
    const header = response.headers.get("X-OAuth-Scopes");
    const scopes = header === null ? null : header.split(",").map((s) => s.trim()).filter(Boolean);
    return { ok: true, login: user.login, scopes };
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
}
