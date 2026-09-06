import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { repositoryFiles } from "./repository-files.mjs";

/** @type {string[]} */
const failures = [];
/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail = "") {
  if (condition) console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
/** @param {string} name @param {string[]} args */
function command(name, args = []) {
  return spawnSync(name, args, { encoding: "utf8" });
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npmResult = command("npm", ["--version"]);
const npmVersion = npmResult.stdout?.trim() ?? "";
/** @param {Record<string, unknown> | undefined} value */
const canonical = (value) =>
  JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort()));
check(
  "Node runtime",
  process.versions.node === "24.20.0",
  `required 24.20.0, found ${process.versions.node}`,
);
check(
  "npm runtime",
  npmResult.status === 0 && npmVersion === "11.19.0",
  `required 11.19.0, found ${npmVersion || "unavailable"}`,
);
check("npm package manager pin", packageJson.packageManager === "npm@11.19.0");
check("lockfile version", lock.lockfileVersion === 3);
check(
  "lockfile root metadata",
  lock.name === packageJson.name &&
    canonical(lock.packages?.[""]?.dependencies) ===
      canonical(packageJson.dependencies) &&
    canonical(lock.packages?.[""]?.devDependencies) ===
      canonical(packageJson.devDependencies),
);
check(
  "install-script allowlist",
  canonical(packageJson.allowScripts) ===
    canonical({ "esbuild@0.28.1": true, "workerd@1.20260828.1": true }),
  "esbuild@0.28.1, workerd@1.20260828.1",
);
const install = command("npm", ["ls", "--all", "--silent"]);
check(
  "installed dependency tree",
  install.status === 0,
  "npm ls --all --silent",
);

for (const tool of ["git", "mise", "node", "npm", "npx"]) {
  check(`tool available: ${tool}`, command(tool, ["--version"]).status === 0);
}
for (const tool of [
  "oxfmt",
  "oxlint",
  "playwright",
  "react-router",
  "tsc",
  "vite",
  "vitest",
  "wrangler",
]) {
  check(
    `project tool installed: ${tool}`,
    existsSync(`node_modules/.bin/${tool}`),
  );
}

const generated = command("npm", ["run", "cf-typegen:check"]);
check(
  "generated Worker bindings",
  generated.status === 0,
  "wrangler --check (non-mutating)",
);
const qualityContracts = command("npm", ["run", "quality:contracts"]);
check(
  "release quality and security contracts",
  qualityContracts.status === 0,
  "toolchain, CI, migrations, transport, environment, and contact boundaries",
);

const environmentSource = readFileSync("app/runtime/environment.ts", "utf8");
/** @param {string} name */
function namesFromConst(name) {
  const body = new RegExp(
    `export const ${name} = \\[([\\s\\S]*?)\\] as const`,
  ).exec(environmentSource)?.[1];
  return [...(body ?? "").matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map(
    (match) => match[1],
  );
}
const plainNames = namesFromConst("plainBindingNames");
const secretNames = namesFromConst("secretBindingNames");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const devExample = readFileSync(".dev.vars.example", "utf8");
check(
  "plain binding names declared",
  plainNames.length > 0 &&
    plainNames.every((name) => new RegExp(`"${name}"\\s*:`).test(wrangler)),
  plainNames.join(", "),
);
check(
  "secret names documented",
  secretNames.length > 0 &&
    secretNames.every((name) => new RegExp(`^${name}=`, "m").test(devExample)),
  secretNames.join(", "),
);

const productionBlock =
  /"production"\s*:\s*\{([\s\S]*?)\n\s*\},\n\s*\}/.exec(wrangler)?.[1] ?? "";
const productionSelected = /"APP_ENV"\s*:\s*"production"/.test(productionBlock);
const productionPlaceholders =
  /(?:localhost|example\.invalid|00000000-0000-0000-0000-000000000000|chorotate-local)/.test(
    productionBlock,
  );
check(
  "production placeholders rejected",
  !productionSelected || !productionPlaceholders,
  productionSelected
    ? "production config inspected"
    : "local config explicitly selected",
);

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationNumbers = migrations.map((name) => Number(name.slice(0, 4)));
check(
  "migration ordering",
  migrations.length > 0 &&
    migrationNumbers.every((number, index) => number === index + 1) &&
    new Set(migrationNumbers).size === migrations.length,
  migrations.join(", "),
);

const tracked = repositoryFiles();
const forbidden = tracked.filter(
  (path) =>
    path === ".env" ||
    (path.startsWith(".dev.vars") && path !== ".dev.vars.example") ||
    path.startsWith("build/") ||
    path.startsWith("test-results/") ||
    path.startsWith("node_modules/") ||
    path.startsWith(".react-router/") ||
    path.startsWith(".wrangler/") ||
    path.endsWith(".tsbuildinfo"),
);
check("no tracked secrets or build artifacts", forbidden.length === 0);
check(
  "generated bindings are tracked",
  tracked.length === 0 || tracked.includes("worker-configuration.d.ts"),
);
check(
  "Mise Node pin",
  /node\s*=\s*"24\.20\.0"/.test(readFileSync("mise.toml", "utf8")),
);
check(
  "browser fixture isolated from production routes",
  !readFileSync("app/routes.ts", "utf8").includes("tests/browser") &&
    !readFileSync("vite.config.ts", "utf8").includes("playwright-fixture"),
);

if (failures.length) {
  console.error("\nDoctor failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nDoctor passed without printing configuration values.");
}
