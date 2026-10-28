import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {import("./github-types").Pull} pull
 * @param {string} repository
 * @param {Array<{filename: string; status: string}>} files
 */
export function eligibleDependabotPull(pull, repository, files) {
  return (
    pull.state === "open" &&
    !pull.draft &&
    pull.user?.login === "dependabot[bot]" &&
    pull.user?.type === "Bot" &&
    pull.head?.repo?.full_name === repository &&
    pull.base?.repo?.full_name === repository &&
    pull.base.ref === "main" &&
    pull.head.ref.startsWith("dependabot/") &&
    /^[0-9a-f]{40}$/.test(pull.head.sha) &&
    files.length > 0 &&
    files.length === pull.changed_files &&
    files.every(
      ({ filename, status }) =>
        status === "modified" &&
        (filename === "package.json" ||
          filename === "package-lock.json" ||
          /^\.github\/workflows\/[^/]+\.ya?ml$/.test(filename)),
    )
  );
}

/** @param {import("./github-types").CIRun[]} runs @param {import("./github-types").Pull} pull */
export function passingPullCI(runs, pull) {
  return runs.some(
    (run) =>
      run.head_sha === pull.head.sha &&
      run.head_branch === pull.head.ref &&
      run.path === ".github/workflows/ci.yml" &&
      ["pull_request", "workflow_dispatch"].includes(run.event) &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
}

/** @param {{repository?: string; event?: import("./github-types").WorkflowEvent; run?: import("./github-types").Runner; log?: (message: string) => void}} [options] */
export function promoteDependabot({
  repository = process.env.GH_REPO,
  event = {},
  run = spawnSync,
  log = console.log,
} = {}) {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("Repository is required");
  const prefix = `repos/${repository}`;
  /** @param {string[]} args */
  function gh(args) {
    const result = run("gh", args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(
        "Dependabot promotion command failed; no check bypass is permitted.",
      );
    return result.stdout.trim();
  }
  /** @param {string} path @param {string[]} [args] */
  const api = (path, args = []) =>
    JSON.parse(gh(["api", `${prefix}/${path}`, ...args]));
  const completed = event.workflow_run;
  if (
    completed &&
    (completed.conclusion !== "success" ||
      completed.head_repository?.full_name !== repository ||
      !completed.head_branch?.startsWith("dependabot/"))
  )
    return;
  /** @type {import("./github-types").Pull[]} */
  const pulls = api("pulls?state=open&base=main&per_page=100");
  for (const summary of pulls) {
    if (summary.user?.login !== "dependabot[bot]") continue;
    /** @type {import("./github-types").Pull} */
    const pull = api(`pulls/${summary.number}`);
    if (completed && completed.head_sha !== pull.head.sha) continue;
    const files = api(`pulls/${pull.number}/files?per_page=100`);
    if (!eligibleDependabotPull(pull, repository, files)) continue;
    if (pull.mergeable_state === "dirty") {
      log(
        `PR #${pull.number} has merge conflicts; human resolution is required before CI and merge.`,
      );
      continue;
    }
    if (pull.mergeable_state === "behind") {
      // Dependabot rejects bot-authored rebase comments. Use GitHub's optimistic
      // branch-update API instead; never checkout PR code with the write token.
      api(`pulls/${pull.number}/update-branch`, [
        "--method",
        "PUT",
        "--raw-field",
        `expected_head_sha=${pull.head.sha}`,
      ]);
      gh([
        "workflow",
        "run",
        "ci.yml",
        "--repo",
        repository,
        "--ref",
        pull.head.ref,
      ]);
      log(
        `Requested a SHA-checked branch refresh and fresh CI for PR #${pull.number}; no merge.`,
      );
      continue;
    }
    /** @type {{workflow_runs?: import("./github-types").CIRun[]}} */
    const { workflow_runs: runs } = api(
      `actions/workflows/ci.yml/runs?head_sha=${pull.head.sha}&per_page=100`,
    );
    // GitHub holds PR runs created by GITHUB_TOKEN branch updates for approval.
    // Only approve after the official-bot, same-repo, and file-scope checks above.
    // PR tests remain credential-free; no production secrets or write tokens.
    for (const pending of runs ?? []) {
      if (
        pending.head_sha === pull.head.sha &&
        pending.head_branch === pull.head.ref &&
        pending.event === "pull_request" &&
        pending.conclusion === "action_required" &&
        Number.isSafeInteger(pending.id)
      ) {
        api(`actions/runs/${pending.id}/approve`, ["--method", "POST"]);
        log(
          `Approved credential-free CI for verified Dependabot PR #${pull.number}; no merge.`,
        );
      }
    }
    // Branch updates are asynchronous. Reconcile CI for the actual new head
    // if the immediate dispatch after an update still observed the old one.
    if (
      !(runs ?? []).some(
        (run) =>
          run.head_sha === pull.head.sha &&
          ["pull_request", "workflow_dispatch"].includes(run.event),
      )
    ) {
      gh([
        "workflow",
        "run",
        "ci.yml",
        "--repo",
        repository,
        "--ref",
        pull.head.ref,
      ]);
      log(
        `Requested missing CI for the current head of PR #${pull.number}; no merge.`,
      );
      continue;
    }
    if (
      !passingPullCI(runs ?? [], pull) ||
      pull.mergeable !== true ||
      pull.mergeable_state !== "clean"
    )
      continue;
    // GitHub enforces protected-main checks again, and the SHA precondition
    // closes the race with Dependabot pushing a new commit after inspection.
    const merged = api(`pulls/${pull.number}/merge`, [
      "--method",
      "PUT",
      "--raw-field",
      `sha=${pull.head.sha}`,
      "--raw-field",
      "merge_method=squash",
      "--raw-field",
      `commit_title=${pull.title}`,
      "--raw-field",
      "commit_message=",
    ]);
    if (!merged.merged)
      throw new Error(
        "Dependabot merge was refused; checks were not bypassed.",
      );
    log(`Merged green Dependabot PR #${pull.number}.`);
  }
  // GITHUB_TOKEN merges do not emit push-triggered runs. workflow_dispatch does.
  // Reconcile on every scheduled run too, so a transient dispatch failure cannot
  // silently strand a merged update without main CI and production deployment.
  const main = api("branches/main").commit.sha;
  /** @type {{workflow_runs?: import("./github-types").CIRun[]}} */
  const { workflow_runs: mainRuns } = api(
    `actions/workflows/ci.yml/runs?head_sha=${main}&branch=main&per_page=100`,
  );
  if (
    !(mainRuns ?? []).some(
      (run) =>
        run.head_sha === main &&
        run.head_branch === "main" &&
        ["push", "workflow_dispatch"].includes(run.event),
    )
  ) {
    gh(["workflow", "run", "ci.yml", "--repo", repository, "--ref", "main"]);
    log(
      "Requested main CI; production deployment remains gated on its release-quality job.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  promoteDependabot({
    event: process.env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
      : {},
  });
}
