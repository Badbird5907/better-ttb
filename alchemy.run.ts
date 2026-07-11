import alchemy from "alchemy";
import { D1Database, KVNamespace, TanStackStart } from "alchemy/cloudflare";

const app = await alchemy("better-ttb", {
  password: process.env.ALCHEMY_PASSWORD,
});

const db = await D1Database("db", {
  name: "better-ttb-db",
  migrationsDir: "apps/web/migrations",
  adopt: true,
});

const kv = await KVNamespace("kv", {
  title: "better-ttb-kv",
  adopt: true,
});

export const web = await TanStackStart("web", {
  cwd: "apps/web",
  bindings: {
    DB: db,
    KV: kv,
    SESSIONS: "20269,20271,20269-20271",
    ADMIN_TOKEN: alchemy.secret(process.env.ADMIN_TOKEN ?? "dev-admin-token"),
  },
  crons: ["0 8 * * *"],
  domains: ["ttb.evanyu.dev"],
});

console.log({ url: web.url });
await app.finalize();
