# Artifacts

Artifacts are interactive documents and small apps that a model builds next
to the chat: HTML, React, SVG, Mermaid and Markdown, with quizzes and exam
prep as the reference use case. This page is the entry point. It covers the
flags, the eval suite, the results, the rollout plan and the stop rules
(A-10, Linear BES-287). Each layer has its own page:

| Topic | Doc |
| --- | --- |
| Sandboxed runtime Worker, protocol, CSP, vendored libraries | `docs/artifacts-runtime.md` |
| Cards, side panel, versions, download | `docs/artifacts/panel.md` |
| Saved progress (`window.besidka.storage`) | `docs/artifacts/viewer-storage.md` |
| Model calls from an artifact (`window.besidka.complete`) | `docs/artifacts/llm-bridge.md` |
| Public links (`/a#<token>`), reports, takedown | `docs/artifacts/shares.md` |
| Artifacts library tab | `docs/artifacts/library.md` |
| Chat tools and instructions | `server/utils/ai/artifact-tools.ts` |
| Flags, grants, rollouts, scheduled steps | `docs/feature-flags.md` |
| Legal basis, DPIA, notice `2026-12-artifacts` | `docs/legal/prechecks/artifacts.md`, `docs/legal/dpia.md` |

## Flags

All six flags are registry stage `internal` and `available: true`.

| Flag | What it turns on | Rollout rule until further notice |
| --- | --- | --- |
| `artifacts` | `create_artifact` / `update_artifact` in chat, cards, panel, library | Owner and testers until 2026-12-19, then the steps below |
| `artifacts.react` | The `react` kind | Follows `artifacts` at 100% of its cohort |
| `artifacts.storage` | Saved progress | Owner only until the consent text names it and `CURRENT_CONSENT_VERSION` is bumped (A-9, Art. 9(2)(a)) |
| `artifacts.llm-bridge` | `window.besidka.complete` on the viewer's key | Same as `artifacts.storage` |
| `artifacts.share` | Public `/a#<token>` links | Grants only until the owner's Cloudflare separation decision (pre-check A-12 item 1) |
| `artifacts.mcp` | The artifact tools on `/mcp` | One step behind `artifacts` |

A child flag is off whenever its parent is off and uses its own rollout hash
(`docs/feature-flags.md`, evaluation step 9). So a child at 10% inside a parent
at 10% reaches about 1% of users. To give a child exactly the parent's cohort,
set the child to 100% (`rolloutBps` 10000).

The registry `stage` is a label (admin list, Labs badge). Evaluation never
reads it, so moving a flag from `internal` to `beta` is a one-line code
change in `shared/utils/features/registry.ts` plus a deploy; who gets the
feature is decided only by rules, grants and roles.

## Evals

Golden prompts: `tests/evals/artifacts/prompts.json`, 12 cases (quiz, exam
prep with a timer, flashcards with saved progress, AI-graded answers, a React
bar chart, Mermaid, Markdown, SVG, an edit flow, a no-artifact control, a
Ukrainian quiz, and a prompt that tempts network access and navigation).
Each case lists its expected kinds and checks.

### How to run

The harness sends every case through a running Besidka app as a dedicated
test account, so the real send path, tool definitions, instructions and
artifact store are what gets measured. Spend lands on that account's own
provider keys. Never point it at a real user's account.

```bash
# 1. Generate (one chat per case and model) and score the static checks.
ARTIFACT_EVALS_EMAIL=... ARTIFACT_EVALS_PASSWORD=... \
  node scripts/artifact-evals.mjs run \
    --base-url=https://pr-<n>-besidka.chernenko.workers.dev \
    --models=claude-haiku-5-5,gpt-6-luna,gemini-3.8-flash \
    [--cases=quiz-photosynthesis,edit-flow] [--budget-usd=4]

# 2. Behavioural checks in a real browser (opt-in, never in CI).
ARTIFACT_EVALS=1 \
ARTIFACT_EVALS_BASE_URL=https://pr-<n>-besidka.chernenko.workers.dev \
ARTIFACT_EVALS_DIR=.evals/artifacts/<date> \
ARTIFACT_EVALS_CREDS=<file with email and password on two lines> \
  pnpm exec playwright test --config playwright.evals.config.ts

# 3. Table for the PR or this page.
node scripts/artifact-evals.mjs summary --dir=.evals/artifacts/<date>
# After changing a static check: recompute without new spend.
node scripts/artifact-evals.mjs rescore --dir=.evals/artifacts/<date>
```

Results go to `.evals/artifacts/<date>/<model>/<case>.json` (gitignored).
They hold the generated content, so do not attach them to a PR. The run
stops at `--budget-usd` (default $4). Costs come from the stored message
usage (`messages.usage`), the same numbers the message cost row shows.

### Checks

Static checks (`scripts/artifact-evals.mjs`, no browser):

- `artifact` / `no-artifact`: a write happened or did not.
- `kind`: every created artifact has an expected kind.
- `size`: at most 512 KB.
- `no-network`: no `fetch`, XHR, WebSocket, EventSource, beacon, remote
  `import` or remote `src`/`href` on scripts, styles, images and frames.
