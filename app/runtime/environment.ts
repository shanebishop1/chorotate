export const applicationEnvironmentNames = [
  "local",
  "test",
  "production",
] as const;
export type ApplicationEnvironment =
  (typeof applicationEnvironmentNames)[number];

export const weekStartNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type WeekStart = (typeof weekStartNames)[number];

export const plainBindingNames = [
  "APP_ENV",
  "CANONICAL_ORIGIN",
  "HOUSEHOLD_TIME_ZONE",
  "HOUSEHOLD_WEEK_START",
  "OWNER_EMAIL",
  "ALLOWED_EMAILS",
  "REMINDER_BATCH_SIZE",
  "REMINDER_LEASE_MILLISECONDS",
  "REMINDER_MAX_ATTEMPTS",
  "REMINDER_PROVIDER_TIMEOUT_MILLISECONDS",
  "REMINDER_RETRY_BASE_MILLISECONDS",
  "REMINDER_RETRY_MAX_MILLISECONDS",
] as const;

export const secretBindingNames = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

export interface PlainEnvironmentBindings {
  APP_ENV: string;
  CANONICAL_ORIGIN: string;
  HOUSEHOLD_TIME_ZONE: string;
  HOUSEHOLD_WEEK_START: string;
  OWNER_EMAIL: string;
  ALLOWED_EMAILS: string;
  REMINDER_BATCH_SIZE: string;
  REMINDER_LEASE_MILLISECONDS: string;
  REMINDER_MAX_ATTEMPTS: string;
  REMINDER_PROVIDER_TIMEOUT_MILLISECONDS: string;
  REMINDER_RETRY_BASE_MILLISECONDS: string;
  REMINDER_RETRY_MAX_MILLISECONDS: string;
}

export interface SecretEnvironmentBindings {
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

export interface AppEnvironment
  extends PlainEnvironmentBindings, SecretEnvironmentBindings {
  DB: D1Database;
}

export interface RuntimeConfig {
  applicationEnvironment: ApplicationEnvironment;
  canonicalOrigin: string;
  household: {
    timeZone: string;
    weekStart: WeekStart;
    ownerEmail: string;
    allowedEmails: readonly string[];
  };
  reminders: ReminderRuntimeConfig;
  secrets: {
    betterAuthSecret: string;
    googleClientId: string;
    googleClientSecret: string;
  };
}

export interface ReminderRuntimeConfig {
  batchSize: number;
  leaseMilliseconds: number;
  maxAttempts: number;
  providerTimeoutMilliseconds: number;
  retryBaseMilliseconds: number;
  retryMaxMilliseconds: number;
}

export class RuntimeConfigError extends Error {
  constructor(readonly invalidBindings: readonly string[]) {
    super(`Invalid runtime configuration: ${invalidBindings.join(", ")}`);
    this.name = "RuntimeConfigError";
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isKnownValue<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.includes(value as T);
}

function requiredString(
  environment: Record<string, unknown>,
  name: string,
  invalidBindings: string[],
): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    invalidBindings.push(name);
    return "";
  }
  return value.trim();
}

