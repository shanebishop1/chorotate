import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import {
  buildBootstrapSql,
  buildContactSql,
  validateContactInput,
} from "./scripts/operator/operator-contact-config.mjs";
import { buildAddChoresSql } from "./scripts/operator/add-chores.mjs";

const migrations = await readD1Migrations("./migrations");
const operatorInput = validateContactInput({
  householdId: "chorotate",
  householdName: "Test Household",
  recordedAt: "2026-09-01T00:00:00.000Z",
  members: ["member-c", "member-a", "member-b"].map((id, index) => ({
    id,
    displayName: `Member ${id.at(-1)?.toUpperCase()}`,
    email: `${id}@example.com`,
    phoneE164: `+1555000000${index}`,
    consent: "consented",
    suppression: "not_suppressed",
  })),
});
const changedOperatorInput = validateContactInput({
  ...operatorInput,
  members: operatorInput.members.map((member, index) => ({
    ...member,
    email: `${member.id}.changed@example.com`,
    phoneE164: `+1555000001${index}`,
  })),
});

const fourMemberInput = validateContactInput({
  ...operatorInput,
  members: ["member-a", "member-b", "member-c", "member-d"].map(
    (id, index) => ({
      id,
      displayName: `Member ${id.at(-1)?.toUpperCase()}`,
      email: `${id}@example.com`,
      phoneE164: `+1555555010${index}`,
      consent: "consented",
      suppression: "not_suppressed",
    }),
  ),
});
const addChoresSql = buildAddChoresSql({
  ...fourMemberInput,
  chores: ["wipe", "sweep"].map((id, index) => ({
    id,
    name: index === 0 ? "Wipe" : "Sweep",
    instructions:
      index === 0
        ? "Wipe counters at least once a week, then maintain them."
        : "Sweep and vacuum floors at least once a week, then maintain them.",
    ownershipStartWeekday: "friday",
    rotation: {
      id: `rotation-${id}-2026-08-28`,
      effectiveFrom: "2026-08-28",
      offset: index === 0 ? 1 : 3,
      memberIds: fourMemberInput.members.map(({ id }) => id),
    },
  })),
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          TEST_OPERATOR_BOOTSTRAP_SQL: buildBootstrapSql(operatorInput, {
            timeZone: "America/New_York",
            weekStart: "monday",
            eveningTime: "20:00",
            morningTime: "08:00",
          }),
          TEST_OPERATOR_CONTACT_SQL: buildContactSql(changedOperatorInput),
          TEST_FOUR_MEMBER_BOOTSTRAP_SQL: buildBootstrapSql(fourMemberInput, {
            timeZone: "America/New_York",
            weekStart: "monday",
            eveningTime: "20:00",
            morningTime: "09:00",
          }),
          TEST_ADD_CHORES_SQL: addChoresSql,
        },
      },
    }),
  ],
  test: {
    include: ["tests/workerd/**/*.test.ts"],
  },
});
