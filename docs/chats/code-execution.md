# Provider-native code execution ("Run code")

Status: built for BES-300 (D-7), flags `code-execution` and
`code-execution.files` at stage `internal`.

Besidka never runs the code. The provider runs it in its own sandbox on the
user's own key; Besidka enables the tool, shows the code and its output,
downloads the files the sandbox produced, and deletes everything it put at
the provider.

## Where it works

Direct Anthropic, OpenAI and Google models only, and only the models whose
provider page lists the tool (`code_execution` in `providers/*.ts`, checked
2026-11-11): every curated Claude model; every OpenAI model except `o1`, the
Deep Research, image and pre-4.1 legacy models; every Gemini text model.
Gateway models, xAI, DeepSeek, Moonshot AI and Qwen are refused with a 400
(`resolveCodeExecutionGate`). Gemini 2.5 models run it exclusively (no app
tools), because mixing it with function calling is only documented for
Gemini 3 and 4.

## Consent and the gate

`code-execution` has `spend: 'foreground'`, so the registry forces
`optIn: 'required'`: the user opts in on Labs (default off) and the composer
row is off for every message. The send path drops the tool, silently and
before anything is registered, when the evaluator says the feature is not
active for the user. The flag must stay at `internal` until the owner decides
whether the Terms mirror the provider rules on malware, DoS and critical
infrastructure (pre-check D-10, `docs/legal/prechecks/documents.md`).

## Send path

| Step | Code |
|---|---|
| Gate, key, input uploads | `server/utils/code-execution/send.ts` |
| Tool registration | `server/utils/providers/{anthropic,openai,google}.ts` (the tool key is always `code_execution`) |
| Stream transform | `server/utils/code-execution/stream.ts` |
| Compact form | `server/utils/code-execution/compact.ts`, `shared/utils/code-execution.ts` |
| Output files | `container-files.ts`, `file-types.ts`, `persist-container-files.ts` |
| Document validation seam | `document-validation.ts` |
| Provider cleanup | `provider-cleanup.ts` |
| Cost | `server/utils/ai/code-execution-cost.ts` |

The stream transform sits between the AI SDK UI stream and its two readers
(the client and the persistence reader), so both see the same safe chunks:

- every run is reduced to `{ language, code }` and `{ stdout, stderr,
  returnCode }`, each capped at 32 KB with a truncation marker; encrypted
  Anthropic stdout, provider file ids, container ids and OpenAI image URLs
  never leave the server;
- files are collected (Anthropic result `file_id`s, OpenAI
  `container_file_citation` source chunks), downloaded at the end of each step
  with the user's key, and announced as ordinary `file` chunks plus one
  `data-code-execution-files` chunk for the skipped ones;
- `finalizeCodeExecutionParts` runs again on the finished message before the
  insert, as a safety net.

## Output files

Allowlist: `png jpg webp csv tsv txt md json pdf docx xlsx pptx`, by
extension and magic bytes. `gif` is not allowed (the AI marking cannot mark
it), nor `svg`, `html`, archives or executables. At most 10 files and 20 MB
each per reply, downloaded one at a time, 30 s each, `redirect: 'manual'`
(a redirect is a failure), size checked from `Content-Length` and while
streaming. Images go through `markAiGeneratedImage`; PDF and Office files go
through `checkContainerDocument`, a seam over `@besidka/doc-renderer`:
`validate()` (structural parse) then `stampDocument()`. A file that validates
but cannot be stamped is stored unchanged and counted as
`provenanceMissing` in the wide event. Every file is a private `assistant`
file with `originProvider` and `originModel`, so it carries the AI badge, and
its URL is marked generated.

Anthropic's container files are only returned from the top level of
`$OUTPUT_DIR`; OpenAI's come from the container the code ran in. The system
instruction tells the model both.

## What Besidka deletes at the provider

| Provider | Created by Besidka | Deleted |
|---|---|---|
| Anthropic | input uploads (`expires_in_seconds: 3600`), the files the sandbox produced | `DELETE /v1/files/{id}` for both |
| OpenAI | input uploads (`expires_after` one hour), the container | `DELETE /v1/files/{id}`, `DELETE /v1/containers/{id}` |
| Gemini | nothing (attachments go inline) | nothing |

Deletion starts when the stream ends (after the `finish` chunk reached the
client, without holding persistence), is awaited in the route's `finally`, and
also runs in the provider-setup failure path, with the user's key. `cleanup()`
is idempotent, concurrent callers share one run, it never throws, and it logs
counts only (`attributes.codeExecutionCleanup`). If the Worker is killed
mid-send (a tab close, see `docs/chats/stuck-generation-guard.md`) or a
route step between the session start and the stream throws, nothing runs;
the backstop is the one hour expiry on every upload (Anthropic
`expires_in_seconds`, OpenAI `expires_after`) and OpenAI's 20 minute idle
expiry of containers. The files Anthropic's sandbox produces carry no expiry
Besidka can set, so in that case they stay in the user's Anthropic workspace
until the user deletes them there.

Not deletable: Anthropic keeps container data up to 30 days and offers no
container delete. The copy of an uploaded file inside the container is
provider-side data, not a Files API object.

OpenAI's `network_policy` is never set; a spec asserts the tool carries no
network field. Anthropic and Gemini sandboxes have no internet access.

## Input files (`code-execution.files`)

The attachments of the current message are uploaded for Anthropic (handed to
the container as `container_upload` blocks) and OpenAI (`fileIds`); Gemini
takes them inline. Maximum 10 files and 20 MB in total; only files the user
owns. Anthropic bills attached files even when no code runs.

The system instruction names the attached files and tells the model to find
them with a directory listing and read them in code instead of retyping what it
saw in the conversation (`buildCodeExecutionInstruction`). CSV and TSV are
accepted as uploads (`text/csv`, `text/tab-separated-values`, see
`docs/files.md`), because they are the main input.

OpenAI mounts an uploaded file as `<file id>-<original name>`. Code, stdout and
stderr are stored and shown with that prefix removed, so the user sees their
own file name and no provider id (`redactProviderFileNames`); the code that
ran at the provider still used the mounted name.

Provider ids stay out of the stored message in every place the AI SDK puts
them: the `source-document` chunk, the text part's `annotations` metadata and
its `citations` list (`stripContainerFileReferences`). The tool call id
(`srvtoolu_…`, `ci_…`) and message id (`msg_…`) are kept; they give no access.

## Cost

Always recorded: `attributes.codeExecution { provider, calls, containers,
files, bytes, skipped }`. The cost only when computable: OpenAI per container
session from `NUXT_PUBLIC_OPENAI_CODE_INTERPRETER_COST_PER_SESSION_USD`;
Anthropic `null` (free container hours belong to the organisation and the
response carries no billable usage); Gemini 0 beyond tokens. The composer
note reads the public rates from the same config. The message usage line in
the UI is unchanged.

## Known limits

- `pause_turn`: the AI SDK maps Anthropic's `pause_turn` to a plain stop, and
  a send without app tools is a single step, so a very long container run ends
  instead of continuing. The user can ask it to continue.
- Anthropic web search `20250305` is used, so container time is billed; the
  free-with-search rule needs `web_search_20260209` or later.
- Prompt-cache impact of the extra tool definition is unmeasured.
- Container CSV files are stored as produced; the CSV formula-injection
  residual of `docs/legal/prechecks/documents.md` (item 5) applies when a user
  opens one in a spreadsheet.
