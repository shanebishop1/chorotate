import { betterAuth } from "better-auth";
import { DatabaseSync } from "node:sqlite";

// Schema-only configuration for the pinned auth CLI. The explicit Kysely/SQLite
// override supplies the adapter, so schema generation never needs a live D1
// binding or any credentials.
export const auth = betterAuth({
  appName: "Chorotate",
  baseURL: "http://localhost",
  database: new DatabaseSync(":memory:"),
  account: {
    encryptOAuthTokens: true,
    storeStateStrategy: "database",
  },
  session: {
    cookieCache: { enabled: false },
  },
  telemetry: { enabled: false },
});

export default auth;
