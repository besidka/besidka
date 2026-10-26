# Record of processing activities (GDPR Art. 30): Besidka

> **Engineer-drafted. Not reviewed by a lawyer.** This is a working record
> written by the person who built the service. It is not legal advice. Items
> marked **[U]** are unverified and need a check before anyone relies on them.

| Field | Value |
|---|---|
| Version | 1.0, 2026-10-26 (consent gate and transfer consent built) |
| Next review | On any new processing activity, processor, provider or storage location, and at least every 12 months |
| Sibling document | `docs/legal/dpia.md` |
| State recorded | The release that ships the consent gate (`2026-11-a`), the Art. 49(1)(a) transfer consent, the memory feature and the 2026-10-26 rewrite of the legal pages. The keep/delete prompt for memory generation (P1-11) is built too (#544) |

## 1. Controller

| Field | Value |
|---|---|
| Controller | [OWNER NAME], a natural person |
| Country | Poland |
| Contact | The privacy address published in the Privacy Policy (set by configuration, `NUXT_PUBLIC_PRIVACY_EMAIL`, not stored in this file) |
| Joint controllers | None |
| Representative in the EU | Not applicable. The controller is in the EU |
| Data protection officer | None. Not required: one person, no systematic large-scale monitoring |
| Supervisory authority | Prezes Urzędu Ochrony Danych Osobowych (UODO) |

## 2. Why this record is required

Art. 30(5) exempts organisations with fewer than 250 people. The exemption does
not apply when the processing is **not occasional** or **includes special
categories of data**. Both limbs fail here:

- **Not occasional.** Every message a user sends is processing. It happens
  continuously.
- **Special categories.** Chats are free text. Users type health details,
  beliefs and similar information. Besidka stores it, whether or not it reads
  it (Court of Justice, Meta Platforms and Others v Bundeskartellamt, C-252/21).

Size does not exempt a one-person service. Being non-commercial does not
either. The household exemption covers the user, not the operator who provides
the means (GDPR Recital 18).

## 3. How to read the tables

**Recipient types.**

- **Processor.** Besidka has a data-processing agreement. Today that is
  **Cloudflare** (hosting, storage, email sending, analytics, Turnstile) and
  **Axiom** (logs).
- **Independent controller, user's own account.** The AI providers, AI gateways
  and search providers the user chooses. The user supplies their own key or
  account. Besidka has no contract that governs what they do with the data
  (`docs/legal.md`). Besidka's server is the party that sends the data, so
  Besidka treats itself as the exporter for transfer purposes.

**Common security measures** (referred to by code in the tables).

| Code | Measure |
|---|---|
| M1 | TLS in transit. Cloudflare encryption at rest for D1, KV and R2 |
| M2 | Authentication through Better Auth. Sessions in KV. Rate limits. Turnstile on sign-up and sign-in. Optional TOTP and passkeys |
| M3 | Per-user ownership enforced inside SQL statements. R2 keys derived on the server from the session user. Model-supplied ids resolve only inside an already scoped set |
| M4 | Provider, gateway and search API keys stored encrypted. Never logged |
| M5 | Logs hold counts, labels and ids, never memory, chat or file text |
| M6 | Deletion cascades from account to chats, projects, files, memory and knowledge. Hourly job removes expired files and orphan objects. R2 batch deletes |
| M7 | Per-user storage quota (20 MB default) counting files and extracted knowledge text, using real request body size. Per-project and per-user item caps |
| M8 | Compliance gate on every memory write path: never-store detectors and the deterministic Art. 9 classifier. Memory write lock after any web search or other tool result |
| M9 | Consent gate with per-user receipt, enforced on the server (built: `server/utils/legal/consent.ts`, `server/api/v1/profiles/consent/`). Transfer consent per provider for DeepSeek, Moonshot AI and Qwen (built) |

**Backups.** D1 Time Travel keeps point-in-time backups for up to 30 days. A
deleted record can survive in a backup for up to 30 days. This applies to every
row stored in D1 below and is not repeated in each row.

## 4. Processing activities: users and their content

| # | Activity and purpose | Data subjects | Data categories | Recipients | Transfers and safeguards | Retention | Security |
|---|---|---|---|---|---|---|---|
| 1 | **Accounts and sessions.** Create and run the account. Basis: contract, Art. 6(1)(b) | Users | Email, name, avatar, password hash, linked Google or GitHub account, 2FA secret (encrypted), passkeys, sessions, account settings | Cloudflare (processor). Google or GitHub only if the user signs in with them | Cloudflare: see section 6.2 | Until the user deletes the account. Sessions until they expire or the user signs out | M1, M2, M6 |
| 2 | **Stored API keys.** Let Besidka call the user's chosen provider, gateway or search provider. Basis: contract | Users | Provider, gateway and search API keys, encrypted | Cloudflare (processor). The key owner's provider receives the key only as the credential of a request | Cloudflare: section 6.2 | Until the user removes the key or the account | M1, M4, M6 |
| 3 | **Chats and files.** Store and show conversations, send history to the model. Basis: contract, Art. 6(1)(b). For special categories the user includes: explicit consent, Art. 9(2)(a) (built, consent gate `2026-11-a`) | Users. Third parties named in chats and files | Messages, reasoning and tool results, sources, attachments, chat titles, project assignment. Free text: may include **special categories** (Art. 9) and, by accident, **criminal-offence data** (Art. 10) | Cloudflare (processor) | Cloudflare: section 6.2 | Until the user deletes the chat, project or account. Files expire after 30 days by default (user can change it) | M1, M2, M3, M6, M7, M9 |
| 4 | **Forwarding to AI providers and gateways.** Answer the user's message with the model the user chose. Basis: contract; explicit consent for special categories (built); explicit consent to the transfer for DeepSeek, Moonshot AI and Qwen, Art. 49(1)(a) (built) | Users. Third parties named in chats | Prompt, message history, attachments, memory index, chat-search excerpts, project knowledge, per-send settings | **Independent controllers, user's own account:** Anthropic, OpenAI, Google (Gemini), xAI, DeepSeek, Moonshot AI, Qwen (Alibaba Cloud). Gateways: Vercel AI Gateway, Cloudflare AI Gateway, OpenRouter (which can pass the request to model vendors elsewhere) | See section 6.1 | Held by the provider under its own terms with the user. Besidka does not train and does not sell | M1, M4. Besidka's server sends the request over TLS with the user's key |
| 5 | **Web search forwarding.** Send the search query the model writes to the search provider the user turned on. Basis: contract | Users. Third parties named in the query | The search query text | **Independent controllers, user's own account:** Brave, Exa. Provider-native search (Google grounding, Anthropic and OpenAI web search, Qwen, Moonshot) happens inside the chosen provider | Brave and Exa: United States **[U]**, see section 6.1. Native search: as the provider | Held by the search provider. Exa states it uses queries to train its models | M1, M4. Memory write lock engages on any requested web search (M8) |
| 6 | **Chat search.** Let the user and the assistant find earlier chats. Basis: contract, Art. 6(1)(b) | Users. Third parties named in chats | Full-text index (SQLite FTS5) over the user's own messages. Excerpts of at most about 3,000 tokens sent to the current chat's provider | The provider or gateway of the **current** chat (independent controller). Cloudflare (processor) | See section 6.1 | Index follows the messages. Nothing new stored. The `chatSearchEnabled` switch turns the assistant's lookup off | M1, M3 |
| 7 | **Memory entries.** Remember lasting facts and preferences and add them to later messages. Basis: contract, Art. 6(1)(b) | Users. Third parties named in entries (people category) | Title, description, text, category, scope, origin, source chat ids, timestamps. Caps: 30 account entries, 15 per project, 4 KB per entry. By design no special categories and no never-store items | The provider or gateway of the chat (independent controller). Cloudflare (processor) | See section 6.1 | Until the user deletes the entry or resets memory, deletes the only chat a generated entry came from, deletes the project (project entries) or the account | M1, M3, M6, M8 |
| 8 | **Background extraction (opt-in).** Save lasting facts from chats without being asked each time. Profiling, Art. 4(4). Basis: consent, Art. 6(1)(a) | Users. Third parties named in chats | The new part of a chat (user messages, assistant text as context only, never files or tool results) sent to the memory model. Resulting entries as in row 7. Setting and `memory_extraction_enabled_at`. Run records: last five runs | The memory model's provider or gateway, on the user's own key (independent controller). By default "Same as chat". Cloudflare (processor) | See section 6.1 | Entries as row 7. Opt-in timestamp until account deletion. Switching it off withdraws consent | M1, M3, M5, M8, M9 |
| 9 | **Explicit memory runs.** Refresh a project, Update now, Build memory from past chats, Import from another assistant. Basis: contract, Art. 6(1)(b), at the user's request each time | Users. Third parties named in chats or pasted text | Chat text read for the run. Pasted import text is not stored, only the entries made from it. Backfill job records (progress, counts, model, cost estimate). Hard ceilings: 200 chats and 4 million tokens per run | The memory model's provider or gateway, on the user's key. Cloudflare | See section 6.1 | Entries as row 7. Backfill records: last five runs | M1, M3, M5, M8 |
| 10 | **Project knowledge.** Reference files, notes and folders for a project's chats. Basis: contract; explicit consent for any special category in the files (built, the chat consent) | Users. Third parties named in the files | Original files, text extracted in the user's browser, notes, a search pack, one database row per item. A linked folder's name stays in the browser | The provider or gateway of the chat (independent controller). Cloudflare (processor) | See section 6.1 | Until the user removes the item, deletes the project or the account. Linked files do not expire while linked | M1, M3, M6, M7. **Not covered by the compliance gate** (user-supplied material) |
| 11 | **Compliance gate.** Keep never-store items and sensitive topics out of memory. Basis: legitimate interests, Art. 6(1)(f), as a safeguard under Arts. 25 and 32. It reads text that may be sensitive, so the consent text names it (Art. 9(2)(a), built) | Users. Third parties named in text | The text being saved, read once on the server. Nothing retained. Counts and category ids logged | None. Runs in the Worker | None | Not stored. Logs: row 18 | M5, M8 |
| 12 | **Consent and acceptance receipts.** Prove consent (Art. 7(1)). Basis: legal obligation to prove consent, Art. 6(1)(c) (judgment call). For the Terms and age record: legitimate interests, Art. 6(1)(f) | Users | On `user_settings`: timestamp and text version for the sensitive-content consent, withdrawal time, Terms acceptance (time and version), age confirmation, extraction opt-in time, and per-provider transfer consent and withdrawal times (JSON). Withdrawal keeps the earlier timestamps | Cloudflare (processor) | Cloudflare: section 6.2 | While the account exists. Deleted with it, so there is no proof after deletion (accepted) | M1, M3, M9 (built) |
| 13 | **Public chat sharing.** Let the user publish a chat by link. Basis: consent, Art. 6(1)(a), per chat | Users. Third parties named in the chat. Link visitors | Share record, chat content shown to anyone with the link, optional files through signed tokens that expire after 1 hour, optional name and avatar | Anyone with the link. Search engines only if the user turns indexing on. Cloudflare | None beyond those who open it | Until the user revokes the share or its expiry. Copies made by visitors cannot be recalled | M1, M3, signed expiring file tokens, tool calls stripped from shares |
| 14 | **Data export and deletion requests.** Honour Arts. 15 to 20. Basis: legal obligation, Art. 6(1)(c) | Users | Memory export (entries and settings). Everything else by email on request | Cloudflare (processor). The user | None | Export is generated on request and not stored. Requests by email: keep only as long as needed to answer | M2, M3 |

## 5. Processing activities: operations

| # | Activity and purpose | Data subjects | Data categories | Recipients | Transfers and safeguards | Retention | Security |
|---|---|---|---|---|---|---|---|
| 15 | **Operational logging.** Keep the service working and secure. Basis: legitimate interests, Art. 6(1)(f) | Users, visitors | Structured request logs: route, status, timing, user id, error context, model and token counts, memory counts and category ids. Not memory, chat or file text | Axiom (processor), datasets for production, audit and consent logs | Axiom: SCCs per the Privacy Policy. Confirm the DPA is accepted on the plan in use **[U]** | As set by the Axiom plan in use **[OWNER: fill in]** | M1, M4, M5 |
| 16 | **Cookie consent records.** Prove cookie choices. Basis: legal obligation to prove consent, Art. 6(1)(c) or legitimate interests, Art. 6(1)(f), as the Privacy Policy states | Visitors, users | Random id, timestamp, banner version, categories granted or denied, how the choice was made, coarse country. **No user id, no IP address, no email** | Cloudflare (processor), in a separate database (`CONSENT_DB`) | Cloudflare: section 6.2 | As stated in the Privacy Policy and Cookie Policy | M1, separate database, pseudonymous |
| 17 | **Campaign attribution and activation milestones.** Learn whether own campaigns lead to use. Basis: legitimate interests, Art. 6(1)(f) | Users who arrive through a campaign link | Source, medium, campaign and content tags, and three early milestones, tied to the account. No cookie or device storage | Cloudflare (processor) | Cloudflare: section 6.2 | Until the account is deleted | M1, M3, M6 |
| 18 | **Aggregate analytics.** Count usage. Basis: legitimate interests for counters that carry no user id. Cloudflare Web Analytics only with the user's consent | Visitors | Aggregate counters with no user id (Workers Analytics Engine). Web Analytics measurements only if the analytics cookie category is allowed | Cloudflare (processor) | Cloudflare: section 6.2 | About three months for counters. Web Analytics as Cloudflare states | M1 |
| 19 | **Push notifications.** Tell the user an answer is ready. Basis: consent, Art. 6(1)(a) | Users who turn them on | Push subscription endpoint and encryption keys, last-seen time | The browser's push service: Google FCM, Apple APNs or Mozilla autopush, which see the endpoint and the encrypted payload. Cloudflare | The push services are operated by US companies **[U]**, see section 6.3 | Until the user turns notifications off or the push service reports the endpoint invalid | M1, payload encrypted end to end (RFC 8291) |
| 20 | **Transactional email.** Send verification and reset emails. Basis: contract | Users | Email address, message content | Cloudflare Email Sending (processor) | Cloudflare: section 6.2 | Not kept by Besidka beyond the log entry | M1 |
| 21 | **Bot protection.** Stop abuse on sign-up and sign-in. Basis: legitimate interests, Art. 6(1)(f) | Visitors | Turnstile challenge data, as Cloudflare describes in its Turnstile Privacy Addendum | Cloudflare (processor) | Cloudflare: section 6.2 | Held by Cloudflare | M1 |
| 22 | **Backups.** Recover after data loss or a bad migration. Basis: legitimate interests, Art. 6(1)(f) | All users | Point-in-time copy of D1 | Cloudflare (processor) | Cloudflare: section 6.2 | Up to 30 days. Used only for restore | M1 |

## 6. Transfers to third countries

Art. 30(1)(e) asks for the third country and the safeguard.

### 6.1 Providers the user chooses

Besidka's server sends the request, so Besidka is the exporter (EDPB Guidelines
05/2021 on the interplay between Art. 3 and Chapter V). The tool is the one the
provider's location allows.

