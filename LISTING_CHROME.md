# Chrome Web Store listing copy

Text to paste into the chrome.google.com/webstore/devconsole submission form. Keep this in sync with the actual extension behavior. Dashboard-only fields (single purpose, permission justifications, data usage) live in [`CHROME_SUBMISSION.md`](./CHROME_SUBMISSION.md).

CWS rendering note: the description field does **not** support Markdown. Line breaks render, but `**bold**` and `#` headings render as literal characters. Sections below use ALL-CAPS labels so they remain readable when pasted as plain text.

## Name

> 50-character limit. Provided by `_locales/en/messages.json` (`extName`).

```
Mr. Pully
```

## Summary

> 132-character limit. Provided by `_locales/en/messages.json` (`extDescription`).

```
Your GitHub pull request inbox as a live tab group: PRs that need you open in a group and close when done, counted on the badge.
```

## Description

> 16,000-character limit. Paste as plain text — CWS does not render Markdown.

```
Mr. Pully turns the GitHub pull requests that need you into a tab group that fills and empties itself, with a count on the toolbar badge and a popup that mirrors GitHub's pull requests inbox.

HOW IT WORKS

Paste a GitHub personal access token in the settings. Every couple of minutes Mr. Pully asks GitHub which open pull requests are waiting for your review, your teams' review, or are yours, and keeps the "Pull requests" tab group in step with that list.

LIVE TAB GROUP

• PRs waiting for your review (or your team's) open in the background, unloaded, in a tab group called "Pull requests".
• When a PR stops needing you (you reviewed it, it was merged or closed), its tab closes after a short grace period. It waits while you're still looking at that tab.
• Tabs you close stay closed until the PR gets new commits or a new review request for you. The popup lists them under "Hidden from group" with a Reopen button.
• Tabs in the group that aren't tracked PRs are left alone, as are PR tabs you opened yourself outside the group.
• If the group is renamed, closed or duplicated, the badge shows "!" and the popup offers a one-click fix.

POPUP INBOX

Grouped like GitHub's inbox: Needs your review, Needs your teams' review, Your drafts, Waiting for review or checks, Needs action, Ready to merge. Each PR shows its status, checks and comments. Clicking a PR focuses its tab, or opens it if it isn't open.

SETTINGS

• Refresh interval (default every 2 minutes)
• Hide your PRs not updated in N days (default 30)
• Badge colour
• Live tab group on or off, its name and colour
• Open new PR tabs without loading them
• Wait before closing a finished PR tab (default 30 seconds)
• Per section: show in the popup, count in the badge, add to the tab group

TOKEN

A classic personal access token with the repo scope, plus read:org if you want team review requests. Fine-grained tokens work too, but only for the one organisation they target. The settings page never shows a saved token again, and "Test token" tells you which account it signs in as.

PRIVACY

The token stays in your browser and is only sent to api.github.com, to fetch your pull requests. No analytics, no telemetry, no other servers, no remote code. Tab URLs are only compared locally to recognise PR tabs; they are never stored or transmitted.

Full privacy policy: https://github.com/nx-alejandrolacasa/mr-pully/blob/main/PRIVACY.md

SOURCE AND LICENSE

Open source under the MIT License.

GitHub: https://github.com/nx-alejandrolacasa/mr-pully
```

## Category

> CWS allows one primary category.

- **Developer Tools** (primary recommendation — GitHub pull requests)
- Fallback: **Workflow & Planning**

## Language

```
English (United States)
```

## Store icon

`packages/shared/assets/icons/icon.png` (128×128 PNG, from `node scripts/generate-icon.mjs`) — the same render the Chrome build embeds, also uploaded separately as the store-listing icon.

## Screenshots

CWS requires **exactly 1280×800** or **640×400**. At least one screenshot is required; up to five may be uploaded.

**Not captured yet.** Suggested shots (save to `packages/shared/assets/screenshots/` at 1280×800):

1. The popup open with several sections filled, badge count visible
2. The "Pull requests" tab group expanded with a few PR tabs
3. The settings page (token section with "Signed in as …", sections table)

## Promotional images (optional but recommended)

- **Small promo tile**: 440×280 PNG/JPG — improves visibility in CWS rotations.
- **Marquee promo**: 1400×560 PNG/JPG — only used if the extension is featured.

If we don't have these yet, skip them; they can be added in a later edit without re-review.

## Release notes

> CWS shows version notes on the item's update. Paste the latest entry as plain text. Newest first.

### v1.0.0

```
First release. The GitHub pull requests that need your review open in a "Pull requests" tab group and close once they're done, with a count on the badge and a popup that mirrors GitHub's inbox. Tabs you close stay closed until the PR changes. Your token only ever goes to api.github.com.
```
