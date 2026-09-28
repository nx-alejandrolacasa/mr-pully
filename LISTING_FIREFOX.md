# Firefox listing copy

Text to paste into the addons.mozilla.org submission form. Keep this in sync with the actual extension behavior.

## Name

```
Mr. Pully
```

## Summary

> 250-character limit.

```
Your GitHub pull request inbox as a live tab group. PRs that need your review open in a "Pull requests" group and close when they're done, with a count on the badge and a popup that mirrors GitHub's inbox. Your token only goes to api.github.com.
```

## Description

> Markdown is supported (basic). Paste into the AMO description field.

```markdown
**Mr. Pully** turns the GitHub pull requests that need you into a tab group that fills and empties itself, with a count on the toolbar badge and a popup that mirrors GitHub's pull requests inbox.

**How it works**

Paste a GitHub personal access token in the settings. Every couple of minutes Mr. Pully asks GitHub which open pull requests are waiting for your review, your teams' review, or are yours, and keeps the "Pull requests" tab group in step with that list.

**Live tab group**

- PRs waiting for your review (or your team's) open in the background, unloaded, in a tab group called "Pull requests".
- When a PR stops needing you (you reviewed it, it was merged or closed), its tab closes after a short grace period. It waits while you're still looking at that tab.
- **Tabs you close stay closed** until the PR gets new commits or a new review request for you. The popup lists them under *Hidden from group* with a *Reopen* button.
- Tabs in the group that aren't tracked PRs are left alone, as are PR tabs you opened yourself outside the group.
- If the group is renamed, closed or duplicated, the badge shows `!` and the popup offers a one-click fix.

**Popup inbox**

Grouped like GitHub's inbox: *Needs your review*, *Needs your teams' review*, *Your drafts*, *Waiting for review or checks*, *Needs action*, *Ready to merge*. Each PR shows its status, checks and comments. Clicking a PR focuses its tab, or opens it if it isn't open.

**Settings**

- Refresh interval (default every 2 minutes)
- Hide your PRs not updated in N days (default 30)
- Badge colour
- Live tab group on or off, its name and colour
- Open new PR tabs without loading them
- Wait before closing a finished PR tab (default 30 seconds)
- Per section: show in the popup, count in the badge, add to the tab group

**Token**

A classic personal access token with the `repo` scope, plus `read:org` if you want team review requests. Fine-grained tokens work too, but only for the one organisation they target. The settings page never shows a saved token again, and *Test token* tells you which account it signs in as.

**Privacy**

The token stays in your browser and is only sent to `api.github.com`, to fetch your pull requests. No analytics, no telemetry, no other servers, no remote code. Tab URLs are only compared locally to recognise PR tabs; they are never stored or transmitted.

Full privacy policy: https://github.com/nx-alejandrolacasa/mr-pully/blob/main/PRIVACY.md

**Source & license**

Open source under the MIT License.

GitHub: https://github.com/nx-alejandrolacasa/mr-pully
```

## Categories

- Tabs
- Other

## Tags

`github`, `pull requests`, `code review`, `tab groups`, `tabs`, `productivity`

## Data collection

> AMO reads this from the manifest (`browser_specific_settings.gecko.data_collection_permissions.required: ["authenticationInfo"]`). The listing shows that the add-on transmits authentication information: the user's own GitHub token, sent only to `api.github.com` in the `Authorization` header. If AMO's reviewers consider first-party API calls with the user's own token out of scope, switch it to `["none"]` in `packages/firefox/manifest.json` and resubmit.

## Notes for reviewer

> Paste into AMO's "Notes for reviewer" field on submission.

```
Mr. Pully keeps a tab group in sync with the user's GitHub pull request inbox. The background event page sends one GraphQL request to https://api.github.com/graphql per refresh (default every 2 minutes) with the user's own personal access token, sorts the results into GitHub-inbox-like sections, and opens or closes PR tabs in a "Pull requests" tab group to match.

Permissions:
- tabs: open and close PR tabs, read tab URLs to recognise tabs showing a tracked PR (github.com/{owner}/{repo}/pull/{n}) so no duplicates are opened, and focus a PR's tab from the popup. URLs are compared locally, never stored or transmitted.
- tabGroups: create, find, name and colour the "Pull requests" group.
- storage: token, settings and the list of PR tabs the user closed in storage.local; the fetched inbox and tab-group state in storage.session.
- alarms: the periodic refresh and closing finished PR tabs after the grace period.

No host permissions: api.github.com answers CORS from any origin. No content scripts, no analytics, no remote code. The only network destination is api.github.com.

Data collection: authenticationInfo, because the user's GitHub token is sent to api.github.com (and nowhere else) to fetch their pull requests.

Build: npm install && NODE_ENV=production npm run build:firefox (esbuild monorepo; see README). No .env or secrets involved.

To test (needs a GitHub account and a classic personal access token with the repo scope):
1. Install the add-on. The badge shows "!" — no token yet.
2. Open the add-on's preferences, paste the token, click Save, then Test token: it shows the account and its scopes.
3. Click the toolbar icon: the popup lists the account's open PRs in GitHub-inbox sections.
4. Have someone request your review on a PR (or request it from a second account): within the refresh interval a "Pull requests" tab group appears with that PR's tab, unloaded.
5. Close that tab: it moves to "Hidden from group" in the popup and is not reopened. Click Reopen to bring it back.
6. Submit the review and switch to another tab: about 30 seconds later the PR's tab closes.
```

## Source code submission

> AMO asks "Do you use any of the following in your extension?" — answer **Yes** (esbuild bundles multiple files into one and minifies in production). Upload a source zip generated from the release tag: `git archive --format=zip -o web-ext-artifacts/mr-pully-<version>-source.zip v<version>`. Paste the following into the source-submission notes field:

```
Requirements: Node.js 22.x (ships with npm 10). Any OS.

1. Unzip the source archive and cd into it.
2. npm install
3. NODE_ENV=production npm run build:firefox

The Firefox package is produced at packages/firefox/dist/ and matches the uploaded zip: esbuild IIFE bundles. No env vars (other than NODE_ENV to minify), secrets, or code generation are involved — the build is a plain esbuild bundle plus static asset copies.
```

## Release notes

> Paste the latest entry into the version's "Release notes" / "What's new" field. Newest first.

### v1.0.0

```
First release. The GitHub pull requests that need your review open in a "Pull requests" tab group and close once they're done, with a count on the badge and a popup that mirrors GitHub's inbox. Tabs you close stay closed until the PR changes. Your token only ever goes to api.github.com.
```
