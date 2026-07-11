# better-ttb

UofT timetable builder monorepo.

## Setup

```sh
npm install
```

## Commands

```sh
npm run dev
npm run typecheck
npm run test
npm run build
npm run alchemy
```

`apps/web` is a TanStack Start app targeting Cloudflare Workers through Alchemy. The build script uses plain `vite build`; Alchemy resource deployment is handled by `npm run alchemy`.

The Alchemy Vite plugin requires Alchemy's generated `.alchemy/local/wrangler.jsonc`. Standalone `npm run build` skips that plugin; `npm run alchemy` enables it through Alchemy's build environment.