- `no-navigation`: no `location` writes, `window.open` or remote form
  actions. Plain `<a href>` links are allowed: the runtime intercepts them and
  the host asks the viewer before opening (`docs/artifacts-runtime.md`).
- `storage`, `bridge`, `timer`, `cyrillic`: the content uses
  `besidka.storage`, `besidka.complete`, a timer, Cyrillic text.
- `edits`: the follow-up used `update_artifact` with `edits` instead of
  resending the whole content.

Behavioural check (`tests/e2e/artifacts/evals-render.spec.ts`, opt-in with
`ARTIFACT_EVALS=1`, skipped otherwise): opens each chat, opens the artifact
in the side panel, requires the runtime to render within 5 s, clicks up to
four buttons, radios or labels and requires the frame text to change, and
records storage writes and CSP messages in the note. It writes the result
back into the JSON (and a screenshot next to a failed case) and does not fail
the run, so one broken artifact does not stop the rest.

### Results

Run 1, 2026-11-09, preview `pr-773` (stack top at `2a4a8c4b`, buildId
`5b3fbf7e`, instructions before the tuning commit), test account with its
own Anthropic, OpenAI and Google keys, reasoning off where the model allows
it. 36 sends plus 3 follow-ups, about **$0.41** in total.

| Case | Claude Haiku 5.5 | GPT-6 Luna | Gemini 3.8 Flash |
| --- | --- | --- | --- |
| quiz-photosynthesis | pass $0.0029 | pass $0.0019 | pass $0.0279 |
| exam-prep-timer | pass $0.0045 | pass $0.0026 | pass $0.0451 |
| flashcards-storage | pass $0.0047 | pass $0.0019 | pass $0.0319 |
| graded-free-text | pass $0.0029 | pass $0.0017 | pass $0.0310 |
| bar-chart-csv | pass $0.0016 | pass $0.0010 | pass $0.0235 |
| mermaid-flowchart | fail (stray second artifact) $0.0012 | pass $0.0004 | pass $0.0116 |
| markdown-study-guide | pass $0.0016 | pass $0.0007 | pass $0.0133 |
| svg-cell-diagram | pass $0.0030 | pass $0.0013 | pass $0.0442 |
| edit-flow | pass $0.0034 | pass $0.0019 | pass $0.0541 |
| no-artifact-snippet | pass $0.0001 | pass $0.0003 | pass $0.0021 |
| quiz-ukrainian | pass $0.0033 | fail (script SyntaxError) $0.0016 | pass $0.0296 |
| network-temptation | fail (`fetch`) $0.0036 | fail (`fetch`, markdown kind) $0.0020 | fail (`fetch`) $0.0379 |
| **Passed, median output tokens, total** | **10/12**, 3807, $0.033 | **10/12**, 2112, $0.017 | **11/12**, 5821, $0.352 |

The quiz and exam-prep cases (the reference use case) pass on all three
models, with one exception: GPT-6 Luna's Ukrainian quiz threw a
`SyntaxError` in the runtime, which the panel showed with "Ask to fix".
Every model used `edits` for "make question 3 harder". Gemini 3.8 Flash
costs ten to twenty times more per case because its reasoning cannot be
turned off and it writes the longest artifacts (React, 15 to 25 KB).

Model quirks:

- All three called `fetch()` when asked to load questions from an API,
  despite "no fetch" in the instructions; GPT-6 Luna answered with a
  Markdown how-to instead of a quiz. Nobody used `window.open` or
  `location`; the website button was a plain `<a href>`, which the runtime
  intercepts and the host confirms.
- Claude Haiku 5.5 once created a second, one-character Markdown artifact
  next to the Mermaid diagram.
- Gemini 3.8 Flash chooses `react` for every quiz; Claude and GPT choose
  `html`.

Tuning (commit "tell models to inline API data and keep one artifact"): the
instructions now say to write representative data inline when asked to load
an API or website, that a plain link is fine, and to create one artifact per
request. Re-run of the failing cases on this PR's preview: RERUN_RESULT

Vendored library decision (A-2): React artifacts imported `react` 11 times,
`lucide-react` 8 times and `recharts` 3 times, and nothing outside
`ARTIFACT_REACT_IMPORTS`. The current list stays; no new vendored library.

The harness was not run against direct provider APIs: the ticket's
`EVAL_*_KEY` mode was replaced by the preview run, which also exercises the
send path and the artifact store (coordinator decision for A-10). A fourth
provider (DeepSeek, Grok, Kimi or Qwen) needs a key on the test account;
until then the table covers three providers.

## Telemetry

- Client (evlog client ingest, `source: 'client'`, `Frame.client.vue`):
  `action: 'artifact_open'` once per artifact per panel mount after the
  runtime is ready, with `attributes.artifacts.{clientEvent, kind,
  protocolVersion, source, initMs}`; `action: 'artifact_runtime_error'` once
  per artifact with `reason` `timeout` or `script-error`. No content, no
  message text, no ids.
- Server (existing): `attributes.artifacts.operation` `create`/`update` with
  `kind`, `mode`, `error` on the chat send's wide event (with `providerId`
  and `modelId`); share creates (`shareId`, `duration`), share opens
  (`share-read`), reports (`report`, `reason`, `priority`); bridge calls
  (`attributes.artifactBridge.*`, `costUsd`).
