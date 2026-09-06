import { describe, expect, it } from "vitest";

import { secretBindingNames } from "./environment";
import {
  allowedSecretNames,
  isAllowedSecretName,
  redactForLog,
} from "./security";

describe("repository secret contract", () => {
  it("keeps one exact allowlist shared with runtime configuration", () => {
    expect(allowedSecretNames).toEqual(secretBindingNames);
    expect(allowedSecretNames).toEqual([
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "TEXTBELT_API_KEY",
    ]);
    expect(isAllowedSecretName("UNREVIEWED_SECRET")).toBe(false);
  });

  it("redacts configured secrets and common sensitive fields without changing safe context", () => {
    const sentinel = "must-never-appear";
    const redacted = redactForLog({
      unreviewedApiKey: sentinel,
      authorization: sentinel,
      sessionToken: sentinel,
      operationId: "operation:123",
    });

    expect(JSON.stringify(redacted)).not.toContain(sentinel);
    expect(redacted).toEqual({
      unreviewedApiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      sessionToken: "[REDACTED]",
      operationId: "operation:123",
    });
  });

  it("recursively redacts contact data and provider errors from ordinary log fields", () => {
    const phone = "+15555550123";
    const providerDetail = `provider rejected ${phone}`;
    const redacted = redactForLog({
      operationId: "operation:456",
      delivery: {
        recipientPhoneE164: phone,
        providerError: providerDetail,
      },
      attempts: [{ contact: phone, status: "failed" }],
      unlabelledValue: phone,
    });

    expect(JSON.stringify(redacted)).not.toContain(phone);
    expect(JSON.stringify(redacted)).not.toContain(providerDetail);
    expect(redacted).toEqual({
      operationId: "operation:456",
      delivery: {
        recipientPhoneE164: "[REDACTED]",
        providerError: "[REDACTED]",
      },
      attempts: [{ contact: "[REDACTED]", status: "failed" }],
      unlabelledValue: "[REDACTED]",
    });
  });
});
