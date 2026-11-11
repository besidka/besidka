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
| Public links (`/artifacts/<token>`), reports, takedown | `docs/artifacts/shares.md` |
| Artifacts library tab | `docs/artifacts/library.md` |
| Attaching an existing artifact to a chat (BES-350) | `docs/artifacts/attach.md` |
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
| `artifacts.share` | Public `/artifacts/<token>` links | Grants only until the owner's Cloudflare separation decision (pre-check A-12 item 1) |
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

Golden prompts: `tests/evals/artifacts/prompts.json`, 24 cases (quiz, exam
prep with a timer, flashcards with saved progress, AI-graded answers, a React
bar chart, Markdown, a Git cheat sheet (A-15), SVG, an edit flow, a
no-artifact control, a Ukrainian quiz, and a prompt that tempts network
access and navigation), plus the BES-333 "inline" group: Mermaid diagrams,
small diagrams, TypeScript functions and bash scripts in English and
Ukrainian (including the owner's "згенеруй мені mermaid діаграму" with the
follow-up "будь-яку, два трикутники") that must stay in the reply, and
positive controls that ask for an artifact explicitly or for an
interactive quiz. Each case lists its expected kinds and checks.

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
usage (`messages.usage`), the same numbers the message cost row shows. A case
that fails after its chat exists still counts: the run reads that chat's
assistant usage, and when it cannot (or a send started and no cost is stored
yet, as after a timeout) it charges `--failed-case-estimate-usd` (default
$0.10) so the cap holds.

#### Stalled preview requests (BES-336)

