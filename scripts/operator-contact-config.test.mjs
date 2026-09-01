import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContactSql,
  summarizeContactReadiness,
  validateContactInput,
} from "./operator-contact-config.mjs";

const validInput = {
  householdId: "chorotate",
  recordedAt: "2026-09-01T00:00:00.000Z",
  members: ["jack", "joe", "dylan", "shane"].map((id, index) => ({
    id,
    email: `${id}@example.com`,
    phoneE164: `+1555000000${index}`,
    consent: "consented",
    suppression: "not_suppressed",
  })),
};

test("validates the exact production member and contact contract", () => {
  assert.deepEqual(validateContactInput(validInput), validInput);

  for (const patch of [
    { phoneE164: null },
    { consent: "not_recorded" },
    { suppression: "suppressed" },
  ]) {
    const input = structuredClone(validInput);
    Object.assign(input.members[0], patch);
    const validated = validateContactInput(input);
    assert.equal(summarizeContactReadiness(validated).sendable, 3);
  }

  const malformed = structuredClone(validInput);
  malformed.members[0].phoneE164 = "+0123";
  assert.throws(() => validateContactInput(malformed));
});

test("rejects unsafe identity and malformed contact configuration without values", () => {
  /** @type {Array<(input: typeof validInput) => void>} */
  const mutations = [
    (input) => input.members.pop(),
    (input) => (input.members[0].email = "Upper@Example.com"),
    (input) => (input.members[0].email = input.members[1].email),
    (input) => (input.members[0].phoneE164 = "555-0000"),
    (input) => (input.members[0].consent = "yes"),
    (input) => (input.members[0].suppression = "no"),
  ];
  for (const mutate of mutations) {
    const input = structuredClone(validInput);
    mutate(input);
    assert.throws(
      () => validateContactInput(input),
      (error) => {
        if (!(error instanceof Error)) return false;
        assert.match(error.message, /^Invalid operator contact input:/);
        assert.ok(!error.message.includes("@example.com"));
        assert.ok(!error.message.includes("+1555"));
        return true;
      },
    );
  }
});

test("generates private D1-only updates with row-count assertions", () => {
  const sql = buildContactSql(validateContactInput(validInput));

  assert.match(sql, /UPDATE allowlisted_identities/);
  assert.match(sql, /UPDATE members/);
  assert.match(sql, /CHECK \(matched_rows = 4\)/);
  assert.doesNotMatch(sql, /SELECT .*email_normalized/i);
  assert.doesNotMatch(sql, /SELECT .*sms_phone_e164/i);
});
