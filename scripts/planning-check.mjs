import { readFileSync } from "node:fs";

const expected = Array.from(
  { length: 11 },
  (_, index) => `SC-${String(index + 1).padStart(2, "0")}`,
);
const milestone = readFileSync("docs/milestones/mvp/INDEX.md", "utf8");
const index = readFileSync(
  "docs/epics/chorotate/core-experience/prds/INDEX.md",
  "utf8",
);
const issues = readFileSync(".beads/issues.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const failures = [];
for (const slice of expected) {
  const milestoneRows =
    milestone.match(new RegExp("^\\| `" + slice + "`", "gm")) ?? [];
  const indexRows = index.match(new RegExp("\\[`" + slice + " ", "g")) ?? [];
  const beadItems = issues.filter(
    (issue) =>
      issue.issue_type === "prd" &&
      typeof issue.description === "string" &&
      issue.description.startsWith(`${slice} /`),
  );
  if (milestoneRows.length !== 1)
    failures.push(`${slice}: expected one milestone slice row`);
  if (indexRows.length !== 1)
    failures.push(`${slice}: expected one PRD index entry`);
  if (beadItems.length !== 1)
    failures.push(`${slice}: expected one read-only Beads PRD item`);
}

if (failures.length) {
  console.error("Planning consistency failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Planning consistency passed: SC-01 through SC-11 map 1:1.");
}
