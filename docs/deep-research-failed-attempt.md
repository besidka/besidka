# Deep Research — abandoned attempt (post-mortem)

**Status:** stopped and closed (PR #291, branch `worktree-deep-research`). Not merged.
**Date:** 2026-07-08.
**Why you're reading this:** so the next attempt doesn't repeat the mistake, and so
the (real) path forward is written down while it's fresh.

## TL;DR

We built a "deep research" mode on top of **provider-native web search**
(OpenAI Responses `webSearch`, Google `googleSearch` grounding + `urlContext`) driven
by an **AI SDK v7 `streamText` agentic loop** — `prepareStep` forcing more searches,
`stopWhen` at a source target, per-depth step/source budgets, a live progress
timeline, and a clarifying-questions form.

It doesn't deliver. The agentic loop **cannot iterate** with provider-native search,
so the multi-step machinery is dead code and the shipped behaviour is effectively
*one grounded model call + high reasoning + cosmetic progress chips* — indistinguishable
from just enabling web search with high reasoning. A "thorough" run produced ~8 sources,
2 nominal steps, ~34s. The only genuinely new, valuable piece was the clarifying-questions
form.

The constraint that pushed us to provider-native search ("don't require users to add a
third-party search key") turned out to be a false dichotomy: **OpenAI and Google now sell
full deep-research *agents* as API primitives that run on the user's own key.** That — not
a homebrew loop, not a Tavily/Exa key — is how a real version should be built.

## What we set out to build

A ChatGPT/Gemini-style "deep research" mode for a BYO-API-key chat app: the user asks a
question, optionally answers clarifying questions, and the system runs a multi-step,
multi-source web investigation and returns a cited report, with live progress and a
push notification on completion.

## What we actually built

- A `deep_research` tool/depth (quick / standard / thorough) with per-depth budgets
  (`maxSteps`, `maxSearches`, `targetSources` in `shared/utils/research.ts`).
- A research branch in the chat streaming endpoint that ran `streamText` with:
  - `prepareStep` pinning `toolChoice` to the search tool for the first N−1 steps to
    "force" more searches, releasing for synthesis on the last step;
  - `stopWhen: [stepCountIs(maxSteps), <sources ≥ target>]`;
  - a Worker-side dedup **source registry** feeding the stop predicate;
  - `pruneMessages` for context management.
- A clarifying-questions endpoint (`generateObject`) + an interactive form.
- A "Deep research" progress container (timer, step list, nested reasoning, sources).
- Reuse of the existing web-push + KV in-flight-guard + #263 replay for completion/resume.

## Why it didn't deliver — the core reason

**Provider-executed search resolves inside a single model step.** OpenAI's Responses
`webSearch` and Google's `googleSearch` grounding run *on the provider's servers within
one response*: the model searches, reads the provider's snippets, and finishes generating
in the **same** step, ending with `finishReason: 'stop'`.

The AI SDK `streamText` loop only takes another step when there is an **unresolved
client-executed tool call** to satisfy (i.e. a tool with an `execute()` you run, whose
result must be fed back). Provider-executed tools have no such round-trip. So:

- Step 1 finishes with the answer → the loop **terminates**.
- `prepareStep` for step 2 **never runs** → the `toolChoice` forcing never happens.
- `stopWhen`, `maxSteps: 20`, `targetSources: 55`, `maxSearches` — **never exercised**.
- The "Planning the research" chip was emitted `status: 'done'` *before the model ran*,
  and "Writing the report" was the single real step. The milestone system was cosmetic.

`stepCountIs(n)` is a **ceiling/safety valve, not a driver**. Raising it does nothing
unless the model keeps issuing *client* tool calls. It doesn't, because search is hosted.

**The wrong assumption, precisely:** *"a high step budget + forced `toolChoice` makes the
model search repeatedly."* True for **client-executed** tools; false for **provider-executed**
search. Every iteration built on that premise. It was never verified at runtime — the
user's real run (2 steps, 8 sources) was the ground truth the whole time.

**Provider asymmetry made it worse.** Even where forcing *could* apply, Google's
`googleSearch` is grounding *config*, not a callable function — per-step `toolChoice`
forcing is ignored there. So the loop was doubly unable to iterate on Gemini.

## Secondary issues found (symptoms of the same root)

- **Duplicate research block:** a `data-*` progress part was written to the stream
  **before** the `start` chunk, so it attached to a client-generated message id; the later
  `start` (server id) flipped the id and the SDK pushed a *second* assistant message. Fixed
  by emitting `start` first (this fix is worth keeping regardless — see below).
- **Reasoning never shown:** the depth→reasoning-effort mapping reached the model, but
  `sendReasoning` and the persisted `reasoning` column were gated on the *raw reasoning
  toggle* (default off), not the *effective* level — so reasoning was silently dropped from
  the stream, the context menu, and the nested UI.
- **Misleading copy:** the planning chip hardcoded "…toward about 55 sources," which the
  run never approached (8).
- **Useless step detail:** synthesizing step's `detail` echoed its title verbatim.
- **iOS app-switch false "Retry":** research progress parts were classified as a
  "completed reply" by the recovery heuristic, and the disconnect-error allowlist missed
  Safari's wording, so a still-running run latched a terminal Retry.

Most of these are only "bugs" because the feature pretended to be multi-step. Descoping
removes the class of problem, not just the instances.

## How real deep research actually works

Genuine depth (ChatGPT Deep Research, Gemini Deep Research, Perplexity, gpt-researcher,
LangChain open_deep_research) shares five ingredients — none of which is "prompt a single
grounded chat call harder":

1. Explicit planning / query decomposition.
2. A **search layer you can call dozens–hundreds of times** with result-count control.
3. A **read/fetch layer that ingests full pages** (not just search snippets).
4. A **reflection loop** deciding what's still missing and searching again.
5. Synthesis over an accumulated evidence store.

| System | How | Sources | Runtime | Cost/run |
|---|---|---|---|---|
| ChatGPT Deep Research | RL-trained o3 browsing agent | hundreds | 5–30 min | quota / API below |
| OpenAI DR API (`o3-deep-research`, `o4-mini-deep-research`) | agent via Responses API, background mode | dozens–hundreds | 2–10+ min | o3 ≈ $10 avg; o4-mini ≈ $1 |
| Gemini Deep Research (Interactions API, `deep-research-preview`) | dedicated agent, plan approval, Search + URL Context | ~80–160 searches; "hundreds of sites" | <20 min | $1–3; Max $3–7 |
| Perplexity `sonar-deep-research` | search/read/evaluate loop on own index | dozens | 2–5 min | ~$0.4–1+ |
| gpt-researcher (OSS) | planner→parallel executors→publisher, Tavily retriever | 20+ | ~3 min | ~$0.005–0.4 |

Provider-native grounding gives ~5–15 sources per call with **no count knob** and resolves
in one turn. Its realistic ceiling — even with server-side query fan-out + a `urlContext`
read pass + a reflection wave — is "Perplexity-lite," ~30–70 sources, and that middle tier
is a dead end you'd throw away for the real thing.

## The unlock we missed

Both of this app's providers now expose **the entire deep-research loop as an API
primitive, billed to the user's own key**:

- OpenAI **`o4-mini-deep-research`** (default, ~$1/run) / **`o3-deep-research`** (~$10/run)
  via the Responses API in **background mode** (kick off, poll/webhook, fetch result).
- Google **Gemini deep-research agent** via the **Interactions API** (`background=true`,
  built-in plan approval — which maps directly onto our clarify form).

So "we don't want to add a Tavily/Exa key" never actually required shallowness. It points
*toward* these agents. The right architecture is an **async job** (not a synchronous stream):
start the job, store its id in D1, let the client poll, and fire the **existing** "your
research is ready" web-push on completion. Cloudflare Workers shouldn't hold a 20-minute
stream anyway.

## Decision

Stopped. PR #291 closed without merging. Reasons: the provider-native implementation is
feature-theatre, evolving it (server-side fan-out) is a dead-end middle tier, and a
third-party search key breaks the BYO-key product model and shifts cost onto the operator.
The honest, high-value path is a future rebuild on the providers' own DR agents.

## Worth salvaging (do not re-derive)

- **The clarifying-questions flow** (`generateObject` + interactive form). It's the one
  piece users reacted to positively, and it's the front door for the provider agents'
  plan-approval step.
- **The stream-lifecycle fix**: always emit `{ type: 'start', messageId }` *before* any
  `data-*` part, or the client splits a phantom message.
- **The reasoning-exposure fix**: `sendReasoning` / persisted reasoning must key on the
  *effective* level actually sent to the model, not the raw UI toggle.
- **The research in this repo's history** (competitor architectures, provider limits,
  Cloudflare execution options) — see PR #291 discussion and the session memory.

## Lessons

1. **For any agent/loop feature, trace how many steps actually fire at runtime before
   building UI/budgets around iteration.** A single log line would have caught this on day one.
2. **Provider-executed vs client-executed tools is a load-bearing distinction.** Only
   client-executed tools (with `execute()`) create the round-trips that make a loop loop.
3. **Get an independent, adversarial review of the *premise* early**, not just the code —
   the code was clean; the premise was wrong.
4. **Prefer the platform's high-level primitive** (provider DR agents) over reimplementing
   an agent loop on low-level grounding tools.
