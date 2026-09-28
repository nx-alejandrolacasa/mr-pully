# Mr. Pully — Plan

Browser extension (Firefox first, Chrome for free) that brings Dia's "live
folders" to GitHub pull requests: a tab group that fills and empties itself
with the PRs that need you, a badge with the count, and a popup that mirrors
GitHub's [pull requests Inbox](https://github.com/pulls).

## Goals

1. **Live tab group (main goal).** A tab group named "Pull requests"
   (configurable) whose tabs are opened and closed by the extension as PRs
   enter and leave the tracked inbox sections.
2. **Popup inbox (secondary goal).** Clicking the toolbar icon shows the inbox,
   grouped by section, like GitHub's.
3. **Badge.** The toolbar icon always shows how many PRs need attention, or a
   warning sign when something is wrong.

## Decisions

| Topic | Decision |
| --- | --- |
| Repo shape | Same as mr-pinny / mr-clicky: npm workspaces (`shared`, `firefox`, `chrome`), esbuild + tsx build scripts, `tsc -b`, `web-ext`, node-assert smoke tests. No WXT. |
| GitHub API | One GraphQL request per refresh with aliased `search(type: ISSUE_ADVANCED)` queries (cost ≈ 1–3 points of the 5,000/hour). |
| Token | User pastes a token. README recommends a classic PAT with `repo` (+ `read:org` if team reviews need it — see spike). Fine-grained PATs work but only for one org. Stored in `storage.local` only. |
| Group lookup | By exact title from the settings, default `Pull requests`. No count in the title — the badge has it. |
| Empty group | Firefox removes a group when its last tab closes. The extension recreates it when a new PR arrives. |
| Group missing / duplicated / renamed by the user | Badge shows `!`, popup explains the problem and offers a fix. |
| Removal of merged/reviewed PR tabs | Not immediate: a grace period (default 30 s, configurable) after the PR leaves the tracked sections. |
| Tabs the user closes | Remembered locally ("dismissed") and not reopened until the PR gets **new commits** or **a new review request for you**. |
| Foreign tabs in the group | Ignored. The extension only manages tabs whose URL is a tracked PR. |
| Multiple windows | One group, in one window. |
| Pinned tabs | Firefox unpins tabs when grouped; accepted. |

## Architecture

```
packages/
  shared/
    src/
      github.ts        GraphQL query, fetch, error mapping (401, SSO, rate limit)
      inbox.ts         pure: raw search results + previous inbox → sections of PrItem
      sync.ts          pure: desired PRs + current tabs + state → actions;
                       group-event classification (window / group / last tab)
      dismissals.ts    pure: dismissed snapshots, "has it changed?" check
      prs.ts           PR URL parsing / matching (owner/repo/number)
      settings.ts      Settings type, defaults, normalize, load/save
      state.ts         storage.session / storage.local keys and helpers
      badge.ts         count / warning → action badge
      background.ts    listeners, alarms, refresh loop, applies sync actions
      messages.ts      popup ⇄ background request/response types
      popup.ts         inbox UI
      options.ts       settings UI
      build-helpers/   icon-png.ts, validate-dist.ts (copied from mr-pinny)
      ui.ts            DOM / i18n helpers shared by popup and options
    assets/            popup.html, options.html, styles.css, icons/icon.svg
    _locales/en/messages.json
  firefox/             manifest.json (event page), build.ts, web-ext config
  chrome/              manifest.json (service worker), build.ts
scripts/
  test-inbox.mjs, test-sync.mjs, test-dismissals.mjs, test-prs.mjs,
  test-settings.mjs
  fixtures/            recorded (anonymised) GraphQL responses
```

As in mr-pinny, the logic lives in pure functions (`inbox`, `sync`,
`dismissals`, `prs`, `settings`) that the smoke tests exercise directly.
`background.ts` only wires browser events to them and executes the actions
they return. Every background task runs through the same `serialized()`
queue as mr-pinny so refreshes, alarms and tab events never interleave.

No content script is needed.

### Manifest (Firefox)

```jsonc
{
  "manifest_version": 3,
  "permissions": ["storage", "alarms", "tabs", "tabGroups"],
  "action": { "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "background": { "scripts": ["background.js"] },
  "browser_specific_settings": {
    "gecko": {
      "id": "mr-pully@nx-alejandrolacasa.github.io",
      "strict_min_version": "142.0",
      "data_collection_permissions": { "required": ["authenticationInfo"] }
    }
  }
}
```

