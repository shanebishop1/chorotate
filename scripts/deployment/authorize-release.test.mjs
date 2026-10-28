import assert from "node:assert/strict";
import test from "node:test";
import { requireGreenMainRelease } from "./authorize-release.mjs";

const sha = "a".repeat(40);
/** @param {{dirty?: boolean; main?: string; event?: string; branch?: string; conclusion?: string | null; status?: string; runs?: boolean; jobName?: string; apiFails?: boolean; currentRun?: string}} [options] */
function evidence({
  dirty = false,
  main = sha,
  event = "push",
  branch = "main",
  conclusion = "success",
  status = "completed",
  runs = true,
  jobName = "release-quality",
  apiFails = false,
  currentRun,
} = {}) {
  /** @type {string[][]} */
  const commands = [];
  /** @type {import("../automation/github-types").Runner} */
  const run = (command, args) => {
    commands.push([command, ...args]);
    let stdout = "";
    if (command === "git") {
      if (args[0] === "status") stdout = dirty ? " M package-lock.json" : "";
      if (args[0] === "rev-parse") stdout = sha;
      if (args[0] === "ls-remote") stdout = `${main}\trefs/heads/main`;
    } else {
      if (apiFails) return { status: 1, stdout: "private failure" };
      stdout = JSON.stringify(
        args[1].includes("/jobs?")
          ? { jobs: [{ name: jobName, status, conclusion }] }
          : {
              workflow_runs: runs
                ? [
                    {
                      id: 123,
                      head_sha: sha,
                      head_branch: branch,
                      path: ".github/workflows/ci.yml",
                      event,
                    },
                  ]
                : [],
            },
      );
    }
    return { status: 0, stdout };
  };
  return {
    run,
    commands,
    environment: currentRun ? { GITHUB_RUN_ID: currentRun } : {},
  };
}

test("authorizes only the exact clean main commit after the complete release job", () => {
  assert.equal(requireGreenMainRelease(evidence()), sha);
  assert.equal(
    requireGreenMainRelease(
      evidence({ event: "workflow_dispatch", currentRun: "123" }),
    ),
    sha,
  );
});

/** @type {Array<[string, Parameters<typeof evidence>[0]]>} */
const refusals = [
  ["dirty checkout", { dirty: true }],
  ["stale or unpushed commit", { main: "b".repeat(40) }],
  ["missing CI", { runs: false }],
  ["failed audit or tests", { conclusion: "failure" }],
  ["skipped checks", { conclusion: "skipped" }],
  ["pending checks", { status: "in_progress", conclusion: null }],
  ["PR-only evidence", { event: "pull_request" }],
  ["another branch", { branch: "dependabot/npm/test" }],
  ["partial check", { jobName: "unit-tests" }],
  ["another CI run", { currentRun: "999" }],
  ["unavailable GitHub", { apiFails: true }],
];
for (const [name, options] of refusals) {
  test(`refuses ${name} without a production command`, () => {
    const input = evidence(options);
    assert.throws(() => requireGreenMainRelease(input));
    assert.ok(
      input.commands.every(([command]) => ["git", "gh"].includes(command)),
    );
  });
}