function boundedIntegerBinding(
  environment: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  invalidBindings: string[],
): number {
  const value = requiredString(environment, name, invalidBindings);
  if (!/^\d+$/.test(value)) {
    invalidBindings.push(name);
    return minimum;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalidBindings.push(name);
    return minimum;
  }
  return parsed;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function isSafeProductionSecret(value: string): boolean {
  return (
    value.length >= 16 &&
    !/(?:test-only|placeholder|change-me|example)/i.test(value)
  );
}

export function parseRuntimeConfig(environment: AppEnvironment): RuntimeConfig {
  const raw = environment as unknown as Record<string, unknown>;
  const invalidBindings: string[] = [];

  if (
    typeof raw.DB !== "object" ||
    raw.DB === null ||
    typeof (raw.DB as { prepare?: unknown }).prepare !== "function"
  ) {
    invalidBindings.push("DB");
  }

  const applicationEnvironmentValue = requiredString(
    raw,
    "APP_ENV",
    invalidBindings,
  );
  const applicationEnvironment = isKnownValue(
    applicationEnvironmentNames,
    applicationEnvironmentValue,
  )
    ? applicationEnvironmentValue
    : "test";
  if (!isKnownValue(applicationEnvironmentNames, applicationEnvironmentValue)) {
    invalidBindings.push("APP_ENV");
  }

  const canonicalOriginValue = requiredString(
    raw,
    "CANONICAL_ORIGIN",
    invalidBindings,
  );
  let canonicalOrigin = "";
  try {
    const url = new URL(canonicalOriginValue);
    const localHttp =
      applicationEnvironment !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.origin !== canonicalOriginValue
    ) {
      throw new Error("invalid origin");
    }
    canonicalOrigin = url.origin;
  } catch {
    invalidBindings.push("CANONICAL_ORIGIN");
  }

  const timeZone = requiredString(raw, "HOUSEHOLD_TIME_ZONE", invalidBindings);
  if (timeZone && !isValidTimeZone(timeZone)) {
    invalidBindings.push("HOUSEHOLD_TIME_ZONE");
  }

  const weekStartValue = requiredString(
    raw,
    "HOUSEHOLD_WEEK_START",
    invalidBindings,
  ).toLowerCase();
  const weekStart = isKnownValue(weekStartNames, weekStartValue)
    ? weekStartValue
    : "monday";
  if (!isKnownValue(weekStartNames, weekStartValue)) {
    invalidBindings.push("HOUSEHOLD_WEEK_START");
  }

  const ownerEmail = requiredString(
    raw,
    "OWNER_EMAIL",
    invalidBindings,
  ).toLowerCase();
  if (ownerEmail && !emailPattern.test(ownerEmail)) {
    invalidBindings.push("OWNER_EMAIL");
  }

  const allowedEmailsValue = requiredString(
    raw,
    "ALLOWED_EMAILS",
    invalidBindings,
  );
  const allowedEmails = [
    ...new Set(
      allowedEmailsValue
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    allowedEmails.length === 0 ||
    allowedEmails.some((email) => !emailPattern.test(email)) ||
    (ownerEmail !== "" && !allowedEmails.includes(ownerEmail))
  ) {
    invalidBindings.push("ALLOWED_EMAILS");
  }

  const batchSize = boundedIntegerBinding(
    raw,
    "REMINDER_BATCH_SIZE",
    1,
    100,
    invalidBindings,
  );
  const leaseMilliseconds = boundedIntegerBinding(
    raw,
    "REMINDER_LEASE_MILLISECONDS",
    6_000,
    3_600_000,
    invalidBindings,
  );
  const maxAttempts = boundedIntegerBinding(
    raw,
    "REMINDER_MAX_ATTEMPTS",
    1,
    20,
    invalidBindings,
  );
  const providerTimeoutMilliseconds = boundedIntegerBinding(
    raw,
    "REMINDER_PROVIDER_TIMEOUT_MILLISECONDS",
    1_000,
    30_000,
    invalidBindings,
  );
  const retryBaseMilliseconds = boundedIntegerBinding(
    raw,
    "REMINDER_RETRY_BASE_MILLISECONDS",
    1_000,
    3_600_000,
    invalidBindings,
  );
  const retryMaxMilliseconds = boundedIntegerBinding(
    raw,
    "REMINDER_RETRY_MAX_MILLISECONDS",
    1_000,
    86_400_000,
    invalidBindings,
  );
  if (retryMaxMilliseconds < retryBaseMilliseconds) {
    invalidBindings.push("REMINDER_RETRY_MAX_MILLISECONDS");
  }
  const sequentialProviderBudget =
    batchSize * providerTimeoutMilliseconds + 5_000;
  if (leaseMilliseconds < sequentialProviderBudget) {
    invalidBindings.push("REMINDER_LEASE_MILLISECONDS");
  }

  const betterAuthSecret = requiredString(
    raw,
    "BETTER_AUTH_SECRET",
    invalidBindings,
  );
  const googleClientId = requiredString(
    raw,
    "GOOGLE_CLIENT_ID",
    invalidBindings,
  );
  const googleClientSecret = requiredString(
    raw,
    "GOOGLE_CLIENT_SECRET",
    invalidBindings,
  );
  if (betterAuthSecret && betterAuthSecret.length < 32) {
    invalidBindings.push("BETTER_AUTH_SECRET");
  }

  if (applicationEnvironment === "production") {
    if (
      ownerEmail.endsWith(".invalid") ||
      allowedEmails.some((email) => email.endsWith(".invalid"))
    ) {
      invalidBindings.push("OWNER_EMAIL", "ALLOWED_EMAILS");
    }
    for (const [name, value] of [
      ["BETTER_AUTH_SECRET", betterAuthSecret],
      ["GOOGLE_CLIENT_ID", googleClientId],
      ["GOOGLE_CLIENT_SECRET", googleClientSecret],
    ] as const) {
      if (!isSafeProductionSecret(value)) invalidBindings.push(name);
    }
  }

  if (invalidBindings.length > 0) {
    throw new RuntimeConfigError([...new Set(invalidBindings)].sort());
  }

  return {
    applicationEnvironment,
    canonicalOrigin,
    household: {
      timeZone,
      weekStart,
      ownerEmail,
      allowedEmails,
    },
    reminders: {
      batchSize,
      leaseMilliseconds,
      maxAttempts,
      providerTimeoutMilliseconds,
      retryBaseMilliseconds,
      retryMaxMilliseconds,
    },
    secrets: {
      betterAuthSecret,
      googleClientId,
      googleClientSecret,
    },
  };
}
