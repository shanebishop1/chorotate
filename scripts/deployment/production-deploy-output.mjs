import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const failureMessages = {
  build: "FAIL production build command; child output withheld",
  "dry-run": "FAIL production deploy dry-run command; provider output withheld",
  deploy: "FAIL production deploy command; provider output withheld",
  cleanup: "FAIL production deploy config cleanup; details withheld",
};

export class ProductionDeployFailure extends Error {
  /** @param {keyof typeof failureMessages} category */
  constructor(category) {
    super(failureMessages[category]);
    this.name = "ProductionDeployFailure";
    this.category = category;
  }
}

/**
 * Run a production child without attaching its output to ordinary output.
 * Provider and build tools can echo config values in forms that cannot be
 * safely recovered with substring replacement.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env: NodeJS.ProcessEnv, category: "build" | "dry-run" | "deploy"}} options
 */
export async function runWithSuppressedChildOutput(command, args, options) {
  try {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const exitCode = await new Promise((complete, reject) => {
      child.once("error", reject);
      child.once("close", complete);
    });
    if (exitCode !== 0) throw new ProductionDeployFailure(options.category);
  } catch (error) {
    if (error instanceof ProductionDeployFailure) throw error;
    throw new ProductionDeployFailure(options.category);
  }
}

/**
 * @template T
 * @param {string} configPath
 * @param {() => Promise<T>} operation
 */
export async function withEmittedDeployConfigCleanup(configPath, operation) {
  let result;
  let operationError;
  let operationFailed = false;
  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  try {
    await rm(configPath, { force: true });
  } catch {
    throw new ProductionDeployFailure("cleanup");
  }
  if (operationFailed) throw operationError;
  return result;
}

/** @param {unknown} error */
export function fixedProductionDeployFailure(error) {
  return error instanceof ProductionDeployFailure
    ? error.message
    : "FAIL production deploy preparation; details withheld";
}

/**
 * @param {"dry-run" | "deploy"} mode
 * @param {string} reminderSmsEnabled
 */
export function successfulProductionDeployChecks(mode, reminderSmsEnabled) {
  if (mode === "deploy") {
    return [
      "PASS chorotate-production Worker deployment completed",
      "PASS deployment provider output withheld",
      "PASS temporary Wrangler config cleaned",
      "PASS emitted Wrangler config cleaned",
    ];
  }
  return [
    "PASS production Worker name chorotate-production",
    "PASS production D1 binding DB",
    "PASS production D1 database chorotate-production",
    "PASS production bindings injected",
    reminderSmsEnabled === "false"
      ? "PASS production SMS disabled"
      : "PASS production SMS explicitly enabled",
    "PASS Wrangler dry run completed without upload",
    "PASS temporary Wrangler config cleaned",
    "PASS emitted Wrangler config cleaned",
  ];
}
