export interface JiraCurrentUserIdentity {
  readonly name?: string;
  readonly key?: string;
  readonly displayName?: string;
  readonly accountId?: string;
}

export type JiraAssigneeValue =
  | string
  | {
      readonly name?: string;
      readonly key?: string;
      readonly displayName?: string;
      readonly accountId?: string;
    }
  | null
  | undefined;

export function matchesCurrentUserAssignee(
  assignee: JiraAssigneeValue,
  currentUser: JiraCurrentUserIdentity,
): boolean {
  const currentUserTokens = collectUserTokens(currentUser);
  if (currentUserTokens.length === 0) {
    return false;
  }

  const assigneeTokens = collectAssigneeTokens(assignee);
  if (assigneeTokens.length === 0) {
    return false;
  }

  const assigneeSet = new Set(assigneeTokens);
  return currentUserTokens.some((token) => assigneeSet.has(token));
}

function collectAssigneeTokens(assignee: JiraAssigneeValue): string[] {
  if (typeof assignee === "string") {
    return normalizeTokens([assignee]);
  }

  if (assignee === null || assignee === undefined) {
    return [];
  }

  return collectUserTokens(assignee);
}

function collectUserTokens(user: JiraCurrentUserIdentity): string[] {
  return normalizeTokens([
    user.displayName,
    user.name,
    user.key,
    user.accountId,
  ]);
}

function normalizeTokens(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeToken(value)).filter(Boolean))];
}

function normalizeToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
