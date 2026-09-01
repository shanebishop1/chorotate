import type { D1Migration } from "@cloudflare/vitest-plugin";

declare module "cloudflare:test" {
  export const env: Cloudflare.Env;
}

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