| Recipient | Country | Safeguard | Status |
|---|---|---|---|
| OpenAI | Ireland (OpenAI Ireland Ltd) for EEA and Swiss customers under OpenAI's data processing addendum. United States otherwise | Intra-EEA for EEA customers. Onward transfers to OpenAI OpCo, LLC rely on SCCs (Decision (EU) 2021/914) under the addendum (effective 2026-01-01) | No DPF entry found on 2026-10-26 (OpenAI OpCo, LLC and OpenAI Ireland Ltd checked, active and inactive). The policy states the SCC mechanism |
| Anthropic | Ireland (Anthropic Ireland Limited) for EEA customers per its terms. United States (Anthropic PBC) otherwise | SCCs (Decision (EU) 2021/914), Modules 2 and 3, under its data processing addendum (effective 2025-02-24) | No DPF entry found on 2026-10-26. Which entity is the importer depends on the contracting party. The policy states the SCC mechanism |
| Google (Gemini) | United States | Google LLC is an active participant in the EU-US Data Privacy Framework (participant 5780), adequacy decision (EU) 2023/1795. In the EEA, Switzerland and the UK Google's paid-service data terms apply to all Gemini API use, including unpaid quota | Checked 2026-10-26 |
| xAI | United States (SpaceXAI LLC, formerly X.AI) | SCCs (Decision (EU) 2021/914) incorporated in its data processing addendum (effective 2026-09-22) | No DPF entry found on 2026-10-26 (X Corp. is a different company). Its pages were tagged "previous version" |
| OpenRouter | United States (OpenRouter, Inc.). Can pass the request on to model vendors anywhere, including China | SCCs per its privacy policy (last updated 2026-08-31). No public DPA found | No DPF entry found on 2026-10-26. The onward step happens under the user's own gateway account |
| Vercel AI Gateway | United States (Vercel Inc.). Can pass the request on to model vendors anywhere, including China | Vercel Inc. is an active participant in the EU-US DPF (participant 6847), adequacy decision (EU) 2023/1795 | Checked 2026-10-26. The onward step happens under the user's own gateway account |
| Cloudflare AI Gateway | Cloudflare network (United States parent). Routes on to the model vendor | Cloudflare, Inc. DPF participation (see section 6.2) and its Customer DPA | Checked 2026-10-26 |
| Brave, Exa | United States | DPF status not checked on 2026-10-26 | **[U]**. How to check: `docs/legal/dpia.md`, section 8, Open placeholders |
| DeepSeek | People's Republic of China | **No adequacy decision. No contract. No suitable safeguard.** The only tool is the Art. 49(1)(a) derogation: explicit consent after the user is told the risks | Notice in the Privacy Policy. Per-user, per-provider transfer consent built (when a key is added and before the next send through an existing key; refusal blocks that provider; deleting the key withdraws it) |
| Moonshot AI | Singapore (the API Besidka calls is `api.moonshot.ai`) | As DeepSeek. No adequacy decision for Singapore | As DeepSeek |
| Qwen (Alibaba Cloud) | Singapore (Besidka calls the international DashScope endpoint, not the mainland one) | As DeepSeek | As DeepSeek |

