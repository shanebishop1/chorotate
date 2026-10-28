import { readdirSync } from "node:fs";
import { loadProductionEnvironment } from "./load-production-environment.mjs";

loadProductionEnvironment();
try {
  const origin = process.env.PRODUCTION_CANONICAL_ORIGIN;
  if (!origin) throw new Error();
  const response = await fetch(origin, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) throw new Error();
  const html = await response.text();
  const home = readdirSync("build/client/assets").find((file) =>
    /^home-[^.]+\.js$/.test(file),
  );
  if (!home || !html.includes(home)) throw new Error();
  const asset = await fetch(new URL(`assets/${home}`, origin), {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (asset.status !== 200) throw new Error();
  const auth = await fetch(new URL("/api/auth/get-session", origin), {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (auth.status !== 200 || (await auth.json()) !== null) throw new Error();
  console.log(
    "PASS live homepage, deployed asset, and unauthenticated session endpoint",
  );
} catch {
  console.error("FAIL production smoke check; response details withheld");
  process.exitCode = 1;
}
