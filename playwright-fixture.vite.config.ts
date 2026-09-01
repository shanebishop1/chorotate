import { defineConfig } from "vite";

export default defineConfig({
  root: "tests/browser/fixture",
  server: {
    host: "127.0.0.1",
    port: 43117,
    strictPort: true,
  },
});
