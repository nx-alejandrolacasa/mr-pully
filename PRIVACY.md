# Privacy Policy

**Last updated:** 2026-09-28

This policy explains what data the **Mr. Pully** browser extension (the "extension") handles, what is transmitted off your device, and how you can control it. It applies to any copy of the extension built from this repository or distributed through [addons.mozilla.org](https://addons.mozilla.org) (Firefox) or the [Chrome Web Store](https://chromewebstore.google.com) (Chrome and Chromium-based browsers).

## 1. Summary

- The extension shows the GitHub pull requests that need your attention and keeps a tab group with them open.
- It needs a GitHub personal access token that you provide. The token is stored only in your browser and is sent **only to `api.github.com`**, to fetch your pull requests.
- The extension talks to no other server. The developer runs no server and receives nothing.
- It does **not** collect, sell, or share your browsing history, page contents, or any personal identifier.

## 2. Data sent off your device

On every refresh (by default every 2 minutes), the extension sends one request to the GitHub GraphQL API (`https://api.github.com/graphql`) with your token in the `Authorization` header. The request asks for the open pull requests you are requested to review, those requested from your teams, and those you authored. When you press *Test token* in the settings, it also calls `https://api.github.com/user` to show which account the token belongs to.

These requests go directly from your browser to GitHub and are governed by [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Nothing else is transmitted: not your tabs, not your browsing history, not your settings.

## 3. Data the extension does not collect or transmit

The extension does **not**:

- Send data to the developer or to any server other than `api.github.com`.
- Transmit your browsing history, visited URLs or page contents.
- Use analytics, telemetry, crash reporting, or any user-identification mechanism.
- Use cookies or any tracking technology.
- Sell, rent, lease, share, or disclose data to advertisers, data brokers, or any third party.
- Read page content. It has no content scripts.

## 4. Data stored by the extension

In local extension storage (`storage.local`) on your device only:

- **Your GitHub token.** It is never displayed again after you save it, and you can remove it at any time from the settings.
- **Settings**: refresh interval, tab group name and colour, grace period, stale-PR filter and per-section options.
- **Pull request tabs you closed**: for each, the PR's internal GitHub ID, its latest commit ID and the time of the latest review request, so it isn't reopened until it changes.
- **Your GitHub login**, to notice when the token belongs to a different account.

In session storage (`storage.session`, cleared when the browser exits): the last fetched list of pull requests (titles, repositories, authors, status), which tabs the extension opened, and the tab group's state.

Uninstalling the extension removes all of its stored data.

## 5. How the extension uses tab URLs

Through the `tabs` permission, the extension reads the URLs of your tabs to recognise tabs that show a tracked pull request (`https://github.com/{owner}/{repo}/pull/{number}`), so it doesn't open duplicates and can find its own tabs again after a restart. URLs are compared locally and never stored or transmitted.

## 6. Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Store the token, settings and closed-tab list locally, and the fetched inbox for the session. |
| `alarms` | Refresh the inbox periodically and close finished PR tabs after the grace period. |
| `tabs` | Open and close PR tabs, read tab URLs to recognise PR tabs, and focus a PR's tab from the popup. |
| `tabGroups` | Create, find, name and colour the "Pull requests" tab group. |
| `offscreen` (Chrome only) | A hidden page that checks whether the browser is in light or dark mode, so the toolbar icon stays visible. |

The extension requests no host permissions: GitHub's API accepts requests from extensions without them.

## 7. Legal basis for processing (EU/EEA users)

Where the General Data Protection Regulation (GDPR) applies: the developer processes no personal data. The extension only exchanges data between your browser and GitHub, at your direction and with a token you provide.

## 8. Your rights and how to exercise them

- **Remove the token**: *Remove* in the extension's settings.
- **Delete all local data**: uninstall the extension; your browser removes its storage automatically.
- **Right to access, rectification, erasure, restriction, portability, and objection** (GDPR), and **right to know, delete, and opt-out of "sale" or sharing** (CCPA / California): the developer stores no data about you anywhere. Data held by GitHub is covered by GitHub's own policies.

## 9. Children's privacy

The extension is not directed at children under the age of 13 and does not knowingly collect personal information from anyone, including children.

## 10. Security

The extension contains no remotely loaded code, no eval'd code, and no third-party scripts. The token is kept in extension storage, protected by the same operating-system-level access controls that protect your browser profile. Use a token with the smallest scopes you need, and revoke it on GitHub if you stop using the extension.

## 11. Changes to this policy

If the extension's data practices change, this policy will be updated and the "Last updated" date at the top will reflect the change.
