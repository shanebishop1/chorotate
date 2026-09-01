import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** @param {{ includeUntracked?: boolean }} [options] */
export function repositoryFiles({ includeUntracked = false } = {}) {
  const args = ["ls-files", "--cached"];
  if (includeUntracked) args.push("--others", "--exclude-standard");
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .sort();
}

/** @param {string} path */
export function textFile(path) {
  const buffer = readFileSync(path);
  return buffer.includes(0) ? null : buffer.toString("utf8");
}
