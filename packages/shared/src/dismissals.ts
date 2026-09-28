// PR tabs the user closed stay closed until the PR has new commits or a new
// review request for them. Everything else (comments, labels, CI) is ignored.

import type { PrItem } from "./inbox.ts";

export interface Dismissal {
  headRefOid: string;
  lastReviewRequestAt?: string;
  dismissedAt: number;
}

export type Dismissals = Record<string, Dismissal>;

export function dismissalOf(item: PrItem, now: number): Dismissal {
  return {
    headRefOid: item.headRefOid,
    ...(item.lastReviewRequestAt ? { lastReviewRequestAt: item.lastReviewRequestAt } : {}),
    dismissedAt: now,
  };
}

export function hasChangedSince(dismissal: Dismissal, item: PrItem): boolean {
  if (item.headRefOid !== dismissal.headRefOid) return true;
  const request = item.lastReviewRequestAt;
  return request !== undefined && (dismissal.lastReviewRequestAt === undefined || request > dismissal.lastReviewRequestAt);
}

// Keeps only dismissals of PRs still in the inbox that haven't changed.
export function activeDismissals(dismissed: Dismissals, items: readonly PrItem[]): Dismissals {
  const byId = new Map(items.map((item) => [item.id, item]));
  return Object.fromEntries(
    Object.entries(dismissed).filter(([id, dismissal]) => {
      const item = byId.get(id);
      return item !== undefined && !hasChangedSince(dismissal, item);
    })
  );
}
