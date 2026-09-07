import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  plainBindingNames,
  RuntimeConfigError,
  secretBindingNames,
  parseRuntimeConfig,
  type AppEnvironment,
} from "./environment";
import { validTestEnvironment } from "./test-fixtures";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(path);
    if (
      ![".ts", ".tsx"].includes(extname(entry.name)) ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx")
    ) {
      return [];
    }
    return [path];
  });
}

describe("parseRuntimeConfig", () => {
  it("keeps member contacts out of environment inputs", () => {
    const inputNames = [...plainBindingNames, ...secretBindingNames];
    const forbiddenMarkers = [["RE", "SEND_"].join(""), "PHONE", "E164"];

    expect(
      inputNames.filter((name) =>
        forbiddenMarkers.some((marker) => name.includes(marker)),
      ),
    ).toEqual([]);
  });

  it("contains no Resend transport or configuration path in runtime source", () => {
    const forbiddenProvider = ["re", "send"].join("");
    const sources = ["app", "workers"].flatMap((directory) =>
      runtimeSourceFiles(resolve(root, directory)),
    );

    expect(
      sources.filter((file) =>
        readFileSync(file, "utf8").toLowerCase().includes(forbiddenProvider),
      ),
    ).toEqual([]);
  });

  it("fails closed when required configuration is missing", () => {
    expect(() => parseRuntimeConfig({} as AppEnvironment)).toThrow(
      RuntimeConfigError,
    );
  });

  it("never includes secret values in validation errors", () => {
    const secretValue = "leak-me-not";

    expect(() =>
      parseRuntimeConfig(
        validTestEnvironment({ BETTER_AUTH_SECRET: secretValue }),
      ),
    ).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(secretValue),
      }),
    );
  });

  it("accepts explicit safe local and test configuration", () => {
    const config = parseRuntimeConfig(
      validTestEnvironment({ APP_ENV: "local" }),
    );

    expect(config.applicationEnvironment).toBe("local");
    expect(config.canonicalOrigin).toBe("http://localhost:5173");
    expect(config.household.allowedEmails).toEqual([
      "owner@example.invalid",
      "member@example.invalid",
    ]);
    expect(config.secrets.googleClientSecret).toBe(
      "test-only-google-client-secret",
    );
    expect(config.secrets.textbeltApiKey).toBe("test-only-textbelt-api-key");
    expect(config.reminders).toEqual({
      smsEnabled: true,
      batchSize: 25,
      leaseMilliseconds: 300_000,
      maxAttempts: 5,
      providerTimeoutMilliseconds: 10_000,
      retryBaseMilliseconds: 60_000,
      retryMaxMilliseconds: 900_000,
    });
  });

  it("parses bounded reminder operations and requires a lease for the sequential batch", () => {
    const config = parseRuntimeConfig(
      validTestEnvironment({
        REMINDER_BATCH_SIZE: "4",
        REMINDER_LEASE_MILLISECONDS: "50000",
        REMINDER_MAX_ATTEMPTS: "3",
        REMINDER_PROVIDER_TIMEOUT_MILLISECONDS: "10000",
        REMINDER_RETRY_BASE_MILLISECONDS: "2000",
        REMINDER_RETRY_MAX_MILLISECONDS: "16000",
      }),
    );
    expect(config.reminders).toEqual({
      smsEnabled: true,
      batchSize: 4,
      leaseMilliseconds: 50_000,
      maxAttempts: 3,
      providerTimeoutMilliseconds: 10_000,
      retryBaseMilliseconds: 2_000,
      retryMaxMilliseconds: 16_000,
    });

    expect(() =>
      parseRuntimeConfig(
        validTestEnvironment({
          REMINDER_BATCH_SIZE: "4",
          REMINDER_LEASE_MILLISECONDS: "44999",
          REMINDER_PROVIDER_TIMEOUT_MILLISECONDS: "10000",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        invalidBindings: expect.arrayContaining([
          "REMINDER_LEASE_MILLISECONDS",
        ]),
      }),
    );
  });

  it.each([
    ["REMINDER_SMS_ENABLED", "yes"],
    ["REMINDER_BATCH_SIZE", "0"],
    ["REMINDER_LEASE_MILLISECONDS", "secret"],
    ["REMINDER_MAX_ATTEMPTS", "21"],
    ["REMINDER_PROVIDER_TIMEOUT_MILLISECONDS", "999"],
    ["REMINDER_RETRY_BASE_MILLISECONDS", "0"],
    ["REMINDER_RETRY_MAX_MILLISECONDS", "86400001"],
  ] as const)(
    "rejects invalid %s without disclosing its value",
    (name, value) => {
      expect(() =>
        parseRuntimeConfig(validTestEnvironment({ [name]: value })),
      ).toThrowError(
        expect.objectContaining({
          message: expect.not.stringContaining(value),
        }),
      );
    },
  );

  it("rejects placeholder values when production is selected", () => {
    expect(() =>
      parseRuntimeConfig(
        validTestEnvironment({
          APP_ENV: "production",
          CANONICAL_ORIGIN: "https://chores.example.com",
          OWNER_EMAIL: "owner@example.invalid",
          ALLOWED_EMAILS: "owner@example.invalid",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        invalidBindings: expect.arrayContaining([
          "OWNER_EMAIL",
          "ALLOWED_EMAILS",
          "BETTER_AUTH_SECRET",
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "TEXTBELT_API_KEY",
        ]),
      }),
    );
  });

  it("rejects the local authentication opt-in in production", () => {
    expect(() =>
      parseRuntimeConfig(
        validTestEnvironment({
          APP_ENV: "production",
          CANONICAL_ORIGIN: "https://chores.example.com",
          OWNER_EMAIL: "owner@example.com",
          ALLOWED_EMAILS: "owner@example.com",
          BETTER_AUTH_SECRET: "production-secret-that-is-long-enough",
          GOOGLE_CLIENT_ID: "production-google-client-id",
          GOOGLE_CLIENT_SECRET: "production-google-client-secret",
          TEXTBELT_API_KEY: "production-textbelt-api-key",
          LOCAL_AUTH_ENABLED: "true",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        invalidBindings: expect.arrayContaining(["LOCAL_AUTH_ENABLED"]),
      }),
    );
  });

  it("requires local authentication to keep SMS disabled", () => {
    expect(() =>
      parseRuntimeConfig(
        validTestEnvironment({
          APP_ENV: "local",
          LOCAL_AUTH_ENABLED: "true",
          REMINDER_SMS_ENABLED: "true",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        invalidBindings: expect.arrayContaining(["REMINDER_SMS_ENABLED"]),
      }),
    );
  });
});
