import { spawnSync } from "node:child_process";

function workingTree() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(
      result.stderr || "Unable to inspect the working tree.\n",
    );
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const initialTree = workingTree();
if (initialTree !== "") {
  console.error("Release gate requires a clean working tree.");
  process.exit(1);
}

const checks = [
  "doctor",
  "format:check",
  "lint",
  "auth:schema:check",
  "cf-typegen:check",
  "typecheck",
  "test",
  "test:workerd",
  "planning:check",
  "operator:contacts:test",
  "operator:d1:test",
  "deploy:production:test",
  "operator:d1:verify:dry-run",
  "build",
  "test:browser",
  "audit",
  "scan:secrets",
];

for (const script of checks) {
  const result = spawnSync("npm", ["run", script], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (workingTree() !== initialTree) {
    console.error(`Release gate detected working-tree drift after ${script}.`);
    process.exit(1);
  }
}

console.log("Release gate passed without working-tree drift.");
