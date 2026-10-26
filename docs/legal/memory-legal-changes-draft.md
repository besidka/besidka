# DRAFT FOR COUNSEL — not legal text

> **Status, 2026-10-26: superseded as the working text.** The Privacy Policy,
> Terms of Use and Cookie Policy were rewritten in `content/legal/` on this
> date, with the final anchors `#memory`, `#sensitive-information-in-your-chats`
> and `#transfers-outside-the-eu` (Privacy Policy) and the `Memory and project
> knowledge` and `Sensitive information` sections (Terms of Use). The anchor
> table below (`#sensitive-topics-in-memory`,
> `/terms-of-use#sensitive-information-and-memory`) is **stale**. The DPIA and
> the Art. 30 record now exist as `docs/legal/dpia.md` and
> `docs/legal/art30-record.md`. This file stays as the counsel-facing outline of
> the original reasoning.

> **Scope note, 2026-10-25: the sensitive-memory opt-in is out of v1** (owner
> decision, option (c) in `docs/legal-memory-sensitive-data.md` section 6).
> Special-category text is rejected on every memory write path and never
> stored, so the **opt-in-specific clauses below are deferred** until that path
> is revisited: the consent dialog text, consent receipts (and the
> `CONSENT_DB` extension they need), the withdrawal purge, the provider
> allowlist and its "withheld" notice, and the sensitive-memory columns and
> measures of the DPIA and Art. 30 skeletons. Read every "sensitive toggle",
> "consent dialog" and "toggle-off purge" mention below as deferred.
>
> **Still needed for v1:**
>
> - The Privacy Policy and Terms of Use changes for the memory feature itself:
>   what is stored, profiling (Art. 4(4)) by extraction, the export that now
>   exists, recipients (the AI provider the user chose), retention, and
>   transfers outside the EU. The Memory tab already tells users that sensitive
>   topics are never saved and links to the Privacy Policy, so the published
>   text must say the same.
> - A DPIA and an Art. 30 record, scoped to memory without the sensitive
>   opt-in.
> - **The chat-storage Art. 9 issue stands, independent of memory.** The
>   Privacy Policy says Besidka has no lawful basis for special-category data
>   and the Terms of Use ban submitting it, which affects chats in production
>   today. It is the most urgent open item in
>   `docs/legal-memory-sensitive-data.md`.

Outlines only. Nothing here is published, and none of it is finished legal
prose. Source and reasoning: `docs/legal-memory-sensitive-data.md`. Labels:
**[L]** needs counsel, **[I]** inference by the researcher. The published
pages live in `content/legal/` and are not edited by this document.

Facts the drafts rely on (verify against `shared/utils/memory-policy.ts` and
`docs/memory-architecture.md` before use): memory entries, About-me text and
source chat ids are stored in D1; origins are user save, tool (`memory_write`),
extraction (opt-in) and import; caps of 30 entries and 2 KB; incognito chats
excluded; never-store list; sensitivity classifier on every write.

## Anchors the Memory UI links to

| Anchor | Used by |
|---|---|
| `/privacy-policy#memory` | Memory tab, general "how memory works" link |
| `/privacy-policy#sensitive-topics-in-memory` | Sensitive toggle and consent dialog |
| `/privacy-policy#the-ai-provider-you-choose` | Consent dialog, provider recipients |
| `/privacy-policy#transfers-outside-the-eu` | Consent dialog, provider gate notice |
| `/privacy-policy#your-rights` | Rights line (export, delete, withdraw) |
| `/terms-of-use#sensitive-information-and-memory` | Memory tab footer |

The brief for this draft proposed `#sensitive-data`. The research uses
`#sensitive-topics-in-memory`, which is the slug of the proposed heading
"Sensitive topics in memory". The anchor must equal the final heading slug, so
if counsel renames the heading, update the UI links in the same change. The
three anchors that already exist (`#the-ai-provider-you-choose`,
`#transfers-outside-the-eu`, `#your-rights`) come from current headings; do not
rename them without updating the links.

## Privacy Policy: clause outline

### New section `## Memory` (anchor `#memory`)

- **What is stored.** Entries (text, category, sensitivity, origin, created and
  updated dates), the About-me text, source chat ids.
- **Where.** Besidka's database on Cloudflare (D1).
- **Origins.** User save in the UI, the assistant's explicit `memory_write`
  tool, extraction from chats (opt-in), import reviewed by the user.
- **Purposes.** (1) Keep what the user asks to be remembered. (2) Inject it
  into future prompts to personalise answers. (3) Optional extraction of
  durable preferences from chats. (4) Detect and drop never-store and
  sensitive content (classifier). (5) Prove consent (receipts).
