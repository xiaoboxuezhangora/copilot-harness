import { describe, expect, it } from "vitest";

import { matchesCurrentUserAssignee } from "./currentUserFilter";

describe("matchesCurrentUserAssignee", () => {
  const currentUser = {
    name: "wangbo",
    key: "JIRAUSER:10001",
    displayName: "王博-麻醉",
    accountId: "712020:6c8e9d73-2f80-4e3a-a2b5-4f4c8f2e9999",
  };

  it("matches string assignee by displayName fallback", () => {
    expect(matchesCurrentUserAssignee("王博-麻醉", currentUser)).toBe(true);
  });

  it("matches object assignee by key/accountId/name", () => {
    expect(
      matchesCurrentUserAssignee(
        {
          key: "JIRAUSER:10001",
        },
        currentUser,
      ),
    ).toBe(true);
    expect(
      matchesCurrentUserAssignee(
        {
          accountId: "712020:6c8e9d73-2f80-4e3a-a2b5-4f4c8f2e9999",
        },
        currentUser,
      ),
    ).toBe(true);
    expect(
      matchesCurrentUserAssignee(
        {
          name: "wangbo",
        },
        currentUser,
      ),
    ).toBe(true);
  });

  it("is case-insensitive and trims surrounding spaces", () => {
    expect(matchesCurrentUserAssignee("  WANGBO  ", currentUser)).toBe(true);
  });

  it("returns false when assignee does not match", () => {
    expect(matchesCurrentUserAssignee("王博-呼吸", currentUser)).toBe(false);
  });

  it("returns false when current user identity is empty", () => {
    expect(matchesCurrentUserAssignee("王博-麻醉", {})).toBe(false);
  });
});