The EDPB consent guidelines record the view that consent is not an appropriate
tool for transfers that happen on an ongoing basis. These transfers are
ongoing. This is a known weak point. It is listed as a residual risk in
`docs/legal/dpia.md`, section 6. The stronger alternatives are to block these
providers for EEA users or to remove them. Owner decision, 2026-10-26: keep the
providers and rely on the per-user consent.

The DPF list was read on 2026-10-26 (dataprivacyframework.gov, through the
participants endpoint the page uses). It changes daily. A differently named
parent or a later certification would be missed. Besidka has no contract with
the AI providers (bring your own key), so the SCCs and DPF statements above
describe what each company publishes for the user's own account.

### 6.2 Processors

| Recipient | Country | Safeguard | Status |
|---|---|---|---|
| Cloudflare | Global network. The parent company is in the United States. D1 and R2 are not pinned to the EU. The Privacy Policy says "EU and US" | Cloudflare, Inc. is a participant in the EU-US DPF (participant 5666); its status on 2026-10-26 reads "Active - Re-certification under Review". Its Customer DPA (version 6.4, effective 2026-04-03) treats DPF transfers as not restricted and uses SCCs as the fallback | Checked 2026-10-26. Keep dated copies of the DPA in a private folder. Re-check the DPF status |
| Axiom | As stated in the Privacy Policy | SCCs per the Privacy Policy | Confirm the DPA is accepted on the plan in use **[U]** |