"The operation was aborted due to timeout" on a case does not mean the send
stream never closed. Preview Workers occasionally accept a request and never
answer it (about 4 to 10 ms of CPU, then `canceled` after the client's
timeout), on any route: a `GET /api/v1/chats/<slug>` right after a send that
had finished in 6 s, `PUT /chats/new`, `GET .../context`. Workers
Observability showed the two "unclosed" Haiku 5.5 runs of 2026-11-09 as
completed `AI stream completed` events (`finishReason: stop`, wall 6 s and
15 s) followed by a stalled read. About 140 Haiku sends against pr-781 with
a per-chunk reader and an immediate chat read found no unclosed stream. The
harness now names the request that timed out (also for a stalled body read),
reads with a 20 s timeout and retries a stalled `GET` once ("after 2
attempts" in the error). Writes (`PUT`, `POST`) are never retried, because a
stalled `PUT /chats/new` may already have created the chat, so that stall
still fails its case. A send whose stream really stays open now fails with
"send stream did not close within 240000 ms".

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
- `inline-mermaid`, `inline-code`: the reply (all assistant text parts, both
  turns) has a closed ```` ```mermaid ```` block, or any fenced block. Fences
  are parsed like Markdown (backtick or tilde, a longer outer fence, an
  unclosed fence counts as code but not as a diagram).
- `no-source-echo`: no diagram, page or script source outside a fence
  (Mermaid headers or `A --> B` lines, Cyrillic node ids included,
  `<!DOCTYPE html>`, React imports, a shebang), and at most two lines of an
  artifact the reply wrote repeated in the reply. Results stored before
  BES-333 have no reply text, so these checks stay `pending` there.

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
request. Re-run of the failing cases is pending: the preview of the layer with the
tuning (#778) had not built when this was written. Command:
`node scripts/artifact-evals.mjs run --base-url=https://pr-778-besidka.chernenko.workers.dev --models=claude-haiku-5-5,gpt-6-luna,gemini-3.8-flash --cases=network-temptation,mermaid-flowchart,quiz-ukrainian`
(about $0.10).

Vendored library decision (A-2): React artifacts imported `react` 11 times,
`lucide-react` 8 times and `recharts` 3 times, and nothing outside
`ARTIFACT_REACT_IMPORTS`. The current list stays; no new vendored library.

The harness was not run against direct provider APIs: the ticket's
`EVAL_*_KEY` mode was replaced by the preview run, which also exercises the
send path and the artifact store (coordinator decision for A-10). A fourth
provider (DeepSeek, Grok, Kimi or Qwen) needs a key on the test account;
until then the table covers three providers.

## When to create an artifact

The owner does not want artifact clutter for every little thing (BES-333):
"згенеруй мені mermaid діаграму" produced a Mermaid artifact plus the same
source as unfenced text above the card, while chat already renders a fenced
```` ```mermaid ```` block with the full viewer (zoom, full screen, SVG and
draw.io export). The model decides alone, so the policy lives in the
artifact instructions (`buildArtifactInstructions`) and in both
`create_artifact` descriptions (chat tool and MCP tool):

- Create an artifact only when the user asks for an artifact, an app, an
  interactive page, a quiz, flashcards, a game or a dashboard, or for a
  long, structured document (study guide, report, cheat sheet) or an SVG
  image.
- Everything else goes in the reply: a diagram as a fenced
  ```` ```mermaid ```` block, code of any length (functions, scripts,
  config) as fenced code blocks. An explicit "create an artifact with a
  diagram" still creates one.
- `update_artifact` only when the user refers to an artifact from this
  chat; a new, unrelated request is not an edit.
- After writing an artifact, one or two sentences; never its source,
  fenced or not.

Cost: input tokens of the single-step `no-artifact-snippet` send on pr-784
grew from 5,206 to 5,304 (Claude Haiku 5.5, +98) and from 2,872 to 2,948
(GPT-6 Luna, +76). The delta also contains the BES-332 `update_artifact`
description that merged in at the same time. Gemini was not run
(below). The text stays in the cached system-prompt prefix.

Run on 2026-11-09 against pr-784 at `7c6b2280`, the full golden set (24
cases), same test account, reasoning off. "yes"/"no" is whether an
artifact was created; "ok" means it matches the expectation and every
static check passed (`interactive` stays pending without the browser
spec). Spend about **$0.075** (Claude $0.050, GPT $0.025).

| Case | Expected artifact | Claude Haiku 5.5 | GPT-6 Luna |
| --- | --- | --- | --- |
| mermaid-flowchart | no | no (ok) | no (ok) |
| mermaid-diagram-uk | no | no (ok) | no (ok) |
| owner-mermaid-uk (+ "будь-яку, два трикутники") | no | no (ok) | no (ok) |
| small-diagram | no | no (ok) | no (ok) |
| small-diagram-uk | no | no (ok) | no (ok) |
| typescript-function | no | no (ok) | no (ok) |
| typescript-function-uk | no | no (ok) | no (ok) |
| bash-script | no | no (ok) | no (ok) |
| bash-script-uk | no | no (ok) | no (ok) |
| no-artifact-snippet | no | no (ok) | no (ok) |
| explicit-artifact-mermaid | yes | yes (ok) | yes (ok) |
| explicit-artifact-uk | yes | yes (ok) | yes (ok) |
| interactive-quiz-short | yes | yes (ok) | yes (ok) |
| markdown-study-guide, cheat-sheet-git, svg-cell-diagram | yes | yes (ok) | yes (ok) |
| 8 quiz, chart, bridge and edit cases | yes | yes (ok, 7); flashcards-storage fails `storage` | yes (ok) |
| **Negatives / positives** | | **10/10 / 14/14** | **10/10 / 14/14** |

- Every negative answered with a fenced block (`inline-mermaid` or
  `inline-code`), and no reply printed source outside a fence or repeated
  an artifact (`no-source-echo`). The owner's prompt got a sample
  flowchart in the first turn and two triangles as a fenced block after
  the follow-up, on both models.
- Claude Haiku's `flashcards-storage` artifact never calls
  `besidka.storage`, although the reply says progress is saved. It passed
  in the earlier runs and is unrelated to this policy; noted for the next
  tuning round.
- `no-artifact-snippet` checks only `no-artifact`: GPT-6 Luna answers the
  one-liner in inline backticks, which is fine.
- Gemini 3.8 Flash: not run. The test account's Google key reached the
  owner's spend cap (every send returned HTTP 500 "provider-unavailable"
  from about 17:45 UTC). Owner instruction: no more Gemini sends for
  evals; Claude Haiku 5.5 is the main eval model (Claude Sonnet 5.5 only
  when a case needs a stronger model) and GPT-6 Luna the second provider.

## Design system in artifacts

HTML and React artifacts look like Besidka: the runtime loads Tailwind CSS 4
and daisyUI 5 with the Besidka light and dark themes (generated from
`app/assets/css/main.css`) and the Nunito font, and the model writes class
names instead of a design system of its own (A-15, Linear BES-321). Runtime
details, the measured JIT-versus-precompiled decision, sizes and integrity:
`docs/artifacts-runtime.md`, "Design system".

### Why vendored

Artifacts have no network (`connect-src 'none'`, and a CDN would be a
third-party recipient for the DPIA), so the CSS cannot come from the
daisyUI CDN pair. The model never fetches or inlines it either: the runtime
ships it once from its own origin (one lazy chunk, 105 KiB brotli, cached
`immutable`) and the artifact source stays small. The CSP is unchanged.

