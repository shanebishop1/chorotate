import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  fixedProductionDeployFailure,
  successfulProductionDeployChecks,
  withEmittedDeployConfigCleanup,
} from "./production-deploy-output.mjs";
import { withTemporaryWranglerConfig } from "./production-d1-wrangler.mjs";

const sensitiveProviderOutput = [
  "own...@exa...",
  "https://private.example.test",
  "12345678-1234-4123-8123-123456789abc",
  "https://provider.example.test/capability?token=private-token",
  '{"providerPayload":{"identity":"arbitrary private detail"}}',
];
const deployOutputModule = pathToFileURL(
  resolve("scripts/production-deploy-output.mjs"),
).href;

/** @param {string} source */
function runModuleProbe(source) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: resolve("."), encoding: "utf8" },
  );
}

test("withholds abbreviated identities and arbitrary successful child output", () => {
  const childSource = `
    process.stdout.write(${JSON.stringify(sensitiveProviderOutput.join("\n"))});
    process.stderr.write(${JSON.stringify(`\n${[...sensitiveProviderOutput].reverse().join("\n")}`)});
  `;
  const probe = runModuleProbe(`
    import { runWithSuppressedChildOutput } from ${JSON.stringify(deployOutputModule)};
    await runWithSuppressedChildOutput(
      process.execPath,
      ${JSON.stringify(["--eval", childSource])},
      { cwd: process.cwd(), env: process.env, category: "dry-run" },
    );
    console.log("PASS local suppression probe");
  `);

  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, "PASS local suppression probe\n");
  assert.equal(probe.stderr, "");
  for (const privateValue of sensitiveProviderOutput) {
    assert.ok(!`${probe.stdout}${probe.stderr}`.includes(privateValue));
  }
});

test("withholds failed provider output and emits only a fixed category", () => {
  const childSource = `
    process.stdout.write(${JSON.stringify(sensitiveProviderOutput.join("\n"))});
    process.stderr.write(${JSON.stringify([...sensitiveProviderOutput].reverse().join("\n"))});
    process.exit(19);
  `;
  const probe = runModuleProbe(`
    import {
      fixedProductionDeployFailure,
      runWithSuppressedChildOutput,
    } from ${JSON.stringify(deployOutputModule)};
    try {
      await runWithSuppressedChildOutput(
        process.execPath,
        ${JSON.stringify(["--eval", childSource])},
        { cwd: process.cwd(), env: process.env, category: "deploy" },
      );
    } catch (error) {
      console.error(fixedProductionDeployFailure(error));
      process.exitCode = 1;
    }
  `);

  assert.equal(probe.status, 1);
  assert.equal(probe.stdout, "");
  assert.equal(
    probe.stderr,
    "FAIL production deploy command; provider output withheld\n",
  );
  for (const privateValue of sensitiveProviderOutput) {
    assert.ok(!`${probe.stdout}${probe.stderr}`.includes(privateValue));
  }
});

test("returns only fixed successful dry-run and deploy checks", () => {
  assert.deepEqual(successfulProductionDeployChecks("dry-run", "false"), [
    "PASS production Worker name chorotate-production",
    "PASS production D1 binding DB",
    "PASS production D1 database chorotate-production",
    "PASS production bindings injected",
    "PASS production SMS disabled",
    "PASS Wrangler dry run completed without upload",
    "PASS temporary Wrangler config cleaned",
    "PASS emitted Wrangler config cleaned",
  ]);
  assert.deepEqual(successfulProductionDeployChecks("deploy", "false"), [
    "PASS chorotate-production Worker deployment completed",
    "PASS deployment provider output withheld",
    "PASS temporary Wrangler config cleaned",
    "PASS emitted Wrangler config cleaned",
  ]);
  assert.equal(
    fixedProductionDeployFailure(new Error(sensitiveProviderOutput.join(" "))),
    "FAIL production deploy preparation; details withheld",
  );
});

test("cleans temporary and emitted configs after success or failure", async () => {
  const testDirectory = mkdtempSync(
    join(tmpdir(), "chorotate-production-deploy-test-"),
  );
  const emittedConfigPath = join(testDirectory, "wrangler.json");
  let temporaryDirectory = "";
  try {
    const result = await withEmittedDeployConfigCleanup(emittedConfigPath, () =>
      withTemporaryWranglerConfig(
        { private: sensitiveProviderOutput },
        ({ configPath }) => {
          temporaryDirectory = dirname(configPath);
          writeFileSync(emittedConfigPath, "private emitted config\n");
          return "completed";
        },
      ),
    );
    assert.equal(result, "completed");
    assert.equal(existsSync(temporaryDirectory), false);
    assert.equal(existsSync(emittedConfigPath), false);

    await assert.rejects(
      withEmittedDeployConfigCleanup(emittedConfigPath, () =>
        withTemporaryWranglerConfig(
          { private: sensitiveProviderOutput },
          ({ configPath }) => {
            temporaryDirectory = dirname(configPath);
            writeFileSync(emittedConfigPath, "private emitted config\n");
            throw new Error(sensitiveProviderOutput.join(" "));
          },
        ),
      ),
    );
    assert.equal(existsSync(temporaryDirectory), false);
    assert.equal(existsSync(emittedConfigPath), false);
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});
