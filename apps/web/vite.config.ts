import { fileURLToPath, URL } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { defineConfig } from "vite";

const alchemyPlugins = process.env.ALCHEMY_ROOT ? [alchemy()] : [];

export default defineConfig(({ command }) => {
  const localCloudflareAlias =
    command === "serve" && !process.env.ALCHEMY_ROOT
      ? {
          "cloudflare:workers": fileURLToPath(
            new URL("./src/server/local-cloudflare.ts", import.meta.url),
          ),
        }
      : {};

  return {
    resolve: {
      alias: localCloudflareAlias,
      tsconfigPaths: true,
    },
    build: {
      target: "esnext",
      sourcemap: true,
      rollupOptions: {
        external: ["node:async_hooks", "cloudflare:workers"],
      },
    },
    plugins: [...alchemyPlugins, tanstackStart(), viteReact(), tailwindcss()],
    server: {
      proxy: {
        "/ingest/static": {
          target: "https://us-assets.i.posthog.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ingest/, ""),
          secure: false,
        },
        "/ingest/array": {
          target: "https://us-assets.i.posthog.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ingest/, ""),
          secure: false,
        },
        "/ingest": {
          target: "https://us.i.posthog.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ingest/, ""),
          secure: false,
        },
      },
    },
  };
});