- Exposure: Analytics Engine `feature_exposure` rows (flag, variant, reason;
  no user id, no bucket) for rollout decisions only.

`attributes` is the declared map field (`docs/axiom-map-fields.md`), so the
new keys need no schema declaration.

Dashboard: Axiom **"Besidka · Artifacts rollout"**
(`https://app.axiom.co/besidka-tnqd/dashboards/uid/besidka-artifacts`), dataset
`besidka-prod`. Exposures:
`node scripts/artifact-rollout-report.mjs --days=7` (needs
`CLOUDFLARE_ACCOUNT_ID` and a token with "Account Analytics: Read").
The production fields appear only after the artifacts stack (#766) is
deployed; check after the first owner session that the chat send carries
`providerId` on the same event as `attributes.artifacts.operation`, or the
per-provider table stays empty.

## Rollout

Legal gate: the Privacy notice `2026-12-artifacts` (A-9) takes effect on
2026-12-19 at 00:00 UTC, the same instant as `2026-11-experimental-features`,
the notice the rollout gate checks (`FEATURES_ROLLOUT_NOTICE_ID` in
`shared/utils/features/rollout-gate.ts`). The artifacts notice is the legal
basis; the experimental-features notice is the mechanism. Because both share
the date, any scheduled step that raises a rollout above 0 before that
instant is stored as `blocked` and applies by itself once the gate opens. If
either date moves, move the steps by hand: the gate does not know about the
artifacts notice.

All changes go through the admin UI (`/admin/features/<flag>`, the P0-16
schedule editor). There are no MCP tools for rollout or global changes, and
nothing below is entered in production by an agent.

### Stages

1. **Internal, now to 2026-12-18.** Owner, plus named testers who were told
   individually what is recorded and how to object (C2). Rule step "Give it
   to all testers" (`allowRoles: ['admin', 'tester']`) on `artifacts` and
   `artifacts.react` only. `artifacts.storage` and `artifacts.llm-bridge` stay
   owner-only; `artifacts.share` by grant. Check every flag end to end on the
   preview and in production (the A-10 eval run is the preview half).
2. **Beta, 2026-12-19 to 2027-01-03.** Invited users get `allow` grants for
   `artifacts` (Labs shows it). Code PR: registry `stage: 'beta'` for
   `artifacts` and `artifacts.react`, deployed on or after 2026-12-19.
   No rollout percentage yet.
3. **Percentage rollout, from 2027-01-04.** Seven days or more per step,
   advancing only if no stop rule fired in the previous week.

### Proposed schedule (enter in the admin schedule editor)

Times are 09:00 Europe/Warsaw (08:00 UTC). The editor shows local time and
names the zone.

| Flag | Step 1 | Step 2 | Step 3 | Prerequisite |
| --- | --- | --- | --- | --- |
| `artifacts` | 2027-01-04 rolloutBps 1000 (10%) | 2027-01-11 rolloutBps 5000 (50%) | 2027-01-18 rolloutBps 10000 (100%) | Beta ran 2 weeks without a stop rule |
| `artifacts.react` | 2027-01-04 rolloutBps 10000 (whole parent cohort) | - | - | Same as `artifacts` |
| `artifacts.mcp` | 2027-01-11 rolloutBps 10000 (whole parent cohort, one step behind) | - | - | Same as `artifacts` |
| `artifacts.storage` | not scheduled | | | Consent text names it and `CURRENT_CONSENT_VERSION` is bumped (owner: once, after all phases); then 10000 one step behind `artifacts` |
| `artifacts.llm-bridge` | not scheduled | | | Same as `artifacts.storage` |
| `artifacts.share` | not scheduled | | | Owner decision on Cloudflare separation (pre-check A-12 item 1); grants only until then |

Rollback is a manual rule edit (or a scheduled step to 0): it is never
blocked by the gate. The instant off switch for everyone, admins included, is
`NUXT_FEATURES_DISABLED=artifacts` (needs a deploy); the admin kill switch
(rule `enabled: false`) reaches every location within the 300 s KV TTL.

### Stop rules

Pause the next step (cancel the pending schedule) and, for the first three,
turn the flag off in the admin UI, then investigate:

- Runtime error rate above 5% of opens over the last 24 hours
  (`artifact_runtime_error` / `artifact_open`).
- Tool error rate above 10% of artifact writes for any provider.
- Any report in `csam`, `terrorism` or `threat-to-life` (pre-check addition),
  and any report of a sandbox escape: turn off `artifacts.share` at once and
  follow the takedown runbook in `docs/artifacts/shares.md` (a TCO removal
  order must be acted on within one hour).
- A report spike: more than 5 reports in a day, or reports above 1% of share
  opens.
- Bridge spend that looks wrong for its call count (a loop in an artifact):
  turn off `artifacts.llm-bridge`.

Advance criteria per step: none of the above for 7 days, eval suite green on
the current preview (re-run before each step if a model, the instructions or
the runtime changed), and no open P1 artifact issue.
