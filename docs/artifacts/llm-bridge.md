# Artifact LLM bridge (A-6, BES-265)

`window.besidka.complete(prompt, { system, maxOutputTokens })` lets an
artifact (a grading quiz, a hint generator) ask a model. The sandbox has no
network, so the runtime sends `besidka/complete` on its MessagePort; the
parent shows a confirmation modal, and Besidka calls the model on the
**viewer's own direct provider key**. Nothing runs without the viewer's
click.

## Who gets `complete()`

`resolveArtifactBridgeEnabled()` (`app/composables/artifact-bridge.ts`)
advertises `capabilities.complete = true` only when the viewer is signed in,
`useFeature('artifacts.llm-bridge').active` is true, the panel was opened
from the viewer's own chat and the artifact is saved. Otherwise the Frame
passes no `complete` handler: the protocol answers `-32601` and the runtime
says "AI completions are not available here", so artifact code can hide its
AI buttons.

The registry gives the flag `spend: 'foreground'`, and `internalFeature`
turns every spending flag into `optIn: 'required'`. A grant alone is not
enough: the viewer also needs the Labs toggle on (`feature_opt_ins`). The
ticket expected `optIn: 'none'` but said to follow the registry if it
differs; it does.

## Flow

1. Artifact calls `complete(prompt, { system?, maxOutputTokens? })`. The
   protocol guard allows a prompt of 1 to 8,000 characters, `system` up to
   2,000 and `maxOutputTokens` up to 2,000 (`CompleteParams.system` is new
   and optional, `PROTOCOL_VERSION` stays 1). The host forwards only these
   three fields; the artifact never picks the model.
2. `useArtifactBridge().complete` holds the request open (the runtime waits
   up to 5 minutes) and shows `BridgeConfirm.client.vue`. One request at a
   time: another call while the modal is open gets `-32012`.
3. The modal loads `GET /api/v1/artifacts/<id>/bridge` (eligible models,
   default, remaining calls) and shows, per the A-9 and A-12 acceptance:
   the artifact title, "The author of this artifact wrote these prompts,
   not you and not Besidka.", the full prompt (scrollable, up to 8,000
   characters), the exact system text (Besidka's prefix plus the artifact's
   own, from the shared `buildArtifactBridgeSystem()`), provider and model,
   the maximum output tokens, an upper cost estimate, remaining calls, and
   that the provider's terms apply. Invisible and direction-changing
   characters (zero-width, bidi overrides, tag characters, variation
   selectors) are shown as `[U+202E]` markers so the preview cannot hide or
   reorder text; what is sent is unchanged.
4. Cancel, Esc or closing the frame rejects with `-32011` (declined). Allow
   posts `POST /api/v1/artifacts/<id>/complete` and resolves `{ text }`.
   Errors stay inline in the modal (`Try again` or Cancel, which rejects with
   the mapped code).
5. Cancel has focus on open, and a keyboard "click" on Allow in the first
   500 ms is ignored, so an Enter already in flight from the composer cannot
   confirm.
6. "Don't ask again for this artifact until I close it" (owner chats only,
   never through a share link): later calls in the same frame session skip
   the modal with the chosen model. A failed remembered call forgets the
   choice, so the next call asks again. Nothing is persisted.

## Server

`complete.post.ts` order: `requireFeature('artifacts.llm-bridge')` →
session → params and body (zod) → `resolveArtifactViewerAccess` (owner only
until A-7; `bridgeAllowed`) → `readLegalConsent` + `assertLegalConsent` →
model must be a direct provider (`getModel`; gateways and unknown ids fail)
→ `assertProviderTransferConsent` (DeepSeek, Moonshot AI, Qwen) → saved key
for that provider (`readAvailableKeys`, `findArtifactBridgeModel`) else 400
`bridge_no_key` → caps → `instantiateDirectModel` (reasoning minimal:
OpenAI `low`, others `off`) → `generateText` with no tools, no memory, no
history, no web search, `AbortSignal.timeout(30s)`.

| Cap | Value | KV key (prefix `artifact-bridge`) |
| --- | --- | --- |
| Per viewer per day | 200 | `day:<viewer>` (checked first) |
| Per viewer and artifact per hour | 30 | `hour:<viewer>:<artifact>` |

Refusals are 429 with `Retry-After` and a `why` naming the cap. Failed
provider calls count against the caps (abuse bound). A call refused by the
hourly cap has already taken a daily slot; the reverse (a daily refusal
using an hourly slot) cannot happen.

Provider errors become 502 with the normalised `why`, so a provider 401 or
429 is never confused with Besidka's own session or caps.

Cost: `buildMessageUsage()` with `getModelCostMap()` gives `costUsd` (null
when the model has no price). The wide event carries
`attributes.artifactBridge = { origin: 'artifact-bridge', artifactId, mode,
modelId, providerId, inputTokens, outputTokens, costUsd, durationMs,
finishReason }`, on failure `error` (the exception name only, never its
message, which could echo the prompt) and `providerStatus`. Analytics
Engine gets `blobs: ['artifact_bridge_call', providerId, modelId,
'ok' | 'error']` with no user id. Prompts and answers are never stored or
logged.

`GET /api/v1/artifacts/<id>/bridge` returns the viewer's direct-provider text
models (providers with a saved key and, for transfer providers, consent;
not retired, research or image models), each with its per-million prices,
the default (`resolveCheapestDirectModel`, the same order and
`forProjectMemory` models the memory fallback uses), remaining calls and
the limits.

`server/utils/ai/resolve-cheapest-model.ts` is the extraction the ticket
asked for: `readAvailableKeys`, `resolveCheapestDirectModel` and the
direct-provider switch `instantiateDirectModel` moved out of
`server/utils/memory/resolve-model.ts`, which now calls them; memory
behaviour is unchanged (its specs pass untouched).

## Error codes seen by artifact code

| Server | JSON-RPC | Runtime message |
| --- | --- | --- |
| Cancel, Esc, frame closed | `-32011` | The viewer declined this AI completion. |
| 429 (caps) or a second open request | `-32012` | Too many AI completions. Try again later. |
| 403 legal or transfer consent | `-32010` | The viewer has not allowed AI completions for this artifact. |
| other 4xx (no key, not owner) | `-32013` | AI completions are not allowed for this artifact. |
| 5xx | `-32603` | The AI completion failed. |

The ticket proposed `-32001 bridge_unavailable`; `-32001` is the protocol's
timeout code, so an unavailable bridge is `-32601` (no handler) and refusals
use the codes above.

## Not in this layer

Share links (`bridgeAllowed` per share, no "Don't ask again" there): A-7.
Streaming, tools, images, gateways, a host-paid model and MCP access are out
of scope (MCP never spends keys).
