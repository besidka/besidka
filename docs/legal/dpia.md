# Data protection impact assessment (DPIA): Besidka

> **Engineer-drafted. Not reviewed by a lawyer.** This is a reasoned position
> by the person who built the service. It is not legal advice. The questions
> most worth a Polish `radca prawny` are listed in section 7.

| Field | Value |
|---|---|
| Controller | [OWNER NAME], a natural person, Poland |
| Service | Besidka, a non-commercial, open-source, bring-your-own-key AI chat |
| Version | 1.0, 2026-10-26 (consent gate and transfer consent built) |
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
  analytics, Turnstile) and Axiom (logs). Besidka has a data-processing
  agreement with these two only.
- **Independent controllers.** The AI providers, gateways and search providers
  the user picks. The user holds the account with them. Besidka has no contract
  with them.
- **Out of scope here.** Cookie consent records, push, email, campaign
  attribution and analytics. They have their own rows in the Art. 30 record and
  carry no special-category content.

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
  covered by the chat consent (section 3.8), not by the memory gate.
- **Basis.** Contract (Art. 6(1)(b)). Explicit consent for any special category
  inside the files.

### 3.7 Compliance gate (classifier and never-store detectors)

- **Purpose.** Keep what should not be in memory out of memory.
- **How.** Server code (`server/utils/memory/compliance.ts`), on every write
  path: Memory page, assistant tool, extraction, import and the one-time
  About-me migration. It is code, not a prompt. The model's own refusal is not
  treated as a control.
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
  all on). Timeouts: 800 ms on the send path, 2.5 s in the background.
  Thresholds come from a synthetic eval run on 2026-10-26 and are re-tuned on
  real traffic.
- **Recipient.** TypeSafe AI, Inc., United States, independent controller
  on the user's own account. Not on the EU-US Data Privacy Framework. Its DPA
  relies on the SCCs (Module 2) and the UK Addendum, marks sensitive-data
  safeguards "N/A", keeps data "as long as necessary" and has no SLA. Its
  privacy policy says it does not train on input.
- **Failure.** Every role is assistive and fails safe to the behaviour
  without the key on a missing key, 401, 429, 529, a network error or a
  timeout.
- **Data in logs.** Counts, scores, statuses and latency under
  `attributes.<role>Jev` (the memory check keeps `memoryJev`), never text.

| Role | Purpose | When | Data sent | On failure |
|---|---|---|---|---|
| `memoryChecks` | Second opinion before a memory entry is saved | Each entry the rules allowed | Entry text with never-store values removed, plus a short redacted source excerpt | Rules alone; add-only, so it can never allow what the rules refused |
| `autoWebSearch` | Decide whether a web search is needed | Only in the Auto web search mode, each message | The message and the last 2-3 turns | Search as usual |
| `extractionPrefilter` | Skip the memory model when nothing is worth remembering (saves the user's cost) | Before memory is generated from a chat: opt-in extraction, backfill from past chats, project Refresh. Never for extract-now or import | Chat text with never-store values removed, in chunks of up to about 8,000 tokens | Unsure or unavailable: generate memory as usual |
| `injectionScreening` | Flag hidden instructions in third-party text | Project knowledge files and notes; Brave and Exa results fetched through Besidka | That text | Text used unscreened; a flag holds a file for review or leaves a result out of context and never deletes anything |
| `rerank` | Order search candidates by relevance and leave out clearly irrelevant ones while enough relevant ones remain | Past-chat and project-knowledge search | The query and excerpts of about 300 tokens each, up to 30 per search | Original order |
| `sharePiiCheck` | Warn about personal data before publishing | When the share window opens or its files toggle changes, before a public share link is created; only with current legal consent | The chat text being shared, with never-store values, emails and phone numbers removed, in chunks of up to about 25,000 tokens | Generic reminder next to the built-in detector warnings; never blocks sharing |
| `pastChatRetrieval` | Pre-search past chats for models without tool calling | Each message, only when the message refers to an earlier, separate conversation | The message and recent turns | No pre-search |

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
- **Withdrawal.** In Profile → Security → Privacy & consent, or by deleting the
  key.
- **Scope.** Owner decision 2026-10-26: it also applies to models reached
  through Vercel AI Gateway, OpenRouter or Cloudflare AI Gateway whose id names
  one of these vendors (`deepseek/`, `moonshotai/`, `alibaba/`, `qwen/`).
  Models a gateway runs itself (Cloudflare's `@cf/` ids) are exempt.
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
  `withdrawn`, `transfer-granted`), the text version and, for a transfer, the
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
| 23 | Injection screening sends project knowledge and third-party web text (Brave and Exa results) to the vendor | Medium | Medium | Only with a key and a toggle; project files are the user's own content already covered by the consent; web text is public; results from a model's built-in search are never sent; nothing is stored by Besidka; counts only in logs; whether this third-party text fits the consent wording is an open owner and counsel question (`docs/legal.md`) | built | Medium |
| 24 | Attacker-crafted content makes screening withhold legitimate results or files (false positive), or evades it (false negative) | Medium | Low | Screening is an add-only signal, never the only defence: the write lock, the data-not-instructions wrapping and the memory gate in row 6 stay; a flag never deletes anything, a flagged file waits for the user's review and a flagged result is only left out of context; thresholds come from an eval and are re-tuned on real traffic; the toggle turns it off | built | Low |

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

**Overall.** With the consent gate, the transfer notice and consent, and the
removal of the ungated background refresh in place (all built in this release),
the residual risk is medium. It is not high enough for prior consultation under
Art. 36. Without them it is high. Review this conclusion if any of them
changes.

## 7. Consultation

- **Data subjects.** Not consulted. The service has no panel of users. Feedback
  comes through the issue tracker and the privacy email.
- **Counsel.** Not consulted. No budget. The single most useful question for a
  `radca prawny`: is a required explicit-consent box for free-text storage
  acceptable to UODO, given that no alternative is offered? Next: is Art.
  49(1)(a) consent usable for repeated transfers to China and Singapore?
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
| Residual-risk decision | [OWNER: accept the residual risks in section 6, items 1 to 9] |
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
- `docs/legal.md`, `docs/files.md`, `wrangler.jsonc`, `providers/*.ts`,
  `docs/providers/alibaba.md`, `docs/providers/moonshotai.md`,
  `docs/providers/deepseek.md`.
