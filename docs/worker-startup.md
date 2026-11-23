# Worker startup time

Everything a Worker evaluates in its global scope runs before the first
request: the Nitro entry, every plugin in `server/plugins/` and every module
they import. Cloudflare validates that work at deploy time, so a slow startup
does not make requests slow, it makes a deploy fail. This document holds the
rules, the measured numbers and the measuring recipe. Ticket: BES-469.

## 1. The `import()` rule

A dynamic `import()` defers nothing while the target module sits in the entry
chunk. Measured fact: in this build all `server/utils` modules (665 at the time)
are in `chunks/nitro/nitro.mjs`, which the entry runs at startup. An `import()`
into the same chunk compiles to `Promise.resolve().then(() => namespace)`, so
the module body still runs at startup. A lazy `import()` only helps for a
module that lives in its own chunk.

PR #1089 added lazy imports to the Google sweep and the account purge modules,
and the measured startup did not move (260 ms before, 248 to 285 ms after).
`tests/unit/server/plugins/startup-imports.spec.ts` scans the explicit static
import graph from every file in `server/plugins/` and `server/middleware/` and
fails when it reaches the heavy Google modules or the workbook map. It does not
see imports that Nitro injects for auto-imported `server/utils` names, so it
guards against one regression and is not proof of a small startup.

## 2. Measured numbers

Local `wrangler check startup`, three runs each, on one developer machine (not
Cloudflare hardware):

| Build | Active at startup | Bundle |
| --- | --- | --- |
| `main` fdfdffca | 274, 279, 409 ms | 16,917.8 KiB, gzip 3,770.5 KiB |
| Google umbrella b7d642b8 | 253, 254, 258 ms | 17,673.5 KiB, gzip 3,951.9 KiB |
| BES-469 before (b7d642b8) | 268.3, 270.0, 273.3 ms (median 270.0) | 17,673.5 KiB |
| BES-469 after | 225.6, 233.0, 240.8 ms (median 233.0) | 17,676.4 KiB, gzip 3,951.3 KiB |

The Google umbrella adds 0.4 MB to `nitro.mjs` and 90 modules over `main`, with
no measurable startup cost.

Top self time before BES-469: `compileSensitiveTextExpression` about 53 ms (the
memory sensitive-topic rule tables), esbuild `__init` wrappers about 51 ms, the
`nitro.mjs` body 36 to 46 ms, garbage collection 20 to 40 ms.

BES-469 made the memory rule compilation lazy (`server/utils/memory/sensitivity.ts`
and `server/utils/memory/topical-never-store.ts` compile on the first
classification and keep the result). The median dropped by about 37 ms (14%),
and `compileSensitiveTextExpression` no longer appears in the top self-time
list. The first classification in a fresh isolate now pays the compile cost
once.

## 3. How to measure

```bash
NODE_OPTIONS=--max-old-space-size=6144 env -u NUXT_PUBLIC_BASE_URL pnpm run build
env -u NUXT_PUBLIC_BASE_URL pnpm exec wrangler check startup \
  --outfile /tmp/worker-startup.json
```

The command bundles `.output/server/index.mjs`, runs the startup phase in a
local workerd and prints the bundle size and the active time. The output file
is a V8 CPU profile (`nodes`, `samples`, `timeDeltas`). Sum `timeDeltas` per
`callFrame.functionName` for the self time per function, and read the top of
that list; the same file opens in the Chrome DevTools profiler. Run it three
times and compare the median. Use the same machine with no other load, and the
same build command for both sides of a comparison.

## 4. The rule

No heavy work at module top level: regex compiles over rule tables, schema
construction, big table merges, JSON parsing, model catalog merges. Compute on
first use and cache the settled value in a module-level `let` that holds a plain
value, never a promise. CLAUDE.md: a promise that waits on I/O belongs to the
request that started it, so a promise cached across requests never settles on
Workers. A top-level constant that is a literal is fine.

```ts
let compiledRules: readonly CompiledRule[] | null = null

function getCompiledRules(): readonly CompiledRule[] {
  if (compiledRules) {
    return compiledRules
  }

  compiledRules = ruleDefinitions.map(compileRule)

  return compiledRules
}
```

## 5. Error 10021 and what Cloudflare says

Cloudflare error 10021 "Script startup exceeded CPU time limit" happened twice
on the PR preview deploy of the Google umbrella (once on 0fea513c, once on
c0328479). Both passed on a re-run without a code change. The local startup was
about 250 ms at the time. The first failures were not found in the workflow
history: the Preview Deploy workflow log has one failure in 200 runs, `Preview
not found [code: 10025]`, so their text is only in the session notes.

What Cloudflare says (checked 2026-11-25):

- A Worker must parse and execute its global scope within 1 second, the same on
  Free and Paid. The limit was raised from 400 ms on 2025-10-10.
  - https://developers.cloudflare.com/workers/platform/limits/
  - https://developers.cloudflare.com/changelog/ (entry 2025-10-10-increased-startup-time)
- Error 10021 is a deploy-time validation error: Cloudflare loads and runs the
  top-level scope when you deploy.
  - https://developers.cloudflare.com/workers/observability/errors/
- The docs call the limit CPU time. Whether the runtime counts CPU or wall time
  is not stated. Whether `wrangler preview` validates with the same limit is
  not stated.
- `wrangler deploy` and `wrangler versions upload` print `Worker Startup Time:
  N ms`, the authoritative number. `wrangler check startup` is local, and the
  docs say its profile will not match the platform number (different CPU, it can
  vary widely). On a failed deploy wrangler writes a `.cpuprofile`
  automatically.
- Guidance: avoid expensive work in global scope, move initialization into the
  handler or to build time (large schema generation is the common cause).
  Larger bundles and expensive global-scope initialization increase startup. A
  lazy `import()` is normally bundled into the entrypoint, which reduces the
  effect. With `find_additional_modules: true` plus a matching `rules` entry the
  file stays a separate module that is loaded and executed only when imported.
  - https://developers.cloudflare.com/workers/wrangler/bundling/

Our platform numbers: production `wrangler deploy` runs printed `Worker Startup
Time: 360 ms` (run 44980959764) and `467 ms` (run 44971976005) for the same
bundle (16,917 KiB, gzip 3,770 KiB), so the platform varies about 30% from run
to run. The satellite Workers print 112 to 184 ms. Local `check startup` of the
same code is about 250 to 280 ms, so the platform number is about 1.4 to 1.9
times the local one, and the 1 second limit corresponds to roughly 550 to 700 ms
locally. PR preview deploys (`wrangler preview --json > file`) print no startup
time.

## 6. What is deliberately not done

These are larger decisions that belong to the owner.

- **Nitro chunking change.** Move route-only code out of `nitro.mjs` so that
  `import()` really defers; Workers evaluate a separately bundled module lazily
  on a dynamic import. Cost: a whole-build change, with the risk that routes
  load code at a different time than the tests assume.
- **Split a heavy surface into its own Worker** behind a service binding, like
  `DOC_RENDERER`. Cost: a new deploy unit, an RPC contract and per-PR preview
  gaps, with test risk on every call that crosses the binding.
- **`find_additional_modules: true` plus a `rules` entry**, with Nitro's chunk
  files as the additional modules, so each chunk stays a separate module that
  loads only when imported. Cost: a whole-build change to how Wrangler bundles
  the Nitro output, with the same test risk, and it needs a measured spike
  first.
