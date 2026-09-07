import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../runtime/environment";
import { validTestEnvironment } from "../runtime/test-fixtures";
import {
  handleLocalDevelopmentAuthRequest,
  isLocalDevelopmentRequest,
  localDevelopmentSessionCookie,
} from "./local-development";

const viteConfigSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../vite.config.ts"),
  "utf8",
);

function localConfig() {
  return parseRuntimeConfig(
    validTestEnvironment({
      APP_ENV: "local",
      CANONICAL_ORIGIN: "http://localhost:5173",
      LOCAL_AUTH_ENABLED: "true",
      REMINDER_SMS_ENABLED: "false",
    }),
  );
}

describe("local development authentication gate", () => {
  it("binds the dev server to loopback instead of a public interface", () => {
    expect(viteConfigSource).toMatch(
      /server:\s*\{[\s\S]*host:\s*"127\.0\.0\.1"[\s\S]*strictPort:\s*true/,
    );
  });

  it("requires the development build and explicit local opt-in", () => {
    const config = localConfig();
    const request = new Request("http://localhost:5173/api/auth/local", {
      method: "POST",
      headers: { origin: config.canonicalOrigin },
    });

    expect(
      isLocalDevelopmentRequest(
        request,
        config,
        { requireOrigin: true },
        false,
      ),
    ).toBe(false);
    expect(
      isLocalDevelopmentRequest(
        request,
        { ...config, localAuthEnabled: false },
        { requireOrigin: true },
        true,
      ),
    ).toBe(false);
  });

  it.each([
    ["production", "https://chorotate.example", "https://chorotate.example"],
    ["remote host", "http://evil.example", "http://evil.example"],
    ["cross-origin", "http://localhost:5173", "http://evil.example"],
  ] as const)(
    "rejects %s local authentication requests",
    (_name, url, origin) => {
      const config = localConfig();
      const request = new Request(`${url}/api/auth/local`, {
        method: "POST",
        headers: { origin },
      });
      const gatedConfig =
        _name === "production"
          ? { ...config, applicationEnvironment: "production" as const }
          : config;

      expect(
        isLocalDevelopmentRequest(
          request,
          gatedConfig,
          { requireOrigin: true },
          true,
        ),
      ).toBe(false);
    },
  );

  it("accepts only an exact loopback URL, host, and origin in a dev build", () => {
    const config = localConfig();
    const request = new Request("http://localhost:5173/api/auth/local", {
      method: "POST",
      headers: {
        host: "localhost:5173",
        origin: config.canonicalOrigin,
      },
    });

    expect(
      isLocalDevelopmentRequest(request, config, { requireOrigin: true }, true),
    ).toBe(true);
    expect(localDevelopmentSessionCookie).toBe("chorotate.local_session");
  });

  it("rejects production, remote, and cross-origin endpoint calls before D1 access", async () => {
    const database = {
      prepare() {
        throw new Error("D1 must not be reached");
      },
    } as unknown as D1Database;
    const config = localConfig();
    const requests = [
      {
        request: new Request("http://localhost:5173/api/auth/local", {
          method: "POST",
          headers: { origin: "http://localhost:5173" },
        }),
        config: { ...config, applicationEnvironment: "production" as const },
      },
      {
        request: new Request("http://evil.example/api/auth/local", {
          method: "POST",
          headers: { origin: "http://evil.example" },
        }),
        config,
      },
      {
        request: new Request("http://localhost:5173/api/auth/local", {
          method: "POST",
          headers: { origin: "http://evil.example" },
        }),
        config,
      },
    ];

    for (const { request, config: requestConfig } of requests) {
      await expect(
        handleLocalDevelopmentAuthRequest(request, database, requestConfig),
      ).resolves.toMatchObject({ status: 403 });
    }
  });
});