- **Legal basis per purpose.** See the table below.
- **Recipients.** The AI provider the user chose (own key) receives injected
  memory with each prompt. Extraction runs on the user's key and model, so the
  chosen provider sees chat content for extraction. Chat search reads the
  user's own chats on demand. No other recipients. Cloudflare as
  infrastructure provider (existing recipients table).
- **Transfers.** Refer to `#transfers-outside-the-eu`. State that sensitive
  entries go only to allowlisted providers, and name the excluded providers
  and the reason (DeepSeek: PRC; Moonshot and Qwen: Singapore; no adequacy
  decision). **[L]** on Art. 49 for non-sensitive memory to those providers.
- **Never-store list.** Quote verbatim from `memory-policy.ts`.
- **Incognito chats** are excluded.
- **Caps.** 30 entries, 2 KB per entry (confirm current values).
- **Classifier.** Runs on every write, drops content, logs hold counts only.
  Describe as Art. 9 processing used as a safeguard. **[L]**
- **Accuracy.** Memory can be wrong; the user can edit or delete.
- **Retention.** Until the user deletes the entry, resets memory, turns the
  relevant toggle off, or deletes the account. Backups: up to 30 days (D1 Time
  Travel). Chat-deletion cascade for extracted entries.
- **Rights and withdrawal.** Per-entry delete, reset, toggle-off purge,
  self-service export (`/api/v1/memory/export`), withdrawal of extraction
  consent at any time with the same effort as giving it. Link `#your-rights`.
- **Profiling.** See the replacement of the profiling sentence below.

### New subsection "Sensitive topics in memory"

Anchor `#sensitive-topics-in-memory`.

- Categories in plain words (health, religion or belief, political opinions,
  sexual orientation or sex life, racial or ethnic origin, trade-union
  membership, genetic data, biometric data) plus "other sensitive topics"
  (`legal-dispute`, `drugs`) labelled honestly as not all being GDPR special
  categories.
- **Opt-in.** Off by default, separate consent, withdrawable.
- **Per-entry notice** each time a sensitive item is saved.
- **Toggle-off deletes** all sensitive entries.
- **Extraction never stores sensitive items.**
- **No sensitive data about other people**, ever.
- **Provider allowlist.** Sensitive entries are sent only to listed providers;
  if the chosen provider is not listed, the entry is withheld and the user is
  told.
- **Consent receipt.** What is recorded (user, text version, categories shown,
  UI surface, granted and withdrawn timestamps) and for how long. **[L]**

### Legal-basis table rows

| Purpose | Basis | Notes |
|---|---|---|
| Explicit saves and injection | Art. 6(1)(b) | **[I]** |
| Extraction (opt-in profiling) | Art. 6(1)(a) | Withdrawal semantics match. **[I/L]** |
| Sensitive memory | Art. 6(1)(a) + Art. 9(2)(a) | Explicit consent, versioned. |
| Chat storage of special categories | Art. 9(2)(a) | One-time consent, separate from the ToU. **[L]** |
| Sensitivity classifier | Art. 6(1)(f) as safeguard, plus 9(2)(a)? | **[L]** |
| Consent receipts | Art. 6(1)(c)/(f) | Accountability, Art. 7(1). **[I/L]** |

### Replace "Special category data"

- Delete "I have no lawful basis to process it".
- State the basis (Art. 9(2)(a) explicit consent), the safeguards (classifier,
  never-store, provider gate) and how to withdraw.
- Keep "think before sharing" as advice, not as a prohibition.
- **[L, most urgent]** Applies to chats today, independent of memory.

### Replace the profiling sentence ("Automated decision-making and profiling")

- Memory is profiling under Art. 4(4), opt-in for extraction.
- Used only to personalise answers for the user.
- No decisions with legal or similarly significant effect are made; Art. 22
  does not apply.

### Other edits

- **Recipients and transfers.** Add the allowlist and exclusions above.
- **Retention row.** Memory entries; sensitive entries; consent receipts;
  30-day backups.
- **Your rights.** Replace "no self-service export button yet" with the memory
  export, once it ships. Document per-entry delete, reset, toggle-off purge.
- **Gemini paragraph.** Add the EEA/CH/UK rule that the Paid data terms apply
  to all services including unpaid quota. **[L]**
- **Operational logging.** State that classifier logs hold counts only.
- **Changes.** Bump `updatedAt` and give in-app notice before the change, per
  the policy's own "Changes" clause. Re-consent when the consent text or the
  provider allowlist changes materially.

## Terms of Use: clause outline

- Rename "Do not submit sensitive personal data" to **"Sensitive information
  and memory"** (`#sensitive-information-and-memory`).
- Keep the practical advice (think before sharing). **Do not prohibit or shift
  responsibility** to the user (EDPB ChatGPT Taskforce para 24).
- Do not save other people's sensitive data in memory.
- Memory output can be wrong; the user controls memory and can edit, pause,
  reset or export it.
- Memory is an optional feature that can be paused or reset. The never-store
  list applies even on request.
