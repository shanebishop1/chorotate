import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import routes from "./routes";
import { links } from "./root";

const rootSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "root.tsx"),
  "utf8",
);

describe("route ownership", () => {
  it("keeps the private app surface and gives React Router ownership of /api/auth/*", () => {
    expect(JSON.stringify(routes)).toContain("routes/home.tsx");
    expect(JSON.stringify(routes)).not.toContain("routes/privacy.tsx");
    expect(JSON.stringify(routes)).not.toContain("routes/terms.tsx");
    expect(JSON.stringify(routes)).toContain("api/auth/*");
    expect(JSON.stringify(routes)).toContain("routes/api.auth.ts");
  });

  it("publishes installable app metadata and an iOS touch icon", () => {
    expect(links()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rel: "manifest",
          href: "/manifest.webmanifest",
        }),
        expect.objectContaining({
          rel: "apple-touch-icon",
          href: "/apple-touch-icon.png",
        }),
      ]),
    );
  });

  it("uses the default iOS standalone status bar style", () => {
    expect(rootSource).toMatch(
      /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="default"\s*\/>/s,
    );
  });
});
