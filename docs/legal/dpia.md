# Data protection impact assessment (DPIA): Besidka

> **Engineer-drafted. Not reviewed by a lawyer.** This is a reasoned position
> by the person who built the service. It is not legal advice. The questions
> most worth a Polish `radca prawny` are listed in section 7.

| Field | Value |
|---|---|
| Controller | [OWNER NAME], a natural person, Poland |
| Service | Besidka, a non-commercial, open-source, bring-your-own-key AI chat |
| Version | 1.10, 2026-11-12 (Office attachments, BES-370: data-flow row 16); 1.9, 2026-11-11 (documents and provider code execution: new section 3.14, data-flow steps 15 to 19, `create_document` in section 3.11 and risk row 37, risk rows 61 to 72, section 6 items 24 to 27, DPF re-check in item 5; 1.8, 2026-11-08: artifacts: new section 3.13, data-flow steps 10 to 14, section 4 rows, risk rows 49 to 60, section 6 items 20 to 23; 1.7, 2026-11-08: feature access, gradual rollouts and experiments: sections 3.9, 3.10, 3.11, new 3.12, 4, new 4.1, risk rows 38 to 48, section 6 items 16 to 19; 1.6, 2026-10-30: a project can turn background extraction on or off for itself: sections 3.4, 3.5, 3.11 and 4; 1.5, 2026-10-30: approval cleanup now waits 30 days without use instead of a day, and an unreadable approval fails closed: section 3.11; 1.4, 2026-10-30: the user can remove an app's permissions, approval cleanup sweep: section 3.11, risk rows 33, 36 and 37; 1.3, 2026-10-30: connected apps reach files and settings and can change and delete: section 3.11, flow row 7, risk rows 36 and 37; 1.2, 2026-10-29: connected AI apps over OAuth and MCP, section 3.11 and risk rows 28 to 35; 1.1, 2026-10-28: share defaults off, avatar proxy, self-hosted fonts and icons, copyright and report handling, risk rows 25 to 27) |
| Next review | On any material change (section 8), and at least every 12 months |
| Sibling document | `docs/legal/art30-record.md` (record of processing activities) |

**State assessed.** This DPIA assesses the release that ships the consent gate
(version `2026-11-a`), the Art. 49(1)(a) transfer consent, the memory feature
and the rewrite of the Privacy Policy, Terms of Use and Cookie Policy of
2026-10-26. The Status column in section 5 says what is `built` in this release
and what is still `planned`. Where a measure is "planned", read the risk as
**open** until it ships. The conclusions hold only while the consent gate and
the transfer consent stay in place. Do not publish text that claims a consent
the app does not collect.

**Added 2026-10-29.** Section 3.11 and risk rows 28 to 35 assess connected AI
apps (Besidka as an OAuth 2.1 authorization server for its MCP server at
`https://besidka.com/mcp`). That release has been in production since
2026-10-29 (#588), so rows 28 to 34 are `built` (their `[U]` items stay open)
and row 35 stays `planned` until it is verified. Rows 36 and 37 (2026-10-30)
are `built` on `feat/mcp-ui-parity` and count as shipped only when that branch
is deployed. The consent gate text and `CURRENT_CONSENT_VERSION` are
unchanged.

**Added 2026-10-30.** Connected apps can now also read files and settings and,
with separate write scopes, rename, move and branch chats, update projects and
knowledge, create and rename text files and change a short list of settings,
and with the separate `data:delete` scope delete chats, messages, projects,
knowledge, files and memory and reset memory (section 3.11, risk rows 36 and
37). No new recipient or purpose, and nothing that spends the user's API keys.
The step that matters for the risk is that deletions are permanent. Corrected the
same day: section 3.11 and rows 28 to 34 are `built` (in production since
2026-10-29), and row 33 no longer holds, because disconnecting stops an app on
its next call.

**Added 2026-10-30 (permission removal).** A user can now remove an
app's permissions in Profile → Connected apps, and the removal applies on the
app's next call (section 3.11, risk rows 33, 36 and 37). It can only take a
permission away; giving one needs the app's own approval flow. The hourly
cleanup job also deletes approvals that have no live token and have gone 30 days without use. No new recipient,
purpose or data, and the residual ratings do not change. Built on
`feat/connected-apps-scopes`, not yet deployed.

**Added 2026-10-30 (per-project automatic updates).** A project now has its own
automatic-update setting (`inherit`, `on`, `off`) that beats the account
switch "Generate memory from chats" (section 3.4). `on` is a second, explicit
opt-in to background extraction on the user's own key, narrowed to one project,
with its own forward-only stamp (`projects.memory_auto_update_enabled_at`).
No new purpose, recipient or data category, and no change to the consent gate
or `CURRENT_CONSENT_VERSION`. A connected app can set a project only to
`inherit` or `off`, never `on`, and cannot turn project memory back on while
the project is disabled and set to `on`, so nothing in section 3.11 gains a way
to spend the user's key.

**Added 2026-11-08 (feature access, rollouts and experiments).** Phase 0 of
the agentic capabilities programme adds per-account feature access: roles and
grants set by the controller, gradual rollouts and non-spending variants
assigned from a hash of the user id, opt-ins for features that spend the
user's keys, an objection switch, an audit log and exposure telemetry
(section 3.12, the legitimate-interests assessment in section 4.1, risk rows
38 to 48). The tables, evaluator, telemetry, `/admin` and the audit sweep are
built on the Phase 0 stack (PRs #741 to #753, not yet merged); the Labs page,
the opt-in and objection writers (P0-7) and the MCP admin tools (P0-8) are
planned. It is a new purpose on a new legitimate interest, so the Privacy
Policy change is material: notice `2026-11-experimental-features`, effective
2026-12-19. No special-category data, no new processor, and no change to the
consent gate or `CURRENT_CONSENT_VERSION`.

**Added 2026-11-08 (artifacts).** Phase 1 adds artifacts: AI-written HTML,
React, SVG, Mermaid and Markdown that run in a sandboxed frame on a separate
origin, with versions, public links, per-viewer storage, AI calls on the
viewer's own key, an in-app report form and takedowns (section 3.13, risk rows
49 to 60, section 6 items 20 to 23). Only the runtime Worker is built; the rest
is planned in A-1 to A-8. New purposes and new obligations in the Terms, so the
Privacy Policy and Terms change is material: notice `2026-12-artifacts`,
effective 2026-12-19. No new processor and no new third-country recipient
(esm.sh dropped). `CURRENT_CONSENT_VERSION` unchanged; the consent text does
not name viewer storage or the bridge, so both stay off beyond the controller
until the owner decides the wording (section 6, item 20).

**Added 2026-11-11 (documents and provider code execution).** Phase 2 adds
two things (section 3.14, risk rows 61 to 72, section 6 items 24 to 27).
First, documents: the chat model, or a connected client over MCP, makes a
PDF, Word, PowerPoint or Excel file from a JSON spec; the browser renders it,
the server renders it as a fallback in a second Worker, and every file is
validated and marked before it is stored. Second, provider code execution:
when the user turns it on for a message, the attachments and the model's code
go to the sandbox of the user's own Anthropic, OpenAI or Google account, and
Besidka deletes what it uploaded and downloaded after the turn. Both sit
inside existing purposes (files, "answer the user's message"), existing
recipients and the existing legal basis, so no new processor, no new transfer
and no consent change. Provider code execution is offered for those three
providers only; xAI, DeepSeek, Moonshot AI, Qwen and every gateway model are
excluded, so the Art. 49(1)(a) consents do not change. The shared package D-2
is built on `feat/documents-spec-package` (PR #833, not merged); everything
else is planned. The flags `documents`, `documents.*`, `code-execution`,
`code-execution.files` and `code-execution.skills` stay at stage `internal`,
and must not reach `beta`, until this section is merged, the code that builds
each planned control has shipped, and the Privacy Policy and Terms have been
re-checked against that code (they describe the intended behaviour in the
present tense) with the provider pages re-read on the day. The Terms of Use change is material by owner decision of 2026-11-11: a new
prohibited use for code and a mirror of the providers' usage rules. The
Privacy Policy change is recorded as material on the cautious reading (the
provider-side retention is a fact users did not have), so one notice,
`2026-12-code-and-documents`, covers both, effective 2026-12-19 (section 6,
items 25 and 26). `CURRENT_CONSENT_VERSION` is
unchanged.

## 1. Why a DPIA is required

Article 35 of the GDPR requires a DPIA when processing is likely to result in a
high risk. It has no exemption for small or non-commercial operators. A
household user is exempt for their own use, but Besidka provides the means for
that use, so the GDPR applies to Besidka (GDPR Recital 18).

**UODO list.** The Polish supervisory authority published its list in
Komunikat Prezesa UODO of 17 June 2019 (M.P. 2019 poz. 666). It says that
processing that meets at least two of its criteria will, as a rule, need a
DPIA.

| UODO criterion | Met | Why |
|---|---|---|
| 4. Special categories or highly personal data | Yes | An AI chat history is a web service for purely personal activities. Users type health, belief and family matters into it. The list names this kind of service as an example |
| 10. Innovative use of technology | Yes | An LLM assistant with memory and automatic extraction |
| 8. Comparison, evaluation or inference from several sources | Arguably | Background extraction reads many chats and builds one profile. Import adds a second source |
| 1. Processing with negative effects for the person | No | Nothing is decided about anyone. See Art. 22 below |

Criteria 4 and 10 are enough on their own. The chats alone meet the rule, so a
DPIA was already due for chat storage before memory existed. This document
covers both.

**EDPB cross-check.** The Article 29 Working Party guidelines WP248 rev.01
(endorsed by the EDPB) list nine criteria and use the same two-criteria rule.
Besidka meets:

- evaluation or scoring (profiling): background extraction (or a project set to
  On) records preferences, interests and work;
- sensitive data or data of a highly personal nature: chats;
- innovative use or new technological solutions: LLM memory.

It probably does not meet: automated decisions with legal effect, systematic
monitoring, large scale (one operator, small user base, no stated count),
matching datasets, vulnerable data subjects (adults only, 18+).

**Further factors that raise the risk.** Content is sent to third-country
providers. Some of those have no adequacy decision (section 6).

**Profiling and Art. 22.** Generating memory from chats is profiling under
Art. 4(4). It is not an Art. 22 decision. Nothing is decided about the user.
Memory only changes what a model knows when it answers the same user.

**Prior consultation (Art. 36).** Needed only if high residual risk remains
after the measures. With the measures in section 5 in place, the residual risk
is medium. No prior consultation is planned. The consent gate and the transfer
consent are built in this release; this conclusion does not hold if either is
removed.

## 2. Scope and context

- **Controller.** One person. No employees, no DPO, no EU representative, no
  joint controller. No revenue and no advertising.
- **Data subjects.** Users (adults, 18+). Third parties named in chats, files
  and project knowledge.
- **Model.** Bring your own key. The user supplies a key for an AI provider, an
  AI gateway or a search provider. Besidka's server sends the request. Besidka
  does not train models and does not sell data.
- **Processors.** Cloudflare (Workers, D1, KV, R2, Images, email sending, web
  analytics, Turnstile; for its own use of Turnstile signals Cloudflare is an
  independent controller under its Turnstile Privacy Addendum) and Axiom (logs). Besidka has a data-processing
  agreement with these two only.
- **Independent controllers.** The AI providers, gateways and search providers
  the user picks, and TypeSafe AI when the user saves a TypeSafe AI key
  (section 3.7a). The user holds the account with them. Besidka has no
  contract with them. Also the maker of every AI app a user connects over OAuth
  (section 3.11), which Besidka does not choose either.
- **Out of scope here.** Cookie consent records, push, email, campaign
  attribution and analytics. They have their own rows in the Art. 30 record and
  carry no special-category content. Handling of content reports, copyright
  notices and disputes of removals is row 14a of the Art. 30 record; its one risk
  for people is row 27 below.

## 3. Systematic description of the processing

### 3.1 Chat storage

- **Purpose.** Run the chat service: keep the conversation, show it again,
  send the history to the model on each message.
- **Data.** Messages (text, reasoning, tool calls and results, sources), file
  attachments, chat titles, project assignment. Free text, so it can hold any
  category of data, including special categories (Art. 9) and, by accident,
  criminal-offence data (Art. 10).
- **Where.** D1 (`DB`) for rows. R2 (`DATA_BUCKET`) for files. Cloudflare does
  not pin either to the EU. The Privacy Policy says "EU and US".
- **Recipients.** The provider or gateway the user chose for each message.
  Cloudflare as processor.
- **Retention.** Until the user deletes the chat, project or account. Files
  expire after 30 days by default (user can change it). D1 Time Travel keeps
  point-in-time backups for up to 30 days.
- **Basis.** Contract (Art. 6(1)(b)). For special categories, explicit consent
  (Art. 9(2)(a)), asked once in the app (section 3.8).

### 3.2 Chat search

- **Purpose.** Let the user find old chats, and let the assistant look up
  earlier chats when that helps an answer.
- **How.** A full-text index (SQLite FTS5, table `message_search`) over the
  user's own messages. The model can call `search_chats` and `read_chat`. The
  current chat is excluded. Excerpts are at most about 3,000 tokens. In a
  project that does not use account memory, only that project's chats are
  searched.
- **Recipients.** Excerpts go to the provider or gateway of **the chat the user
  is in**. That can be a different company from the one that answered the
  original chat.
- **Control.** The `chatSearchEnabled` switch (on by default, "Search and
  reference chats" on the Memory page).
- **Retention.** Nothing new is stored. The index follows the messages.
- **Basis.** Contract (Art. 6(1)(b)).

### 3.3 Memory entries

- **Purpose.** Remember lasting facts and preferences across chats and add
  them to later messages.
- **Data.** Title, one-line description, text, category (`profile`,
  `preferences`, `areas`, `topics`, `people`), scope (account or project),
  origin (`user`, `tool`, `extraction`, `import`), source chat ids, timestamps.
  Caps: 30 account entries, 15 per project, 4 KB per entry, 1.5 KB for the
  always-injected `profile` and `preferences`.
- **How it is written.** Only by the user (Memory page), by the assistant when
  the user's current message asks for it (`memory_write`, which must quote the
  request), by background extraction (section 3.4), or by an explicit run
  (Refresh, Update now, Build from past chats, Import, and the "tell Besidka
  what to remember" box from #543: one model call on the user's key proposes
  changes, which the user reviews and applies; the text is redacted for
  never-store items and not stored). A chat the user excludes from memory
  (#542) is never read for memory.
- **How it is used.** A short index (profile and preferences text plus one line
  per other entry) is added to each message. The assistant can read a full
  entry with a tool.
- **Where.** D1 table `memory_entries`.
- **Recipients.** The provider or gateway of the chat. Cloudflare as processor.
- **Retention.** Until the user deletes the entry, resets memory, deletes the
  only chat a generated entry came from, deletes the project (project
  entries) or deletes the account.
- **Basis.** Contract (Art. 6(1)(b)).

### 3.4 Background extraction (opt-in)

- **Purpose.** Save lasting facts and preferences from chats without the user
  asking each time.
- **Opt-in.** Off by default. The user switches on "Generate memory from
  chats" (or sets a project to On, below). The app records
  `memory_extraction_enabled_at`. Nothing runs in the background before that.
  Enabling it never reads old history by itself.
- **Per-project opt-in.** Each project has an automatic-update setting:
  `inherit` (the default, follows the account switch), `on` or `off`. `on` is a
  second explicit opt-in: the user sets a project to On in the app, behind a
  confirm, and only that project's chats are then read in the background on
  the user's own key, even while the account switch is off. The app records
  `projects.memory_auto_update_enabled_at` as that project's own cut-over, and
  the sweep reads a project chat only when its last activity is after the
  applicable cut-over (the later of the account stamp, while the account
  switch is on, and the project stamp). `off` stops it for the project and
  clears the stamp; `off` back to `inherit` restamps, so messages written
  while it was off are never read; `on` back to `inherit` keeps the stamp. The
  stamp is also restamped when project memory is turned back on, and, for
  projects set to `on`, when account memory is turned back on. Memory
  turned off in the account settings, a disabled project and the consent gate
  still block everything. Account chats are not affected.
  History is read only through the explicit "Build memory from past chats"
  action, which shows a cost estimate first and has hard ceilings (200 chats
  and 4 million tokens per run).
- **How.** A scheduled sweep picks chats that have been idle for about ten
  minutes. It sends the new part of the chat to the memory model **on the
  user's own key**. By default the memory model is "Same as chat". The user can
  pick another model, which then receives the chat text. User messages are the
  input. Assistant text is context only. Files, tool results, web results and
  reasoning are never sent.
- **Before sending.** Never-store items (card numbers, keys and the like) are
  removed from the input.
- **After the model answers.** Every proposed entry passes the compliance gate
  (section 3.7) before it is saved.
- **Profiling.** Yes (Art. 4(4)). Not an Art. 22 decision.
- **Recipients.** The memory model's provider or gateway. Cloudflare.
- **Retention.** As memory entries. Run records: the last five runs per user.
- **Basis.** Consent (Art. 6(1)(a)), given by the account switch or by a
  project's `on`. Switching it off, or setting the project to `off`, is
  withdrawal. The user
  chooses whether to keep or delete what it already generated (built, #544:
  the prompt in `app/components/Profile/Memory/Controls.vue` and
  `POST /api/v1/memory/entries/delete-extracted`).

### 3.5 Project memory

- **Purpose.** Give a project a shared summary of what its chats established.
- **Data.** Project-scope memory entries. Legacy projects may still carry the
  older single summary text (`projects.memory`). It is migrated lazily into one
  entry on first read. The old column stays in place.
- **How.** The same paths as section 3.3 and 3.4, plus the explicit
  **Refresh** button on a project. Nothing runs in the background for a project
  unless the extraction opt-in is on, for the account or for that project
  (section 3.4), and only for users with current consent.
- **Background refresh is gone in this release.** Production before this release
  refreshed project memory after every answer, on a key picked in a fixed
  provider order, without an opt-in. In this release the client no longer posts
  a project-context refresh after each answer: a search of `app/` finds only the
  explicit Refresh handler in `app/pages/chats/projects/[id].vue`, which calls
  `POST /api/v1/projects/<id>/memory/refresh`. The summaries written before
  this release may already hold special-category data (section 6).
- **Recipients.** As section 3.4.
- **Retention.** Deleted with the project.
- **Basis.** Contract for explicit runs. Consent for background runs.

### 3.6 Project knowledge

- **Purpose.** Let the user attach files, notes and folders to a project as
  reference material for that project's chats.
- **Data.** Original files, text extracted **in the user's browser**, notes, a
  search pack, and a database row per item. The server stores the text and does
  not extract it from the original. A linked folder's name stays in the
  browser only.
- **How it is used.** Added to messages in that project in full when it fits
  the model's budget. Otherwise the assistant gets search and read tools.
- **Where.** R2 (`DATA_BUCKET`) under keys derived on the server from the
  session user and a verified project. D1 for metadata.
- **Recipients.** The provider or gateway of the chat. Cloudflare.
- **Retention.** Until the user removes the item, deletes the project or
  deletes the account. Linked files do not expire while linked.
- **Outside the compliance gate.** Knowledge is user-supplied material, like a
  chat attachment. The Art. 9 classifier and the never-store list do **not**
  run on it. A medical PDF the user adds is stored and sent like any file. It is
  covered by the chat consent (section 3.8), not by the memory gate. The only
  check that reads it is the optional TypeSafe AI injection screening
  (section 3.7a), which looks for hidden instructions, not for sensitive data.
- **Basis.** Contract (Art. 6(1)(b)). Explicit consent for any special category
  inside the files.

### 3.7 Compliance gate (classifier and never-store detectors)

- **Purpose.** Keep what should not be in memory out of memory.
- **How.** Server code (`server/utils/memory/compliance.ts`), on every write
  path: Memory page, assistant tool, extraction, import, "tell Besidka what to
  remember" (apply) and the one-time About-me migration. It is code, not a
  prompt. The model's own refusal is not treated as a control.
  - **Never-store detectors.** Card numbers (Luhn), IBAN, PESEL, tax and
    passport numbers, API keys and tokens, JSON Web Tokens, passwords and
    credentials, private keys. Narrow detectors for precise home address,
    immigration or residence status and criminal history.
  - **Sensitive-topic classifier.** Fixed word and pattern rules, not a model.
    English, Ukrainian, Polish and Russian. Covers the Art. 9
    categories (health, religion or belief, political opinion, racial or ethnic
    origin, sex life or orientation, trade-union membership, genetic and
    biometric data) and two extra topics (ongoing legal disputes, drugs). There
    is no opt-in and no setting that allows them.
- **Result.** The write is refused (HTTP 422) or the extracted entry is
  dropped. Never-store items are checked first and win.
- **Data processed.** The text being saved. Nothing is retained. Logs hold
  counts and category ids only.
- **Basis.** Legitimate interests (Art. 6(1)(f)) as a safeguard under Arts. 25
  and 32. Because it reads text that may be sensitive, the consent text names
  it (Art. 9(2)(a)).
- **Known limit.** It can miss unusual wording (section 6).

### 3.7a TypeSafe AI Jev checks (optional, per-role toggles)

- **Purpose.** Catch special-category data and never-store values the rules
  in 3.7 miss, and reject entries a model wrote that are not supported by the
  user's own text (the memory check). The same key also powers six more
  assistive checks, listed in the table below.
- **When.** Only for a user who saved a TypeSafe AI key (Profile → API Keys
  → Smart checks). Saving the key is the opt-in; deleting it stops every
  check. Each check also has its own toggle in a "TypeSafe AI checks" section
  on that tab. All are on after the key is saved; a role is on unless the
  user switched it off. Only on paths already behind the consent gate.
- **How (memory check).** `server/utils/memory/jev-check.ts`. The rules in
  3.7 run first. Only entries they allow are sent, with never-store values
  removed, plus, for model-written entries, a short excerpt of the user's
  text (also redacted, and dropped if the rules would refuse it). Jev can
  only add a refusal. Model pinned to `jev-1.14.0`; threshold 0.5.
- **Shared client.** All roles call one client in `server/utils/jev/`. The
  per-role setting is `user_settings.typesafe_roles` (nullable JSON, null =
  all on). Timeouts: 800 ms on the send path, 2.5 s in the background, 1.5 s
  for the share check. Role ids (`JEV_ROLE_IDS` in
  `shared/utils/jev-policy.ts`): `memoryChecks`, `autoWebSearch`,
  `extractionPrefilter`, `injectionScreening`, `rerank`, `sharePiiCheck`,
  `pastChatRetrieval`; the table below has one row for each.
  Thresholds come from a synthetic eval run on 2026-10-26 and are re-tuned on
  real traffic.
- **Recipient.** TypeSafe AI, Inc., United States, independent controller
  towards Besidka on the user's own account, described like the BYOK model
  providers (no contract between Besidka and TypeSafe AI). Its DPA is its
  contract with its own account holder (the user, for the key they add),
  under which it acts as that account holder's processor; that is why it
  relies on the SCCs Module 2 (controller to processor) and the UK
  Addendum, and Besidka is not a party to it (delta audit finding 12,
  2026-10-26). Not on the EU-US Data Privacy Framework. The DPA marks
  sensitive-data safeguards "N/A", keeps data "as long as necessary" and has
  no SLA. Its privacy policy says it does not train on input.
- **Failure.** Every role is assistive and fails safe to the behaviour
  without the key on a missing key, 401, 403, 429, 529, a network error or a
  timeout. The direction differs by role and is in the last column of the
  table: `memoryChecks` falls back to the gate alone, `autoWebSearch` and
  `pastChatRetrieval` fall toward searching, `extractionPrefilter` toward
  generating memory, `rerank` keeps the original order, `injectionScreening`
  treats undecided text as unscreened, and `sharePiiCheck` only warns.
- **Retention at Besidka.** The prompts are not stored. Two KV markers exist:
  the re-screening queue entry of `injectionScreening` (user, project and item
  ids, plus an attempt counter; 14 days) and the Auto web search first-message
  marker (`auto-web-search-first-message:<chat>:<message>`, holds the outcome
  only; 1 day).
- **Data in logs.** Counts, scores, statuses and latency under
  `attributes.<role>Jev` (the memory check keeps `memoryJev`), never text.

| Role | Purpose | When | Data sent | On failure |
|---|---|---|---|---|
| `memoryChecks` | Second opinion before a memory entry is saved | Each entry the rules allowed | Entry text with never-store values removed, plus a short redacted source excerpt | Rules alone; add-only, so it can never allow what the rules refused |
| `autoWebSearch` | Decide whether a web search is needed | Only in the Auto web search mode, each message, unless a URL, a domain or a recency phrase ("today", "latest") already decides it without a Jev call | The message and the last three turns, with never-store values removed | Search as usual |
| `extractionPrefilter` | Skip the memory model when nothing is worth remembering (saves the user's cost) | Before memory is generated from a chat: opt-in extraction, backfill from past chats, project Refresh. Never for extract-now or import | Chat text with never-store values removed, in chunks of up to about 8,000 tokens | Unsure or unavailable: generate memory as usual |
| `injectionScreening` | Flag hidden instructions in third-party text | Project knowledge files and notes; Brave and Exa results (title and snippet) fetched through Besidka | That text in chunks of up to about 2,000 tokens, with never-store values removed | Text used unscreened: search results are kept; a project file or note is stored ready and queued in KV (ids only, no text, kept 14 days, at most 5 failed attempts) and screened again by the hourly sweep, only while the user's consent is current and the key and check are still on; a flag holds a file for review or leaves a result out of context and never deletes anything |
| `rerank` | Order search candidates by relevance and leave out clearly irrelevant ones while enough relevant ones remain | Past-chat and project-knowledge search | The query and excerpts of about 300 tokens each, up to 30 per search, with never-store values removed | Original order |
| `sharePiiCheck` | Warn about personal data before publishing | When the share window opens or its files toggle changes, before a public share link is created; only with current legal consent | The chat text being shared, with never-store values, emails and phone numbers removed, in chunks of up to about 25,000 tokens | Generic reminder next to the built-in detector warnings; never blocks sharing |
| `pastChatRetrieval` | Pre-search past chats for sends where the chat search tools are not registered (models without tool calling) | Each such message, only while "Search and reference chats" is on, unless a listed phrase ("last time", "we discussed") already starts the search without a Jev call | The message and the last three turns, with never-store values removed | No key or role off: no pre-search. Jev unsure or unavailable: the search runs anyway, so a failed call sends nothing extra to TypeSafe AI |

### 3.8 Consent gate, version 2026-11-a

- **What.** A modal shown before the next message to every signed-in user whose
  record is missing, withdrawn or older than the current version. It covers
  email, Google, GitHub and passkey sign-ups and existing users.
- **Two boxes, never combined, neither pre-ticked.**
  1. The user is 18 or over and accepts the Terms of Use (required).
  2. **Explicit consent** (Art. 9(2)(a)) to store the sensitive information the
     user chooses to include in chats, projects and files, to send it to the
     providers, gateways and search providers whose keys the user added (for
     chats, project memory and memory), and to the automatic check before text
     is saved to memory. It is a separate box from the Terms (Art. 7(2)).
- **One version.** `CURRENT_CONSENT_VERSION = '2026-11-a'`. A user is `current`
  only when the Terms version and the consent version both equal it. Changing
  the version asks everyone again. A `2026-10-a` text was never shipped, so no
  user consented to it.
- **Enforcement.** The server refuses to send a message (HTTP 403) when consent
  is missing, withdrawn or outdated. The extraction sweep, extract-now,
  backfill, project memory refresh and import skip or refuse users without it.
  Withdrawing cancels a running backfill job. A UI-only gate would not be
  enough, because consent must come before the processing. Because the consent
  covers storing, new content is refused too (owner decision 2026-10-26):
  file uploads, project knowledge and notes, project instructions, memory
  entries, "tell Besidka what to remember" and chat branching. Reading,
  exporting and deleting stay open. The full route list is in
  `docs/legal.md`, "Consent records". Consent is read once per request, so an
  answer already streaming when the user withdraws is still saved.
- **Rollout.** Every existing user starts as `missing`. Until each one
  consents, the background extraction and backfill pause for that user.
- **Receipt.** Per-user timestamp and text version on `user_settings`:
  `terms_accepted_at`, `terms_version`, `age_confirmed_at`,
  `sensitive_content_consent_at`, `sensitive_content_consent_version`,
  `sensitive_content_consent_withdrawn_at` (additive columns, no table
  rebuild). This also closes the gap for OAuth sign-ups. The receipt is not in
  `CONSENT_DB`, which stays pseudonymous and isolated (`docs/legal.md`,
  "Consent records").
- **Withdrawal.** In **Profile → Security → Privacy & consent**, which also
  shows the date and version consented to and allows re-consent. After
  withdrawal the app stops sending new messages and stops background memory
  work. The user can still read, export and delete everything. Withdrawal keeps
  the earlier timestamps.
- **If the user refuses.** They cannot send messages. This is the main
  judgment call (section 6, item 1). The owner decided it on 2026-10-26.
- **Status.** **Built** in this release: `server/utils/legal/consent.ts`,
  `server/api/v1/profiles/consent/` (`index.get.ts`, `index.post.ts`,
  `withdraw.post.ts`), the migration
  `.drizzle/migrations/20261026144709_legal_consent/migration.sql`,
  `app/components/Legal/ConsentModal.client.vue`,
  `app/components/Profile/Security/PrivacyConsent.vue` and
  `app/composables/legal-consent.ts`.

### 3.8a Transfer consent (Art. 49(1)(a))

- **Purpose.** Give DeepSeek (China), Moonshot AI (Singapore, as Besidka calls
  it) and Qwen (Singapore) a transfer tool, since there is no adequacy decision
  and no contract.
- **How.** A one-time dialog when the user adds a key for one of these
  providers, and again before the next send through an existing key. It names
  the country and says there is no adequacy decision. The user ticks an explicit
  consent box.
- **Refusal.** That provider cannot be used to send, and is not used for memory
  work. The key stays stored.
- **Withdrawal.** In Profile → Security → Privacy & consent. Deleting the
  DeepSeek, Moonshot AI or Qwen key withdraws that consent too. The
  gateway-vendor and `router` consents have no key of their own, so only the
  Privacy & consent page withdraws them.
- **Scope.** Owner decision 2026-10-26: it also applies to models reached
  through Vercel AI Gateway, OpenRouter or Cloudflare AI Gateway whose id names
  one of these vendors (`deepseek/`, `moonshotai/`, `alibaba/`, `qwen/`,
  also behind OpenRouter's `~vendor/` aliases). Models a gateway runs itself
  (Cloudflare's `@cf/` ids) are exempt. Extended the same day (delta audit
  finding 5): gateway-only consents for Z.ai (`z-ai/`, `zai/`; Singapore),
  MiniMax (`minimax/`; Singapore entity, US storage), ByteDance
  (`bytedance/`, `bytedance-seed/`; Malaysia or Indonesia), and, mapped to
  China defensively, Tencent (`tencent/`), Xiaomi (`xiaomi/`), Meituan
  (`meituan/`), StepFun (`stepfun/`), inclusionAI (`inclusionai/`), TeleAI
  (`xingchen-agi/`) and Dots Studio (`dots-studio/`); and one generic
  `router` consent for OpenRouter meta-routers (`openrouter/`) and
  `@preset/` model strings, which can send a request to a provider in any
  country. See `docs/legal.md`.
- **Receipt.** `provider_transfer_consents` (JSON) on `user_settings`: per
  provider `consentedAt` and `withdrawnAt`. Deleted with the account.
- **Status.** **Built** in this release: `server/utils/legal/consent.ts`,
  `server/api/v1/profiles/consent/transfers/index.post.ts` and
  `transfers/withdraw.post.ts`, `app/components/Legal/TransferConsentModal.client.vue`.
- **Known weakness.** The EDPB view that consent is inappropriate for ongoing
  transfers (section 6, item 4).

### 3.9 Logging

- **What.** Structured request logs (evlog wide events) sent to Axiom, dataset
  `besidka-prod`, plus an audit dataset and a consent dataset.
- **Memory fields.** Only counts, outcome labels, origin, the category ids of a
  refused item, the model and provider used, and technical error labels. Never
  the text of memory, a chat, a file or anything imported. Fields live under the
  `attributes` map (see `docs/axiom-map-fields.md`).
- **Consent fields.** `attributes.legalConsent` holds the action (`granted`,
  `withdrawn`, `transfer-granted`, `transfer-withdrawn`), the text version and, for a transfer, the
  provider name, with the user id.
- **Feature access fields (built on the Phase 0 stack).**
  `attributes.features[flag]` (`value`, `variant`, `reason`) only for
  hash-based rollout and variant decisions, never the bucket;
  `attributes.featureAccess` for every feature-access write (action, flag,
  target user id, effect, expiry, actor kind, client id; the opt-in and
  objection writers add `optedIn` and `objected`, planned with P0-7) and for
  admin reads (`admin.read`, resource, result count). Ids only: never an
  email, a name, a grant reason or the admin search text, which the request
  observability hook also strips from the logged path of every
  `/api/v1/admin/` route. These lines are the replay ledger after a D1
  restore (section 3.12).
- **Processor.** Axiom, under its data-processing agreement. Retention of
  `besidka-prod`, `besidka-audit-prod` and `besidka-consent-prod` is 30
  days each (dataset setting, AWS us-east-1, read on 2026-11-08).
- **Basis.** Legitimate interests (Art. 6(1)(f)): keeping the service working
  and secure.
- **Verified against the code on 2026-10-26.** `attributes.memoryCompliance`
  (`origin`, `blocked` counts per never-store kind, `blockedTotal`, and
  `sensitive.categories`), `attributes.chatSearch` (`stage`, `operator`, `hits`,
  messages read, `truncated`), `attributes.memoryModel` (`scope`, `source`,
  provider, gateway and model ids, skipped labels), `attributes.memoryExtraction`
  (chat, message and character counts, ops proposed, applied and dropped,
  models, token usage), `attributes.memoryBackfill*` and
  `attributes.projectMemoryRefresh` (counts and phases), and error names and
  status codes. None carries entry, chat, search or import text.

### 3.10 Data flow in one view

| Step | From | To | Data | Control |
|---|---|---|---|---|
| 1 | Browser | Worker | Message, files, settings | Session auth, TLS, server-side consent check |
| 2 | Worker | D1, KV, R2 | Rows, cache, files | Cloudflare at rest, ownership checks in SQL |
| 3 | Worker | Provider or gateway | Message, history, memory index, excerpts, knowledge | User's own key; transfer notice and consent where needed |
| 4 | Worker | Search provider | Query the model writes | Only if the user turned search on, user's own key |
| 5 | Worker | Memory model | New chat text (opt-in) | Never-store redaction, then gate on output |
| 5a | Worker | TypeSafe AI (only with a TypeSafe AI key, per enabled check) | Candidate memory entries the gate allowed, redacted, plus a short redacted source excerpt; chat text for the pre-filter, the share check and Auto web search; project knowledge and Brave or Exa results for injection screening; query and excerpts for re-ranking; recent turns for past-chat retrieval | Per-role toggle; gate first for memory; flagged text never sent; add-only for memory; every role fails safe |
| 6 | Worker | Axiom | Counts and ids | No memory or chat text |
| 7 | AI client (pulls) | Worker (MCP server) | Token, then the chats, projects, knowledge, files, memory and settings the user approved; for write scopes, new values (names, instructions, notes, text files, memory entries, settings) and which items to move or delete | OAuth 2.1 with PKCE, scopes ticked per client, 15-minute tokens, per-user ownership in SQL, consent gate, never-store and sensitive-topic gate on memory writes. The client is an independent controller the user chose |
| 8 | Worker | Workers Analytics Engine | `feature_exposure`, flag, variant, reason for hash-based decisions | No bucket, path or user id (C1). Pseudonymous while a cohort is tiny |
| 9 | Admin browser, or the controller's AI client (planned) | Worker (`/api/v1/admin/`, MCP `admin:features`) | Searches by email prefix or name; grants, roles and rules; for MCP, user ids and grants | Admin only (env secret or `user_roles`, verified email, TOTP in production), 404 for everyone else, same-origin writes, audit row and Axiom ledger line per write, reads logged without search text; MCP returns ids only (C9) |
| 10 | Worker | R2 `artifacts/`, D1 artifact tables | Artifact versions, links, viewer storage, reports (planned, section 3.13) | Ownership in SQL, R2 key derived on the server, takedown and legal hold columns |
| 11 | Viewer's browser | Runtime origin (Cloudflare, built) | Request for the runtime page and vendored libraries; IP address and User-Agent as in any request | Sandboxed frame, header CSP, no third-party host; self-navigation tripwire (wired by A-4) |
| 12 | Besidka page | Runtime frame (`postMessage` channel) | Artifact source, theme, viewer storage values, bridge answers | Opaque origin; the frame's code is the author's, so anything given to it can leave by self-navigation (risk rows 51, 52) |
| 13 | Worker | Viewer's direct provider (planned, A-6) | The artifact's prompt, after the viewer confirms it | Viewer's own key, consent gate and transfer consent, caps, nothing stored |
| 14 | Visitor or reporter | Worker, privacy mailbox (A-7) | Report form: name, email, reason, details; Turnstile for signed-out reporters; receipts and statements of reasons by email | Rate limit, no IP stored, a person decides |
| 15 | Browser, then Worker | R2 `documents/`, D1 `documents`, then the rendered file in R2 and `files` | The document spec the model wrote (text, tables, slide text, sheet cells, references to the user's own images), the title, then the rendered file (planned, D-4, section 3.14) | The user's own send and key, ownership in SQL, spec bounds and strict keys, `validate()` before anything is stored, the file counts in the 20 MB quota |
| 16 | Worker | `besidka-doc-renderer` (same Cloudflare account, service binding, no public route; planned, D-3) | The spec and the owner's image bytes, only when the browser cannot render; the rendered bytes come back. **Office extraction (for every stored Office file, generated documents included; uploads are accepted behind the flag `files.office`):** the bytes of an uploaded or generated DOCX, XLSX or PPTX, when the file is stored or first sent, so the renderer can read its text; the Markdown comes back and is stored as the file's text derivative (activity row 3). The renderer keeps nothing and logs sizes and codes only, never the text | No bindings to user data, no public route, no spec text, title or asset bytes in its logs (test), nothing kept after the call |
| 17 | AI client (pulls) | Worker (MCP `create_document` under `files:write`; built, D-5) | Content the client supplies, rendered into a private file | Same scope and approval screen as row 10a, no provider key, no AI assertion unless the client declares `aiGenerated`, per-user rate limits and quota |
| 18 | Worker | Anthropic, OpenAI or Google (planned, D-7) | With "Run code" on: the message's attachments (uploaded to the provider's sandbox for the turn, up to 10 files and 20 MB), the model's code and the files the code creates; Google inline | The user's own key, off per message, one-time confirmation, direct providers only, no sandbox network, deletion after the turn, price note |
| 19 | Provider sandbox | Worker, then R2 and `files` (planned, D-7) | Output files the container made, downloaded with the user's key and stored as the user's files | Type allowlist, size caps, magic bytes, `validate()` for Office and PDF, image marking, visible AI label |

### 3.11 Connected AI apps (OAuth 2.1 and MCP) -- built

- **Purpose.** Let a user work with their own Besidka data from an AI client
  they choose (a chat assistant, a coding tool) through the MCP server at
  `https://besidka.com/mcp`. Besidka is the authorization server (Better Auth
  `@better-auth/mcp`), the MCP server is the resource server. Sending chat
  messages through MCP, and so spending the user's API keys, is **not** part
  of this release.
- **Flow.** The client registers itself (dynamic client registration, no
  account needed), sends the user to a Besidka screen, and the signed-in user
  approves a set of scopes. Authorization code with PKCE. Access tokens last
  15 minutes (JWT); refresh tokens rotate on use and last 30 days at most.
- **Scopes.** Read: `chats:read` (list, search and read chats, list shared
  chats), `projects:read` (projects, instructions, project knowledge items),
  `memory:read` (memory entries), `files:read` (the file list, storage use and
  the text of text files), `settings:read` (display preferences and memory
  switches, and which models memory uses and whether automatic extraction is
  on). Write: `chats:write` (rename, pin, move and branch chats, exclude a chat
  from memory, stop a share), `projects:write` (create, update and archive
  projects, edit instructions, add and edit knowledge items), `memory:write`
  (add and edit memory entries), `files:write` (create text files, rename
  files), `settings:write` (display preferences, favourite models, sidebar
  pinning, the memory and chat search switches), and `data:delete` (all
  permanent deletion: chats, messages, projects, knowledge items, files, memory
  entries, memory reset). 11 resource scopes, each write scope its own tick and
  unticked by default. The share URL of a chat is returned only to a token that
  also has `chats:write`; `chats:read` shows whether a chat is shared, its
  expiry and what it shows. 32 private tools in all (`docs/mcp-server.md`).
  `create_file` text is stored as a file without the prompt-injection screening
  that project notes get; an agent can read it back with `read_file`, so treat
  it like any text an agent reads (risk row 31). `create_document` (built, D-5) also sits under `files:write`: it renders a PDF, Word, PowerPoint or Excel file from content the client supplies and stores it as a private file (section 3.14). It spends no key and publishes nothing, so it fits the recorded rule that an extension of an existing scope involves no deletion or spend (risk row 37).
- **Left out on purpose.** Anything that spends the user's keys (sending,
  memory import and extraction, backfill, project memory refresh, title
  generation, the share personal-data check, deep research), creating or
  updating a public chat share, "Allow anyway" on a flagged knowledge item,
  settings that authorise spend or change the data recipient (automatic
  memory extraction, memory models, TypeSafe AI roles), setting a project's
  automatic memory updates to On (a connected app may only set `inherit` or
  `off`, which can only reduce what the background sweep reads), and API keys,
  sessions, consents, push, email, password, 2FA, passkeys and account
  deletion. Reasons and revisit criteria: `docs/mcp-server.md`, "What MCP does
  not do (and why)".
- **Deletion.** The delete tools are permanent, as in the app: no trash, no
  per-user undo. Guard rails: destructive tools carry `destructiveHint` so
  a client asks the user first; `delete_project` needs the exact project name
  (`confirmName`) and `reset_memory` needs `confirm: true`; batches are capped
  (25 chats per call, 100 files or knowledge items, 90 share revocations);
  deleting a chat or message and branching are skipped or refused for a chat
  that is generating a reply (best effort, not a lock); every deletion needs the
  separate `data:delete` scope; deletes are limited to 20 calls an hour and
  writes to 30 a minute. D1
  Time Travel (30 days) exists for disaster recovery of the whole database and
  is not used to undo one user's deletions.
- **Data subjects.** Users. Third parties named in the chats, projects and
  memory that a client can read.
- **Data stored.** `oauth_clients` (name, redirect URIs, and whatever metadata
  the client sent when it registered; no user id for an unauthenticated
  registration), `oauth_consents` (user id, client id, scopes, timestamps),
  `oauth_access_tokens` and `oauth_refresh_tokens` (user id, client id, scopes,
  expiry, revocation), and `jwks` (signing keys; the private key is encrypted
  by Better Auth with the auth secret by default). Schema:
  `server/db/schemas/oauth.ts`.
- **Recipient.** The AI client and the company behind it, an independent
  controller that Besidka does not choose and has no contract with. The user
  chooses it and directs the disclosure. Whether the client runs in the EEA
  is unknown to Besidka.
- **Basis.** Contract, Art. 6(1)(b), at the user's request each time a client
  is connected, as for the BYOK sends. For special-category content in what
  the client reads: explicit consent, Art. 9(2)(a), given **on the approval
  screen**, per client and per scope. The existing consent gate does not cover
  it, because its text names the providers, gateways and search providers whose
  keys the user adds (section 3.8). The `oauth_consents` row is the Art. 7(1)
  record for the approval and is **not** a copy of the gate record in
  `user_settings` (`docs/legal.md`, "Consent records"). Security, rate limiting
  and disabling an abusive client: legitimate interests, Art. 6(1)(f). Judgment
  calls: section 6, items 12 and 13.
- **Gate integration (required).** A connected client reads or changes nothing
  while the user's consent under section 3.8 is not `current`. Every MCP write
  tool is gated like its in-app twin (chats, projects, project instructions,
  project knowledge notes, files, memory entries, settings: the list in
  `docs/legal.md`). Memory writes through
  MCP run the same never-store and sensitive-topic gate as any other memory
  write path (3.7).
- **Retention.** Access tokens 15 minutes. Refresh tokens until they expire (30
  days at most) or are revoked. Consents until the user disconnects the client or deletes the
  account, or, once no live refresh or access token exists for the user and
  the client and the consent has gone 30 days without use or change (its `updated_at`,
  which every verified `/mcp` call refreshes at most every 15 minutes, because
  JWT access tokens are not stored), until the hourly `oauth-grant-sweep` job
  deletes it. Owner-less client registrations (every
  unauthenticated registration) are deleted once they are older than 7 days
  and no consent or token references them; a registration with a user id would
  not be swept, and the current flow creates none **[U]**. Expired access
  tokens and refresh tokens expired or revoked for a day are deleted by the
  same job (`server/plugins/oauth-grant-sweep.ts`).
- **Narrowing.** Profile → Connected apps also lets the user remove single
  permissions (`PATCH /api/v1/profiles/connected-apps/[clientId]/scopes`). It
  only removes resource scopes from the consent, never adds one, and never
  writes an empty list (the user disconnects instead). Tokens keep the scopes
  they were issued with, so what an app can do is the token's scopes
  intersected with the current consent on every call
  (`resolveEffectiveMcpScopes`, `server/utils/mcp/auth.ts`), and a removal
  applies on the app's next call. Adding a permission goes through the app's
  own OAuth flow and the approval screen. A consent row whose scope list cannot
  be read fails closed: the app's effective scopes are empty, so it keeps only
  the tools that need no scope until the user approves it again, and the
  request logs `consent_unreadable`. Duplicate connections of the same app are grouped, with a
  "Disconnect older" action the user triggers and nothing in use is revoked
  automatically; only an idle approval is deleted by the hourly sweep, and a
  connection with no live token that has not been used for 30 days is not
  listed.
- **Revocation.** Profile → Connected apps. Disconnecting deletes the consent
  and the tokens, and the app stops on its next call: every `/mcp` call checks
  that the user exists, the client is enabled and a live `oauth_consents` row
  exists (`resolveMcpPrincipal`, `server/utils/mcp/auth.ts`), so a JWT access
  token that is still unexpired is refused at once (risk row 33).
- **Logs.** `attributes.mcp`: client id, tool name, scope, status, timing and
  the user id; never chat, memory or project text (`docs/axiom-map-fields.md`).
- **Cookies.** The OAuth flow rides on the existing Better Auth session cookie
  and signed query parameters. The only cookie the OAuth provider adds is
  `better-auth.session_token.oauth_logout_confirmation` (signed, `HttpOnly`,
  300 seconds), set only when a client with end-session enabled asks to sign
  the user out. Listed in the Cookie Policy.
- **Status.** **Built** and in production since 2026-10-29 (#588): the OAuth
  provider, the scopes, the approval screen, the Connected apps page, the gate
  integration and the write tools. The 2026-10-30 additions (files, settings,
  deletion tools, a separate `data:delete` scope, 11 scopes) are built on `feat/mcp-ui-parity`.
  Permission removal, the duplicate grouping and the consent sweep are built on
  `feat/connected-apps-scopes`, not yet deployed. The items
  marked `[U]` (token hashing at rest, account-deletion
  cleanup of OAuth rows, client registrations that carry a user id) are still to
  be verified.
- **Admin scope `admin:features` (planned, P0-8).** A twelfth scope with
  three tools, `list_feature_flags`, `list_feature_access` and
  `set_feature_access`, for the controller's own AI client (section 3.12).
  The consent page never shows it to a non-admin, and the server strips it
  from a non-admin's request, so no user can grant it. No tool returns another
  user's email, name or grant reason: `list_feature_access` returns numeric
  user ids with their grants, and `set_feature_access` accepts an email or a
  user id and echoes only the id (pre-check C9). Writes change one account at
  a time; rules, rollout shares, variants and the kill switch are UI-only.
  Every write goes through the same writer as `/admin`, with actor kind
  `mcp` and the client id. `list_my_features` (the user's own features)
  sits under the existing `settings:read`. The maker of the controller's
  client is a recipient chosen by the controller (Art. 30 record, row 27 and
  section 6.4), not a user-directed disclosure like the rest of this section.
  The Privacy Policy does not describe it yet: before the first production
  use, the client is named there with its country and safeguard, under its
  own material notice.

### 3.12 Feature access, rollout and experiments -- built, Labs and MCP planned

- **Purpose.** Decide per account which experimental features are available:
  release a feature to the controller and named testers first, then to a share
  of accounts; compare variants of features that do not spend the user's keys;
  and require the user's own opt-in before a feature spends their API keys.
  Design: `docs/feature-flags.md` (on the Phase 0 stack). Compliance
  pre-check: `docs/legal/agentic-capabilities-precheck.md`, section 4 (PR
  #731); its design changes are cited here as C1 to C15.
- **Data stored.** Five D1 tables with no foreign key to `users` and no column
  on `users` (`server/db/schemas/features.ts`): `user_roles` (user id, `admin`
  or `tester`, granted-by id), `feature_flag_rules` (flag, enabled, rollout
  share in basis points, allowed roles, variant weights, random 16-byte salt,
  updated-by id), `feature_grants` (user id, flag, allow or deny, forced
  variant, expiry, free-text reason up to 200 characters, granted-by id),
  `feature_opt_ins` (user id, flag, latest opt-in and opt-out times; the
  reserved key `experiments` with an opt-out time is an Art. 21 objection,
  C3) and `feature_audit_log` (actor id, actor kind `ui`, `mcp` or `env`, MCP
  client id, action, flag, target user id, flat `before` and `after` with the
  target id, the setting and the reason only, C5).
- **Evaluation.** A pure function (`server/utils/features/evaluate.ts`); the
  first step that decides wins: flag unknown, off; kill switch
  `NUXT_FEATURES_DISABLED`, off for everyone including admins; host mode or a
  missing binding, off; rule disabled, off; signed out, registry default;
  deny grant; allow grant (with its forced variant); allowed role; gradual
  rollout; registry default. The rollout step is skipped while
  `NUXT_FEATURES_ROLLOUT_ENABLED` is false (default, C2) or when the user
  objected (C3); otherwise the account is in when the first 4 bytes of
  `sha256(flag:salt:userId)` modulo 10,000 fall below the rule's share. A
  variant comes from a second hash, only on rollout results and only for a
  registry entry with `spend: 'none'` (registry spec and writer check, C4).
  A child flag is off when its parent is off. The evaluator sees only the
  user id, roles, grants and opt-ins: no country, email domain, usage or other
  attribute (C14). A feature with `spend` other than `none` is **active**
  only with the user's own opt-in, and the route guard requires it by
  default.
- **Admins.** An admin is a `user_roles` admin row or an address in the
  `NUXT_ADMIN_EMAILS` secret, always with a verified email (C13), and in
  production also with TOTP enrolled (C13b). The UI and API assign and revoke
  only `tester` (C7), so the env secret, which holds only the controller, is
  the only source of the admin role. Known limits: TOTP enrolment is not
  proof that the session passed a TOTP challenge (passkey and OAuth sign-ins
  skip it), and a `CI=true` variable on a deployed Worker would drop the email
  and TOTP checks (`docs/feature-flags.md`, section 6).
- **Admin area (`/admin`).** Every route answers 404 to non-admins and 401
  when signed out; writes are refused unless same-origin; bodies are strictly
  validated; the writer refuses a rollout share above 0 or variants while
  `NUXT_FEATURES_ROLLOUT_ENABLED` is false (409), and the UI disables those
  controls. User search (email prefix or name substring, at least 3
  characters, 20 results), the grant list and the audit view show the
  admin the account emails and names, read live from `users`. Reads are
  logged without the search text (C15). The pages are `noindex` and
  disallowed in robots.
- **Client.** `GET /api/v1/features` returns `enabled`, `active` and
  `variant` for exposed flags, never the bucket or the reason, with
  `Cache-Control: private, no-store`. The state lives in the server-rendered
  payload and page memory only, never in cookies or browser storage (C11), so
  ePrivacy Art. 5(3) is not engaged by this feature.
- **Labs (planned, P0-7).** `/profile/labs` lists the features the user can
  use, with an opt-in switch (default off) for features that spend the user's
  keys and the switch "Include my account in gradual rollouts and
  experiments" (default on) with one sentence on the right to object, which
  brings Art. 21(4) to the user's attention. Neither switch is exposed over
  MCP. Copy says "experimental, may change or be removed" and no email or push
  announces Labs features (C12).
- **Exposure telemetry (C1).** Only for hash-based decisions (reason
  `ROLLOUT`, the only result with a hash variant), once per flag per request:
  Workers Analytics Engine gets `feature_exposure`, flag, variant and reason
  (no bucket, path or user id); Axiom gets `attributes.features` on the wide
  event, which already carries the user id. Grant, role, default and
  anonymous results are never recorded, and the `/api/v1/features` listing
  records nothing.
- **Retention.** Roles and grants until revoked or the account is deleted (an
  expired grant stops applying, its row stays). Opt-ins and objections for the
  account's lifetime. Audit rows 365 days, deleted by the hourly
  `feature-audit-sweep` job (C6), and anonymised on account deletion (C5).
  Axiom lines 30 days. Analytics Engine about three months. Account deletion
  runs `purgeUserFeatureAccess` as the last step before the `users` row is
  deleted.
- **Who sees what.** The controller, as the only admin, sees every account's
  email and name in the admin area. A user sees only their own features. The
  controller's AI client (planned) sees user ids and grants only.
- **Restore.** A D1 Time Travel restore brings back withdrawn opt-ins (a
  feature could then spend a user's key again without consent), objections,
  revoked roles and grants and old rules, and rolls back the audit table with
  them. The replay source is the Axiom ledger, opt-outs and objections first,
  then role revocations, deny grants and grant revocations, then rule changes
  (`docs/d1-restore-reconciliation.md`, "Feature access", C8). Axiom keeps
  30 days, which matches the Time Travel window, so export the window from
  Axiom before restoring to an old bookmark. Limit: the rule ledger line
  holds only `enabled` or `disabled`, and a grant line no forced variant, so
  a changed rollout share, allowed roles, variants or forced variant cannot
  be rebuilt from Axiom; logging the full rule patch is a follow-up for
  P0-6. Until P0-7, an objection arrives by email and is written by hand;
  the email in the privacy mailbox is its record outside D1.
- **Release gate (C2).** Production keeps `NUXT_FEATURES_ROLLOUT_ENABLED`
  false until the notice `2026-11-experimental-features` takes effect on
  2026-12-19 **and** the Labs objection switch with its ledger line (P0-7)
  is in production, because the policy promises that switch before any
  rollout starts. Until then, features are granted only to the controller and to
  named testers who were told individually what is recorded and how to
  object.
- **Basis.** Section 4 and the assessment in section 4.1.

### 3.13 Artifacts -- runtime built, everything else planned

Phase 1 of the agentic capabilities programme (parent BES-225, tickets A-1
to A-8, A-11, A-14). Compliance pre-check: `docs/legal/prechecks/artifacts.md`
(A-12); its track rows are cited here as P1 to P15. Only the runtime Worker
(A-2, #751) is built and deployed; the rest is planned. Read every measure
below as `planned` unless it says `built`.

- **(a) Owner content.** The chat model writes an artifact with the
  `create_artifact` and `update_artifact` tools on the user's own send and key
  (A-3; at most 3 writes a turn), or a connected client writes it with
  `artifacts:write` (A-8). Kinds: HTML, React, SVG, Mermaid, Markdown.
  Content is stored in R2 under `artifacts/<userId>/<artifactId>/v<n>`, at most
  512 KB a version, 50 versions an artifact, 25 MB a user; metadata in D1
  (`artifacts`, `artifact_versions`: title, kind, origin chat and message,
  `createdVia`, sizes, SHA-256, optional `modelId`), with no foreign key to
  `users` or `chats` (A-1). Messages store only a reference part
  (`data-artifact`: id, version, kind, title), never the content. Up to three
  referenced artifacts, 30,000 characters each, go to the chat's provider as
  user data in the system prompt (A-3). Retention: until the user deletes the
  artifact or the account; **chat deletion keeps the artifact** (origin chat
  id nulled, shown as "Chat deleted" on the Artifacts page, A-11); versions
  are never pruned. Account purge deletes R2 objects first, then rows, and
  skips rows and objects under a legal hold (P3). Basis: contract; special
  categories under the chat consent, read as covering artifacts built in a
  chat (section 6, item 20).
- **(b) Runtime isolation.** Built (A-2): a separate Worker origin, assets
  only, no bindings, configured in one place
  (`NUXT_PUBLIC_ARTIFACTS_ORIGIN`; production
  `besidka-artifacts.chernenko.workers.dev`, same Cloudflare account, owner
  decision 2026-11-08). The frame is `sandbox="allow-scripts"` (opaque
  origin, no cookies or storage), and the document carries a header CSP:
  `default-src 'none'`, scripts and styles only from itself, `connect-src
  'none'`, `form-action 'none'`, `frame-src 'none'`, `base-uri 'none'`,
  `webrtc 'block'` (not enforced by Chromium or WebKit today; WebRTC is also
  removed from the frame), `frame-ancestors` limited to Besidka hosts; plus
  `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Libraries are
  vendored on that origin (React, ReactDOM, Recharts, lucide-react, Sucrase,
  Pele for Mermaid text, marked, DOMPurify); an unknown import fails in the
  frame and makes no request. **esm.sh is not used** (P5): no third party
  receives the viewer's IP address. A licence scan fails the build on a
  licence outside the allowlist, and `THIRD_PARTY_NOTICES.txt` is served from
  the runtime origin (P6). **Limit (P10):** a sandboxed frame can still
  try to navigate itself (`location.href`) to any address, with data in the
  URL; the page that replaces the runtime is not under its CSP. Two layers
  (`docs/artifacts-runtime.md`): **(1) primary:** every page that embeds
  artifacts sends `Content-Security-Policy: frame-src <artifactsOrigin>`,
  which the A-2 e2e spec shows blocks the self-navigation before its request
  leaves, in Chromium and WebKit, including targets that never fire `load`
  (a 204, a download); A-4 adds it to the chat and shared-chat pages, and
  **A-7 must add it to `/a/**` and the admin report drawer** (its
  `routeRules` set only `frame-ancestors 'none'` today); **(2) fallback:** the
  host treats any second iframe `load` as navigation and destroys the frame
  (built in `packages/artifacts-protocol`), and logs
  `attributes.artifacts.runtimeNavigation` with ids only. Without the
  `frame-src` header the URL and whatever the new page sends while it loads
  leave before the tripwire fires, and a 204 target is never detected.
  Firefox was not tested. No document may claim that the frame "cannot send
  data out" or that credential collection is impossible.
  A-14 (planned) adds a clipboard write from the frame, text only and only
  after a recent user gesture in the parent, and a full-screen request; no
  new network access.
- **(c) Viewer storage (A-5).** Per artifact and signed-in viewer
  (`artifact_storage`): opaque JSON written by the artifact's code, at most
  32 KB a value, 100 KB and 64 keys; 120 writes a minute. Only on the owner's
  own artifacts and on links with `storageAllowed`; signed-out viewers get page
  memory only. Every storage route requires `getLegalConsentStatus ===
  'current'` (P8). Never shown to the owner, the controller's UI, any model or
  MCP; logs hold ids and byte counts. **Not end-to-end private:** the
  artifact's code receives the values in the viewer's browser and can send
  them out as in (b), so no text may say the author "cannot" see them. Values
  can be special-category data (a symptom tracker), so they need the Art.
  9(2)(a) consent, which the current text does not name (section 6, item 20).
  Retention: reset, artifact deletion, account deletion; for non-owner
  viewers also 30 days after the last active link ends and at once on
  takedown (default; owner item 4 of the pre-check may change it).
- **(d) Public links (A-7, A-8).** `besidka.com/artifacts/<token>`; the token
  is 32 random bytes, stored as a SHA-256 hash for lookup and encrypted
  (`useEncryptText`) so the owner can copy the link again. The token is the
  last path segment of the link (owner decision of 2026-11-11, replacing the
  fragment form `/a#<token>` of 2026-11-09, which hid the token from every
  request URL). The page request therefore carries the token in its URL and
  Cloudflare Workers Logs record it on Cloudflare's side; this is accepted on
  the same basis as `/shared/<publicId>` chat links (Cloudflare is the
  processor, access is account-only, retention is short, `observability`
  unchanged). The page answers `Referrer-Policy: no-referrer` and
  `Cache-Control: private, no-store`, so the `Referer` and shared caches do
  not carry it; link unfurlers that fetch the URL do see it, as for any
  secret-in-the-path link. The page sends the token to the API only in the
  `x-besidka-artifact-share` header, and sign-in returns to the link through
  a `sessionStorage` key and `next=/artifacts/return`, never a token in a
  `next` query. The pre-check's ban on the raw token in Besidka's logs is
  kept: wide events, browser-ingested events and report details redact every
  `/artifacts/<token>` form (plain, in a URL, in a query value,
  percent-encoded once or more) to `[token]`, and every other path under
  `/artifacts` answers a plain 404. **Residual risk, changed:** a token now
  exists in Cloudflare's request logs and in browser history for the
  lifetime of those records, where the fragment form kept it out of both
  the request and the logs; revoking or expiring a link makes a logged URL
  useless at once.
  At most 10 active links an artifact; expiry from 1 hour to never; latest or
  pinned version; `storageAllowed` and `bridgeAllowed` start off.
  `X-Robots-Tag: noindex, nofollow`, robots meta, not in the sitemap and not
  in `robots.disallow` (so the `noindex` is read); `Cache-Control: private,
  no-store`; `Referrer-Policy: no-referrer`; no Web Analytics beacon; logs
  carry the share id. Banner "AI-generated by a Besidka user, not reviewed by
  Besidka.", a line warning against passwords and payment details, and a
  Report button, all outside the frame. A deterministic PII check
  (`detectSharePii`) warns before publishing. Revoke is soft (`revokedAt`),
  so a taken-down link stays recorded. **Grant-only:** `artifacts.share`
  stays a beta granted by hand until the owner decides the Cloudflare
  separation (P11; risk row 54). MCP links: separate unticked scope
  `artifacts:share` ("Publish artifacts as public links (up to 30 days)"),
  expiry 1 to 30 days required, storage and bridge forced off, the client id
  stored and shown to the owner as "created by connected app <name>", a daily
  cap (suggested 10, not fixed yet), PII warnings returned to the client.
  Artifacts inside a shared chat are readable by the chat's audience through
  a separate read-only route that honours takedown (A-4).
- **(e) Reports and takedowns (A-7, A-1).** Report form with name and email
  required except for `csam`; reasons `csam`, `terrorism`, `threat-to-life`,
  `phishing`, `copyright` (with the six notice elements), `privacy`,
  `illegal`, `harmful`, `other`; details 20 to 2,000 characters; good-faith
  box; Turnstile for signed-out reporters only; 5 reports an hour per user,
  or per IP keyed by an HMAC of the address (keyed with the existing
  encryption key, so KV never holds the address), expiring keys; no IP
  stored with a report. Receipts go only to the typed address of a
  signed-out reporter or the verified account email of a signed-in one, at
  most 3 per address per 24 hours, and name the content by reference id,
  never its title, so the form cannot be used to mail chosen text to a
  third party. Names refuse line breaks; share links pasted into the details
  are reduced to `/artifacts/[token]`. A user-scope takedown also writes a deny
  grant for `artifacts.share`. `threat-to-life`
  and `terrorism` set a priority and a subject prefix on the mailbox email.
  Emails: receipt to the reporter (DSA Art. 16(4)), decision with redress
  (Art. 16(5)), statement of reasons to the owner (Art. 17), sent no later
  than the takedown; templates in
  `docs/legal/content-incidents.md`. Admin actions: take down or reject a
  report with a 20 to 4,000 character statement; **take down by URL, token,
  artifact id or user without a report** (for a one-hour TCO order), at phone
  width, effective on the next request (no SWR cache), with an audit row.
  Takedown sets `takedownAt` on the artifact so `/a/`, the shared-chat route
  and the owner view all stop (410); it never deletes. `legalHoldUntil`
  preserves content and report rows for six months under a TCO order (Art.
  6), or at an authority's explicit request; no voluntary holds (the
  runbook keeps CSAM only as disabled content, never copied). Report rows
  outlive the artifact: deleted 12 months after closing, 24
  for a copyright removal. Emergency fallback: the global `artifacts` rule
  off. Runbook: `docs/legal/content-incidents.md`.
- **(f) AI bridge (A-6).** `POST /api/v1/artifacts/[id]/complete` on the
  signed-in viewer's own direct provider key (gateways refused), only on the
  owner's own artifacts and links with `bridgeAllowed`, never over MCP. The
  server runs `assertLegalConsent` and the model and provider transfer-consent
  checks before any provider call. The modal shows the artifact title, "the
  author of this artifact wrote these prompts, not you and not Besidka", the
  provider and model, the full prompt (scrollable, up to 8,000 characters),
  the maximum cost, the remaining calls and that the viewer's provider terms
  apply; no "Don't ask again" through a share link (session-only for the
  owner's own artifacts). Caps: prompt 8,000 characters, system 2,000, output
  2,000 tokens; 30 calls an hour per viewer and artifact, 200 a day per
  viewer; 30-second abort; no tools, memory, history or web search. Nothing
  stored; logs `attributes.artifactBridge` with ids, model, provider, tokens,
  cost and duration. Besidka's server sends the request, so Besidka is the
  exporter as in section 3.8a, and the per-provider Art. 49(1)(a) consent
  applies. The key holder, not the author, carries the provider's usage-policy
  exposure for a prompt a stranger wrote (P7).
- **(g) MCP (A-8).** Scopes `artifacts:read` ("Read your artifacts and their
  share links"), `artifacts:write` ("Create and edit your artifacts"),
  `artifacts:share` (above); deletion through the existing `data:delete`
  (`delete_artifacts`, at most 20 ids, `confirm: true`, also removes links and
  viewer storage, never report rows or held content). Content at most 200,000
  characters per create. No storage, bridge, report or takedown over MCP.
  Flags checked: `artifacts.mcp`, `artifacts`, `artifacts.share`,
  `artifacts.react`. The amendment to `docs/mcp-server.md` exclusion 2 is an
  owner-decided exception for artifacts only.
- **(h) AI Act marking.** Banner, in-app "AI-generated" badge,
  `<meta name="ai-generated" content="true">` on `/a/` and the shared-chat
  artifact view, a meta plus an HTML comment with the model id only in HTML
  exports, a comment in `.md` and `.svg` exports; `.jsx` and `.mmd` exports
  unmarked as source code. Details and open points:
  `docs/legal/compliance-review-2026-10.md`, section 3.2.
- **(i) Rollout.** Flags `artifacts`, `artifacts.react`, `artifacts.storage`,
  `artifacts.llm-bridge`, `artifacts.share`, `artifacts.mcp`, all `internal`
  (admin only) today. The public text is announced by notice
  `2026-12-artifacts` (effective 2026-12-19, the day the rollout gate opens).
  **Operating rule:** no grant of `artifacts.storage` or
  `artifacts.llm-bridge` to anyone but the controller until the consent
  wording decision (owner item 2) ships; `artifacts.share` stays grant-only
  until the Cloudflare separation decision; no percentage rollout of any
  `artifacts.*` flag before 2026-12-19.

### 3.14 Documents and provider code execution -- planned, D-2 built on a branch

Phase 2 of the agentic capabilities programme (parent BES-226, tickets D-2 to
D-8). Compliance pre-check: `docs/legal/prechecks/documents.md` (D-10,
BES-307); its questions are cited here as Q1 to Q14. The shared package D-2
(`packages/doc-renderer`, `docs/chats/documents-spec-package.md`) is built on
`feat/documents-spec-package` (PR #833) and is **not merged**. Everything else
is planned. Read every measure below as `planned` unless it says `built`. The
flags `documents`, `documents.pdf`, `documents.docx`, `documents.xlsx`,
`documents.pptx`, `code-execution`, `code-execution.files` and
`code-execution.skills` stay at stage `internal`, and must not reach `beta`,
until this section is merged, the code that builds each planned control has
shipped, and the Privacy Policy and Terms have been re-checked against that
code, with the provider pages re-read on the day and the date recorded here.

- **(a) Documents: four paths, one store.**
  1. *Client render (default).* The chat model calls `create_document` on the
     user's own send and key (D-4; at most 3 calls a turn). The server checks
     the spec against its bounds, writes it to R2 under
     `documents/<userId>/<documentPublicId>/spec.v<n>.json` and inserts a
     `documents` row. The browser fetches the spec (`private, no-store`),
     renders the file in a Web Worker on the user's device, validates it
     there, and uploads the bytes. The server validates them again and stores
     them as a private file.
  2. *Server render (fallback).* If the browser cannot render, the Worker calls
     `besidka-doc-renderer` through a service binding (D-3), which has no
     public route, no bindings to user data and logs no spec text, title or
     asset bytes (a test). Image bytes are read from R2 one at a time.
  3. *MCP.* A client with `files:write` supplies the content and Besidka
     renders it (D-5). No provider key is used. The content is the client's,
     so the file is marked as created by a connected app and not as AI output
     unless the client declares `aiGenerated`.
  4. *Provider container.* Files that a provider's code execution or skill
     made enter through `validate()` (part (b)).
- **(a1) What is stored.** The spec (any personal data the user discusses;
  strict keys, at most 200,000 characters, and 2,000,000 for a spreadsheet,
  100,000 cells, 60 slides, 20 images, about 200 pages), the `documents` row
  (owner, origin chat and message ids, format, **title**, status, render
  lease, spec key, size, file id, who rendered it, `createdVia`), and the file
  in R2 and `files`. No foreign key to `users` or `chats`, as for artifacts.
  The message keeps only a `data-document` reference part, never the spec. The
  chat's provider receives a short list of the chat's documents (title,
  format, id, up to 10) as part of the chat. Shared chats show the title only
  unless the share shows files.
- **(a2) Retention.** The spec and the file share one lifetime: the file's
  retention, 30 days by default or what the user set. Deleting the file
  deletes the spec object. **Deleting a chat deletes the files made in it and
  their specs**, unless the file is still referenced elsewhere (a file part in
  another chat, project knowledge); a branch copy holds only the document id
  and is not a reference. The ticket text said a deleted chat keeps its
  documents until the file expires; that is wrong for documents made in a chat
  and is corrected here and in the D-4 acceptance criteria. Where the file
  survives, the title and the origin chat id are cleared. A sweep removes rows
  with no file and no chat. A document made over MCP has no chat and lives
  until the file expires. Account deletion deletes the spec objects by prefix
  `documents/<userId>/` (batched R2 delete) and the rows. D1 Time Travel keeps the database row (title and ids) for up to 30 days;
  the spec and the file are in R2, which those backups do not cover.
  Spec objects are deleted by the paths `cleanupFilesOrphanedByChatDeletion`
  (single chat, single message and bulk chat delete), retention cleanup, bulk
  file delete and `purgeUserData`, with a test per path (D-4, planned).
- **(a3) Basis.** Contract, Art. 6(1)(b), as for files. For special
  categories the user includes: explicit consent, Art. 9(2)(a), the chat
  consent `2026-11-a`, which names chats, projects and files; files made in a
  chat are read as covered, the same judgment call as for artifacts (section
  6, item 20). A document a client supplies over MCP rests on the approval
  screen consent (section 3.11).
- **(b) Provider code execution (D-7) and Anthropic's document skills (D-8).**
  - *What goes where.* With "Run code" on for a message, the message's
    attachments are uploaded to the sandbox of the user's own provider for the
    turn (up to 10 files, 20 MB), and the provider receives the code the model
    writes and the files the code creates. Gemini takes the input inline.
    Besidka downloads the output files with the user's key, checks them (type
    allowlist, size caps, magic bytes), and stores them as the user's files.
    The message keeps a compact record of the code and its output (each cut
    to 32 KB), without provider file ids or encrypted payloads.
    Office and PDF outputs are stored only after `validate()` with a
    structural parse. Images are marked. `gif` is not marked by
    `markAiGeneratedImage`, so D-7 either removes it from the allowlist or
    stores it unmarked and logs that (Q10).
  - *Role and basis.* The provider is an independent controller on the user's
    own account, as in section 3.1 and row 4 of the Art. 30 record. Code
    execution is a processing operation inside the existing purpose "answer
    the user's message". The attachments already go to the provider under the
    chat consent. The Privacy Policy now says what the provider keeps.
  - *Providers.* Direct Anthropic, OpenAI and Google only. The server refuses
    the tool for xAI, DeepSeek, Moonshot AI, Qwen and every gateway model, so
    no Art. 49(1)(a) consent changes and no transfer is added. Adding another
    provider or a gateway needs a new review of this section, the Art. 30
    record (section 6.1) and the transfer consent first.
  - *Provider retention (read on 2026-11-07 for the pre-check, not re-read on
    2026-11-11).* Anthropic: code execution, the Files API and Skills are not
    zero-data-retention eligible; container data is retained up to 30 days;
    an uploaded file persists until it is deleted or expires and is visible
    to every key in the user's workspace; a deleted file "may persist in
    active Messages API calls"; expiry is not a guaranteed-deletion control;
    the pages do not say that a Files API delete reaches the container copy.
    OpenAI: a container is discarded after 20 minutes idle; the delete
    endpoint is verified; Files API objects stay until deleted; abuse logs up
    to 30 days; zero data retention for containers is unverified. Google:
    Files API files are deleted after 48 hours; on an unpaid key outside the
    EEA, Switzerland and the UK, content may be used and read by reviewers;
    sandbox retention and network access are not stated.
  - *What Besidka does.* When the stream ends Besidka deletes the files it
    uploaded, the output files the sandbox made that it downloaded and, at
    OpenAI, the container. If a send is cut off (a closed tab kills the Worker), uploads
    expire after one hour at Anthropic and OpenAI, and the OpenAI container
    after 20 minutes, so the object stays bounded. Files the Anthropic sandbox
    makes stay in the user's own Anthropic workspace until the user deletes
    them, and Anthropic container data (up to 30 days) has no delete API. It prefers inline input. It never enables sandbox
    network access and never sets an OpenAI `network_policy` (a test).
  - *Money.* The row shows the provider's price from config (rates live in
    `wrangler.jsonc`, like web search) and says that Anthropic bills attached
    files even when no code runs and that free hours depend on the user's
    organisation. It is off for each message, with a one-time confirmation per
    provider. MCP has no route to it, because it spends the user's key.
  - *Skills (D-8).* Besidka references a fixed list of four Anthropic skill
    ids (`docx`, `pdf`, `pptx`, `xlsx`) on the user's own Anthropic key and
    bundles, vendors and redistributes none (an owner choice, not a legal
    need). The terms of the hosted skills are not stated in anything read, so
    the records and the UI say neither "proprietary" nor "open source" for
    them. Skills are not zero-data-retention eligible.
- **(c) Marking of AI output (Art. 50(2)); detail in
  `docs/legal/compliance-review-2026-10.md`, section 3.2.** Besidka is treated
  as the provider of the AI system (Commission Communication C(2026) 7702 of
  5.11.2026, para 11). Rendered documents are read as "text" (para 60); the
  JSON spec is out of scope as a machine-readable specification (para 68). The
  Commission guidelines do not name office or PDF formats, so this reading is
  the draft's own. D-2 (built on the branch) writes the mark into every file
  it renders: OOXML `docProps/custom.xml` with `Iptc4xmpExt:DigitalSourceType`
  and `Iptc4xmpExt:AISystemUsed` (the model id only), and for PDF an
  uncompressed XMP stream with the same IPTC fields. No prompt, user id or chat
  id is ever written. `validate()` reports three states: `ai`, `channel-only`
  (MCP content the caller wrote) and `missing`. The server rejects or
  relabels `missing` files on the chat path. `stampDocument` adds the mark to
  a provider-made OOXML or PDF file without re-rendering (the PDF is rewritten
  with pdf-lib).
- **(d) Residuals the D-2 package records itself.**
  1. *PDF cross-reference table not modelled.* The PDF scan is structural and
     linear (names decoded, object streams inflated, `/URI` schemes checked)
     but ignores the cross-reference table, so a polyglot that hides an object
     where only a viewer's table points is not modelled. Files Besidka renders
     itself are not at risk; provider-made PDFs should go through
     `stampDocument`, which rewrites the file.
  2. *An orphan XMP stream reads as marked.* A PDF whose catalog does not
     point to the metadata stream, but which holds one, still reads as marked.
     This is a false positive for the mark, not for the security checks.
  3. *Cached formula values are not written.* The spec accepts `cached`
     values but the renderer does not write them, so a viewer that does not
     recalculate shows empty formula cells. This is an accuracy limit, not a
     security one (risk row 71).
- **(d1) Access and export (Arts. 15 and 20).** Documents are files, so they
  are in the user's file list and can be downloaded. The specs and the
  `documents` rows are included in an access or export request by email, like
  the other data in row 14 of the Art. 30 record.
- **(e) Third-party code.** Five renderer libraries and one font, all under
  permissive licences, no veto (Q1). `THIRD_PARTY_NOTICES` is generated from
  the real client and Worker bundle graphs and compared by a test; legal
  banners survive the build; versions are pinned by a boundary test. No
  Node, DOM, network, `eval` or `new Function` code is allowed in the package
  source (a test). The font and every asset are same-origin, with no CDN
  (as risk row 26).
- **(f) Status.** Built on `feat/documents-spec-package` (PR #833, not
  merged): the spec, validator, renderers, provenance stamp, CSV escape helper
  (`escapeCsvCell`), notices collector and browser smoke. Planned: D-3 (the
  renderer Worker), D-4 (tool, routes, cards, deletion hooks, labels), D-5
  (MCP tool and label), D-6 (docs), D-7 (code execution), D-8 (skills).
  Whether CSV export ships in v1, and its Excel round-trip residual (OWASP:
  a leading apostrophe is not reliable after Excel re-saves the file), are
  open for D-2 and D-4 **[U]**.

## 4. Necessity and proportionality

**Purposes and bases.**

| Processing | Basis |
|---|---|
| Store chats, send them to the chosen provider | Contract, Art. 6(1)(b) |
| Special-category content the user chooses to include | Explicit consent, Art. 9(2)(a), in addition to the contract basis |
| Memory entries the user writes or asks the assistant to save | Contract, Art. 6(1)(b) |
| Chat search tools | Contract, Art. 6(1)(b) (judgment call) |
| Project knowledge | Contract, Art. 6(1)(b) |
| Background extraction | Consent, Art. 6(1)(a) |
| Explicit runs (Refresh, Update now, backfill, import) | Contract, Art. 6(1)(b) |
| Compliance gate | Legitimate interests, Art. 6(1)(f), plus the chat consent |
| TypeSafe AI checks the user leaves on | Contract, Art. 6(1)(b), because the user added the key and left the check on; for sensitive text, also the chat consent |
| Consent and opt-in records | Legal obligation to prove consent, Art. 6(1)(c) with Art. 7(1) (judgment call) |
| Transfers to providers with no adequacy decision | Explicit consent to the transfer, Art. 49(1)(a) (built) |
| Terms and age record | Legitimate interests, Art. 6(1)(f): proving the user agreed and is an adult |
| Connecting an AI app and giving it the data the user approved | Contract, Art. 6(1)(b), at the user's request (judgment call, section 6, item 13); for special-category content, explicit consent, Art. 9(2)(a), on the approval screen |
| Rate limiting, abuse handling and disabling a client | Legitimate interests, Art. 6(1)(f) |
| Feature access set by the admin (roles and grants, section 3.12) | Legitimate interests, Art. 6(1)(f) (section 4.1) |
| Gradual rollout and variant split, and the exposure telemetry | Legitimate interests, Art. 6(1)(f) (section 4.1). Not profiling. Objection through the Labs switch or by email |
| Opt-ins to features that spend the user's keys | Contract, Art. 6(1)(b), at the user's request |
| Objection records (`experiments` key) | Legal obligation, Art. 6(1)(c) with Art. 21 (judgment call, like the consent receipts) |
| Feature access audit log and the `featureAccess` log lines | Legitimate interests, Art. 6(1)(f) (section 4.1) |
| The controller's AI client with `admin:features` (planned) | Legitimate interests, Art. 6(1)(f), as for the admin area |
| Artifacts and their versions (section 3.13) | Contract, Art. 6(1)(b); special categories under the chat consent (section 6, item 20) |
| Public artifact links | Consent, Art. 6(1)(a), per link |
| Artifact viewer storage and AI calls on the viewer's key | Contract, Art. 6(1)(b), at the viewer's request; explicit consent, Art. 9(2)(a), **open** until the consent text names them (section 6, item 20); for the bridge, Art. 49(1)(a) per provider as for chats |
| Artifact reports, takedowns, preservation and notices to authorities | Legal obligation, Art. 6(1)(c), where EU or Polish law requires action (TCO orders and Art. 6 preservation; DSA Art. 18 if the DSA applies); otherwise legitimate interests, Art. 6(1)(f) |
| Frame navigation tripwire, report rate limits, Turnstile on the report form | Legitimate interests, Art. 6(1)(f): protecting visitors and the service |

**Why this is necessary.** Besidka cannot store and forward a chat while leaving
out the parts that happen to be health or belief. That would mean reading every
message, which is more intrusive. What the user types is the service. This is
the inseparability argument. It is the reason the explicit consent is required
to send messages. It is a judgment call (section 6, item 1).

**Why this is proportionate.**

- **Minimisation.** Caps on entries and sizes. A never-store list that applies
  even on request. "Store the preference, not the reason." Bounded extraction
  input. No files, tool results or web results in extraction.
- **Opt-in where it profiles or spends money.** Extraction is off by default.
  There is no background model call on a user's key without an explicit opt-in.
  The opt-in is the account switch or, for one project, that project's `on`
  setting; the project's default is `inherit`, and a connected app cannot set
  `on`.
- **No secondary use.** No training, no advertising, no sale, no scoring.
- **TypeSafe AI checks.** Optional, tied to the user's own key, each with its own
  toggle. Each sends only the text that check needs and fails safe to the
  behaviour without it. The pre-filter and the share check send the most text;
  both can be switched off alone.
- **Accuracy.** Memory can be wrong. The user can see, edit and delete every
  entry. The Terms say so.
- **Transparency.** Privacy Policy sections on sensitive information, memory,
  profiling and transfers. The Memory page states what is never kept.
- **Rights.**
  - Access and portability: Export JSON on the Memory page (entries and
    settings). It omits project knowledge and technical records. For
    everything else the user emails the published privacy address.
  - Erasure: per-entry delete, Reset, delete chat, delete project, delete
    account. Deleting a chat removes generated entries that came only from it.
    Entries the user saved stay, because the user asked for them.
  - Withdrawal: switch extraction off and set every project that is On to Account setting or Off, withdraw the chat consent, remove a key.
  - Backups: copies can survive up to 30 days in D1 Time Travel.
- **Alternatives considered.** Reading no chat text for memory at all (rejected:
  it removes the feature). A model-based classifier (rejected: it would send
  text to another model to decide whether to send it to a model). An opt-in for
  sensitive memory (removed from v1 by the owner on 2026-10-25, see
  `docs/legal-memory-sensitive-data.md`). An ephemeral chat mode (not built,
  would give users who refuse consent a real alternative).

### 4.1 Legitimate-interests assessment: feature access, rollouts and experiments

Written under Art. 5(2) for the Art. 6(1)(f) purposes of section 3.12. It
also supports the Privacy Policy statement of the interest (Art. 13(1)(d)).

**Purpose.** Three interests. (a) Releasing features safely: a feature that
fails reaches the controller, a few testers or a small share of accounts,
not everyone. (b) Learning which variant of a non-spending feature works
better. (c) Accountability and security of access changes (Arts. 5(2) and
32): who changed whose access, and the replay after a D1 restore. All three
are lawful, specific and present, because the Phase 0 code is built and every
later feature track ships behind it.

**Necessity.**

- Releasing to everyone at once loses (a). An opt-in-only beta in Labs is
  also offered, but a self-selected group says little about a release, so a
  random share is needed for (a) and (b).
- The assignment uses the user id only, through a salted hash, and is
  computed instead of stored. Without an identifier the assignment would
  change between requests, which breaks the feature it is meant to test.
- No attribute is used (C14). The exposure event drops the bucket, the path
  and the user id (C1). Audit rows and log lines carry ids, never emails or
  free text (C5, C8, C15).
- 12 months for the audit log covers one yearly review of this DPIA, and it
  matches the 12-month record for content reports (Art. 30 record, row 14a).
  30 days in Axiom matches the 30-day D1 Time Travel window, which is the
  period the restore replay needs.

**Balancing.**

- Data: an account id, flags and timestamps. No content, no special
  categories, no attribute of the person.
- Effect on the person: a feature earlier or later, or one of two variants
  of a feature that spends nothing. No price changes (there is none), no
  rights change, and a variant never changes what is spent on the user's keys
  (C4). A spending feature always needs the user's own opt-in. No Art. 22
  effect.
- Reasonable expectations: users of a free service with a Labs page can
  expect features to appear gradually, and they are told 30 days in advance
  by email and in the app before any rollout share or variant is switched on
  (C2).
- Risks: confusion from different screens, a tiny-cohort re-identification of
  exposure events (row 42), and admin access to emails (rows 38 and 44).
  Users are adults only (age gate).
- Safeguards: C1, C2, C3 (objection switch, on by default, with the Art.
  21(4) sentence), C4, C5, C6, C7, C8, C11, C12, C13, C13b, C14, C15.

**Result.** The interests are not overridden. For rollouts and variants, an
objection is honoured without a balancing test: the evaluator skips those
steps for the user. A user who does not want a role or a grant set by hand
has it removed on request. For the audit log and the log lines, an objection
is assessed case by case under Art. 21(1): the controller keeps the record
only where it can show compelling legitimate grounds that override the
user's interests, rights and freedoms (for example, an open question about
who changed an access), or needs it for legal claims, and tells the user the
outcome.

**Why not another basis.** Contract (Art. 6(1)(b)) is weaker for rollouts
and experiments, because the EDPB treats service improvement as generally not
necessary for the contract (Guidelines 2/2019). Consent would make a random
share impossible to keep random. Opt-ins to spending features do rest on the
contract, because the user asks for the feature.

## 5. Risks and measures

Likelihood and severity use three levels: low, medium, high. **Residual** is
the level after the measures that are built. **Status** is `built` (in the
code) or `planned` (named in the legal-changes plan, not shipped).

| # | Risk to people | Likelihood | Severity | Measures | Status | Residual |
|---|---|---|---|---|---|---|
| 1 | Special-category data in chats is processed with no valid basis | High | High | One-time explicit consent, separate from the Terms, server-enforced, versioned receipt (`2026-11-a`); Privacy Policy rewritten to state the basis | built | Medium |
| 2 | The extractor infers special-category data and stores it as memory | Medium | High | Deterministic Art. 9 classifier on every write path; extraction input contains user messages only; extraction is opt-in; entries carry the source chat for deletion | built | Medium (classifier can miss) |
| 3 | Credentials, card or ID numbers, home address, immigration or criminal history reach memory or the extraction model | Medium | High | Never-store detectors with checksums on every write path; the same redaction applied to extraction input and import chunks; logs hold counts only | built | Low |
| 4 | Third parties' special-category data (for example a relative's illness) | Medium | High | Classifier rejects detectable cases in memory; Terms duty on other people's data; delete on request; advice text | built | Medium (chats cannot be filtered) |
| 5 | Criminal-offence data (Art. 10) in chats | Low | High | Never-store rule keeps it out of memory; advice to keep it out; delete on request | built | Medium (no lawful route exists, see section 6) |
| 6 | Text read from the web, a file or another chat steers the model into writing or deleting memory (prompt injection) | Medium | Medium | Web-search write lock set before the first step on any requested web search; lock after any non-memory tool result; `userRequestQuote` must match the user's current message; external markdown images blocked at render; knowledge wrapped as data, never instructions | built | Low |
| 7 | One user reads another user's memory, chats or knowledge | Low | High | Ownership enforced inside the SQL statement, not after it; R2 keys derived on the server from the session user and a verified project; model-supplied ids resolve only inside the already scoped set; shared chats strip tool calls and use signed, expiring file tokens | built | Low |
| 8 | Chat content sent to DeepSeek (PRC) or Moonshot AI and Qwen (Singapore) with no adequacy decision and no contract | Medium | High | Provider choice is the user's; transfer notice in the Privacy Policy naming the country; explicit transfer consent (Art. 49(1)(a)) when a key is added and at the next send for existing keys; withdrawal per provider; refusal blocks sending to that provider and memory use | built | High, accepted and disclosed (section 6) |
| 9 | Chat content sent to US providers that may not be certified under the EU-US Data Privacy Framework | Medium | Medium | DPF list checked on 2026-10-26: Google LLC, Vercel Inc. and Cloudflare, Inc. are active participants (Cloudflare's status reads "Active - Re-certification under Review"); no entry found for Anthropic, OpenAI, xAI or OpenRouter under any name checked. The policy states the mechanism each publishes: SCCs under their own terms (Anthropic Ireland Limited, OpenAI Ireland Ltd and SpaceXAI LLC named in their terms; OpenRouter per its privacy policy). The policy says Besidka's server is the exporter | built (text); owner re-checks the list periodically | Medium |
| 10 | The provider keeps, reviews or trains on the content (free Gemini outside the EEA, Exa search queries) | Medium | Medium | Policy paragraphs per provider; advice to use paid keys; no training by Besidka | built (text) | Medium, outside Besidka's control |
| 11 | Production's project-memory summaries already hold Art. 9 data sent to a provider the user did not pick | Medium | High | The background refresh after every answer is gone from this release (only the explicit Refresh and the opt-in extraction remain, both behind the consent gate); disclosure; legacy blob passes never-store redaction on migration; user can edit or delete | built | Medium (the past cannot be cured) |
| 12 | Project knowledge files contain sensitive data and reach the model | High | Medium | Covered by the chat consent; panel says knowledge goes to the send's provider; optional client-side warning for credentials | partly built | Medium (no classifier on knowledge) |
| 13 | Consent cannot be proved, or was never given (OAuth sign-ups, existing users) | High | Medium | Per-user receipts for chat consent, Terms and age; gate for everyone; records kept while the account exists | built | Low |
| 14 | Memory is wrong, stale or reveals more than the user expects | Medium | Low | Visible, editable, deletable entries; "Saved to memory" chip with Undo; memory can be switched off per account and per project | built | Low |
| 15 | Spend on the user's key without consent | Medium | Low | Extraction off by default; no implicit history; backfill shows an estimate and has ceilings of 200 chats and 4 million tokens; explicit runs are billed to the user's key and say so | built | Low |
| 16 | Deleted data survives in backups, exports or shared chats | Medium | Medium | Time Travel backups roll off in 30 days and are stated in the policy; deletion cascades through chats, projects, files, memory and knowledge; R2 batch deletes; sweeper removes orphan objects; revoked shares stop access immediately | built | Low to medium |
| 17 | Storage abuse or runaway growth through uploads or knowledge | Low | Low | Per-user storage quota (20 MB default) counting files plus extracted knowledge text; per-project and per-user item caps; quota uses real body size, not the header | built | Low |
| 18 | Memory text leaks through logs | Low | High | Wide events carry counts, outcome labels, category ids and model names only; audit and consent datasets separate | built | Low |
| 19 | Account takeover exposes all chats and memory | Low | High | Better Auth, rate limits, Turnstile, optional TOTP and passkeys, encrypted API keys, sessions in KV | built | Low |
| 20 | The optional TypeSafe AI memory check sends candidate entries, which can hold special-category data the rules missed, to a young US vendor: out of stealth about six weeks (2026-09-15), its DPA marks sensitive-data safeguards "N/A", retention "as long as necessary", no SLA, not on the DPF (SCCs Module 2 and UK Addendum only) | Low | Medium | Only with a key the user saves; only entries the deterministic gate already allowed, redacted for never-store values; source excerpts redacted and dropped when the gate flags them; add-only, so an outage or a wrong answer can never let sensitive text in; fails open to the gate on 401, 429, 529, network errors and a 2.5 s timeout; model pinned; counts only in logs; disclosed in the Privacy Policy and on the keys page | built | Medium (vendor maturity and contract terms are outside Besidka's control) |
| 21 | The memory pre-filter sends whole chat transcripts, which can hold special-category data the user wrote, to a US vendor before memory is generated | Medium | High | Only with a key the user saves and a toggle left on; never-store values removed first; chunks of up to about 8,000 tokens; runs only when memory generation already runs behind the consent gate; unsure or unavailable means normal extraction; counts only in logs; the user can switch the check off alone; disclosed in the Privacy Policy | built | Medium (the transcript leaves Besidka to a vendor with weak contract terms, same as row 20) |
| 22 | Auto web search and the share check send chat text (message and recent turns; the chat being shared) to the vendor | Medium | Medium | Auto web search sends only in the Auto mode; the share check only when the user starts a share; both only with a key and a toggle; a failure means a normal search or a generic reminder; the share check warns and never blocks; counts only in logs; disclosed in the Privacy Policy | built | Low to medium |
| 23 | Injection screening sends project knowledge and third-party web text (Brave and Exa results) to the vendor | Medium | Medium | Only with a key and a toggle; project files are the user's own content already covered by the consent; web text is public; never-store values are removed before sending; results from a model's built-in search are never sent; Besidka stores no screened text for this check (the re-screening queue holds item ids only, 14 days); counts only in logs; whether this third-party text fits the consent wording is an open owner and counsel question (`docs/legal.md`) | built | Medium |
| 24 | Attacker-crafted content makes screening withhold legitimate results or files (false positive), or evades it (false negative). This includes text written against Jev itself, to make it flag a legitimate document or result | Medium | Low | Screening is an add-only signal, never the only defence: the memory write lock (set for every Brave or Exa search whatever the verdict), the data-not-instructions wrapping and the memory gate in row 6 stay, and a clean verdict never relaxes any of them; a flag never deletes anything, so the worst a manipulated flag can do is ask the user to review a file (one "Allow anyway" click puts it back, and it is not screened again until its text changes) or leave one web result out of the model's context, with a note saying how many were withheld; a Jev failure keeps the file usable and the results in context; thresholds come from an eval and are re-tuned on real traffic; the toggle turns it off; results from a model's built-in search cannot be screened and rely on the other defences alone | built | Low |
| 25 | A chat published by a share link exposes its content, third parties' data and the author's identity to anyone, and can be indexed or copied | Medium | High | Privacy by default (Art. 25(2); EDPB Guidelines 4/2019): every extra on a new share (search indexing, files and generated images, message metadata, author name and avatar, branching) starts **off**, the user switches on only what they want; indexing is its own opt-in; the link duration starts at "never" but the user can pick an expiry, and a share can be revoked; file access uses signed tokens that expire after 1 hour; tool calls are stripped; the optional TypeSafe AI share check and the built-in detector warn before publishing (row 22); the Terms and Privacy Policy say plainly that revoking cannot recall caches, archives or copies. The SQL column defaults stay `DEFAULT true` (changing them rebuilds `chat_shares` on D1 and cascades `chat_share_files`), which is harmless because the route writes every flag explicitly (`docs/d1-restore-reconciliation.md`). Shares created before 2026-10-28 keep their saved flags | built | Medium (a published link is public; copies cannot be recalled) |
| 26 | A visitor's IP address and browser details reach Google or GitHub (avatar host) or font and icon services just by opening a share page, or by using the app | Medium | Low | Fonts (Nunito, Atkinson Hyperlegible Mono) and icons are served from besidka.com and the Iconify API fallback is disabled; the share author's avatar, when shown, is delivered through a same-origin proxy (`server/api/v1/shared/[slug]/avatar.get.ts`, allowlisted to real Google and GitHub avatar URLs, answers cached privately for 5 minutes), so visitors to a **share page** do not contact Google or GitHub and the raw avatar URL is never sent to them; third-party scripts stay at two, both Cloudflare (Turnstile on auth pages, Web Analytics only after consent). **Residual:** inside the app a signed-in user's own avatar (`Chat/Message.vue`) is still loaded by their own browser from Google or GitHub, which receive that user's IP address; it is their own account and their own data, and the host is the one they signed in with | built for share pages, fonts and icons | Low |
| 27 | A user who disputes a copyright removal could have their name and contact details passed to the complainant; a false or abusive notice takes down a user's content | Low | Medium | The user's name and contact details are passed to the complainant only with the user's consent (Terms "Copyright complaints", Privacy Policy "Reports and notices about content"); no US DMCA agent is designated (owner decision 2026-10-28) and no US safe harbour is claimed, so nothing in the procedure requires forwarding; a notice needs its elements and an accuracy statement, a person decides, the user gets a statement of reasons and can challenge it, and the false-notice warning is stated; retention is until the matter is closed plus 12 months, and 24 months for the note on a copyright removal | built (text and procedure) | Low |
| 28 | An access or refresh token is stolen (leaky client, log, shared machine) and used to read chats, projects and memory | Medium | High | Access tokens last 15 minutes. Refresh tokens rotate on use and a replayed one is rejected (the library keeps a replay window). PKCE is required. Tokens are bound to the client and the scopes granted and carry only the MCP resource audience. The user can revoke in Profile → Connected apps. Tokens are never logged. Whether token values are stored hashed in `oauth_access_tokens` and `oauth_refresh_tokens` **[U]** | built (the `[U]` items stay open) | Medium |
| 29 | Over-broad consent: the user ticks every scope without understanding it, or a client later asks for more than the user expected | Medium | High | Eleven narrow scopes (five read, six write); write scopes unticked by default, each its own tick, and shown apart from read scopes, with the screen saying that write access can change or delete chats, projects, files, memory and settings; the screen names the client, shows the redirect host and says in plain words that chats, projects and memory can hold sensitive and third-party data and that approving is explicit consent to send it to that app; a client cannot widen scopes without a new approval; no `skip_consent` for dynamically registered clients **[U]**; the approval is recorded with scopes and time | built (the `[U]` items stay open) | Medium |
| 30 | A malicious or impersonating client registers itself (dynamic registration is open, no account) under the name of a well-known app and phishes consent, or registers redirect URIs it should not | Medium | High | Registration is rate limited per IP and capped; redirect URIs validated (https or loopback only); the screen shows the name as unverified, the redirect host and the registration date, never a client-supplied logo or link as proof; the user must be signed in with Besidka's own session; PKCE; Besidka can disable a client (`oauth_clients.disabled`) and revoke its tokens; the Terms allow it. A registered client cannot set `skip_consent` or `enable_end_session` without owner action **[U]** | built (the `[U]` items stay open) | Medium (a convincing name still works on a careless user) |
| 31 | An agent is steered by text it reads (a chat, a note, a web page in its own context) into writing bad instructions, notes or memory entries, or into deleting memory (rows 36 and 37 cover deletion and scope growth) | Medium | Medium | Write scopes are separate and off by default; writes are gated by the consent gate; memory writes pass the never-store and sensitive-topic gate (3.7); entry and size caps (30 account entries, 15 per project, 4 KB); entries created over MCP carry an origin that names the client so the user can find and remove them; the user can see, edit and delete everything; logs record client, tool and status for each write; the Privacy Policy warns the user | built | Medium |
| 32 | Rate limiting by IP address breaks for connectors that call from shared egress ranges of the AI vendor: one noisy user locks out all others, or one abusive user hides in the crowd | Medium | Low | Limits keyed by the user id from the token (120 private calls and 30 write calls a minute), not by IP; a separate per-IP limit only for the unauthenticated registration and authorization endpoints; counters in KV with the existing rate-limit helper; per-request result caps | built | Low |
| 33 | After the user revokes a client, its JWT access token keeps working until it expires | Medium | Medium | Closed by design: every `/mcp` call, reads and writes, checks in one D1 batch that the user exists, the client is enabled and a live `oauth_consents` row exists, so disconnecting (which deletes the consent and the tokens) stops the app on its next call. The 15-minute access lifetime only bounds a token whose consent row somehow survived, for example a failed delete; removing a single permission works the same way, because the scopes a call may use are the token's intersected with the live consent row; a lookup failure answers 503, not data. The Privacy Policy and Terms say the app stops at once | built | Low |
| 34 | Sensitive and third-party data reaches an AI client run by a company outside the EEA with no adequacy decision and no safeguard Besidka can provide; the characterisation under Chapter V is unsettled | Medium | High | The user chooses the client and directs the disclosure; nothing reaches a client the user did not approve; the screen states that the app may be outside the EU and that Besidka has no contract with it, and the approval is meant to double as explicit Art. 49(1)(a) consent if the disclosure is a transfer; the Privacy Policy says the question is not settled; sending chat messages and API keys are out of scope for this release | built | Medium to high, accepted and disclosed (section 6, item 12) |
| 35 | OAuth records outlive the account: `oauth_consents`, `oauth_access_tokens` and `oauth_refresh_tokens` reference `users` with no `ON DELETE`, so they are not removed by the cascade | Medium | Medium | The account-deletion path must delete the user's OAuth rows explicitly before the user row, and the same for Time Travel restore reconciliation (`docs/d1-restore-reconciliation.md`). Must be verified before release **[U]** | planned | Low once verified |
| 36 | A connected app, or an agent steered by text it reads, deletes or overwrites the user's data (chats, messages, projects with their knowledge and project memory, files, memory entries) or changes settings, and the user cannot get it back | Medium | High | Every write scope is off by default and a separate tick; all permanent deletion sits behind its own scope, `data:delete`, which no existing approval holds and which a "Change" scope does not include, so an app that only needs to read, add notes or rename never holds a delete power; the consent screen says in words that write access can change or delete; every destructive tool carries `destructiveHint: true` so a client asks the user first (a unit test fails when the annotations and the tool map disagree); `delete_project` needs the exact project name as `confirmName` and `reset_memory` needs `confirm: true`; batches are capped (25 chats per call, 100 files, 100 knowledge items, 90 share revocations); deleting or branching a chat that is generating a reply is skipped or refused, on a best-effort basis (a check of the generation lease, not a lock); deleting a project keeps its chats; deletes are limited to 20 calls an hour and writes to 30 a minute per user, which slows a runaway agent but does not stop it from deleting within those limits; settings that spend the user's keys or change the data recipient cannot be changed (`docs/mcp-server.md`, "What MCP does not do (and why)"); the user can disconnect an app in Profile → Connected apps and the next call fails at once, or remove just `data:delete` or any other permission there and the next call is refused for that tool (the effective scopes are the token's intersected with the current approval). **Residual:** deletion is permanent, as in the app, and narrowing helps only a user who opens that page: an app the user never reviews keeps what it was given, and a consent row whose scope list cannot be read grants the app no scope until the user approves it again (it fails closed, so it is a damaged row, not a way round narrowing). A "Change" scope cannot delete those records directly but has side effects: excluding a chat from memory removes extraction-only memory entries learned only from it, stopping a share removes its link, editing replaces the old text (instructions, knowledge items, memory entries, file names, favourites) and switching project memory off resets its state. D1 Time Travel is disaster recovery for the whole database, not a per-user undo, and restoring it for one user would roll back every other user (`docs/d1-restore-reconciliation.md`). A client that does not ask before a call can still delete what its scope allows, within the caps. The Privacy Policy and Terms say deletions through an app are permanent | built on `feat/mcp-ui-parity`, not yet deployed | Medium, accepted and disclosed |
| 37 | Scope growth: a client registered before the write scopes existed may ask for them, and a stored approval could be read as covering them, so an app gains delete power the user never ticked | Low | High | Any client whose stored scope list is a strict subset of the current one may *ask for* the new scopes (the `hooks.before` upgrade on `/oauth2/authorize`, `server/utils/oauth/client-scope-upgrade.ts`: a stored list that is a strict subset of the current scopes is rewritten, anything else is left alone, a failure never blocks sign-in). The user's `oauth_consents` row is not widened: authorize sends the user to the consent page whenever a requested scope is not in their row, so the user ticks each new scope on the screen. A tool behind a scope the user did not grant answers `403 insufficient_scope`. An existing connection that never asks for the new scopes keeps working with what it had. **Residual:** consent is stored per scope name, so when a tool is added behind a scope the user already granted, the existing approval gets it with no new prompt. Deletion is closed off by `data:delete` (`delete_memory` moved there from `memory:write`, so existing connections lose it until the user ticks the new scope). What did reach existing approvals involves no deletion or spend, though overwrites are possible: under `projects:write`, `update_project` (rename, pin, archive, knowledge mode, project memory switch, and `memoryAutoUpdate` set to `inherit` or `off`, which is spend-free but can overwrite a project the user set to `on`) `update_project_knowledge_item`; and, under `files:write`, `create_document` (planned, D-5: a private file from content the client supplies, inside the 20 MB quota, no deletion or spend; the consent label changes from "Create text files and rename files" to one that names documents, a clarification that changes future consent screens only); under `chats:read`, `list_shared_chats` and share status (the URL needs `chats:write`). The Privacy Policy says this and tells the user to check Profile → Connected apps after such a change. Future extensions of an existing scope must involve no deletion or spend, though overwrites are possible. The user can remove permissions from an approval and never add them there; adding one goes through the app's own OAuth flow, because a token keeps the scopes it was issued with, so narrowing cannot be used to widen. A removed scope is asked for again on the approval screen if the app requests it, and the hourly sweep deletes approvals with no live token that were unused for 30 days, so a long-stale approval cannot silently cover a later authorization | built on `feat/mcp-ui-parity`, not yet deployed | Low to medium, accepted and disclosed |
| 38 | An admin account is taken over and the attacker reads every user's email and name through the admin search, the grant list and the audit view | Low | Medium | Admin only from the `NUXT_ADMIN_EMAILS` secret (or a hand-made `user_roles` row) with a verified email, and in production TOTP enrolled (C13, C13b); the UI cannot make a second admin (C7); reads logged with actor, resource and count (C15); Better Auth rate limits and Turnstile; owner action: enable TOTP before the first admin use | built on the Phase 0 stack | Low (TOTP enrolment is not a per-session challenge, passkey and OAuth sign-ins skip it) |
| 39 | An unauthorised or mistaken admin action: a cross-site request, the wrong account, or a feature switched off for everyone by accident | Low | Medium | `requireAdmin` first in every handler (404 otherwise); same-origin check on writes; strict schemas; confirmation before turning a feature off; one audit row and one Axiom ledger line per write; `NUXT_FEATURES_DISABLED` as the instant switch; rollout and variant writes refused while the env flag is off | built on the Phase 0 stack | Low |
| 40 | Text read by the controller's AI client steers it into granting or denying features (prompt injection) | Low | Medium | `admin:features` only for the admin account; per-account writes only, no rule, rollout or kill-switch change over MCP; write rate limit; `destructiveHint` so the client asks first; a spending feature still needs the user's own opt-in; audit rows with actor kind `mcp` and the client id | planned (P0-8) | Low once built |
| 41 | A variant or rollout raises what is spent on a user's key | Low | Medium | Variants only for `spend: 'none'` (registry spec and writer check, C4); a spending feature is active only with the user's own opt-in, which the route guard requires by default; no MCP path to opt-ins | built on the Phase 0 stack | Low |
| 42 | An exposure event in Analytics Engine is linked back to a person | Low | Low | No bucket, path or user id in the event (C1); exposure only for hash-based decisions; the Privacy Policy treats the events as pseudonymous personal data and does not call them unlinkable; Axiom lines with the user id are operational logs kept 30 days | built on the Phase 0 stack | Low (a cohort of one or two accounts stays identifiable to the controller, disclosed) |
| 43 | A D1 restore brings back a withdrawn opt-in (a feature spends a user's key again without consent), a lifted objection or a revoked role | Low | High | Axiom ledger (`attributes.featureAccess`) as the replay source, not the restored audit table; replay order opt-outs and objections first (C8, `docs/d1-restore-reconciliation.md`); Axiom keeps 30 days, the Time Travel window, so export it before restoring to an old bookmark; P0-7 must ship the `opt_in.set` and `experiments.set` ledger lines together with the writers, so no opt-in or switch-based objection exists without a ledger line; email objections before P0-7 keep the email as the record. Rule changes beyond on and off cannot be rebuilt from the ledger today (follow-up for P0-6) | built for admin writes; the opt-in and objection ledger lines ship with P0-7 | Low |
| 44 | A second person with the admin role sees every user's email, and the Privacy Policy's "only the controller" becomes false | Low | Medium | The UI and API assign only `tester` (C7); admin only from the env secret, which holds only the controller; the Privacy Policy says only the controller holds the admin role. Adding an admin needs Art. 29 instructions, a confidentiality commitment (Art. 32(4)), a Privacy Policy change and a new notice first | built on the Phase 0 stack | Low |
| 45 | Rollouts or experiments drift into profiling or unequal treatment (targeting by country, email domain or usage; per-user analysis of outcomes by variant) | Low | Medium | The evaluator sees only the user id, roles, grants and opt-ins (C14); the hash is random; Analytics Engine exposure events carry no user id. The Axiom `attributes.features` lines do sit on wide events with the user id, so per-user analysis by variant is technically possible for their 30 days: operating rule, never analyse them per user by variant, only in aggregate; adding attribute targeting or per-user outcome analysis reopens the pre-check and this DPIA | built on the Phase 0 stack (design rule and operating rule) | Low |
| 46 | Users are put into rollouts or experiments before the Privacy Policy notice takes effect, or before they can object in the app as the policy promises | Medium | Low | `NUXT_FEATURES_ROLLOUT_ENABLED` defaults to false and the writer refuses rollout and variant writes while it is false (C2); production may switch it on only from 2026-12-19 and only once the Labs objection switch (P0-7) is in production; until then grants go only to the controller and to testers told individually | built (code); operating rule for the controller | Low |
| 47 | Audit rows or log lines keep a deleted user's identity | Low | Low | Account deletion nulls the actor and target ids and removes user ids and the reason from `before` and `after` (C5, flat-JSON rule); the admin views read emails live, so they disappear with the account; Axiom lines stay 30 days, disclosed | built on the Phase 0 stack | Low |
| 48 | The maker of the controller's AI client receives other users' ids, a recipient and possibly a transfer that the records and the Privacy Policy do not cover | Low | Low | Ids and grants only, never emails, names or reasons (C9); before the first production use the owner names the client, records its terms and safeguard (Art. 30 record, section 6.4) and adds it to the Privacy Policy under its own material notice | planned (P0-8) | Low once recorded and announced |
| 49 | A user publishes personal data, someone else's content or special-category data in a public artifact (section 3.13 (d)) | Medium | High | Off by default, consent per link, `noindex` always, expiry and revoke, deterministic PII warning before publishing (A-7) and for MCP shares (A-8), Terms promise on third-party data and rights (A-9), Report button and form with a `privacy` category, takedown at artifact level (A-7) | built (A-7, A-8), not yet released; Terms built in A-9 | Medium (copies cannot be recalled) |
| 50 | A malicious artifact tries to spend the viewer's key, or to send more than the viewer meant | Medium | Medium | Bridge off on every link until the owner switches it on; signed-in viewers only; direct key only; a modal before each call through a share link with the full prompt, provider, model, maximum cost and remaining calls, and "the author wrote these prompts"; 30 calls an hour per artifact, 200 a day; output at most 2,000 tokens; no tools, memory or history; consent and transfer-consent checks before the call; Terms ban (A-6, A-9) | planned (A-6) | Low |
| 51 | An artifact navigates its own frame to an attacker's address, carrying data in the URL, or replaces itself with a fake sign-in or payment page (P10) | Medium | High | Opaque sandbox, CSP and no network (built, A-2); `frame-src <artifactsOrigin>` on every embedding page, which blocks the navigation before its request leaves in Chromium and WebKit (A-4 for chat and shared pages; A-7 added it to `/artifacts/**` and the admin drawer); second-`load` tripwire that destroys the frame as the fallback (built in the protocol package) and an id-only log line; banner and "never enter passwords or payment details" line outside the frame (A-7); A-3 tool instructions forbid navigation and credential forms; Terms ban and a `phishing` report category (A-9, A-7); e2e test of self-navigation in Chromium and WebKit (A-2) | built (A-2, A-4, A-7), not yet released | Low to medium (untested browsers such as Firefox, and any embedding page that lacks the `frame-src` header, fall back to the tripwire, which fires only after the first request has left and never for a 204 target) |
| 52 | Stored answers reveal a viewer's knowledge, health or beliefs, to the artifact's author or by inference (section 3.13 (c)) | Medium | Medium | Storage only for signed-in viewers on links that allow it, consent gate on every storage route, no owner, admin, model or MCP access, ids-only logs, reset button, purge 30 days after the last link ends and at once on takedown (A-5); Privacy Policy states the author's code receives the values (A-9) | planned (A-5) | Medium (the author's code can still send values out, risk 51) |
| 53 | Children use quizzes and public links, or an artifact is aimed at children | Medium | Medium | 18+ service; storage and the bridge need sign-in and a current consent record, which includes the age confirmation (A-5, A-6); Terms ban artifacts aimed at children under 13 and collecting visitors' personal data (A-9); signed-out visitors get page memory only and no cookie beyond the necessary ones | planned (A-5, A-6); Terms built in A-9 | Medium (whether user-published child-aimed artifacts make Besidka "directed to children" under COPPA is **[U]**) |
| 54 | Cloudflare suspends the account that also runs besidka.com after abuse reports against artifact links (P11) | Low to medium | High | `artifacts.share` grant-only (invited beta); kill switch (global `artifacts` rule off, UI only); no-report admin takedown; Cloudflare abuse-response steps in `docs/legal/content-incidents.md`; runtime origin configurable in one place. Owner decision 2026-11-08: same Cloudflare account for now (pre-check option C) | A-7 built, not yet released; A-10 planned | Medium to high, accepted for the invited beta; option A (separate registrable domain and account) before wider public sharing |
| 55 | A takedown misses a path (shared chat, owner view, export), or a one-hour TCO order is missed | Low | High | Artifact-level `takedownAt` honoured by `/artifacts/<token>`, the shared-chat route and owner reads (A-1, A-4, A-7); no-report takedown by URL, token, artifact id or user at phone width, effective on the next request (A-7); phone alert on the privacy mailbox (owner item 3); runbook (A-9) | built (A-1, A-4, A-7), not yet released; owner item 3 open | Low once built and the alert is set |
| 56 | A leaked `NUXT_ENCRYPTION_KEY` plus a D1 read exposes every live artifact link (`token_encrypted`) | Low | Medium | Breach runbook: re-encrypt `artifact_shares.token_encrypted` on key rotation and bulk-revoke all artifact links as containment (A-9, section 2.5 and 2.6); lookup uses the hash only | runbook built (A-9); re-encryption job planned | Low |
| 57 | A connected client, possibly steered by text it read, publishes content it read through `artifacts:share` | Medium | Medium | Separate unticked scope; links expire within 30 days; storage and bridge forced off; PII warnings returned; the owner's list marks the link as created by that app; daily cap; revoke in the app (A-8) | built (A-8), not yet released | Medium (copies cannot be recalled) |
| 58 | Report records are deleted with the artifact or account, defeating the repeat-infringement rule, the retention promise and a TCO preservation duty | Medium | Medium | `deleteArtifacts` and the account purge never delete `artifact_reports`; a sweep deletes them 12 months after closing (24 for copyright); `legalHoldUntil` keeps held content and rows six months (A-1) | planned (A-1) | Low |
| 59 | Viewer storage or the bridge processes special-category data under a consent text that does not name them | High | Medium | Operating rule: neither flag is granted beyond the controller until owner item 2 ships (a wider text with a `CURRENT_CONSENT_VERSION` bump, or a separate first-use consent); the Privacy Policy says the current text does not name them and that they are not offered until it does; both routes still require a current consent record | operating rule (A-9); consent change open (owner item 2) | Low while the rule holds |
| 60 | A D1 restore brings back revoked or taken-down artifact links, closed reports or deleted artifacts | Low | High | Takedowns and revocations logged with ids; replay steps in `docs/d1-restore-reconciliation.md` ("Artifacts"); R2 objects of deleted artifacts are gone, so reads return 410 | built (A-1, A-7 log lines), not yet released; runbook built (A-9) | Low |
| 61 | A generated or provider-made document carries active content (macros, external relationships, formula or DDE injection, PDF JavaScript, launch or open actions, Word field instructions, PowerPoint program actions) and harms whoever opens it (section 3.14) | Medium | High | `validate()` on every document before it is stored, and `render()` re-validates its own output: ZIP bounds, no macro, ActiveX, embedded or OLE parts, external relationships only to `https:` and `mailto:` links, no XML DOCTYPE or entity, tokenised formula allowlist, Word field reassembly (DDE, INCLUDETEXT and similar), PowerPoint `ppaction` checks, structural PDF scan (JavaScript, launch, embedded files, rich media, `/OpenAction`, `/AA`, URI schemes). Strict spec keys, string cells inert. Only validated bytes are persisted, served with `nosniff`. Provider-made PDFs go through `stampDocument` | built on a branch (D-2, PR #833, not merged); wiring planned (D-3, D-4, D-7) | Low to medium: the PDF scan ignores the cross-reference table (section 3.14 (d)); the CSV and Excel round trip is open |
| 62 | A spec or a title outlives the chat or the file that made it (Art. 5(1)(e), Art. 17) | Medium | Medium | Spec and file share one lifetime; spec deletion hooked into chat, message and bulk chat delete, retention cleanup, bulk file delete and `purgeUserData`, one test per path; a branch copy is not a reference; title and origin chat id cleared where a file survives; sweep for rows with no file and no chat. The ticket statement that a deleted chat keeps its documents is corrected | planned (D-4); open until built | Low once built; the D1 backups hold the row (title, ids) up to 30 days |
| 63 | Files the user attaches linger at the provider after the turn, in a workspace others can see, or in a container (Anthropic container data up to 30 days, workspace-wide Files API visibility, OpenAI abuse logs up to 30 days) | Medium | Medium | Off for each message; one-time confirmation naming the provider; deletion of uploaded and downloaded files and the OpenAI container when the stream ends; one-hour expiry on Anthropic and OpenAI uploads and a 20-minute OpenAI container when a send is cut off; files the Anthropic sandbox makes stay in the user's own workspace until the user deletes them, and Anthropic container data has no delete API; inline input where the provider allows; Privacy Policy "Running code" paragraphs state what stays; a leaked provider key is in the breach runbook (Besidka's per-turn deletion limits what sits there) | planned (D-7); policy text built here | Medium, outside Besidka's control (a deleted Anthropic file may persist in active calls; no source says a delete reaches the container copy) |
| 64 | Code steered by text the model read (a file, a page) sends the user's data out of the sandbox | Medium | Medium | The provider runs the code, never Besidka; no network in Anthropic containers; OpenAI hosted containers have none by default; Besidka never enables network access or sets a `network_policy` (a test); only on a message where the user turned it on; Gemini sandbox network not stated **[U]** | planned (D-7) | Medium until the Gemini sandbox network status is known |
| 65 | AI output is misattributed or unmarked (Art. 50(2)): provider-made files without a mark, MCP content labelled as AI or not labelled, a mark that is stripped | Medium | Medium | IPTC mark and model id in every rendered file; three states (`ai`, `channel-only`, `missing`); server relabels or rejects `missing` on the chat path; MCP files say "Created by a connected app" unless `aiGenerated`; `stampDocument` for provider files; a published line on how to read the mark; no use of the Art. 111(4) grace for documents | marking built on a branch (D-2, PR #833, not merged); labels planned (D-4, D-5) | Medium: one unsigned metadata layer, probably below what Art. 50(2) expects; stripped by re-saving, printing or copy-paste; no text watermark; an orphan XMP stream reads as marked; decision due before 2 Dec 2026 (section 6, item 24) |
| 66 | Anthropic's document skills are used outside what their terms allow, or an unreviewed skill id is used | Low | Medium | Fixed list of four ids on the user's own Anthropic key; nothing bundled, vendored or redistributed; neutral wording in the UI and the records (hosted terms unverified **[U]**); skills disclosed as not zero-data-retention eligible | planned (D-8) | Low |
| 67 | The renderer is used as a free compute service, through MCP or repeated sends | Medium | Low | Spec bounds, the 20 MB quota, render and upload rate limits per user (D-4: 10 and 20 a minute), the MCP write limit, a render lease with an attempt count, no public route on the renderer Worker | bounds built (D-2); limits planned (D-4, D-5) | Low |
| 68 | Unexpected provider spend from code execution | Medium | Low | Off for each message; one-time confirmation with the provider's price from config; the note that Anthropic bills attached files even when no code runs and that free hours depend on the user's organisation; no MCP route to it | planned (D-7) | Low to medium: the user's own balance is unknowable |
| 69 | Third-party code in the client chunk or the renderer Worker: unmet licence duties, external fetches, supply-chain drift | Low | Medium | Licences read, no veto; notices generated from the real bundle graphs and compared by a test; legal banners kept; pinned versions and a package-boundary test; no network code in the package; same-origin assets and font (as row 26) | built on a branch (D-2, PR #833, not merged); serving the notices file planned (D-3, D-4) | Low |
| 70 | Document content appears in renderer logs or error messages | Low | Medium | No spec text, title or asset bytes in Workers Logs (a test, D-3); `attributes.documents` and `attributes.codeExecution` hold formats, counts, bytes, durations and error codes only, never a title, spec text, code, output or file name; validator codes are stable strings with JSON paths, no values | planned (D-3) | Low; Workers Logs retention not checked **[U]** |
| 71 | A document with wrong content or empty formula cells is used without checking | High | Medium | Card and preview labels ("Preview from the document outline; download for exact layout"); the renderer does not write cached formula values, so non-recalculating viewers show empty cells; Terms wording that Besidka does not review generated documents or code results and that the user checks them (notice `2026-12-code-and-documents`, effective 2026-12-19, section 6, item 26) | behaviour built (D-2); Terms wording in this change, effective 2026-12-19 | Medium |
| 72 | A D1 restore brings back `documents` rows whose file or spec object was deleted, or documents whose chat was deleted | Low | Medium | D-4 adds the table to `docs/d1-restore-reconciliation.md`; deleted objects are gone from R2, so reads fail closed; a sweep removes rows with no file and no chat | planned (D-4) | Low |

## 6. Residual risks

These remain after the measures. None is solved by code. Each is disclosed in
the Privacy Policy or should be.

1. **The required consent may be called bundled.** Sending is blocked without
   the explicit consent. The necessity argument is inseparability. A regulator
   could still say a real alternative is missing. The fix is an ephemeral chat
   mode, which is not built. Decision: accept for now.
2. **The classifier can miss things.** It uses fixed rules. It can miss names,
   slang and unusual wording. A miss means special-category data in memory. The
   policy says so, the user can delete entries, and the chat consent names the
   check. Decision: accept.
   The optional TypeSafe AI checks (section 3.7a) are a second, add-only
   signal. They can also miss things, and the injection screening can flag
   legitimate text or miss crafted text (risk 24). Decision: accept.
3. **Criminal-offence data (Art. 10) in chats.** Art. 10 allows such processing
   only under official authority or where the law authorises it. Consent does
   not cover it. Every free-text chat service carries this. Mitigation is
   after the fact: memory never stores it, and a chat that contains it is
   deleted on request. Decision: accept and disclose.
4. **Repeated transfers to China and Singapore.** DeepSeek stores data in the
   PRC. Besidka calls Moonshot AI and Qwen at Singapore endpoints. There is no
   adequacy decision for either, and Besidka has no contract that could add
   safeguards. The only tool left is explicit consent after informing the user
   of the risks (Art. 49(1)(a)), which is built (section 3.8a). The EDPB consent
   guidelines record the view that consent is inappropriate for transfers that
   happen on an ongoing basis, and per-message chat traffic is ongoing. A
   commentator reads the GDPR differently. This was not re-verified, because the
   EDPB guidelines on Art. 49 could not be fetched. The stronger options are to
   block these providers for EEA users or remove them. Owner decision,
   2026-10-26: keep the providers and rely on the per-user consent. Decision:
   accept and disclose; revisit if a supervisory authority or counsel
   objects.
5. **DPF status of the US providers, checked 2026-10-26.** The official list
   (dataprivacyframework.gov, read through the participants endpoint the page
   uses) shows Google LLC (participant 5780), Vercel Inc. (6847) and
   Cloudflare, Inc. (5666) as active under the EU-US DPF. Cloudflare's status
   text is "Active - Re-certification under Review". It shows no row, active or
   inactive, for Anthropic, OpenAI (OpenAI OpCo, LLC and OpenAI Ireland Ltd),
   xAI (X.AI, xAI and SpaceX names; X Corp. is a different company) or
   OpenRouter. For those four the Privacy Policy relies on the mechanism each
   publishes, the Standard Contractual Clauses under its own terms; OpenRouter
   has no public DPA, so it is cited per its privacy policy. Besidka itself has
   no contract with them (bring your own key), so whether the Transfers section
   describes Besidka's own transfers or the user's provider relationships is
   a counsel question. The list changes daily, a differently named parent or a
   later certification would be missed, and the xAI pages were tagged "previous
   version". Owner action: re-check periodically, and update the policy if a
   status changes. Searched again on 2026-11-11 through the same endpoint:
   Google LLC (5780) and Cloudflare, Inc. (5666) are active, and there is
   still no entry for Anthropic or OpenAI under the names searched.
6. **Project knowledge is outside the gate.** Files the user uploads are not
   classified. Sensitive data in them is covered only by the chat consent.
7. **Production's earlier project memory.** Summaries written before any
   consent existed may hold special-category data. Decision: leave, or redact
   on first refresh. The memory release's legacy pass removes never-store items
   but not sensitive topics from that text.
8. **Joint controllership for the sending step.** A regulator could treat
   Besidka and the provider as joint controllers for the transmission. The
   argument is weak, because the user picks the provider, but it is untested.
   Besidka could not get Art. 26 arrangements from the providers.
9. **Consent records are deleted with the account.** That means no proof after
   deletion. Accepted for simplicity.
10. **TypeSafe AI checks and the consent wording.** The consent text names
    recipients by category (the AI providers whose keys the user adds, for
    chats, project memory and memory). Whether screening third-party web
    results and project files, and sending whole transcripts for the
    pre-filter, still fit that wording is an open owner and counsel question
    (`docs/legal/memory-legal-changes-draft.md`). Decision: ship, keep every
    check switchable, revisit with counsel.

11. **Published shares cannot be recalled.** Even with every extra off by
    default (risk row 25), a share is readable by anyone with the link, and
    copies, caches and archives outlive a revocation. Disclosed in the Terms
    and the Privacy Policy. Nothing more can be done in code.

12. **Chapter V for connected AI apps is unsettled.** Under EDPB Guidelines
    05/2021 a transfer needs an exporter that is subject to the GDPR and
    discloses personal data to an importer in a third country. Here the
    importer is a client the user chose. The client, not Besidka, initiates the
    call, and Besidka cannot name the client's country, so it cannot name a
    safeguard. Against that, Besidka's server does transmit the data, and the
    Art. 30 record already treats Besidka as the exporter for provider sends
    that the user directs. The Privacy Policy therefore does not claim that
    no transfer rule applies. It says the user directs the disclosure, that
    Besidka has no safeguard to offer, and that the approval, after the stated
    warning, is also meant as explicit consent under Art. 49(1)(a). The EDPB
    view on consent for ongoing transfers (item 4) applies here too, and the
    country is not even known. Decision: accept and disclose; ask counsel.
13. **Art. 6(1)(b) for an optional connection.** The connection is an optional
    feature, and the EDPB reads "necessary for the contract" narrowly (EDPB
    Guidelines 2/2019). The position taken is that connecting an app is
    something the user asks for as part of the service Besidka offers, so the
    disclosure is performance of that contract. A regulator could say the
    safer basis is consent, Art. 6(1)(a). The approval screen is built to meet
    the Art. 7 standard in any case: specific per client and per scope,
    unticked write scopes, a clear record, and withdrawal by disconnecting.
    Art. 9(2)(a) consent is given on that screen and is a separate record from
    the gate (`docs/legal.md`). Decision: ship on 6(1)(b), keep the screen
    consent-grade, ask counsel.
14. **A client cannot be made to erase.** What a client already read stays with
    the client and its maker, outside Besidka's reach. Disclosed in the
    Privacy Policy. Nothing can be done in code.
15. **Open dynamic client registration.** The interface accepts registrations
    without an account, which is what the MCP clients in common use expect.
    A name can be faked (risk row 30). Mitigation is a warning on the screen,
    limits and the ability to disable a client, not verification of the client.
    Decision: accept.

16. **Bucketing is not profiling.** Section 3.12 treats a salted hash of the
    user id as a random assignment that evaluates no personal aspect (WP251
    rev.01), so it is not profiling. If an authority read Art. 4(4) more
    broadly, the practical position would not change: the basis is
    legitimate interests, the objection switch exists and there is no Art. 22
    effect. Decision: accept.
17. **Material notice for rollouts.** Staged rollout could be read as part of
    running the service rather than a new purpose. The project rule says to
    treat it as material when unsure, so rollouts wait for the 30-day notice.
    Decision: accept the delay.
18. **TOTP enrolment, not a per-session challenge.** An admin who signs in
    with a passkey or OAuth is not asked for the TOTP code (risk row 38).
    Stronger than the law requires, weaker than a step-up check. Decision:
    accept for v1; revisit if a second admin is ever added.
19. **Expired grants are kept.** A grant past its end date stops applying
    but its row, with the free-text reason, stays until it is revoked or the
    account is deleted. It keeps the admin's view of who had what, and the
    reason is short and written without names. Art. 5(1)(e) would favour
    deleting it; the change is already in the audit log for 12 months.
    Decision: accept for v1; a sweep that deletes expired grants is a
    follow-up candidate.
20. **The consent text does not name artifacts.** The Art. 9(2)(a) consent
    `2026-11-a` names "chats, projects and files". Artifacts the model builds
    in a chat are read as covered, because they are made from that chat; that
    is a judgment call. Viewer storage and the AI bridge are not covered by any
    reading: a stranger's artifact collects the answers, and a stranger wrote
    the prompt. Options (pre-check owner item 2): (A) widen the text and bump
    `CURRENT_CONSENT_VERSION`, which re-prompts every user once; (B) rely on
    the current text (rejected here: specific and informed consent is the
    point); (C) a separate first-use consent for storage and the bridge.
    Recommendation: A; `CURRENT_CONSENT_VERSION` is bumped once, after all
    agentic-capabilities phases ship (owner decision, 2026-11-09). Until the
    bump ships, the operating rule in section 3.13 (i) applies (risk row 59).
21. **A frame may still send data out (risk 51).** The `frame-src` header
    blocks self-navigation in the engines tested (Chromium, WebKit); in other
    browsers, or on a page that misses the header, the tripwire limits a
    malicious artifact to one request, not zero. Decision: accept, disclose
    plainly (Privacy Policy "Where artifacts run", the banner line), and
    never claim that the frame cannot send data out.
22. **Same Cloudflare account for public artifacts (risk 54).** An abuse
    report against an artifact link can reach the account that runs the whole
    service. Decision (owner, 2026-11-08): accept for the invited beta with
    grant-only sharing and the kill switch; separate before wider sharing.
23. **The DSA and TCO may apply after all.** The argument that Besidka is not
    "normally provided for remuneration" (`compliance-review-2026-10.md`,
    section 3.1) is untested, and public artifact links make Besidka look more
    like a hosting service that disseminates to the public. The notice process,
    statements of reasons, Art. 18 path, one-hour removal and six-month
    preservation are therefore built as if both applied. Decision: accept the
    argument, follow the rules.

**Overall.** With the consent gate, the transfer notice and consent, and the
removal of the ungated background refresh in place (all built in this release),
the residual risk is medium. It is not high enough for prior consultation under
Art. 36. Without them it is high. Review this conclusion if any of them
changes.

**Connected AI apps (2026-10-29, extended 2026-10-30).** Rows 28 to 34 are `built` and in production, row 35 is `planned`, and rows 36 and 37 are `built` on `feat/mcp-ui-parity`. With the measures named there, the overall conclusion stays medium, with
row 34 (the Chapter V question) as the one that stays medium to high and is
accepted and disclosed. If the gate integration (section 3.11) or the
approval-screen consent wording is missing at release, row 34 and the Art. 9
position are high and the release should not ship. Row 36 stays medium
because deletion cannot be undone; it is accepted because every delete power is
a separate, unticked scope and the app asks the user first. If a write scope
ever becomes default-on or a delete tool loses its cap or confirmation, treat
row 36 as high. Review before release, and
again after the first month of real use.

**Feature access (2026-11-08).** Rows 38 to 48. With the measures marked
built, and rows 40, 43 and 48 completed by P0-7 and P0-8, the overall
conclusion stays medium; nothing here raises it. Row 43 is medium until the
opt-in ledger ships, because a restore could revive a withdrawn opt-in; do not
release a spending feature to users before P0-7 is in production.

**Artifacts (2026-11-08).** Rows 49 to 60, all planned except the runtime
isolation. With the measures in section 3.13 built, the overall conclusion
stays medium. Three rows carry it: row 51 (self-navigation, low to medium,
accepted and disclosed; medium if `/a/` ships without `frame-src`), row 54 (one Cloudflare account, medium to high, accepted only
for the invited beta) and row 59 (consent text, low only while the operating
rule holds). If storage or the bridge reaches users before the consent text
names them, treat row 59 as high. If `artifacts.share` leaves the grant-only
beta on the same account, treat row 54 as high and review this DPIA first.
24. **Art. 50(2) for documents and for chat text.** Rendered documents are
    read as text (guidelines para 60) and carry one unsigned metadata layer.
    That is probably below what Art. 50(2) expects (the Code of Practice asks
    for two layers; paras 86 and 87 accept metadata alone only in narrow closed
    cases), the same position as for xAI and Qwen images
    (`docs/legal/compliance-review-2026-10.md`, section 3.2). Provider-made
    files may lack a mark, MCP files are channel-only, and the mark is stripped
    by re-saving. This draft does not rely on the Art. 111(4) grace for a new
    output type, because no source says it reaches one. Assistant text in the
    chat has a visible label and no machine-readable mark at all. Decision
    needed before 2 December 2026, together with the image decision: put
    documents and chat text on the same decision (recommended), or leave chat
    text out and accept the exposure. A visible "created with AI" line in
    documents is optional (guidelines para 71) and is not planned.
25. **Provider-side retention for code execution is outside Besidka's
    control.** Besidka deletes what it uploads, downloads and creates, but
    Anthropic container data is kept up to 30 days, a deleted Anthropic file
    may persist in active calls, OpenAI abuse logs run up to 30 days, OpenAI
    zero data retention for containers is unverified and Google's sandbox
    retention and network access are not stated. The Privacy Policy says so
    for each provider. **Materiality was a judgment call:** this is a
    retention fact users did not have before, near the checklist item "a
    longer retention period", but it is the provider's retention and Besidka
    keeps nothing longer than file retention. The pre-check expected minor; the
    checklist says to treat an unclear case as material and a Terms notice goes
    out anyway, so the Privacy Policy is recorded as material and covered by
    notice `2026-12-code-and-documents`. The provider pages were read on 2026-11-07 and not
    re-read on 2026-11-11.
26. **Terms of Use: the mirror of provider prohibitions (decided 2026-11-11).**
    The owner decided on 2026-11-11 ("Yes, add to Terms") to mirror the
    providers' usage rules for code (Anthropic's Usage Policy from 2026-11-12,
    OpenAI's from 2026-11-20). This is option A of pre-check owner item 1, against the recommendation. The
    Terms now forbid code run or written through Besidka, including with Run
    code, from attacking systems: no malware, no denial of service or
    botnets, no bypassing security controls without authorisation, no attacks
    on critical infrastructure. They say that the provider's usage policy
    applies directly to code run on the user's key. In the same change the
    Terms say that documents and code results are not checked by Besidka and
    must be checked by the user, extend the AI-mark paragraph to documents
    (what is written, the model id and no personal details, that it can be
    missing or stripped, how to read it), and state that Anthropic's document
    skills run under the user's own Anthropic agreement and are not licensed
    or distributed by Besidka (no word "proprietary"). New user restrictions
    are material under the WP260 checklist, so notice
    `2026-12-code-and-documents` (Privacy Policy and Terms) is published 2026-11-15, sent
    from 2026-11-15, and takes effect 2026-12-19. No sourced duty makes
    Besidka a flow-down party, so this is a choice, not a requirement. The
    earlier notice effective 2026-12-04 is unchanged.
27. **Validator and renderer residuals.** The PDF scan ignores the
    cross-reference table; an orphan XMP stream reads as marked; cached
    formula values are not written; the Excel round trip of CSV export is open;
    provider-made PDFs are only as safe as `stampDocument`'s rewrite. None of
    these is solved by this record. Decision: accept for the `internal` stage
    and re-assess before a flag reaches `beta`.

## 7. Consultation

- **Data subjects.** Not consulted. The service has no panel of users. Feedback
  comes through the issue tracker and the privacy email.
- **Counsel.** Not consulted. No budget. The single most useful question for a
  `radca prawny`: is a required explicit-consent box for free-text storage
  acceptable to UODO, given that no alternative is offered? Next: is Art.
  49(1)(a) consent usable for repeated transfers to China and Singapore?
  For connected AI apps (section 3.11): is a user-directed disclosure to an AI
  client of the user's choice a transfer by Besidka under Chapter V at all, or
  only a disclosure by the user; may it rest on Art. 6(1)(b) or does it need
  consent under Art. 6(1)(a); and is an approval screen the right place for
  the Art. 9(2)(a) consent when the existing gate wording names only the
  providers whose keys the user adds. For feature access (section 3.12): is
  Art. 6(1)(f) the right basis for staged rollout, and is an objection
  record rightly kept under Art. 6(1)(c)? For artifacts (section 3.13): is a
  free, non-gainful service a `usługodawca` and so within the Polish DSA and
  TCO penalty rules; who receives a DSA Art. 18 notice in Poland; and does a
  user-published, child-aimed artifact make Besidka a service "directed to
  children"?
- **DPO.** None. Not required for one person with no systematic large-scale
  monitoring.
- **Processors.** Cloudflare and Axiom DPAs. Keep dated copies in a private
  folder (not the public repository).

## 8. Sign-off and review

| Item | Value |
|---|---|
| Prepared by | Engineer draft, 2026-10-26 |
| Approved by | [OWNER NAME], controller |
| Date approved | [DATE] |
| Residual-risk decision | [OWNER: accept the residual risks in section 6, items 1 to 27] |
| Counsel reviewed | No |

**Review this DPIA when:**

- a new memory origin, provider or gateway is added, or a provider endpoint
  region changes;
- code execution is offered for another provider or any gateway (section
  3.14);
- the consent text, version or flow changes;
- the classifier categories or the never-store list change;
- the retention rules, storage locations or processors change;
- a complaint, breach or authority request touches this processing (the breach
  procedure is `docs/legal/breach-runbook.md`);
- any other material change to the processing.

Otherwise review at least every 12 months. Keep the previous version in git
history.

### Open placeholders

This list covers this DPIA and `docs/legal/art30-record.md`.

- **[OWNER NAME], [DATE] and the residual-risk decision** in the sign-off table
  above, and the controller name in the Art. 30 record.
- **Axiom.** Confirm that Axiom's DPA is accepted on the plan in use. The
  retention of all three datasets is 30 days (read on 2026-11-08, Art. 30
  record, row 15). That retention
  also bounds the consent history: the database keeps only the latest grant
  and withdrawal, and every earlier grant, withdrawal and transfer consent is
  provable only from the Axiom `legalConsent` events.
- **Brave and Exa DPF status.** Not part of the 2026-10-26 check. The Art. 30
  record still marks them **[U]** and the Privacy Policy states no transfer
  mechanism for them. To check, use the same approach as for the other US
  providers: `https://www.dataprivacyframework.gov/list` is a single-page app
  that reads the participants endpoint `https://dpfapi.azurewebsites.net/api/participants`.
  Fetch that export, and search both the organization names and the covered
  entity names, active and inactive rows, for the legal entity named in Brave's
  and Exa's own privacy policy or terms. If one is active, note its
  participant id and the "EU-U.S. Data Privacy Framework" status. If neither
  is listed, read the provider's privacy policy or DPA for its stated
  mechanism (usually SCCs) and cite that. Record the check date here and in
  the Art. 30 record, not on the public page, and update the Privacy Policy's
  "Transfers outside the EU" section with the mechanism only.
- **The controller's AI client for `admin:features`.** Before the first
  production use (P0-8), name the client and record its country, its terms
  for the plan in use and the transfer safeguard (Art. 30 record, section
  6.4; risk row 48), and add it to the Privacy Policy with its own
  material notice.
- **xAI.** Its documents read on 2026-10-26 were tagged "previous version", so
  re-read the current DPA and confirm the entity name (SpaceXAI LLC) and SCCs.

## 9. Sources

Primary text and guidance:

- GDPR (Regulation (EU) 2016/679), Arts. 4(4), 6, 7, 9, 10, 13, 22, 25, 26, 30,
  32, 35, 36, 49 and Recital 18:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
- Komunikat Prezesa UODO z 17 czerwca 2019 r. (M.P. 2019 poz. 666), the list of
  processing that requires a DPIA:
  https://eli.gov.pl/api/acts/MP/2019/666/text/O/M20190666.pdf
- WP29, Guidelines on DPIA (WP248 rev.01), endorsed by the EDPB:
  https://ec.europa.eu/newsroom/article29/items/611236
- WP29, Guidelines on automated decision-making and profiling (WP251 rev.01):
  https://ec.europa.eu/newsroom/article29/items/612053
- EDPB, Guidelines 05/2020 on consent under Regulation 2016/679:
  https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- EDPB, Report of the work undertaken by the ChatGPT Taskforce (23 May 2024):
  https://www.edpb.europa.eu/system/files/2024-05/edpb_20240523_report_chatgpt_taskforce_en.pdf
- EDPB, Guidelines 2/2019 on the processing under Art. 6(1)(b) in the context of
  the provision of online services (the narrow reading of "necessary for the
  contract"; not re-read when this was drafted).
- RFC 7591 (OAuth 2.0 Dynamic Client Registration) and the OAuth 2.1 draft
  (PKCE, rotating refresh tokens); not re-read when this was drafted.
- EDPB, Guidelines 05/2021 on the interplay between Art. 3 and Chapter V:
  https://edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf
- Court of Justice, Meta Platforms and Others v Bundeskartellamt, C-252/21:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62021CJ0252
- Court of Justice, GC and Others v CNIL, C-136/17 (operator duties scale with
  its responsibilities, powers and capabilities):
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0136
- Data Privacy Framework list (checked 2026-10-26):
  https://www.dataprivacyframework.gov/list
- Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/terms
- OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/

Not re-read when this was drafted, so check before relying on the detail: the
two Court of Justice judgments (paragraph numbers in particular), WP248 and
WP251 (taken from earlier research), and the EDPB guidelines on Art. 49
derogations (the link returned 404). The DPF list was read on 2026-10-26.

Repository documents:

- "Legal pages: what to change now" research note, 2026-10-26 (working copy
  `legal-changes-now.md`, not in the repository): the P0 to P2 list, the
  consent gate copy, the residual list.
- `docs/memory-architecture.md`: sections 3.1 to 3.17 and the decision log.
- `docs/project-knowledge-design.md`: sections 9 and 10.
- `docs/legal-memory-sensitive-data.md`, `docs/legal/memory-legal-changes-draft.md`.
- `docs/legal/prechecks/documents.md` (D-10), `docs/chats/documents-spec-package.md`
  (on `feat/documents-spec-package`, PR #833, not merged), provider pages read
  on 2026-11-07 (listed in the Art. 30 record, section 8), Commission
  Communication C(2026) 7702 (5.11.2026), DPF list searched on 2026-11-11.
- `docs/mcp-server.md`, `server/db/schemas/oauth.ts` and the Better Auth
  `@better-auth/mcp` and `@better-auth/oauth-provider` packages (flow, token
  lifetimes, the one cookie it sets), read 2026-10-29.
- `docs/legal.md`, `docs/files.md`, `wrangler.jsonc`, `providers/*.ts`,
  `docs/providers/alibaba.md`, `docs/providers/moonshotai.md`,
  `docs/providers/deepseek.md`.
