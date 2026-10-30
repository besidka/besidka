# Data protection impact assessment (DPIA): Besidka

> **Engineer-drafted. Not reviewed by a lawyer.** This is a reasoned position
> by the person who built the service. It is not legal advice. The questions
> most worth a Polish `radca prawny` are listed in section 7.

| Field | Value |
|---|---|
| Controller | [OWNER NAME], a natural person, Poland |
| Service | Besidka, a non-commercial, open-source, bring-your-own-key AI chat |
| Version | 1.4, 2026-10-30 (the user can remove an app's permissions, approval cleanup sweep: section 3.11, risk rows 33, 36 and 37; 1.3, 2026-10-30: connected apps reach files and settings and can change and delete: section 3.11, flow row 7, risk rows 36 and 37; 1.2, 2026-10-29: connected AI apps over OAuth and MCP, section 3.11 and risk rows 28 to 35; 1.1, 2026-10-28: share defaults off, avatar proxy, self-hosted fonts and icons, copyright and report handling, risk rows 25 to 27) |
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
cleanup job also deletes approvals that have no live token. No new recipient,
purpose or data, and the residual ratings do not change. Built on
`feat/connected-apps-scopes`, not yet deployed.

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

- evaluation or scoring (profiling): background extraction records preferences,
  interests and work;
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
  chats". The app records `memory_extraction_enabled_at`. Nothing runs in the
  background before that. Enabling it never reads old history by itself.
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
- **Basis.** Consent (Art. 6(1)(a)). Switching it off is withdrawal. The user
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
  unless the extraction opt-in is on, and only for users with current consent.
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
- **Processor.** Axiom, under its data-processing agreement. Retention is as
  set by the Axiom plan in use.
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
  it like any text an agent reads (risk row 31).
- **Left out on purpose.** Anything that spends the user's keys (sending,
  memory import and extraction, backfill, project memory refresh, title
  generation, the share personal-data check, deep research), creating or
  updating a public chat share, "Allow anyway" on a flagged knowledge item,
  settings that authorise spend or change the data recipient (automatic
  memory extraction, memory models, TypeSafe AI roles), and API keys,
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
  the client and the consent has been untouched for a day, until the hourly
  `oauth-grant-sweep` job deletes it. Owner-less client registrations (every
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
  be read does not narrow: the token's scopes stand, and the request logs
  `token_fallback`. Duplicate connections of the same app are grouped, with a
  "Disconnect older" action the user triggers; nothing is revoked
  automatically, and a connection with no live token is not listed.
- **Revocation.** Profile → Connected apps. Disconnecting deletes the consent
  and the tokens, and the app stops on its next call: every `/mcp` call checks
  that the user exists, the client is enabled and a live `oauth_consents` row
  exists (`isMcpPrincipalActive`, `server/utils/mcp/auth.ts`), so a JWT access
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
  - Withdrawal: switch extraction off, withdraw the chat consent, remove a key.
  - Backups: copies can survive up to 30 days in D1 Time Travel.
- **Alternatives considered.** Reading no chat text for memory at all (rejected:
  it removes the feature). A model-based classifier (rejected: it would send
  text to another model to decide whether to send it to a model). An opt-in for
  sensitive memory (removed from v1 by the owner on 2026-10-25, see
  `docs/legal-memory-sensitive-data.md`). An ephemeral chat mode (not built,
  would give users who refuse consent a real alternative).

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
| 36 | A connected app, or an agent steered by text it reads, deletes or overwrites the user's data (chats, messages, projects with their knowledge and project memory, files, memory entries) or changes settings, and the user cannot get it back | Medium | High | Every write scope is off by default and a separate tick; all permanent deletion sits behind its own scope, `data:delete`, which no existing approval holds and which a "Change" scope does not include, so an app that only needs to read, add notes or rename never holds a delete power; the consent screen says in words that write access can change or delete; every destructive tool carries `destructiveHint: true` so a client asks the user first (a unit test fails when the annotations and the tool map disagree); `delete_project` needs the exact project name as `confirmName` and `reset_memory` needs `confirm: true`; batches are capped (25 chats per call, 100 files, 100 knowledge items, 90 share revocations); deleting or branching a chat that is generating a reply is skipped or refused, on a best-effort basis (a check of the generation lease, not a lock); deleting a project keeps its chats; deletes are limited to 20 calls an hour and writes to 30 a minute per user, which slows a runaway agent but does not stop it from deleting within those limits; settings that spend the user's keys or change the data recipient cannot be changed (`docs/mcp-server.md`, "What MCP does not do (and why)"); the user can disconnect an app in Profile → Connected apps and the next call fails at once, or remove just `data:delete` or any other permission there and the next call is refused for that tool (the effective scopes are the token's intersected with the current approval). **Residual:** deletion is permanent, as in the app, and narrowing helps only a user who opens that page: an app the user never reviews keeps what it was given, and a consent row whose scope list cannot be read does not narrow (the token's scopes stand). A "Change" scope cannot delete those records directly but has side effects: excluding a chat from memory removes extraction-only memory entries learned only from it, stopping a share removes its link, editing replaces the old text (instructions, knowledge items, memory entries, file names, favourites) and switching project memory off resets its state. D1 Time Travel is disaster recovery for the whole database, not a per-user undo, and restoring it for one user would roll back every other user (`docs/d1-restore-reconciliation.md`). A client that does not ask before a call can still delete what its scope allows, within the caps. The Privacy Policy and Terms say deletions through an app are permanent | built on `feat/mcp-ui-parity`, not yet deployed | Medium, accepted and disclosed |
| 37 | Scope growth: a client registered before the write scopes existed may ask for them, and a stored approval could be read as covering them, so an app gains delete power the user never ticked | Low | High | Any client whose stored scope list is a strict subset of the current one may *ask for* the new scopes (the `hooks.before` upgrade on `/oauth2/authorize`, `server/utils/oauth/client-scope-upgrade.ts`: a stored list that is a strict subset of the current scopes is rewritten, anything else is left alone, a failure never blocks sign-in). The user's `oauth_consents` row is not widened: authorize sends the user to the consent page whenever a requested scope is not in their row, so the user ticks each new scope on the screen. A tool behind a scope the user did not grant answers `403 insufficient_scope`. An existing connection that never asks for the new scopes keeps working with what it had. **Residual:** consent is stored per scope name, so when a tool is added behind a scope the user already granted, the existing approval gets it with no new prompt. Deletion is closed off by `data:delete` (`delete_memory` moved there from `memory:write`, so existing connections lose it until the user ticks the new scope). What did reach existing approvals involves no deletion or spend, though overwrites are possible: under `projects:write`, `update_project` (rename, pin, archive, knowledge mode, project memory switch) and `update_project_knowledge_item`; under `chats:read`, `list_shared_chats` and share status (the URL needs `chats:write`). The Privacy Policy says this and tells the user to check Profile → Connected apps after such a change. Future extensions of an existing scope must involve no deletion or spend, though overwrites are possible. The user can remove permissions from an approval and never add them there; adding one goes through the app's own OAuth flow, because a token keeps the scopes it was issued with, so narrowing cannot be used to widen. A removed scope is asked for again on the approval screen if the app requests it, and the hourly sweep deletes approvals with no live token, so a stale approval cannot silently cover a later authorization | built on `feat/mcp-ui-parity`, not yet deployed | Low to medium, accepted and disclosed |

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
   status changes.
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
  providers whose keys the user adds.
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
| Residual-risk decision | [OWNER: accept the residual risks in section 6, items 1 to 15] |
| Counsel reviewed | No |

**Review this DPIA when:**

- a new memory origin, provider or gateway is added, or a provider endpoint
  region changes;
- the consent text, version or flow changes;
- the classifier categories or the never-store list change;
- the retention rules, storage locations or processors change;
- a complaint, breach or authority request touches this processing;
- any other material change to the processing.

Otherwise review at least every 12 months. Keep the previous version in git
history.

### Open placeholders

This list covers this DPIA and `docs/legal/art30-record.md`.

- **[OWNER NAME], [DATE] and the residual-risk decision** in the sign-off table
  above, and the controller name in the Art. 30 record.
- **Axiom.** Confirm that Axiom's DPA is accepted on the plan in use, and fill
  in the log retention that plan sets (Art. 30 record, row 15). That retention
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
- `docs/mcp-server.md`, `server/db/schemas/oauth.ts` and the Better Auth
  `@better-auth/mcp` and `@better-auth/oauth-provider` packages (flow, token
  lifetimes, the one cookie it sets), read 2026-10-29.
- `docs/legal.md`, `docs/files.md`, `wrangler.jsonc`, `providers/*.ts`,
  `docs/providers/alibaba.md`, `docs/providers/moonshotai.md`,
  `docs/providers/deepseek.md`.