- Consent for sensitive memory is separate from acceptance of the Terms
  (Art. 7(2)).

## DPIA skeleton (Art. 35)

**Trigger.** UODO list, Komunikat Prezesa UODO z 17.06.2019 (M.P. 2019 poz.
666): processing meeting at least two criteria "co do zasady" needs a DPIA.
EDPB (WP248 rev.01) uses the same two-of-nine rule. **[I, strong; L to
confirm]**

| UODO criterion | Applies | Why |
|---|---|---|
| 4. Special categories / highly personal data | Yes | Cloud "life-logging" style storage of very personal data |
| 8. Comparison, evaluation or inference across sources | Yes | Cross-chat extraction builds a profile |
| 10. Innovative technology | Yes | LLM extractor |
| 1. Profiling with negative effects | Probably no | **[I]** |
| Art. 35(3)(b) large-scale special categories | Probably no | **[I]** |

EDPB criteria cross-check: evaluation or scoring (profiling), sensitive data
or data of a highly personal nature, innovative use of new technology,
vulnerable data subjects (probably no). **[I]**

Skeleton sections:

1. **Scope and context.** Memory feature, chats, classifier, extraction,
   consent receipts. Toggle off and toggle on scenarios assessed separately.
2. **Description of processing.** Data flow (UI, server, D1, provider prompt),
   data categories, data subjects (users; third parties mentioned in chats),
   recipients, retention, systems (Workers, D1, KV, CONSENT_DB).
3. **Necessity and proportionality.** Purposes, bases (table above),
   minimisation (caps, never-store, "store the preference, not the reason"),
   accuracy, retention, transparency, rights handling.
4. **Risks to data subjects.** At least: unlawful special-category processing
   in chats; inference of Art. 9 data by the extractor; third-party special
   data; transfer to non-adequate providers; provider-side retention or
   training; wrong or stale memory; leakage via shared chats or exports;
   residual copies in backups; consent not provable.
5. **Measures per risk.** Deterministic classifier, extraction never writes
   `special`, third-party special data rejected, provider allowlist (empty
   until verified), toggle hidden behind
   `NUXT_PUBLIC_MEMORY_SENSITIVE_OPT_IN_ENABLED`, toggle-off purge, per-entry
   notice, export and delete, versioned consent receipts.
6. **Residual risk and decision.** Likelihood and severity before and after.
   Art. 36 prior consultation only if high residual risk remains. **[I]**
7. **Consultation.** Counsel; data-subject views if practicable.
8. **Review plan.** On any provider allowlist change, consent text change, or
   new memory origin; at least every 12 months.
9. **Sign-off.** Owner and counsel, date, version.

Proportionate length for a one-person operator: 6-10 pages. **[I]**

## Art. 30 record-of-processing skeleton (memory feature)

Art. 30(5) exemption does not apply (processing is not occasional and
includes special categories). **[C]** One row per processing activity; the
controller block is shared with the existing record for chats.

Controller block: name, contact, EU representative (n/a), DPO (none).

| Field | Memory (explicit) | Extraction (opt-in) | Sensitive memory (opt-in) | Sensitivity classifier | Consent receipts |
|---|---|---|---|---|---|
| Purpose | Keep and inject remembered facts | Learn durable preferences from chats | Keep sensitive facts the user asked to keep | Detect and drop never-store and sensitive content | Prove consent |
| Data subjects | Users; third parties named in text | Users; third parties named in chats | Users | Users; third parties | Users |
| Data categories | Preferences, About-me, facts | Same, derived from chats | Special categories (explicit) | Content scanned, nothing retained | User id, kind, text version, timestamps |
| Legal basis | 6(1)(b) | 6(1)(a) | 6(1)(a) + 9(2)(a) | 6(1)(f) + 9(2)(a)? **[L]** | 6(1)(c)/(f) |
| Recipients | User's chosen AI provider; Cloudflare | User's chosen provider; Cloudflare | Allowlisted providers only; Cloudflare | None (server-side) | Cloudflare |
| Transfers | Per `#transfers-outside-the-eu` | Same | Adequacy/DPF providers only | None | Per Cloudflare terms |
| Retention | Until delete, reset, account deletion; backups 30 days | Same; cascade on chat deletion | Until delete, toggle-off, account deletion; backups 30 days | Not stored; logs hold counts only | Account life plus accountability period **[L]** |
| Security measures | Auth, per-user scoping, TLS, D1 at rest, caps | Same | Same plus allowlist gate | Deterministic, server-side | Isolated `CONSENT_DB` |
| Systems | D1 `DB`, Workers | D1 `DB`, Workers, provider API | D1 `DB`, Workers, provider API | Workers | `CONSENT_DB` |

Review: update the record whenever a new memory origin, provider allowlist
entry or storage location is added.
