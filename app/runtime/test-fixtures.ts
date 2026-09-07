import type { AppEnvironment } from "./environment";

const fakeDatabase = {
  prepare() {
    throw new Error("The unit-test D1 fixture does not execute queries.");
  },
} as unknown as D1Database;

export function validTestEnvironment(
  overrides: Partial<AppEnvironment> = {},
): AppEnvironment {
  return {
    DB: fakeDatabase,
    APP_ENV: "test",
    CANONICAL_ORIGIN: "http://localhost:5173",
    HOUSEHOLD_TIME_ZONE: "America/Chicago",
    HOUSEHOLD_WEEK_START: "monday",
    OWNER_EMAIL: "owner@example.invalid",
    ALLOWED_EMAILS: "owner@example.invalid,member@example.invalid",
    LOCAL_AUTH_ENABLED: "false",
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
    TEXTBELT_API_KEY: "test-only-textbelt-api-key",
    ...overrides,
  };
}
