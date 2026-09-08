import { existsSync, statSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

const productionEnvironmentPath = resolve(".chorotate/production.env");

export function loadProductionEnvironment() {
  if (!existsSync(productionEnvironmentPath)) return;
  const mode = statSync(productionEnvironmentPath).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      "Production environment file must be mode 0600: .chorotate/production.env",
    );
  }
  loadEnvFile(productionEnvironmentPath);
}
