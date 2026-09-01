import { secretBindingNames } from "./environment";

export const allowedSecretNames = secretBindingNames;

const sensitiveKeyPattern =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|client[-_]?secret|phone|e164|contact|provider.*(?:error|response|body)|(?:error|response|body).*provider)/i;
const e164ValuePattern = /\+[1-9]\d{1,14}\b/;

export function isAllowedSecretName(name: string): boolean {
  return allowedSecretNames.includes(
    name as (typeof allowedSecretNames)[number],
  );
}

export function redactForLog(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const visited = new WeakSet<object>();

  function redactValue(value: unknown): unknown {
    if (typeof value === "string" && e164ValuePattern.test(value)) {
      return "[REDACTED]";
    }
    if (Array.isArray(value)) {
      if (visited.has(value)) return "[REDACTED]";
      visited.add(value);
      return value.map(redactValue);
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return value;
    }
    if (visited.has(value)) return "[REDACTED]";
    visited.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([name, nestedValue]) => [
        name,
        sensitiveKeyPattern.test(name) || isAllowedSecretName(name)
          ? "[REDACTED]"
          : redactValue(nestedValue),
      ]),
    );
  }

  return redactValue(fields) as Record<string, unknown>;
}
