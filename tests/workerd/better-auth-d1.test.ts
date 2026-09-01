import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createBetterAuthOptions } from "../../app/auth/better-auth";
import {
  createD1AuthBinding,
  createD1AllowlistLookup,
} from "../../app/auth/d1-allowlist";
import {
  parseRuntimeConfig,
  type AppEnvironment,
} from "../../app/runtime/environment";

const origin = "https://auth.example.test";
const email = "member@example.test";

function d1(): D1Database {
  if (env.DB === undefined)
    throw new Error("Workerd D1 test binding is missing");
  return env.DB;
}

function environment(): AppEnvironment {
  return {
    DB: d1(),
    APP_ENV: "test",
    CANONICAL_ORIGIN: origin,
    HOUSEHOLD_TIME_ZONE: "UTC",
    HOUSEHOLD_WEEK_START: "monday",
    OWNER_EMAIL: email,
    ALLOWED_EMAILS: email,
    REMINDER_SMS_ENABLED: "true",
    REMINDER_BATCH_SIZE: "25",
    REMINDER_LEASE_MILLISECONDS: "300000",
    REMINDER_MAX_ATTEMPTS: "5",
    REMINDER_PROVIDER_TIMEOUT_MILLISECONDS: "10000",
    REMINDER_RETRY_BASE_MILLISECONDS: "60000",
    REMINDER_RETRY_MAX_MILLISECONDS: "900000",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-00000000",
    GOOGLE_CLIENT_ID: "test-only-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-only-google-client-secret",
  };
}

async function seedAllowlist(): Promise<void> {
  await d1().exec(`
    INSERT INTO households (id,name,time_zone,week_start,created_at) VALUES ('household-1','Home','UTC',1,'2026-08-31T00:00:00Z');
    INSERT INTO members (id,household_id,display_name,active,created_at) VALUES ('member-1','household-1','Member One',1,'2026-08-31T00:00:00Z');
    INSERT INTO allowlisted_identities VALUES ('identity-1','household-1','member-1','${email}',NULL,1,'2026-08-31T00:00:00Z');
  `);
}

function testAuth() {
  const environmentValue = environment();
  const database = d1();
  return betterAuth({
    ...createBetterAuthOptions(
      database,
      parseRuntimeConfig(environmentValue),
      createD1AllowlistLookup(database),
      createD1AuthBinding(database),
    ),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async () => undefined,
    },
  });
}

async function authRequest(
  auth: ReturnType<typeof testAuth>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      ...init,
      headers: {
        origin,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init.headers,
      },
    }),
  );
}

async function count(table: string): Promise<number> {
  const result = await d1()
    .prepare(`SELECT count(*) AS count FROM "${table}"`)
    .first<{ count: number }>();
  return result?.count ?? -1;
}

beforeEach(async () => {
  const database = d1();
  const existing = await database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY rowid DESC`,
    )
    .all<{ name: string }>();
  if (existing.results.length > 0) {
    await database.exec("PRAGMA foreign_keys = OFF");
    await database.batch(
      existing.results.map(({ name }) =>
        database.prepare(`DROP TABLE "${name.replaceAll('"', '""')}"`),
      ),
    );
    await database.exec("PRAGMA foreign_keys = ON");
  }
  await applyD1Migrations(database, env.TEST_MIGRATIONS);
});

describe("Better Auth 1.7.2 on workerd D1", () => {
  it("provides AsyncLocalStorage and handles a real empty-session request", async () => {
    const storage = new AsyncLocalStorage<string>();
    await expect(
      storage.run("workerd", async () => {
        await Promise.resolve();
        return storage.getStore();
      }),
    ).resolves.toBe("workerd");

    const response = await authRequest(testAuth(), "/get-session");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });

  it("creates user/account/session/verification rows and revokes the real database session", async () => {
    await seedAllowlist();
    const auth = testAuth();
    const signUp = await authRequest(auth, "/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name: "Member One",
        email,
        password: "correct horse battery staple",
      }),
    });
    expect(signUp.status).toBe(200);
    const signUpBody = (await signUp.json()) as { token: string };
    const cookie = signUp.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    expect(signUpBody.token).toBeTruthy();
    await expect(count("user")).resolves.toBe(1);
    await expect(count("account")).resolves.toBe(1);
    await expect(count("session")).resolves.toBe(1);
    await expect(
      d1()
        .prepare(
          "SELECT auth_user_id FROM allowlisted_identities WHERE id = 'identity-1'",
        )
        .first(),
    ).resolves.toMatchObject({ auth_user_id: expect.any(String) });

    const reset = await authRequest(auth, "/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    expect(reset.status).toBe(200);
    await expect(count("verification")).resolves.toBe(1);

    const revoke = await authRequest(auth, "/revoke-session", {
      method: "POST",
      headers: { cookie: cookie! },
      body: JSON.stringify({ token: signUpBody.token }),
    });
    expect(revoke.status).toBe(200);
    await expect(count("session")).resolves.toBe(0);

    const revokedSession = await authRequest(auth, "/get-session", {
      headers: { cookie: cookie! },
    });
    await expect(revokedSession.json()).resolves.toBeNull();
  });

  it("fails closed for an unbound user then idempotently reconciles only its exact account claim", async () => {
    await seedAllowlist();
    await d1()
      .prepare(
        `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt)
       VALUES (?1,'Member One',?2,1,?3,?3)`,
      )
      .bind("orphan-user", email, new Date().getTime())
      .run();
    const binding = createD1AuthBinding(d1());

    await expect(binding.requireBoundUser("orphan-user")).rejects.toMatchObject(
      {
        reason: "denied",
      },
    );
    const options = createBetterAuthOptions(
      d1(),
      parseRuntimeConfig(environment()),
      createD1AllowlistLookup(d1()),
      binding,
    );
    await expect(
      options.databaseHooks?.account?.create?.before?.({
        userId: "orphan-user",
      } as never),
    ).resolves.toBeUndefined();
    await expect(
      binding.reconcileAccountUser("orphan-user"),
    ).resolves.toMatchObject({ id: "member-1" });
    await expect(
      binding.requireBoundUser("orphan-user"),
    ).resolves.toMatchObject({
      id: "member-1",
    });
    await expect(binding.claim(email, "different-user")).rejects.toMatchObject({
      reason: "denied",
    });
  });

  it("allows only one winner when two auth users race to claim the identity", async () => {
    await seedAllowlist();
    const binding = createD1AuthBinding(d1());

    const outcomes = await Promise.allSettled([
      binding.claim(email, "user-a"),
      binding.claim(email, "user-b"),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expect(
      d1()
        .prepare(
          "SELECT auth_user_id FROM allowlisted_identities WHERE id = 'identity-1'",
        )
        .first(),
    ).resolves.toMatchObject({
      auth_user_id: expect.stringMatching(/^user-[ab]$/),
    });
  });
});