### Instruction sheet

`ARTIFACT_DESIGN_INSTRUCTIONS` in `server/utils/ai/artifact-tools.ts` is a
compact rule and component sheet condensed from the daisyUI 5 component
reference (llms.txt): no CDN or fonts, class names over CSS, the theme
colour names and what each is for, no fixed colours or `dark:` variants
(the host theme switches the frame), the common components with their parts
and modifiers, one example, padding, a short `<style>` only for what classes
cannot do, and accessibility. It is appended to the artifact instructions
only when `html` or `react` is an allowed kind, and those instructions are
only sent when the artifact tools are registered for the send, so chats
without artifacts pay nothing. It stays in the cached system-prompt prefix
(it depends only on the allowed kinds). The `create_artifact` kind
description now says "styled with daisyUI and Tailwind classes" instead of
"inline CSS". The MCP `create_artifact` tool says the same since BES-333
(MCP 3.0.1).

Size: 2,750 characters, 347 words when measured below; about 2,535 since
BES-335 dropped the dark `primary`/`neutral` sentence
(`artifact-tools.spec.ts` caps it at 4,000). Measured cost per send, from the input tokens of the single-step
`no-artifact-snippet` case (artifact tools on, no artifact written) on
pr-773 (before) and pr-784 (after): the artifact instructions grew by
3,197 characters, 2,750 of them the sheet, and input tokens grew by 1,168
(Claude Haiku 5.5), 780 (GPT-6 Luna) and 831 (Gemini 3.8 Flash). The sheet
alone is therefore about 1,000, 670 and 715 tokens, under the 1.5k target.
It is English whatever language the user writes in, so the Cyrillic
multiplier from `docs/memory-architecture.md` does not apply to it; a
Ukrainian chat pays the same sheet. A send that writes an artifact makes
a second model call (the follow-up turn), so it pays the sheet twice, both
inside the cached system-prompt prefix where the provider caches.

Dark `primary` and `neutral` (BES-335). In the app's dark theme both equal
`base-100` (stone-800), so `text-primary`, `progress-primary`, `bg-primary`
chart bars or a `badge-neutral` disappeared in dark artifacts: the first
pr-784 run used them in 22 of 26 html and react artifacts (Gemini's Git
cheat sheet had 22 invisible `text-primary` commands). A sheet rule
("primary and neutral for buttons only") cut that to 1 of 11. The fix is
now in the theme instead: the artifact dark theme inverts `primary`
(stone-100 fill, stone-800 content: 13.9:1, and 13.9:1 against the page)
and lifts `neutral` to stone-700 (9.4:1 with its content), see
`docs/artifacts-runtime.md` "Theme sync". The sheet rule shrank to
"neutral (fills only)", because stone-700 text on the stone-800 page is
only 1.5:1. The app theme is unchanged.

### Updating the theme

1. Change the `light` or `dark` `@plugin "daisyui/theme"` block in
   `app/assets/css/main.css`.
2. `pnpm run artifacts:theme` regenerates
   `workers/artifacts-runtime/src/design/theme.generated.ts`. A new token
   makes the script stop until it is listed in `DAISYUI_TOKENS` (mirrored
   into artifacts) or `APP_ONLY_TOKENS` (app chrome only) in
   `workers/artifacts-runtime/scripts/theme.mjs`. Dark `primary`,
   `neutral` and their `*-content` come from `ARTIFACT_THEME_OVERRIDES`
   in the same script; `design.spec.ts` fails when `main.css` changes
   them, so the override gets a second look.
3. `pnpm vitest run tests/unit/workers/artifacts-runtime/design.spec.ts`
   (it fails while the generated file is stale) and commit both files.

A new app-wide daisyUI component override in `main.css` (like the textarea
radius) is copied by hand into `BESIDKA_COMPONENT_OVERRIDES` in
`workers/artifacts-runtime/src/design/stylesheet.ts`.

Upgrading `tailwindcss`, `daisyui` or `@fontsource/nunito` in the runtime
fails its build until the new digests are recorded (`pnpm --filter
artifacts-runtime build --update-integrity`); re-run the evals below first.

### Results

