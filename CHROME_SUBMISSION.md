# Chrome Web Store submission — dashboard form fields

Text to paste into the **Privacy** and **Distribution** tabs of the chrome.google.com/webstore/devconsole submission form, in addition to the listing copy in [`LISTING_CHROME.md`](./LISTING_CHROME.md).

## Single purpose

> One sentence. CWS reviewers check that every permission ties back to this.

```
Show the GitHub pull requests that need the user's attention, as a toolbar badge, a popup inbox and a tab group that opens and closes their tabs automatically.
```

## Permission justifications

Paste one line per permission into the corresponding field in the dashboard. Each line answers "Why does your extension need this permission?"

### `tabs`

```
Required to open the tabs of pull requests that need the user's review, close them once the pull request no longer needs the user, and focus a pull request's tab from the popup. The extension reads tab URLs only to recognise tabs that already show a tracked pull request (github.com/{owner}/{repo}/pull/{number}), so it never opens duplicates and can find its own tabs again after a restart. URLs are compared locally and are never stored or transmitted.
```

### `tabGroups`

```
The extension's core feature is a "Pull requests" tab group that fills and empties itself. tabGroups is used to create that group, find it again by its title after a restart, and set its name and colour from the user's settings. No other tab groups are modified.
```

### `storage`

```
chrome.storage.local holds the user's GitHub token, their settings, their GitHub login and the list of pull request tabs they closed (pull request id, latest commit id, latest review request time), so closed tabs stay closed. chrome.storage.session holds the last fetched pull request list and the tab group's state for the browser session. Nothing is synced or sent anywhere.
```

### `alarms`

```
A periodic alarm refreshes the pull request inbox from the GitHub API (every 2 minutes by default, configurable from 1 to 60), and a one-shot alarm closes a finished pull request's tab after the grace period, so the background service worker does not need to stay alive.
```

### `offscreen`

```
Service workers can't evaluate media queries, so a hidden offscreen document (reason MATCH_MEDIA) watches prefers-color-scheme and tells the background whether the browser is in light or dark mode. The background then shows a dark or a white toolbar icon so it stays visible. The document does nothing else and loads no remote content.
```

## Remote code

> CWS field: "Are you using remote code?" — Choose **No**.

```
No. All JavaScript executed by the extension is bundled inside the package at build time (esbuild, IIFE bundles). No eval, no Function() construction from strings, no script injection from remote sources, no WebAssembly. The only network requests are JSON API calls to api.github.com.
```

## Data usage disclosure

> CWS field: "What user data does your extension collect or use?" — tick **Authentication information**: the user's own GitHub personal access token is sent to `api.github.com` (and nowhere else) to fetch their pull requests. Tab URLs are read through the `tabs` permission but only compared locally, never logged or transmitted, so **Web history** can defensibly stay unchecked; tick it too if you prefer the conservative reading. Either way the rationale below applies.

Rationale for the reviewer (paste in the "Additional details" field if prompted):

```
Mr. Pully has no server and the developer receives no data. The user pastes their own GitHub personal access token, which is stored in chrome.storage.local and sent only to api.github.com in the Authorization header, to fetch the user's open pull requests. Tab URLs are read only to recognise tabs that already show a tracked pull request; they are compared locally and never stored or transmitted. No analytics, telemetry, or crash reporting.
```

## Data usage certifications

> CWS displays three required checkboxes near the data-usage form. Tick all three:

- [x] **I do not sell or transfer user data to third parties** apart from the approved use cases.
- [x] **I do not use or transfer user data for purposes unrelated to my item's single purpose.**
- [x] **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

## Privacy policy URL

```
https://github.com/nx-alejandrolacasa/mr-pully/blob/main/PRIVACY.md
```

## Notes for reviewer

> Paste into the "Justification" / "Testing instructions" field on submission.

```
Mr. Pully keeps a "Pull requests" tab group in sync with the user's GitHub pull request inbox, shows the count on the badge and lists the pull requests in the popup, grouped like GitHub's inbox.

To test (needs a GitHub account and a classic personal access token with the repo scope):
1. Install the extension. The badge shows "!" — no token yet.
2. Open the extension's options, paste the token, click Save, then Test token: it shows the account and its scopes.
3. Click the toolbar icon: the popup lists the account's open pull requests in GitHub-inbox sections.
4. Have someone request your review on a pull request (or request it from a second account): within the refresh interval a "Pull requests" tab group appears with that pull request's tab.
5. Close that tab: it moves to "Hidden from group" in the popup and is not reopened. Click Reopen to bring it back.
6. Submit the review and switch to another tab: about 30 seconds later the pull request's tab closes.

Network behavior: one GraphQL request to https://api.github.com/graphql per refresh, plus https://api.github.com/user when the user clicks Test token. No other destinations. No host permissions are requested because api.github.com answers CORS from any origin.

Build notes:
- Source: https://github.com/nx-alejandrolacasa/mr-pully (MIT license)
- npm install && NODE_ENV=production npm run build reproduces the package (esbuild monorepo, no other env vars or secrets).
- No analytics, telemetry, crash reporting, or remote code.
```

## Distribution settings

- **Visibility**: Public
- **Distribution**: All regions (the extension has no region-specific behavior)
- **Pricing**: Free

## Post-submission checklist

- [ ] Listing language matches `LISTING_CHROME.md` (summary ≤ 132 chars, description pasted as plain text)
- [ ] Privacy practices tab green-checked (Authentication information ticked, all three certifications ticked, privacy policy URL present)
- [ ] Single purpose statement matches the one above
- [ ] Justifications filled for `tabs`, `tabGroups`, `storage`, `alarms` and `offscreen`
- [ ] Screenshots uploaded (1280×800 or 640×400, at least one — see LISTING_CHROME.md, none captured yet)
- [ ] Store icon = 128×128 PNG (auto-uses `icons.128` from manifest, but the listing slot is separate — upload `packages/shared/assets/icons/icon.png` there too)
- [ ] Package uploaded: `mr-pully-chrome-v1.0.0.zip` from the GitHub release