- **No host permissions.** `api.github.com` answers CORS preflights from any
  origin (`Access-Control-Allow-Origin: *`, `Authorization` allowed), so plain
  `fetch` from the background works.
- `tabs` is needed to read the URLs of tabs (to recognise PR tabs after a
  restart). `tabGroups` is not shown in the permission prompt.
- `authenticationInfo`: the token is sent to GitHub. To be confirmed with
  `web-ext lint` and the AMO data-collection docs; switch to `none` if AMO
  considers first-party API calls with the user's own token out of scope.
- Chrome manifest: same, with `service_worker` and `minimum_chrome_version`
  `"120"` (tabGroups since 89, `alarms` 30 s minimum since 120).
- Toolbar icon: the glyph without its background, dark or white. Firefox
  switches through `action.theme_icons`; Chrome has no equivalent, so it adds
  the `offscreen` permission for a document that watches
  `prefers-color-scheme` (service workers can't) and messages the background,
  which calls `action.setIcon`.

## GitHub data

### Query

One GraphQL request with an alias per enabled source:

| Alias | Search query |
| --- | --- |
| `review` | `is:pr is:open archived:false user-review-requested:@me` |
| `team` | `is:pr is:open archived:false team-review-requested-user:@me` |
| `authored` | `is:pr is:open archived:false author:@me` |

Each with `first: 50`, `issueCount` (so the popup can show "50+" when a
section is truncated) and these `PullRequest` fields:

- identity: `id`, `number`, `title`, `url`, `repository { nameWithOwner }`,
  `author { login }`, `updatedAt`, `createdAt`
- state: `isDraft`, `isInMergeQueue`, `reviewDecision`, `mergeable`,
  `mergeStateStatus`, `totalCommentsCount`
- change detection: `headRefOid`,
  `timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 10) { … createdAt requestedReviewer { … on User { login } … on Team { slug } } }`
  (`last: 1` may be someone else's request). A request "for you" is one
  whose reviewer is the viewer, or any `Team` when the PR came from the
  `team` search — that search already guarantees you're in one of the
  requested teams, so there's no need to resolve membership.
- checks on `commits(last: 1)`:
  `statusCheckRollup { state contexts { checkRunCount statusContextCount checkRunCountsByState statusContextCountsByState } }`
  and `checkSuites(first: 20) { status conclusion app { slug } }`
- plus `viewer { login }` and `rateLimit { cost remaining resetAt }`

Verified against the real account on 2026-09-28: "Needs your review" matched
exactly, and the check counters (e.g. 10/10, 6/9) equal
`checkRunCount + statusContextCount`.

The request uses `signal: AbortSignal.timeout(20_000)`. The fetch runs
**outside** the `serialized()` queue; only applying its result (store, badge,
sync) is queued, so a slow GitHub never delays tab events. Concurrent refresh
triggers share the in-flight promise instead of starting a second request,
except a settings change, which always starts a new one. Each request gets an
increasing number, and a result is dropped if a newer request has started, so
a response fetched with the old token or sources never overwrites a newer one.

### Sections

Classification lives in `inbox.ts`. GitHub doesn't document its rules, so this
is a heuristic calibrated with the screenshot fixtures. Rules are evaluated
top to bottom and the **first match wins**; several rules can feed the same
section:

| # | Rule | Section | Label |
| - | --- | --- | --- |
| 1 | in `review` | Needs your review | — |
| 2 | in `team` | Needs your teams' review | — |
| 3 | authored, `isDraft` | Your drafts | *Not ready* |
| 4 | authored, `isInMergeQueue` | Ready to merge | *In merge queue* |
| 5 | authored, rollup `PENDING` or any check suite `QUEUED`/`IN_PROGRESS` | Waiting for review or checks | *Awaiting CI* |
| 6 | authored, rollup `FAILURE`/`ERROR` | Needs action | *Checks failing* |
| 7 | authored, `reviewDecision = CHANGES_REQUESTED` | Needs action | *Changes requested* |
| 8 | authored, `mergeable = CONFLICTING` | Needs action | *Merge conflicts* |
| 9 | authored, `mergeStateStatus = BEHIND` | Needs action | *Out of date* |
| 10 | authored, `reviewDecision = REVIEW_REQUIRED` | Waiting for review or checks | *Awaiting approval* |
| 11 | authored, `reviewDecision` ∈ {`APPROVED`, null}, `mergeStateStatus` ∈ {`CLEAN`, `HAS_HOOKS`} | Ready to merge | *Ready to merge* |
| 12 | authored, anything else (`BLOCKED` by other rules, `UNSTABLE`, …) | Waiting for review or checks | *Awaiting approval* |

This reproduces the screenshot: website#204 (conflicts, CI pending) → rule 5;
landing#157 (approved, Cloudflare check suite stuck `QUEUED`) → rule 5.

GitHub computes `mergeable` / `mergeStateStatus` lazily, so right after a
push they are often `UNKNOWN`. When either is `UNKNOWN`, rules 8–12 are
skipped and the PR keeps its section and label from the previous inbox;
if it has none, it goes to rule 12. `inbox.ts` therefore takes the previous
inbox as an input, which also stops the badge from flickering.

GitHub's Inbox hides stale PRs (two drafts last updated 39+ days ago are
missing from it). Setting **Hide PRs not updated in N days** (default 30, 0 =
off) reproduces that. It only applies to **authored** PRs (rules 3–12): a
stale review request still needs you, so it stays in the popup, the badge and
the group.

### Errors

| Situation | Detected by | Shown as |
| --- | --- | --- |
| No token | settings | badge `!`, popup: "Add a GitHub token" + link to options |
| Invalid / expired token | HTTP 401 | badge `!`, popup message |
| SAML SSO not authorised | `X-GitHub-SSO` header / GraphQL `errors` with partial data | popup message with an *Authorize* link, results still shown (the header only carries org ids, so orgs aren't named) |
| Rate limited | 403/429, `Retry-After`, `rateLimit.remaining` | keep last data, store `retryAfter` (from `Retry-After`, else `resetAt`) in session and skip every refresh trigger until then, small note in popup |
| Network error / timeout | fetch rejects or the 20 s timeout aborts | keep last data, "Last updated …" in popup, retry next tick |

The badge keeps the last good count while offline; only config errors turn it
into `!`.

## Settings (options page)

| Setting | Default |
| --- | --- |
| GitHub token: write-only password field (the saved token is never shown again, only "a token is saved"), *Save* / *Test* / *Remove*, stored under its own `token` key so the popup never loads it. "Test" button showing login + scopes from `X-OAuth-Scopes`; fine-grained tokens send no such header, so show "fine-grained token" instead of an empty list) | — |
| Refresh interval (minutes, 1–60) | 2 |
| Tab group name | `Pull requests` |
| Tab group colour (`grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`, `orange`) | `grey` |
| Live tab group on/off | on |
| Open new PR tabs unloaded (`discarded: true`) | on |
| Grace period before closing a finished PR tab (seconds, 0–600) | 30 |
| Hide PRs not updated in N days | 30 |
| Badge colour (native colour picker) | `#0969da` |
| Per section: *Show in popup* / *Count in badge* / *Add to tab group* | see below |

| Section | Popup | Badge | Group |
| --- | :-: | :-: | :-: |
| Needs your review | ✓ | ✓ | ✓ |
| Needs your teams' review | ✓ | ✓ | ✓ |
| Your drafts | ✓ | | |
| Waiting for review or checks | ✓ | | |
| Needs action | ✓ | ✓ | |
| Ready to merge | ✓ | ✓ | |

Sources not needed by any enabled section are left out of the query.
Settings are normalised on load (like mr-pinny's `normalizeSettings`), so bad
or old values never crash the background.

Settings live in `storage.local` (never `sync`, because of the token). Effects
of changing them while running:

- **Group name / colour**: the live group is renamed / recoloured with
  `tabGroups.update` (an expected update, see [Tab and group
  events](#tab-and-group-events)). A user who recolours the group by hand is
  not fought.
- **Live tab group off**: managed tabs and the group are left as they are;
  `managed`, `pendingRemoval` and their alarms are cleared, so nothing is
  closed later. Turning it back on adopts the group again.
- **Token**: after the next successful fetch, if `viewer.login` differs from
  the stored one, `dismissed` and the cached inbox are cleared.

## Background

### Refresh loop

- Alarm `refresh` every *interval* minutes; also refresh on install, on
  startup, when settings change, when the popup opens (if data is older than
  30 s) and from the popup's refresh button.
- Result stored in `storage.session` (`inbox`: sections, `fetchedAt`, `error`),
  so the popup renders instantly and a suspended event page loses nothing.
- After each refresh: update badge, then run tab sync.
- **Startup delay**: on `runtime.onStartup` the refresh runs immediately, but
  tab sync waits until session restore has brought the old group back
  (`STARTUP_SYNC_DELAY_MS`, start at 5 s; mr-pinny uses 2.5 s for a
  similar wait; tune with spike 5). Syncing earlier would create
  a second group next to the restored one (`duplicate`). The delay is a gate,
  not a single timer: `onStartup` stores `syncNotBefore` in session, and
  **every** sync (from alarms, the popup, tab events) is skipped until then;
  a timer runs one sync when the gate opens.

### Badge

- Count = unique PRs in sections with *Count in badge*.
- `!` on an orange background for config/group errors; the popup explains.
- Empty badge when the count is 0 and nothing is wrong.

## Live tab group

### State

| Key | Area | Content |
| --- | --- | --- |
| `managed` | session | `tabId → { prId, key }` for tabs the extension opened or adopted (the key lets it check the tab is still on that PR after the PR leaves the inbox) |
| `group` | session | `{ groupId, windowId }` of our group, so group events and renames are matched by id |
| `closingByUs` | session | tab ids the extension is closing, so `onRemoved` doesn't treat them as dismissals |
| `pendingRemoval` | session | `prId → removeAt` |
| `groupStatus` | session | `ok` · `empty` (no group because it has no tabs — ours or the user's last close) · `lost` (group closed by user) · `renamed` (with the new title) · `duplicate` |
| `retryAfter` | session | timestamp before which refreshes are skipped (rate limit) |
| `dismissed` | local | `prId → { headRefOid, lastReviewRequestAt, dismissedAt }` |
| `viewer` | local | login of the token's user, to detect an account change |

`dismissed` and `viewer` are in `storage.local` so they survive restarts;
everything else is rebuilt. A `lost` status is therefore forgotten on
restart, and the group is recreated then.

### Reconciliation (`sync.ts`)

Input: tracked PRs (sections with *Add to tab group*), all tabs of the target
window, the group (found by title), state, settings, `now`. Output: the next
state (`managed`, `group`, `groupStatus`, `pendingRemoval`, `dismissed`) plus
the effects: PRs to open (and whether to create the group, in which window)
and tab ids to close.

0. **Skip** entirely when *Live tab group* is off, or when there is no target
   window (macOS: the browser can run with every window closed).
1. **Find the group**: if `group.groupId` still exists, it's ours: with the
   configured title → `ok`, with any other title → `renamed` (no tab
   actions until resolved). Otherwise `tabGroups.query({})` and filter by **exact**
   title in JS (Chrome's `title` query is a pattern match). Groups in private
   windows are ignored.
   - 0 groups: create lazily if there's a PR to open and status is not
     `lost` / `renamed`.
   - 1 group: store its `groupId` / `windowId` in `group`; status `ok`.
   - 2+ groups: `duplicate` → warn, do nothing.
2. **Adopt** on every sync (not only after a restart): tabs in the group
   whose URL parses to a tracked PR become managed (`prs.ts` matches
   `/{owner}/{repo}/pull/{n}` including sub-pages like `/files`,
   case-insensitive owner/repo). This also picks up PR tabs the user drags
   into the group. If two tabs in the group are on the same PR, the first one
   (by index) is adopted and the other is treated as foreign. Adopting a
   dismissed PR forgets the dismissal: putting it back in the group means
   you want it there.
3. **Open**: for each tracked PR with no managed tab, not dismissed, and not
   already open elsewhere →
   `tabs.create({ url, windowId, active: false })`, discarded once the page
   has its own title (both browsers), then
   `tabs.group({ tabIds, groupId | createProperties: { windowId } })` and
   `tabGroups.update({ title, color })` for a new group. New tabs are appended
   to the group; nothing is reordered. If the PR is already open in a tab
   outside the group, leave that tab alone and don't duplicate it.
4. **Remove**: a managed tab whose PR is no longer tracked gets
   `removeAt = now + grace`; a single `remove` alarm fires at the earliest
   `removeAt` (or the next refresh, whichever is first) and runs a sync. If the PR is tracked again before
   then, cancel. Only close if the tab is still in the group and still on that
   PR (otherwise just stop managing it). If the tab is the **active tab of the
   focused window** (e.g. you just submitted your review and are still
   reading it), don't close it yet: push its `removeAt` to
   `now + grace` (the alarm has already fired, so nothing else would retry it
   before the next refresh), so it disappears only after you've moved away.
5. **Dismissed PRs** reopen when `headRefOid` changed or a review request for
   you (see [Query](#query)) is newer than `lastReviewRequestAt`. Dismissals
   for PRs no longer in any section are deleted.

Target window (non-private, `normal` only): the window of the existing group,
otherwise `windows.getLastFocused({ windowTypes: ["normal"] })`.

Closing a tab: add its id to `closingByUs` **before** calling `tabs.remove`,
and delete it when its `onRemoved` is handled.

### Tab and group events

Group events are matched by `group.groupId`, never by title.

- `tabs.onRemoved(tabId, { isWindowClosing })`: if in `closingByUs`, just
  forget it. If managed and `isWindowClosing`, forget it (no dismissal).
  Otherwise the managed tab becomes a **candidate dismissal** (with the PR's
  current snapshot from the stored inbox), buffered for ~500 ms (spike 3)
  before being written to `dismissed`.
- `tabGroups.onRemoved(group)` for our group, unless we closed its last tab.
  Three cases, told apart with the buffered removals:
  - **Window closed**: the buffered removals had `isWindowClosing` (Firefox
    also passes `removeInfo.isWindowClosing`; Chrome doesn't, so rely on the
    tab events or on `windows.get(group.windowId)` rejecting) → `empty`, no
    dismissals. The next sync recreates the group in the last focused window.
  - **Whole group closed** (2 or more **managed** tabs removed within the
    buffer; `tabs.onRemoved` doesn't say which group a tab was in, so foreign
    tabs can't be counted) → drop the candidate dismissals, status `lost`.
    Selecting every tab of the group and closing them looks the same and is
    treated the same way; *Recreate group* undoes it.
  - **User closed the last remaining tab** (a single managed removal) → keep
    the dismissal, status `empty`. A group with one managed tab closed with
    "Close group" looks the same and is treated the same way; that's
    acceptable.
- `tabs.onUpdated` with a `url` that no longer parses to the **same PR** →
  stop managing it; no dismissal. Moving between `/files`, `/commits`, etc.
  keeps it managed.
- `tabs.onUpdated` with a `groupId` change: moved out of our group → stop
  managing it, no dismissal (the PR then counts as "open elsewhere", so it
  isn't duplicated). Moved into our group → adopted on the next sync. The
  "moved out" case goes through the same ~500 ms buffer: if the browser
  ungroups tabs before removing them when a group is closed (spike 3), those
  tabs must still count as removals of our group, not as moves.
- `tabs.onReplaced(addedId, removedId)` → move the `managed` entry
  (Chrome can replace a tab id, e.g. on discard).
- `tabGroups.onUpdated` → run a sync, which reads the **current** groups
  instead of trusting the event payload. Step 1 compares our group's title
  (found by id) with the group-name setting: a different title → `renamed`
  with the new title; the configured title again (renamed back by hand, or
  our own "untitled → title" update after `tabs.group`) → `ok`. When the
  group-name setting changes, the live group is renamed first if it still
  carries the previous name, so a sync in between can't mistake it for a
  user rename. Colour changes are ignored.

### Recovery in the popup

| Status | Popup message | Actions |
| --- | --- | --- |
| `lost` | "The 'Pull requests' group can't be found." | *Recreate group* |
| `renamed` | "The group was renamed to 'X'." | *Use 'X'* (saves X as the group name) · *Rename back* |
| `duplicate` | "There are N groups called 'Pull requests'." | *Use the one in this window* (stores its id in `group`; the others become foreign groups) |

`empty` and `ok` show nothing.

## Popup

- Header: title, last updated ("2 min ago"), refresh button, gear → options.
- Error / warning banner when relevant.
- One collapsible section per enabled section with its count, like GitHub's
  ("50+" when `issueCount` exceeds the fetched items).
- Item: title, `owner/repo#n · author · updated 3 days ago`, status label,
  checks `x/y` (✓ / ✗ / ●), comment count.
- Click: focus the PR's tab if open (managed or not) with `tabs.update`
  + `windows.update({ focused: true })`, otherwise open it in the current
  window.
- Dismissed PRs: a collapsed "Hidden from group (n)" list with *Reopen*
  (forgets the dismissal, then syncs).
- Plain TS + DOM like mr-pinny, no framework. All GitHub-provided text (titles,
  logins, repo names) is set with `textContent`, never `innerHTML`, and only
  URLs accepted by `prs.ts` (`https://github.com/…/pull/n`) are opened.

### Messages (`messages.ts`)

Popup → background requests, each answered after it has run through
`serialized()`:

| Request | Effect / response |
| --- | --- |
| `get-inbox` | stored inbox, `groupStatus`, dismissed list; triggers a refresh if older than 30 s |
| `refresh` | forces a refresh (unless `retryAfter` is in the future), returns the new inbox |
| `open-pr` `{ prId }` | focus or open the PR tab |
| `reopen-pr` `{ prId }` | forget the dismissal, sync |
| `recreate-group` | status `lost` → `empty`, sync |
| `adopt-renamed-group` | save the new title as the group name setting |
| `rename-group-back` | `tabGroups.update` with the setting's title |
| `use-group` `{ groupId }` | resolve `duplicate` by storing that group |

The popup re-renders on `storage.onChanged` for `inbox` / `groupStatus`, so
a refresh started by `get-inbox` shows up without polling.

## Chrome

Same code; differences to handle:

- Service worker instead of event page (state already lives in storage).
- Chrome collapses the whole group (Firefox keeps the active tab visible).
- Alarms minimum 30 s: the `remove` alarm is never set earlier than
  `now + 30 s`, so a grace of 1–29 s acts as 30 s (0 still closes on the
  sync itself).
- `tabs.create({ discarded })` is not supported in Chrome, and Firefox shows
  the URL instead of its `title`: both create the tab, wait for the page's
  title (up to 10 s) and then `tabs.discard()` it, keeping the id of the tab
  it **returns** (Chrome may change it; `tabs.onReplaced` covers other
  replacements). Discarding before the URL commits leaves an empty
  "Untitled" tab, so on timeout it's only discarded if the URL is there.
- `tabGroups.onRemoved` has no `removeInfo`; window closes are detected via
  the buffered `tabs.onRemoved` events (see [Tab and group
  events](#tab-and-group-events)).

## Spikes (do first, in a throwaway temporary add-on)

1. **Team reviews without `read:org`**: does
   `team-review-requested-user:@me` return results with only `repo`?
2. **Fine-grained token**: which searches work and what's missing when the
   token targets one org; how SSO/unapproved orgs show up (partial `errors`).
3. **Group close event order**: when the user closes the whole group, closes
   the last tab, or closes the window, do `tabs.onRemoved` events arrive
   before `tabGroups.onRemoved`, and how far apart? Confirm the ~500 ms
   buffer and the three-way split in [Tab and group
   events](#tab-and-group-events), in both browsers.
4. **"Save and close" group**: confirm it fires `tabGroups.onRemoved` like a
   close. Restored while `lost`, it should be picked up by title (1 group →
   `ok`); restored next to a recreated group, the stored `groupId` wins and
   the restored one is foreign (no `duplicate` warning, its PR tabs count as
   "open elsewhere"). Check both.
5. **Group restore after restart**: title/colour kept, new `groupId`, tab URLs
   available immediately or only after load for discarded tabs, and how long
   after `onStartup` the group appears (sets `STARTUP_SYNC_DELAY_MS`).
6. **Firefox alarm precision** for short delays (30 s grace).

## Milestones

**Status (2026-09-28):** v1.0.0 — all milestones are implemented, with
store listing copy in `LISTING_CHROME.md`, `LISTING_FIREFOX.md` and
`CHROME_SUBMISSION.md`. Still open: spikes 1–6 (the buffer length, startup
delay and team/fine-grained token behaviour are unverified defaults),
recording a real anonymised fixture to replace the synthetic
`scripts/fixtures/inbox.json`, and store screenshots.


1. **Scaffold** — copy mr-pinny's workspace, build scripts, tsconfig, release
   workflow and lint setup; rename to `@mr-pully/*`; drop the content script;
   add options page and `tabGroups` permission; new SVG icon.
2. **GitHub client + inbox** — `github.ts`, `inbox.ts`, fixtures from the
   screenshot data, `test-inbox.mjs`. Spikes 1–2.
3. **Background + badge** — settings, refresh alarm, `storage.session`
   cache, badge, error states.
4. **Popup** — inbox rendering, refresh, open/focus PR tabs, error banner.
5. **Options page** — all settings, token test.
6. **Live tab group** — `sync.ts`, `dismissals.ts`, event wiring, recovery
   actions, `test-sync.mjs` / `test-dismissals.mjs`. Spikes 3–6.
7. **Chrome parity** — manifest, discard workaround, alarm floor.
8. **Release** — README, PRIVACY.md (token stays local, only requests go to
   `api.github.com`), store listings, icon PNG, release ZIPs.

## Tests

Node-assert smoke tests, run with `npm test`, as in mr-pinny:

- `inbox`: screenshot fixtures land in the same sections with the same labels
  and check counts; stale filter hides authored PRs only; team vs direct
  review dedupe; `UNKNOWN` merge state keeps the previous section, falls back
  to rule 12 without one; `BLOCKED` / `UNSTABLE` hit the fallback.
- `sync`: create group lazily; adopt tabs (after restart and dragged in);
  duplicate PR tabs in the group adopt one; don't duplicate a PR open outside
  the group; grace removal scheduled / cancelled / executed / deferred while
  the tab is active; never touch foreign tabs; duplicate/lost/renamed groups
  produce no tab actions; no actions when the live group is off or there's no
  window; exact title match (`Pull*` doesn't match `Pull requests`).
- `dismissals`: reopen on new `headRefOid`; reopen on a newer review request
  for the viewer, or for a team on team-sourced PRs; ignore other users'
  requests, comments, labels and CI; cleanup.
- `prs`: sub-pages (`/files`, `/commits/…`) match the same PR; other PRs,
  other repos and non-`github.com` URLs don't.
- `settings`: normalisation and clamping.

The group-event classification (window closed / group closed / last tab
closed) is a pure function over the buffered removals, tested too.

Manual checklist per release: fresh install without token, bad token, empty
inbox, group recreated, close a PR tab (stays closed), push a commit (tab
returns), merge a PR (tab closes after the grace period), submit a review
while on the tab (it stays until you switch away), navigate to `/files`
(still managed), rename / close / duplicate the group (warnings and fixes),
close the group's window (recreated elsewhere, nothing dismissed), change the
group name in settings (group renamed, no warning), turn the live group off
(nothing closes), switch token to another account (dismissals cleared),
browser restart (no duplicate group).

## Out of scope (v1)

- Repository filter ("Select repositories") and multiple accounts.
- GitHub Enterprise Server hosts.
- Notifications API (classic tokens only).
- Custom search queries / saved views as extra sections.

## References

- Firefox: [`tabs.group`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group),
  [`tabGroups`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups),
  [`TabGroup` (unstable ids)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/TabGroup),
  [`tabGroups.onRemoved`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/onRemoved),
  [`tabs.create` (`discarded`)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create),
  [`alarms.create`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create),
  [`action.setBadgeText`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setBadgeText),
  [data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- Chrome: [`tabGroups`](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- GitHub: [Inbox changelog](https://github.blog/changelog/2026-07-09-new-pull-requests-dashboard-is-now-generally-available/),
  [search qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests),
  [GraphQL `PullRequest`](https://docs.github.com/en/graphql/reference/objects#pullrequest),
  [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api),
  [REST search limits](https://docs.github.com/en/rest/search/search#rate-limit),
  [token types and limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations),
  [classic scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps),
  [multi-org fine-grained PATs (paused)](https://github.com/github/roadmap/issues/1118)
