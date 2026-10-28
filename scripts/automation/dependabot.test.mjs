import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleDependabotPull,
  passingPullCI,
  promoteDependabot,
} from "./dependabot.mjs";

const repository = "example/chores";
const sha = "a".repeat(40);
const files = [
  { filename: "package.json", status: "modified" },
  { filename: "package-lock.json", status: "modified" },
];
const pull = {
  number: 12,
  state: "open",
  draft: false,
  title: "Bump dependencies",
  changed_files: 2,
  user: { login: "dependabot[bot]", type: "Bot" },
  head: {
    sha,
    ref: "dependabot/npm_and_yarn/npm",
    repo: { full_name: repository },
  },
  base: { ref: "main", repo: { full_name: repository } },
  mergeable: true,
  mergeable_state: "clean",
  updated_at: "2026-10-27T00:00:00Z",
};
const green = {
  head_sha: sha,
  head_branch: pull.head.ref,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  status: "completed",
  conclusion: "success",
};

test("allows official Dependabot npm and pinned action updates, including majors", () => {
  assert.ok(eligibleDependabotPull(pull, repository, files));
  assert.ok(
    eligibleDependabotPull({ ...pull, changed_files: 1 }, repository, [
      { filename: ".github/workflows/ci.yml", status: "modified" },
    ]),
  );
});
test("rejects spoofed authors, forks, other bases, drafts, and non-dependency files", () => {
  for (const change of [
    { user: { login: "dependabot", type: "User" } },
    { head: { ...pull.head, repo: { full_name: "attacker/fork" } } },
    { base: { ...pull.base, ref: "other" } },
    { draft: true },
    { changed_files: 3 },
  ])
    assert.equal(
      eligibleDependabotPull({ ...pull, ...change }, repository, files),
      false,
    );
  assert.equal(
    eligibleDependabotPull(pull, repository, [
      files[0],
      { filename: "workers/app.ts", status: "modified" },
    ]),
    false,
  );
});
test("requires successful full CI on the exact current PR head", () => {
  assert.ok(passingPullCI([green], pull));
  for (const change of [
    { head_sha: "b".repeat(40) },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { status: "in_progress" },
    { event: "push" },
    { path: ".github/workflows/unit.yml" },
  ]) {
    assert.equal(passingPullCI([{ ...green, ...change }], pull), false);
  }
});

/** @param {{ci?: import("./github-types").CIRun | null; candidate?: import("./github-types").Pull; mergeFails?: boolean; event?: import("./github-types").WorkflowEvent}} [options] */
function exercise({
  ci = green,
  candidate = pull,
  mergeFails = false,
  event = {},
} = {}) {
  /** @type {string[][]} */
  const commands = [];
  /** @type {import("./github-types").Runner} */
  const run = (_command, args) => {
    commands.push(args);
    let data;
    const path = args[1];
    if (args[0] === "workflow") data = {};
    else if (path.includes("pulls?")) data = [candidate];
    else if (path.endsWith("/files?per_page=100")) data = files;
    else if (path.endsWith("/merge")) {
      assert.ok(args.includes(`sha=${sha}`));
      data = { merged: !mergeFails };
    } else if (path.endsWith("/update-branch")) {
      assert.ok(args.includes(`expected_head_sha=${sha}`));
      data = { message: "Updating pull request branch" };
    } else if (path.endsWith("/approve")) data = {};
    else if (path.endsWith("/pulls/12")) data = candidate;
    else if (path.endsWith("branches/main"))
      data = { commit: { sha: "b".repeat(40) } };
    else if (path.includes("branch=main")) data = { workflow_runs: [] };
    else if (path.includes("/runs?")) data = { workflow_runs: ci ? [ci] : [] };
    else throw new Error(`Unexpected request ${path}`);
    return { status: 0, stdout: JSON.stringify(data) };
  };
  const perform = () => promoteDependabot({ repository, run, event, log() {} });
  return { commands, perform };
}
test("merges by exact SHA and explicitly dispatches main CI despite GITHUB_TOKEN suppression", () => {
  const input = exercise();
  input.perform();
  assert.ok(input.commands.some((args) => args[1].endsWith("/merge")));
  assert.ok(
    input.commands.some(
      (args) => args[0] === "workflow" && args.includes("main"),
    ),
  );
});
test("never merges failing checks and refreshes stale PRs through the API with fresh CI", () => {
  for (const options of [
    { ci: { ...green, conclusion: "failure" } },
    { candidate: { ...pull, mergeable_state: "behind" } },
  ]) {
    const input = exercise(options);
    input.perform();
    assert.ok(!input.commands.some((args) => args[1]?.endsWith("/merge")));
    if (options.candidate) {
      assert.ok(
        input.commands.some((args) => args[1]?.endsWith("/update-branch")),
      );
      assert.ok(
        input.commands.some(
          (args) => args[0] === "workflow" && args.includes(pull.head.ref),
        ),
      );
      assert.ok(!input.commands.some((args) => args[1]?.includes("/comments")));
    }
  }
});
test("refuses failed merge responses and ignores stale or fork workflow events", () => {
  assert.throws(exercise({ mergeFails: true }).perform);
  for (const head_repository of [
    { full_name: "attacker/fork" },
    { full_name: repository },
  ]) {
    const input = exercise({
      event: {
        workflow_run: {
          ...green,
          conclusion: "success",
          head_repository,
          head_branch: pull.head.ref,
          head_sha: "c".repeat(40),
        },
      },
    });
    input.perform();
    assert.ok(!input.commands.some((args) => args[1]?.endsWith("/merge")));
  }
});

test("dispatches CI for the actual head if an asynchronous refresh raced the first dispatch", () => {
  const input = exercise({ ci: null });
  input.perform();
  assert.ok(!input.commands.some((args) => args[1]?.endsWith("/merge")));
  assert.ok(
    input.commands.some(
      (args) => args[0] === "workflow" && args.includes(pull.head.ref),
    ),
  );
});

test("leaves conflicting updates blocked rather than forcing a merge or hiding a failure", () => {
  const input = exercise({ candidate: { ...pull, mergeable_state: "dirty" } });
  input.perform();
  assert.ok(
    !input.commands.some(
      (args) =>
        args[1]?.endsWith("/merge") || args[1]?.endsWith("/update-branch"),
    ),
  );
});

test("approves only verified Dependabot CI held after a token-authored branch update", () => {
  const input = exercise({
    ci: { ...green, id: 123, conclusion: "action_required" },
  });
  input.perform();
  assert.ok(
    input.commands.some((args) =>
      args[1]?.endsWith("actions/runs/123/approve"),
    ),
  );
  assert.ok(!input.commands.some((args) => args[1]?.endsWith("/merge")));
  const spoofed = exercise({
    ci: { ...green, id: 123, conclusion: "action_required" },
    candidate: { ...pull, user: { login: "attacker", type: "User" } },
  });
  spoofed.perform();
  assert.ok(!spoofed.commands.some((args) => args[1]?.endsWith("/approve")));
});
