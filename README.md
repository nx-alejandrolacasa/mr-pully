# Mr. Pully

Browser extension (Firefox first, Chrome too, Manifest V3) that brings Dia's
"live folders" to GitHub pull requests: a tab group that fills and empties
itself with the PRs that need you, a badge with the count, and a popup that
mirrors GitHub's [pull requests Inbox](https://github.com/pulls).

## What it does

- **Live tab group.** PRs waiting for your review (or your team's) open, unloaded,
  in a tab group called "Pull requests". When a PR stops needing you (you
  reviewed it, it was merged or closed), its tab closes after a short grace
  period. It waits if you're still looking at that tab.
- **Tabs you close stay closed** until the PR gets new commits or a new review
  request for you. The popup lists them under "Hidden from group" with a
  *Reopen* button.
- **Badge** with the number of PRs that need attention, or `!` when the
  token is missing or rejected, or the group was renamed, closed or
  duplicated. The popup explains what's wrong and offers a fix.
- **Popup inbox** grouped like GitHub's: *Needs your review*, *Needs your
  teams' review*, *Your drafts*, *Waiting for review or checks*, *Needs
  action*, *Ready to merge*. Each PR shows its status, checks and comments.
  Clicking a PR focuses its tab, or opens it if it isn't open.

Tabs in the group that aren't tracked PRs are left alone, as are PR tabs you
opened yourself outside the group.

## Setup

1. Create a [classic personal access token](https://github.com/settings/tokens/new?scopes=repo,read:org&description=Mr.%20Pully)
   with the `repo` scope (and `read:org` if you want team review requests).
   Fine-grained tokens work too, but only for the one organisation they target.
2. Open the extension's settings (gear in the popup, or the add-on's
   *Preferences*) and paste the token. The field is write-only: it never
   shows the saved token again. *Test token* shows who it signs in as and
   its scopes.

## Settings

| Setting | Default |
| --- | --- |
| Refresh every (minutes, 1–60) | 2 |
| Hide your PRs not updated in N days (0 = never) | 30 |
| Badge colour | blue (`#0969da`) |
| Live tab group on/off | on |
| Group name / colour | `Pull requests` / blue |
| Open new PR tabs without loading them | on |
| Wait before closing a finished PR tab (seconds, 0–600) | 30 (on Chrome, 1–29 act as 30) |
| Per section: show in popup / count in badge / add to tab group | review sections everywhere; your own PRs in the popup; *Needs action* and *Ready to merge* also in the badge |

Turning the live group off leaves its tabs where they are; the extension just
stops managing them. Changing the group name or colour updates the live group.

## How it works

One GraphQL request per refresh, with an aliased `search` per section source
(about 1–5 points of GitHub's 5,000/hour). The results are sorted into
sections by a heuristic (`inbox.ts`), because GitHub doesn't document its own
rules. The tab group is reconciled by a pure function (`sync.ts`) that turns
the tracked PRs, the current tabs and the stored state into tabs to open and
close. See [docs/PLAN.md](./docs/PLAN.md) for the full design.

## Repo layout

npm-workspaces monorepo, same shape as
[mr-pinny](https://github.com/nx-alejandrolacasa/mr-pinny):

- `packages/shared`: browser-agnostic logic (GitHub client, inbox
  classification, tab group sync, dismissals, settings, background, popup and
  options UI), assets and locales.
- `packages/firefox`: Firefox manifest (event page) + esbuild script → `dist/`.
- `packages/chrome`: Chrome manifest (service worker) + esbuild script → `dist/`.

## Development

```sh
npm install
npm run build            # both browsers → packages/*/dist/
npm run dev              # watch + web-ext run (Firefox)
npm run dev:chrome       # watch + web-ext run (Chromium)
npm run typecheck
npm test                 # inbox, sync, dismissals, PR URL and settings tests
npm run lint             # web-ext lint (firefox dist)
```

Load `packages/firefox/dist` via `about:debugging` → "Load Temporary Add-on",
or `packages/chrome/dist` via `chrome://extensions` → "Load unpacked".

`scripts/fixtures/inbox.json` is a synthetic GraphQL response modelled on
real inbox cases; replace it with a recorded, anonymised one when available.

The Chrome icon PNG is rendered from the SVG design at build time
(`packages/shared/src/build-helpers/icon-png.ts`);
`node scripts/generate-icon.mjs` writes the same PNG to
`packages/shared/assets/icons/icon.png` for a store listing.

## Privacy

The token stays in your browser and is only sent to `api.github.com`. No
analytics, no other servers, no remote code. See [PRIVACY.md](./PRIVACY.md).
