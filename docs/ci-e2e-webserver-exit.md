# CI e2e flake: the `wrangler dev` webServer exits mid-suite

**Status: root cause unknown; diagnostics added 2026-10-06.** This doc
records the signature and what to collect, so the next occurrence is
diagnosable instead of a rerun.

## Signature

In CI, Playwright's single `webServer` is `pnpm exec wrangler dev --port
<E2E_PORT>` (see `playwright.config.ts`). In roughly 4% of runs wrangler
**exits mid-suite**. The log shows, in order:

1. an empty `[WebServer] ✘ [ERROR]` block (no message),
2. wrangler's exit hook:
   `[WebServer] 🪵  Logs were written to "/home/runner/.config/.wrangler/logs/wrangler-<timestamp>.log"`,
3. the running test timing out, then both retries failing with
   `net::ERR_CONNECTION_REFUSED`, and every later test failing the same way.

It has blocked a production deploy. Observed in preview run 37451688496
(attempt 1) and production run 37461455134 (attempt 1); both passed on
re-run, which is why the cause was never visible.

## Why the exit reason was invisible

- Playwright's `webServer.stdout` defaults to `'ignore'`, so anything
  wrangler or the Worker wrote to stdout was dropped. `stderr` already
  defaulted to `'pipe'`, which is why the empty `[ERROR]` block was visible
  but not its cause.
- Wrangler writes a debug-level log file for every run, but the file lives
  outside the workspace (`~/.config/.wrangler/logs/`) and was never
  uploaded.

## Diagnostics

- `playwright.config.ts`: `webServer.stdout` is `'pipe'` in CI (kept
  `'ignore'` locally to avoid flooding dev output) and `stderr` is
  explicitly `'pipe'`. Server stdout now appears in the job log prefixed
  with `[WebServer]`.
- `.github/workflows/preview-build.yml` and
  `.github/workflows/production.yml`: a failed e2e run uploads a
  `wrangler-logs` artifact (30 days) from `/home/runner/.config/.wrangler/logs/`
  and `.wrangler/logs/`. The upload uses `include-hidden-files: true`
  because both directories are dot-directories, and
  `if-no-files-found: ignore` so it never fails a job.
- `WRANGLER_LOG=debug` is deliberately not set. Wrangler appends every
  message to the log file before applying the console level filter, so the
  file already contains debug output while the console stays at its default
  volume.

## On the next occurrence

1. Download the `wrangler-logs` artifact from the failed run and open the
   `wrangler-<timestamp>.log` named in the `Logs were written to` line.
2. Read the final entries before the exit: the empty `[ERROR]` should have a
   real message and stack in the file.
3. In the job log, search for `[WebServer]` lines just before the first
   `ERR_CONNECTION_REFUSED` for any stdout that explains the exit (workerd
   crash, OOM, unhandled rejection).
4. If the artifact is empty, check whether the log directory differs on that
   runner (the `Logs were written to` path is authoritative) and update the
   artifact paths.
5. Record the finding here and replace the "root cause unknown" status.