Run on 2026-11-09 against preview `pr-784` (stack top with A-15), the same
test account and models as run 1, 13 cases per model, then a re-run of
`bar-chart-csv`, `quiz-photosynthesis`, `cheat-sheet-git`,
`exam-prep-timer` and `no-artifact-snippet` after the `primary`/`neutral`
rule (those five use the re-run). Three sends of the first run timed out
in the harness (Claude Haiku `mermaid-flowchart` and `network-temptation`
after generating, GPT-6 Luna `quiz-photosynthesis` before) and were
re-run once. About **$0.60** in total ($0.42 first run, $0.006 timeouts,
$0.18 re-run).

| Case | Claude Haiku 5.5 | GPT-6 Luna | Gemini 3.8 Flash |
| --- | --- | --- | --- |
| quiz-photosynthesis | pass, react, 10 classes $0.0030 | fail (`interactive`, harness), html, 10 $0.0019 | pass, react, 27 $0.0285 |
| exam-prep-timer | pass, react, 14 $0.0037 | pass, html, 14 $0.0020 | pass, react, 44 $0.0414 |
| flashcards-storage | pass, html, 17 $0.0034 | pass, html, 22 $0.0021 | pass, react, 45 $0.0406 |
| graded-free-text | pass, html, 13 $0.0030 | pass, html, 19 $0.0017 | pass, react, 31 $0.0263 |
| bar-chart-csv | pass, react, 13 $0.0020 | pass, react, 7 $0.0009 | pass, react, 21 $0.0188 |
| cheat-sheet-git | pass, html, 9 $0.0028 | pass, markdown $0.0008 | pass, html, 27 $0.0683 |
| edit-flow | pass, react, 13 $0.0026 | pass, html, 14 $0.0019 | pass, react, 25 $0.0384 |
| quiz-ukrainian | pass, html, 16 $0.0028 | pass, html, 15 $0.0019 | pass, react, 20 $0.0254 |
| network-temptation | pass, react, 22 $0.0032 | pass, html, 17 $0.0016 | fail (`interactive`, harness), react, 22 $0.0235 |
| mermaid-flowchart | pass $0.0011 | pass $0.0005 | pass $0.0109 |
| markdown-study-guide | pass $0.0016 | pass $0.0008 | pass $0.0125 |
| svg-cell-diagram | pass $0.0058 | pass $0.0017 | pass $0.0657 |
| no-artifact-snippet | pass $0.0007 | pass $0.0004 | pass $0.0027 |
| **Passed, total** | **13/13**, $0.036 | **12/13**, $0.018 | **12/13**, $0.403 |

"Classes" counts distinct daisyUI-specific classes and theme colour
utilities in the artifact (`btn-*`, `card-body`, `badge-*`, `bg-base-200`,
`text-base-content/70` and so on), a rough proxy that the screenshots in
#784 confirm. Run 1 artifacts had none: Claude and GPT wrote their own CSS
under names like `.card` and `.btn`, and Gemini wrote Tailwind classes that
had no CSS, so its React artifacts rendered unstyled.

- Claude Haiku 5.5 passes both cases it failed in run 1 and the tuned
  re-run: no `fetch()` (not even in a comment) and no placeholder artifact
  next to the Mermaid diagram. It now picks `react` for most quizzes.
- Gemini 3.8 Flash `network-temptation` and GPT-6 Luna
  `quiz-photosynthesis` fail `interactive` because the harness only counts
  text changes: both quizzes first highlight the chosen answer (a class
  change) and change text only after "Check answer" or "Submit", and
  Gemini's first button opens the host link dialog. Both work in the
  screenshots the spec saved. A follow-up could let the harness count
  class changes too.
- GPT-6 Luna answers the cheat sheet with a Markdown artifact, which is an
  allowed kind and untouched by the design system.

Artifact size, the same 11 cases with an artifact in both runs (run 1 on
pr-773 versus this run): average **9,161 to 8,341 bytes** (-9%). For the 8
html and react cases only: **10,869 to 9,407 bytes** (-13%; Claude 7,649
to 6,188, GPT 7,095 to 6,805, Gemini 17,862 to 15,229), and the inline
`<style>` blocks shrink from 1,262 to 48 bytes on average. Run 1 predates
the A-10 tuning, so `network-temptation` also differs for that reason.
`cheat-sheet-git` is new in A-15 and has no "before". SVG sizes (Gemini
17 to 26 KB) vary run to run and the design system does not touch them.

Rendering (`interactive`, 15 html and react cases with a check): 13 pass,
2 fail on the harness limit above; every artifact initialised in 197 to
2,218 ms. On iOS: the deployed preview renders the Git cheat sheets and
the React quiz in Safari on the iOS 27 simulator in light and dark (opened
through artifact share links, no sign-in needed); the home-screen PWA mode
was not checked.

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
