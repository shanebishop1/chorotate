import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// No bypass flag: both local operators and CI must prove the exact main commit
// passed the complete release job before any production mutation.
/** @param {{run?: import("../automation/github-types").Runner; environment?: NodeJS.ProcessEnv}} [options] */
export function requireGreenMainRelease({
  run = spawnSync,
  environment = process.env,
} = {}) {
  /** @param {string} command @param {string[]} args */
  function output(command, args) {
    const result = run(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error("Release evidence could not be verified.");
    return result.stdout.trim();
  }
  if (
    output("git", ["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
  ) {
    throw new Error("Production requires a clean working tree.");
  }
  const head = output("git", ["rev-parse", "HEAD"]);
  const remoteMain = output("git", [
    "ls-remote",
    "origin",
    "refs/heads/main",
  ]).split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(head) || head !== remoteMain) {
    throw new Error("Production requires the latest origin/main commit.");
  }
  /** @type {{workflow_runs?: import("../automation/github-types").CIRun[]}} */
  const { workflow_runs: runs } = JSON.parse(
    output("gh", [
      "api",
      `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=${head}&branch=main&per_page=100`,
    ]),
  );
  for (const run of runs ?? []) {
    if (
      run.head_sha !== head ||
      run.head_branch !== "main" ||
      run.path !== ".github/workflows/ci.yml" ||
      !["push", "workflow_dispatch"].includes(run.event) ||
      (environment.GITHUB_RUN_ID &&
        String(run.id) !== environment.GITHUB_RUN_ID)
    )
      continue;
    /** @type {{jobs?: Array<{name: string; status: string; conclusion: string | null}>}} */
    const { jobs } = JSON.parse(
      output("gh", [
        "api",
        `repos/{owner}/{repo}/actions/runs/${run.id}/jobs?per_page=100`,
      ]),
    );
    if (
      jobs?.some(
        (job) =>
          job.name === "release-quality" &&
          job.status === "completed" &&
          job.conclusion === "success",
      )
    )
      return head;
  }
  throw new Error(
    "Production refused: release-quality has not passed for this exact main commit.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    requireGreenMainRelease();
    console.log(
      "PASS exact main commit has a successful GitHub release-quality job",
    );
  } catch {
    console.error(
      "Production refused: a clean, current main commit and successful GitHub release-quality job are required.",
    );
    process.exitCode = 1;
  }
}
