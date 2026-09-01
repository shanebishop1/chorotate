import { defineConfig } from "@playwright/test";

const projects = [
  ["phone-light", 390, 844, "light"],
  ["phone-dark", 390, 844, "dark"],
  ["desktop-light", 1440, 900, "light"],
  ["desktop-dark", 1440, 900, "dark"],
] as const;

export default defineConfig({
  testDir: "tests/browser",
  outputDir: "test-results/playwright",
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: "http://127.0.0.1:43117",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  projects: projects.map(([name, width, height, colorScheme]) => ({
    name,
    use: { viewport: { width, height }, colorScheme },
  })),
  webServer: {
    command: "vite --config playwright-fixture.vite.config.ts",
    url: "http://127.0.0.1:43117",
    reuseExistingServer: !process.env.CI,
  },
});
