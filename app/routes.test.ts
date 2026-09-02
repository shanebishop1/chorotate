import { describe, expect, it } from "vitest";

import routes from "./routes";

describe("route ownership", () => {
  it("preserves public pages and gives React Router ownership of /api/auth/*", () => {
    expect(JSON.stringify(routes)).toContain("routes/home.tsx");
    expect(JSON.stringify(routes)).toContain("routes/privacy.tsx");
    expect(JSON.stringify(routes)).toContain("routes/terms.tsx");
    expect(JSON.stringify(routes)).toContain("api/auth/*");
    expect(JSON.stringify(routes)).toContain("routes/api.auth.ts");
  });
});
