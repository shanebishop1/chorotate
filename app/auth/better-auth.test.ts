import { describe, expect, it, vi } from "vitest";
import { google } from "better-auth/social-providers";

import { parseRuntimeConfig } from "../runtime/environment";
import { validTestEnvironment } from "../runtime/test-fixtures";
import {
  createBetterAuth,
  createBetterAuthOptions,
  handleAuthRequest,
  type BetterAuthFactory,
} from "./better-auth";
import type { D1AuthBinding } from "./d1-allowlist";

function binding(overrides: Partial<D1AuthBinding> = {}): D1AuthBinding {
  const authorized = {
    id: "member-1",
    householdId: "household-1",
    displayName: "Member One",
  };
  return {
    requireEligible: async () => authorized,
    claim: async () => authorized,
    reconcileAccountUser: async () => authorized,
    requireBoundUser: async () => authorized,
    ...overrides,
  };
}

describe("Better Auth construction contract", () => {
  it("pins D1 sessions, Google, canonical URL, state/PKCE, and secure cookies", () => {
    const environment = validTestEnvironment({
      CANONICAL_ORIGIN: "https://chorotate.example",
    });
    const config = parseRuntimeConfig(environment);
    const options = createBetterAuthOptions(
      environment.DB,
      config,
      async () => ({
        id: "member-1",
        householdId: "household-1",
        displayName: "Member One",
      }),
    );

    expect(options.database).toBe(environment.DB);
    expect(options.baseURL).toBe("https://chorotate.example");
    expect(options.basePath).toBe("/api/auth");
    expect(options.trustedOrigins).toEqual(["https://chorotate.example"]);
    expect(options.socialProviders.google).toEqual({
      clientId: config.secrets.googleClientId,
      clientSecret: config.secrets.googleClientSecret,
    });
    expect(options.session?.cookieCache).toEqual({ enabled: false });
    expect(options.account).toMatchObject({
      storeStateStrategy: "database",
      skipStateCookieCheck: false,
      storeAccountCookie: false,
    });
    expect(options.advanced).toMatchObject({
      useSecureCookies: true,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    });
    expect(options.logger).toEqual({ disabled: true });
    expect(options.telemetry).toEqual({ enabled: false });
  });

  it("uses Better Auth's Google state and PKCE contract for the exact callback", async () => {
    const provider = google({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
    const authorizationUrl = await provider.createAuthorizationURL({
      state: "opaque-state",
      codeVerifier: "a-secure-code-verifier-with-sufficient-entropy-1234567890",
      redirectURI: "https://chorotate.example/api/auth/callback/google",
    });

    expect(authorizationUrl.searchParams.get("state")).toBe("opaque-state");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://chorotate.example/api/auth/callback/google",
    );
  });

  it("denies account creation unless the exact normalized identity is active", async () => {
    const environment = validTestEnvironment();
    const config = parseRuntimeConfig(environment);
    const lookup = vi.fn(async (email: string) =>
      email === "member@example.invalid"
        ? {
            id: "member-1",
            householdId: "household-1",
            displayName: "Member One",
          }
        : null,
    );
    const requireEligible = vi.fn(async (email: string) => {
      if (email !== "member@example.invalid") {
        const error = new Error("denied");
        Object.assign(error, { reason: "denied" });
        throw error;
      }
      return {
        id: "member-1",
        householdId: "household-1",
        displayName: "Member One",
      };
    });
    const options = createBetterAuthOptions(
      environment.DB,
      config,
      lookup,
      binding({ requireEligible }),
    );
    const before = options.databaseHooks?.user?.create?.before;

    await expect(
      before?.({ email: " Member@Example.invalid " } as Parameters<
        NonNullable<typeof before>
      >[0]),
    ).resolves.toBeUndefined();
    await expect(
      before?.({ email: "other@example.invalid" } as Parameters<
        NonNullable<typeof before>
      >[0]),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect(requireEligible).toHaveBeenCalledWith("member@example.invalid");
    await expect(
      before?.({ email: "member@example.invalid.evil" } as Parameters<
        NonNullable<typeof before>
      >[0]),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("fails account creation closed when the allowlist cannot be read", async () => {
    const environment = validTestEnvironment();
    const options = createBetterAuthOptions(
      environment.DB,
      parseRuntimeConfig(environment),
      async () => null,
      binding({
        requireEligible: async () => {
          const error = new Error("sensitive database detail");
          Object.assign(error, { reason: "unavailable" });
          throw error;
        },
      }),
    );
    const before = options.databaseHooks?.user?.create?.before;

    await expect(
      before?.({ email: "member@example.invalid" } as Parameters<
        NonNullable<typeof before>
      >[0]),
    ).rejects.toMatchObject({
      status: "SERVICE_UNAVAILABLE",
      message: expect.not.stringContaining("sensitive database detail"),
    });
  });

  it("claims at user creation and gates account/session creation on the exact binding", async () => {
    const environment = validTestEnvironment();
    const claim = vi.fn(binding().claim);
    const reconcileAccountUser = vi.fn(binding().reconcileAccountUser);
    const requireBoundUser = vi.fn(binding().requireBoundUser);
    const options = createBetterAuthOptions(
      environment.DB,
      parseRuntimeConfig(environment),
      async () => null,
      binding({ claim, reconcileAccountUser, requireBoundUser }),
    );

    await options.databaseHooks?.user?.create?.after?.({
      id: "user-1",
      email: " Member@Example.invalid ",
    } as never);
    await options.databaseHooks?.account?.create?.before?.({
      userId: "user-1",
    } as never);
    await options.databaseHooks?.session?.create?.before?.({
      userId: "user-1",
    } as never);

    expect(claim).toHaveBeenCalledWith("member@example.invalid", "user-1");
    expect(reconcileAccountUser).toHaveBeenCalledWith("user-1");
    expect(requireBoundUser).toHaveBeenCalledWith("user-1");
  });

  it("instantiates the pinned library through the typed D1 factory seam", async () => {
    const d1 = {
      prepare() {
        throw new Error("The construction fake does not execute statements");
      },
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;
    const environment = validTestEnvironment({ DB: d1 });
    const auth = createBetterAuth(
      environment.DB,
      parseRuntimeConfig(environment),
      async () => null,
    );

    expect(auth.handler).toBeTypeOf("function");
    expect(auth.options.database).toBe(d1);
    await expect(auth.ready).resolves.toBeUndefined();
  });

  it("mounts the complete auth request URL without logging callback tokens", async () => {
    const environment = validTestEnvironment({
      CANONICAL_ORIGIN: "https://chorotate.example",
    });
    const config = parseRuntimeConfig(environment);
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const factory: BetterAuthFactory = () => ({
      handler,
      readSession: async () => null,
    });
    const request = new Request(
      "https://chorotate.example/api/auth/callback/google?code=secret&state=secret",
    );

    const response = await handleAuthRequest(request, environment.DB, config, {
      factory,
      lookup: async () => null,
    });

    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("rechecks authenticated API requests and denies removed identities", async () => {
    const environment = validTestEnvironment({
      CANONICAL_ORIGIN: "https://chorotate.example",
    });
    const config = parseRuntimeConfig(environment);
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const factory: BetterAuthFactory = () => ({
      handler,
      readSession: async () => ({
        sessionId: "session-1",
        userId: "user-1",
        email: "removed@example.invalid",
      }),
    });

    const response = await handleAuthRequest(
      new Request("https://chorotate.example/api/auth/revoke-session", {
        method: "POST",
        headers: {
          cookie: "chorotate.session_token=opaque",
          origin: "https://chorotate.example",
        },
      }),
      environment.DB,
      config,
      { factory, lookup: async () => null },
    );

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a removed identity sign out only through the exact-origin endpoint", async () => {
    const environment = validTestEnvironment({
      CANONICAL_ORIGIN: "https://chorotate.example",
    });
    const config = parseRuntimeConfig(environment);
    const handler = vi.fn(async () =>
      Response.json(
        { success: true },
        { headers: { "set-cookie": "chorotate.session_token=; Max-Age=0" } },
      ),
    );
    const factory: BetterAuthFactory = () => ({
      handler,
      readSession: async () => ({
        sessionId: "session-1",
        userId: "user-1",
        email: "removed@example.invalid",
      }),
    });
    const signOut = new Request("https://chorotate.example/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: "chorotate.session_token=opaque",
        origin: "https://chorotate.example",
      },
    });

    const response = await handleAuthRequest(signOut, environment.DB, config, {
      factory,
      lookup: async () => null,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(handler).toHaveBeenCalledWith(signOut);

    handler.mockClear();
    const alternateHost = await handleAuthRequest(
      new Request("https://alternate.example/api/auth/sign-out", {
        method: "POST",
        headers: { origin: "https://chorotate.example" },
      }),
      environment.DB,
      config,
      { factory, lookup: async () => null },
    );
    expect(alternateHost.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("redacts handler failures from responses and logs", async () => {
    const sensitiveValue = "code=secret&state=secret";
    const environment = validTestEnvironment({
      CANONICAL_ORIGIN: "https://chorotate.example",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const response = await handleAuthRequest(
      new Request(
        `https://chorotate.example/api/auth/callback/google?${sensitiveValue}`,
      ),
      environment.DB,
      parseRuntimeConfig(environment),
      {
        factory: () => ({
          readSession: async () => null,
          handler: async () => {
            throw new Error(sensitiveValue);
          },
        }),
        lookup: async () => null,
      },
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain(sensitiveValue);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
