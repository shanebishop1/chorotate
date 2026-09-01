import { describe, expect, it } from "vitest";

import {
  activeAllowlistMemberQuery,
  claimActiveAllowlistIdentityQuery,
  createD1AuthBinding,
  createD1AllowlistLookup,
} from "./d1-allowlist";

function fakeD1(
  handler: (
    query: string,
    bindings: readonly unknown[],
  ) => { results: unknown[]; success?: boolean },
): D1Database {
  return {
    prepare: (query: string) =>
      ({
        bind: (...bindings: unknown[]) => ({
          all: async () => {
            const result = handler(query, bindings);
            return { ...result, success: result.success ?? true };
          },
        }),
      }) as unknown as D1PreparedStatement,
  } as unknown as D1Database;
}

const memberRow = {
  member_id: "member-1",
  household_id: "household-1",
  display_name: "Member One",
};

describe("D1 allowlist contract", () => {
  it("targets the domain migration's normalized email and active member link", () => {
    expect(activeAllowlistMemberQuery).toContain("ai.email_normalized = ?1");
    expect(activeAllowlistMemberQuery).toContain("ai.auth_user_id = ?2");
    expect(activeAllowlistMemberQuery).toContain("ai.active = 1");
    expect(activeAllowlistMemberQuery).toContain("m.active = 1");
  });

  it("returns the linked member only for one active allowlist mapping", async () => {
    const lookup = createD1AllowlistLookup(
      fakeD1((_query, bindings) => ({
        results:
          bindings[0] === "member@example.invalid" && bindings[1] === "user-1"
            ? [memberRow]
            : [],
      })),
    );

    await expect(lookup("member@example.invalid", "user-1")).resolves.toEqual({
      id: "member-1",
      householdId: "household-1",
      displayName: "Member One",
    });
    await expect(
      lookup("member@example.invalid", "other-user"),
    ).resolves.toBeNull();
  });

  it("fails closed for no mapping, ambiguous mapping, malformed rows, or D1 failure", async () => {
    await expect(
      createD1AllowlistLookup(fakeD1(() => ({ results: [] })))(
        "member@example.invalid",
        "user-1",
      ),
    ).resolves.toBeNull();
    await expect(
      createD1AllowlistLookup(fakeD1(() => ({ results: [{}, {}] })))(
        "member@example.invalid",
        "user-1",
      ),
    ).rejects.toThrow("Allowlist lookup failed");
    await expect(
      createD1AllowlistLookup(fakeD1(() => ({ results: [{}] })))(
        "member@example.invalid",
        "user-1",
      ),
    ).rejects.toThrow("Allowlist lookup failed");
    await expect(
      createD1AllowlistLookup(fakeD1(() => ({ results: [], success: false })))(
        "member@example.invalid",
        "user-1",
      ),
    ).rejects.toThrow("Allowlist lookup failed");
  });

  it("atomically claims one active unbound identity and permits only the exact replay", async () => {
    expect(claimActiveAllowlistIdentityQuery).toContain("auth_user_id = ?2");
    expect(claimActiveAllowlistIdentityQuery).toContain(
      "auth_user_id IS NULL OR auth_user_id = ?2",
    );
    expect(claimActiveAllowlistIdentityQuery).toContain("RETURNING");

    let boundUserId: string | null = null;
    const binding = createD1AuthBinding(
      fakeD1((query, bindings) => {
        if (query === claimActiveAllowlistIdentityQuery) {
          const requestedUserId = bindings[1] as string;
          if (boundUserId !== null && boundUserId !== requestedUserId) {
            return { results: [] };
          }
          boundUserId = requestedUserId;
          return { results: [memberRow] };
        }
        return { results: [] };
      }),
    );

    await expect(
      binding.claim("member@example.invalid", "user-1"),
    ).resolves.toMatchObject({ id: "member-1" });
    await expect(
      binding.claim("member@example.invalid", "user-1"),
    ).resolves.toMatchObject({ id: "member-1" });
    await expect(
      binding.claim("member@example.invalid", "user-2"),
    ).rejects.toMatchObject({ reason: "denied" });
  });

  it("reconciles a user/account retry only from the stored normalized auth email", async () => {
    const binding = createD1AuthBinding(
      fakeD1((query) => {
        if (query.includes('FROM "user"')) {
          return {
            results: [
              { auth_user_id: "user-1", email: "member@example.invalid" },
            ],
          };
        }
        if (query === claimActiveAllowlistIdentityQuery) {
          return { results: [memberRow] };
        }
        return { results: [] };
      }),
    );

    await expect(binding.reconcileAccountUser("user-1")).resolves.toMatchObject(
      {
        id: "member-1",
      },
    );
  });
});
