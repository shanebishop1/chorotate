import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import {
  buildBootstrapSql,
  buildContactSql,
  validateContactInput,
} from "./scripts/operator-contact-config.mjs";

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
        },
      },
    }),
  ],
  test: {
    include: ["tests/workerd/**/*.test.ts"],
  },
});
