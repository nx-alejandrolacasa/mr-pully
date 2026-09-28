// Pull request URLs: https://github.com/{owner}/{repo}/pull/{n}, including
// sub-pages like /files or /commits/<sha>, and the login or SSO pages GitHub
// redirects a PR to, which name it in `return_to`. Owner and repo are
// case-insensitive on GitHub, so the key lowercases them.

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

export function prKey(url: string | undefined): string | undefined {
  const parsed = parseUrl(url);
  if (parsed?.protocol !== "https:" || parsed.hostname !== "github.com") return undefined;
  const match = PR_PATH.exec(parsed.pathname);
  if (match) {
    const [, owner, repo, number] = match;
    return `${owner?.toLowerCase()}/${repo?.toLowerCase()}#${Number(number)}`;
  }
  const returnTo = parsed.searchParams.get("return_to");
  return returnTo ? prKey(parseUrl(returnTo, parsed)?.href) : undefined;
}

function parseUrl(url: string | undefined, base?: URL): URL | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}
