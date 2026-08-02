import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "cloudflare:workers": fileURLToPath(
        new URL("./src/server/local-cloudflare.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
