import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationError,
  createRequestAuthorizer,
  normalizeEmail,
  type AllowlistLookup,
  type AuthorizedMember,
  type SessionIdentity,
} from "./access";

const member: AuthorizedMember = {
  id: "member-1",
  householdId: "household-1",
  displayName: "Member One",
};

const session: SessionIdentity = {
  sessionId: "session-1",
  userId: "user-1",
  email: "member@example.com",
};

describe("auth access boundary", () => {
  it("normalizes email using exact trim plus lowercase semantics", () => {
    expect(normalizeEmail(" User+Alias@Example.COM ")).toBe(
      "user+alias@example.com",
    );
  });

  it("allows an authenticated identity linked by an active allowlist row", async () => {
    const lookup: AllowlistLookup = vi.fn(async (email, authUserId) =>
      email === "member@example.com" && authUserId === "user-1" ? member : null,
    );
    const authorize = createRequestAuthorizer({
      readSession: async () => session,
      lookup,
    });

    await expect(
      authorize.requireAuthorizedMember(
        new Request("https://app.example.test"),
      ),
    ).resolves.toEqual(member);
    expect(lookup).toHaveBeenCalledWith("member@example.com", "user-1");
  });

  it("denies a non-allowlisted authenticated identity", async () => {
    const authorize = createRequestAuthorizer({
      readSession: async () => session,
      lookup: async () => null,
    });

    await expect(
      authorize.requireAuthorizedMember(
        new Request("https://app.example.test"),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rechecks the allowlist on every request so removal denies the next request", async () => {
    let active = true;
    const authorize = createRequestAuthorizer({
      readSession: async () => session,
      lookup: async () => (active ? member : null),
    });
    const request = new Request("https://app.example.test");

    await expect(authorize.requireAuthorizedMember(request)).resolves.toEqual(
      member,
    );
    active = false;
    await expect(
      authorize.requireAuthorizedMember(request),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed unless every session supplies both auth user ID and email", async () => {
    for (const malformed of [
      { ...session, userId: "" },
      { ...session, email: "" },
      { ...session, email: " Member@Example.com " },
      { ...session, userId: undefined },
      { ...session, email: undefined },
    ]) {
      const lookup = vi.fn(async () => member);
      const authorize = createRequestAuthorizer({
        readSession: async () => malformed as unknown as SessionIdentity,
        lookup,
      });

      await expect(
        authorize.requireAuthorizedMember(
          new Request("https://app.example.test"),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("denies the next request after the database session is revoked", async () => {
    let currentSession: SessionIdentity | null = session;
    const authorize = createRequestAuthorizer({
      readSession: async () => currentSession,
      lookup: async () => member,
    });
    const request = new Request("https://app.example.test");

    await expect(authorize.requireAuthorizedMember(request)).resolves.toEqual(
      member,
    );
    currentSession = null;
    await expect(
      authorize.requireAuthorizedMember(request),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed without exposing D1 or session errors", async () => {
    const secretError = "database failed for member@example.com token=secret";
    const authorize = createRequestAuthorizer({
      readSession: async () => session,
      lookup: async () => {
        throw new Error(secretError);
      },
    });

    await expect(
      authorize.requireAuthorizedMember(
        new Request("https://app.example.test"),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "AuthorizationError",
        status: 503,
        message: expect.not.stringContaining(secretError),
      }),
    );

    const sessionFailure = createRequestAuthorizer({
      readSession: async () => {
        throw new Error(secretError);
      },
      lookup: async () => member,
    });
    await expect(
      sessionFailure.requireAuthorizedMember(
        new Request("https://app.example.test"),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
