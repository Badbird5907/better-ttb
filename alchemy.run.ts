import alchemy from "alchemy";
import {
  D1Database,
  DOStateStore,
  KVNamespace,
  TanStackStart,
} from "alchemy/cloudflare";

const app = await alchemy("better-ttb", {
  stage: process.env.STAGE ?? "prod",
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: (scope) => new DOStateStore(scope),
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
  adopt: true,
  bindings: {
    DB: db,
    KV: kv,
    SESSIONS: "20269,20271,20269-20271",
    ADMIN_TOKEN: alchemy.secret(process.env.ADMIN_TOKEN ?? "dev-admin-token"),
  },
  crons: ["0 8 * * *"],
  domains: [
    {
      domainName: "ttb.evanyu.dev",
      adopt: true,
      // The domain is currently bound to the old `better-ttb-web-evanl`
      // worker; this transfers it to this stage's worker.
      overrideExistingOrigin: true,
    },
  ],
});

console.log({ url: web.url });
await app.finalize();
