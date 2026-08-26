import alchemy from "alchemy";
import {
  D1Database,
  DOStateStore,
  KVNamespace,
  RateLimit,
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

const courseRefreshRateLimit = RateLimit({
  namespace_id: 1001,
  simple: {
    limit: 20,
    period: 60,
  },
});

export const web = await TanStackStart("web", {
  cwd: "apps/web",
  adopt: true,
  compatibilityDate: "2026-08-01",
  bindings: {
    DB: db,
    KV: kv,
    COURSE_REFRESH_RATE_LIMIT: courseRefreshRateLimit,
    SESSIONS: "20269,20271,20269-20271",
    ADMIN_TOKEN: alchemy.secret(process.env.ADMIN_TOKEN ?? ""),
  },
  crons: ["*/15 * * * *"],
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
