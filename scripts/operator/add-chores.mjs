import { fileURLToPath } from "node:url";

import { choreConfigForInput } from "./chore-config.mjs";
import {
  readOperatorInput,
  validateContactInput,
  writeOperatorSql,
} from "./operator-contact-config.mjs";

/** @param {string} value */
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

/** Add chores only; never change members, existing rotations, or assignments.
 * The private document contains the exact active roster and ONLY new chores.
 * @param {unknown} candidate
 */
export function buildAddChoresSql(candidate) {
  const input = validateContactInput(candidate);
  if (input.chores === undefined) {
    throw new Error("Adding chores requires an explicit new-chore list");
  }
  const chores = choreConfigForInput(input);
  const household = sqlString(input.householdId);
  const timestamp = sqlString(input.recordedAt);
  const memberIds = input.members.map(({ id }) => sqlString(id)).join(", ");
  const names = chores.map(({ name }) => sqlString(name)).join(", ");
  const choreRows = chores
    .map(
      (chore) =>
        `(${sqlString(chore.id)}, ${household}, ${sqlString(chore.name)}, 1, ${timestamp}, ${sqlString(chore.instructions)}, ${chore.ownershipStartWeekdayNumber})`,
    )
    .join(",\n");
  const rotationRows = chores
    .map(
      ({ id, rotation }) =>
        `(${sqlString(rotation.id)}, ${household}, ${sqlString(id)}, ${sqlString(rotation.effectiveFrom)}, ${rotation.offset}, ${timestamp})`,
    )
    .join(",\n");
  const rotationMemberRows = chores
    .flatMap(({ rotation }) =>
      rotation.memberIds.map(
        (memberId, position) =>
          `(${household}, ${sqlString(rotation.id)}, ${sqlString(memberId)}, ${position})`,
      ),
    )
    .join(",\n");

  return `-- PRIVATE OPERATOR INPUT. Do not commit or log.
-- Additive only. Execute as one atomic D1 SQL file; do not split statements.
PRAGMA foreign_keys = ON;
CREATE TABLE operator_add_chores_assert (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO operator_add_chores_assert SELECT count(*) = 1 FROM households WHERE id = ${household};
INSERT INTO operator_add_chores_assert SELECT count(*) = ${input.members.length} FROM members WHERE household_id = ${household} AND active = 1;
INSERT INTO operator_add_chores_assert SELECT count(*) = ${input.members.length} FROM members WHERE household_id = ${household} AND active = 1 AND id IN (${memberIds});
INSERT INTO operator_add_chores_assert SELECT count(*) + ${chores.length} <= 50 FROM chores WHERE household_id = ${household} AND active = 1;
INSERT INTO operator_add_chores_assert SELECT count(*) = 0 FROM chores WHERE household_id = ${household} AND name COLLATE NOCASE IN (${names});
INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
VALUES ${choreRows};
INSERT INTO rotation_configs (id,household_id,chore_id,effective_from,rotation_offset,created_at)
VALUES ${rotationRows};
INSERT INTO rotation_config_members (household_id,rotation_config_id,member_id,position)
VALUES ${rotationMemberRows};
DROP TABLE operator_add_chores_assert;
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== "--input" ||
    args[2] !== "--output" ||
    !args[1] ||
    !args[3]
  ) {
    throw new Error(
      "Usage: node scripts/operator/add-chores.mjs --input <private-json-path> --output <new-private-sql-path>",
    );
  }
  const input = await readOperatorInput(args[1]);
  await writeOperatorSql(args[3], buildAddChoresSql(input));
  console.log(
    `Prepared private SQL for ${choreConfigForInput(input).length} new chores; existing household data is unchanged.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Chore preparation failed",
    );
    process.exitCode = 1;
  });
}