### 6.3 Push services

Google (FCM), Apple (APNs) and Mozilla (autopush) receive the subscription
endpoint and an end-to-end encrypted payload. They are chosen by the user's
browser, not by Besidka. They are listed here for completeness.

## 7. Review log

| Date | Change | By |
|---|---|---|
| 2026-10-26 | First draft | Engineer draft |
| 2026-10-26 | Consent gate `2026-11-a` and Art. 49(1)(a) transfer consent marked built, with their files. DPF status filled from the list checked on this date. | Engineer draft |

Update this record whenever a new activity, provider, processor, storage
location, memory origin or retention rule is added. Keep it in step with the
Privacy Policy, which is the public version of this information.

## 8. Sources

- GDPR (Regulation (EU) 2016/679), Arts. 4(4), 6, 7, 9, 10, 15 to 20, 25, 30,
  32, 49 and Recital 18:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
- EDPB, Guidelines 05/2021 on the interplay between Art. 3 and Chapter V:
  https://edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf
- EDPB, Guidelines 05/2020 on consent:
  https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- Court of Justice, Meta Platforms and Others v Bundeskartellamt, C-252/21:
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62021CJ0252
- Data Privacy Framework list (checked 2026-10-26):
  https://www.dataprivacyframework.gov/list
- OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/
- Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/terms
- Cloudflare Turnstile Privacy Addendum:
  https://www.cloudflare.com/en-gb/turnstile-privacy-policy/
- Repository: `content/legal/privacy-policy.md` (recipients, retention and
  logging sections), `docs/legal.md` (processor and controller test),
  `docs/memory-architecture.md`, `docs/project-knowledge-design.md`,
  `docs/files.md`, `docs/providers/alibaba.md`, `docs/providers/moonshotai.md`,
  `docs/providers/deepseek.md`, `wrangler.jsonc`.
- "Legal pages: what to change now" research note, 2026-10-26 (working copy
  `legal-changes-now.md`, not in the repository).

Not re-read when this was drafted: the Court of Justice judgment (taken from
earlier research), and every provider's current terms except the Gemini terms
and the Anthropic and Mistral policies reviewed in that research note.
