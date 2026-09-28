// Pull request URLs: https://github.com/{owner}/{repo}/pull/{n}, including
// sub-pages like /files or /commits/<sha>. Owner and repo are
// case-insensitive on GitHub, so the key lowercases them.

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

export function prKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return undefined;
  const match = PR_PATH.exec(parsed.pathname);
  if (!match) return undefined;
  const [, owner, repo, number] = match;
  return `${owner?.toLowerCase()}/${repo?.toLowerCase()}#${Number(number)}`;
}
