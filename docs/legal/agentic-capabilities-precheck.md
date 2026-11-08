# Agentic capabilities: compliance pre-checks

> **Engineer-drafted. Not reviewed by a lawyer.** This is a reasoned position
> by the person who builds the service, written with an AI agent and checked
> by a second, independent agent. It is not legal advice. Every point was
> checked against the named source on 2026-11-07 unless it is marked
> **(unverified)**.

| Field | Value |
|---|---|
| Date | 2026-11-07 |
| Status | Phase 0 section complete. Later tracks append one section each |
| Review | Independent agent review on 2026-11-08 against primary sources: 11 findings, all resolved in this version |
| Scope | The "Agentic capabilities" programme (Linear project P-BES-3): Phase 0 foundation, then Artifacts, Documents, Research, Connectors, Google and Skills |
| Sibling documents | `docs/legal.md`, `docs/legal/dpia.md`, `docs/legal/art30-record.md`, `docs/legal/compliance-review-2026-10.md`, `docs/legal/breach-runbook.md`, `docs/legal/monetisation-readiness.md`, `docs/legal-memory-sensitive-data.md`, `docs/d1-restore-reconciliation.md` |

## 1. Purpose

Every feature track of the programme gets a compliance pre-check **before**
its first implementation ticket starts, so nothing is built that may not be
shipped. A pre-check answers one question: go, go with changes, or no-go. It
does not write the legal records. Each track has its own legal-docs ticket for
that (Art. 30 rows, DPIA rows, Privacy Policy text), and that ticket starts
from the verdict here.

How to use this document:

1. Run the shared gate (section 2) for the track.
2. Answer the track's own questions in a go/no-go table with the columns
   `Question | Source | Finding | Verdict | Required design change | Ticket to change`.
3. State the overall verdict in one line at the top of the track's section.
4. Push every "go with changes" into the affected tickets (a comment and an
   edit of the acceptance criteria) before those tickets start.
5. Give the track's legal-docs ticket an exact input list.
6. Have an independent reviewer (a fresh agent with no context) check the
   findings against the primary sources, fix, and list the findings in the PR.

Accessibility is decided once for all tracks in section 3. Later pre-checks
refer to it instead of researching it again.

| Track | Pre-check ticket | Legal-docs ticket | Section |
|---|---|---|---|
| Phase 0, feature access, admin and Labs | P0-14 (BES-303) | P0-9 (BES-254) | 4 |
| Phase 1, Artifacts | A-12 (BES-305) | A-9 | to be added |
| Phase 2, Documents and code execution | D-10 (BES-307) | D-9 | to be added |
| Phase 3, Research | R-11 (BES-309) | R-10 | to be added |
| Phase 4a, Connectors | C-12 (BES-311) | C-10 | to be added |
| Phase 4b, Google | G-11 (BES-313) | G-10 | to be added |
| Phase 4c, Skills | S-8 (BES-315) | S-7 | to be added |

## 2. Shared gate

Every pre-check runs these seven checks and records the answer to each.

| # | Check | What to look at |
|---|---|---|
| G1 | **GDPR records and lawful basis.** New personal-data categories need Art. 30 rows and DPIA rows. Name the lawful basis per purpose (Art. 6). Look for Art. 9 data or Art. 9 inferences (`docs/legal-memory-sensitive-data.md`). Look for a new recipient or a new transfer outside the EEA, and whether it needs the Art. 49(1)(a) transfer consent (`user_settings.providerTransferConsents`) | `docs/legal/art30-record.md`, `docs/legal/dpia.md` |
| G2 | **Public documents.** What must change in `content/legal/privacy-policy.md`, `terms-of-use.md` and `cookie-policy.md`, including every new cookie, localStorage, sessionStorage or IndexedDB key | `content/legal/*.md` |
| G3 | **Notification.** The WP260 materiality checklist outcome, whether a `LEGAL_NOTICES` entry is needed (30 days, 14 with a reason), whether `CURRENT_CONSENT_VERSION` must change (only when consented purposes or consent wording change) | `docs/legal.md` "Notifying users of changes", `shared/utils/legal-notices.ts`, `server/utils/legal/consent.ts` |
| G4 | **Items of the 2026-10-28 review.** Age gate (2.1), external requests that leak IP addresses (2.2), session replay (2.3), marketing email (2.4), DSA (3.1), AI Act Art. 50 (3.2), TCO Regulation (3.3), and the breach runbook: new data stores to contain, new tokens or roles to revoke | `docs/legal/compliance-review-2026-10.md`, `docs/legal/breach-runbook.md` |
| G5 | **Third-party terms and licences** touched by the feature: provider usage policies, API terms, open-source licences of new dependencies | The vendor's current terms |
| G6 | **Monetisation guard.** Nothing may become monetisation: no paid tier, credits, donations, sponsorship, referral rewards or "supporter" access, and no copy that suggests them (owner decision of 2026-10-28) | `docs/legal/monetisation-readiness.md` section 2 |
| G7 | **Accessibility.** Apply the engineering target in section 3.2 | Section 3 |

## 3. Accessibility (decided once, for all tracks)

### 3.1 The European Accessibility Act does not apply today

The European Accessibility Act is Directive (EU) 2019/882. Poland implements
it in the act of 26 April 2024 on ensuring that certain products and services
meet accessibility requirements by economic operators (Dz.U. 2024 poz. 731,
"Polski Akt o Dostępności"), which applies to services from 28 June 2025.

**Verdict: most likely not applicable, not certain.** Two reasons, of which
the first carries the conclusion:

1. **Microenterprises that provide services are exempt.** Art. 4(5) of the
   directive: "Microenterprises providing services shall be exempt from
   complying with the accessibility requirements referred to in paragraph 3
   of this Article and any obligations relating to the compliance with those
   requirements." A microenterprise employs fewer than 10 persons and has an
   annual turnover or balance sheet total not exceeding EUR 2 million
   (Art. 3(23)). The Polish act does not apply to services that a
   microenterprise offers or provides (gov.pl guidance on the act; the
   article number in the act is **(unverified)**). Besidka is run by one
   person with no turnover. The Polish act is also addressed to economic
   operators ("podmioty gospodarcze"), and Besidka's operator is not an
   entrepreneur at all (`docs/legal.md`, "Why no postal address is
   published"). That cuts both ways: an operator that is not an enterprise
   is not, strictly, a microenterprise either. The position is that an
   activity too small to be an enterprise is at least as far outside the act
   as a microenterprise is. **(unverified)**
2. **Besidka is probably not one of the listed services.** Art. 2(2) lists
   electronic communications services, access to audiovisual media services,
   elements of passenger transport services, consumer banking services,
   e-books and dedicated software, and e-commerce services. An AI chat that a
   user runs on their own provider key is none of the first five. E-commerce
   services are services provided at a distance "with a view to concluding a
   consumer contract" (Art. 3(30)). Besidka sells nothing, but the repo
   itself treats the Terms of Use as a contract (Privacy Policy, lawful basis
   Art. 6(1)(b); `docs/legal.md` on KC art. 384¹). Whether a free account is
   a "consumer contract" for this definition is **(unverified)**, so this
   reason supports the conclusion but does not carry it.

The Polish act on digital accessibility of public bodies (2019) covers public
entities only and does not apply.

**Revisit when** any trigger in `docs/legal/monetisation-readiness.md`
section 2 fires (the operator then becomes an economic operator, though the
microenterprise exemption would most likely still apply), when Besidka starts
selling anything to consumers, or when it starts publishing e-books.

### 3.2 Engineering target: WCAG 2.2 level AA

Regardless of 3.1, every new surface in this programme targets **WCAG 2.2
level AA** (W3C Recommendation). The criteria that matter most for the planned
surfaces:

| Criterion | Rule for this programme |
|---|---|
| 2.1.1 Keyboard, 2.1.2 No keyboard trap | Every action works from the keyboard. A focus trap (full-width side panel, overlay, sheet) always ends with Esc |
| 2.4.3 Focus order, 2.4.7 Focus visible | Opening a panel or sheet moves focus into it. Project practice on top of the criterion: closing returns focus to the control that opened it |
| 2.4.11 Focus not obscured (minimum) | The fixed nav pill, the fixed composer and the docked side panel never fully hide the focused element |
| 2.5.7 Dragging movements | Anything done by dragging (side panel resize, any future reordering) also works with single clicks, without dragging. Keyboard arrows alone do not satisfy this criterion |
| 2.5.1 Pointer gestures | Swipe-down to close a sheet always has a visible close button too |
| 2.5.8 Target size (minimum) | Interactive targets are at least 24 by 24 CSS pixels, or have enough spacing |
| 1.4.3 Contrast, 1.4.11 Non-text contrast | 4.5:1 for text, 3:1 for controls, focus rings, the panel seam and the resize handle, in the light **and** the dark theme. Use DaisyUI tokens and daisyUI badge modifiers only, never colour overrides |
| 1.4.10 Reflow, 1.4.4 Resize text | Usable at 320 CSS pixels wide and at 200% text size |
| 4.1.2 Name, role, value | Toggles, the resize separator (`role="separator"` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`), tabs and iframes (a `title` on every artifact iframe) have accessible names and states |
| 4.1.3 Status messages | "Saved", errors and progress (research, rendering) are announced through a live region without moving focus |
| 3.3.1 Error identification, 3.3.3 Error suggestion | Form errors (admin rules, connector URLs, skill imports) say what is wrong and how to fix it |
| 3.3.8 Accessible authentication (minimum) | Connector and Google OAuth flows and any 2FA step never require a cognitive test; pasting codes stays allowed |
| 3.3.7 Redundant entry, 3.2.6 Consistent help | Multi-step flows (connector setup, research preflight) do not ask again for what the user already entered; help links stay in the same place |

Content that a model or a user writes (artifacts, documents, research
reports) is not guaranteed to be accessible. The frame around it (cards,
panel, controls) must be.

**How to verify:** a keyboard-only pass of the new surface (Tab, Shift+Tab,
Enter, Space, Esc, arrows) in the built-in browser at the widths the UI
definition of done already requires, plus a contrast check of new colours in
both themes. Record the result in the PR body.

## 4. Phase 0: feature access, admin and Labs

**Overall verdict: GO with changes.** Nothing is a no-go. Seventeen design
changes (C1 to C15, with C10b and C13b; section 4.3) go into P0-2, P0-3,
P0-4, P0-6, P0-7, P0-8, P0-10 and P0-11 before they are built. One of them is
a release gate: until the Privacy Policy notice from P0-9 has taken effect in
production, no rollout percentage and no A/B variant is switched on, and
features are granted only to the owner and to named testers who were told
first.

### 4.1 What Phase 0 processes

- `user_roles`: user id, role (`admin`, `tester`), who granted it.
- `feature_grants`: user id, flag, allow or deny, forced variant, expiry,
  free-text reason, who granted it.
- `feature_opt_ins`: user id, flag, opt-in and opt-out times. This is the
  evidence that a user chose to let a feature spend their own keys.
- `feature_audit_log`: actor id, actor kind (`ui`, `mcp`, `env`), MCP client
  id, action, flag, target user id, before and after as JSON.
- A sticky rollout bucket and a variant, computed from
  `sha256(flag:salt:userId)` on every evaluation. Not stored.
- Exposure telemetry in Workers Analytics Engine and Axiom.
- Admins from `NUXT_ADMIN_EMAILS` (a secret) when the email is verified.
- `/admin`: user search by email prefix, rule and grant editing, audit view.
- `/profile/labs`: the features a user can access, opt-in switches.
- MCP: `list_my_features` (`settings:read`), and `list_feature_flags`,
  `list_feature_access`, `set_feature_access` under the new scope
  `admin:features`.
- P0-11 (side panel) stores a panel width in localStorage. P0-13 (chat
  context panel) shows the user's own chat data under the existing
  `chats:read` scope. Neither adds a new personal-data category.

### 4.2 Go/no-go table

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Is sticky hash bucketing profiling, does Art. 22 apply, and what is the lawful basis? | GDPR Art. 4(4), 6(1)(b), 6(1)(f), 22; WP251 rev.01 (profiling has three elements: automated, on personal data, **to evaluate personal aspects**); EDPB Guidelines 2/2019 on Art. 6(1)(b), section on service improvement | A salted hash of the user id assigns a random bucket. It evaluates nothing about the person (no performance, preferences, behaviour or location), so the third element of profiling is missing: **bucketing alone is not profiling**. If it were, Art. 22 still would not apply: getting an experimental feature earlier or later has no legal or similarly significant effect, provided a variant never changes what the user's own key spends (see change C4). Lawful basis: staged rollout and experiments, Art. 6(1)(f) (releasing features safely, learning which variant works). Art. 6(1)(b) is weaker here, because the EDPB treats service improvement as generally not necessary for the contract. Opt-in records, Art. 6(1)(b) (the user asked for the feature). Grants and roles that an admin sets, Art. 6(1)(f). Audit log, Art. 6(1)(f) (accountability and security, Art. 5(2) and 32). Targeting by user attributes (country, email domain, usage), or any per-user analysis of outcomes by variant (spend, retention, behaviour), would evaluate behaviour and reopen this question | Go with changes | C4: a feature with variants must have `spend: 'none'` in v1. C14: no targeting on user attributes; Flagship later receives only an opaque key | P0-3, P0-10 |
| 2 | Does A/B assignment touch the device? | ePrivacy Directive Art. 5(3); PKE art. 399; EDPB Guidelines 2/2023 on the technical scope of Art. 5(3), v2.0 of 7 October 2024; `content/legal/cookie-policy.md` | The variant is decided on the server. P0-4 sends the user's feature state in the SSR payload and keeps it in `useState` memory only. Nothing is written to or read from device storage, so Art. 5(3) is most likely not engaged. The EDPB guidelines set no minimum duration for "storage", and whether they count in-memory page state is **(unverified)**. Do not lean on the "strictly necessary" exception for the experiment part: it covers what the user requested, not a variant chosen for Besidka's own purposes. The safe position therefore depends on the state never being persisted (C11). Separately, P0-11 stores `besidka:side-panel-width` in localStorage. The Cookie Policy treats every comparable UI preference (`settings_sidebar_pinned`, `file-manager-view-mode`) as a consent-gated Preference, and the ticket's "consent-exempt as strictly functional" does not match that practice | Go with changes | C11: feature state never written to cookies, localStorage, sessionStorage or IndexedDB. C10: the panel width becomes a Preferences key (consent-gated, listed in the Cookie Policy) | P0-4, P0-11 |
| 3 | Is an "opt out of experiments" required (Art. 21)? | GDPR Art. 13(1)(d), 21(1), 21(4), 5(2); WP251 rev.01; Privacy Policy "Why I am allowed to process your data" and "Your rights" | With Art. 6(1)(f), a user may object on grounds relating to their situation (Art. 21(1); no direct marketing is involved, so 21(2) and (3) do not apply). An email request would satisfy the right, but a self-service switch makes the balancing robust and costs one reserved row per user. Objecting removes the user from hash-based rollouts and variant splits only; grants and roles still apply, so a user can still be given a feature on request. Art. 21(4) requires the right to be brought to the user's attention explicitly and separately: the sentence next to the switch does that. Art. 13(1)(d): the Privacy Policy names today's legitimate interests (running a free service, debugging, abuse); "releasing features safely and learning which version works" is a new interest that must be named. Art. 5(2): the balancing must be written down | Go with changes | C3: a Labs switch "Include my account in gradual rollouts and experiments" (on by default), with one sentence saying the user can object; off stores an objection, and the evaluator then skips the rollout and variant steps for that user. P0-9 writes the legitimate-interests assessment and names the interest | P0-3, P0-7, P0-9 |
| 4 | Admin audit log: retention, account deletion, emails shown to admins | GDPR Art. 5(1)(c), 5(1)(e), 29, 32(4); Privacy Policy "Security" ("Access to production data is limited to the controller") | 12 months is proportionate for accountability of access changes. P0-2 plans to null actor and target ids on account deletion, but `before`/`after` JSON and the free-text `reason` can still name the person, so nulling the columns is not enough. The 12-month limit must exist in code before the Privacy Policy states it. User search shows every user's email to an admin. Today only the controller sees production data. If a second person ever held the `admin` role, they would act under the controller's authority (Art. 29), need a confidentiality commitment (Art. 32(4)), and the Privacy Policy "Security" sentence would become false | Go with changes | C5: before/after hold ids and flag data only; purge scrubs ids and `reason` in rows that reference the user. C6: hourly sweep deletes audit rows older than 365 days. C7: the UI cannot grant the `admin` role in v1, only `tester`; admin comes only from `NUXT_ADMIN_EMAILS` | P0-2, P0-6 |
| 5 | Is the `emailVerified` gap in dev and CI a security risk? | GDPR Art. 32; `server/utils/auth.ts` (`requireEmailVerification: !import.meta.dev && !isCiEnvironment`); `docs/auth-security.md` | Production and previews require email verification, and P0-3 already requires `emailVerified === true` for env admins even in dev. The remaining paths are an email change to an admin address that was never verified, and a takeover of the owner's account. A taken-over admin can enumerate user emails through the admin user search, an exposure that does not exist today. The DPIA must list this risk | Go with changes | C13: test that an account whose email was changed to an admin address without verification is not admin. C13b: in production, `requireAdmin` also needs `twoFactorEnabled === true` (owner action: turn on TOTP before first admin use) | P0-3 |
| 6 | MCP `admin:features`: is the admin's agent a new recipient? Is the audit enough? | `docs/mcp-server.md`; DPIA section 3.11; GDPR Art. 4(9), 5(1)(c), 44 | DPIA 3.11 covers a user sending **their own** data to an AI app they chose. `list_feature_access` as specified returns **other users'** emails to the admin's AI client. The vendor of that client then receives other people's personal data, possibly in the US and possibly as an independent controller (for example a consumer AI subscription), which is a new recipient and a transfer the current records do not cover. Returning numeric user ids instead keeps it to pseudonymous ids; the free-text grant `reason` must not be returned either, because it may name a person. The audit row with `actor_kind='mcp'` and the client id is enough for accountability of writes, but it lives in D1 and is restored with it (see question 9). Reads (admin user search, MCP list tools) are not audited at all as specified | Go with changes | C9: no MCP tool returns another user's email, name or grant `reason`; `list_feature_access` returns user ids, `set_feature_access` accepts an email or a user id and echoes only the id. C15: admin reads are logged (actor id, action, result count; never the search text). P0-9 records the admin's MCP client as a recipient of user ids | P0-6, P0-8, P0-9 |
| 7 | Is the exposure event (flag, variant, reason, bucket) anonymous? | GDPR Recital 26; CJEU C-413/23 P, EDPS v SRB, 4 September 2025 (pseudonymised data stays personal data for a party that can re-identify; read in commentary, judgment text **(unverified)**) | Answer per sink. **Analytics Engine:** with the bucket, no. Besidka holds the salt and every user id, so it can recompute every user's bucket, and with far fewer users than 10,000 buckets a bucket value points to about one person. The bucket adds nothing to the analysis, so drop it. Without the bucket an event holds flag, variant, reason and a timestamp and carries no identifier; it is treated like the existing counters, with one caveat: while a rollout cohort is tiny (one or two accounts), Besidka could still tell whose activity it is, so P0-9 must not promise that these events "cannot be linked back to you". **Axiom:** the wide event already carries the user id, so `attributes.features` there is personal data, kept under operational logging with its stated retention | Go with changes | C1: Analytics Engine gets `feature_exposure`, flag, variant, reason only (no bucket, no path, no user id); Axiom gets flag, value, variant, reason (no bucket); exposure only for hash-based decisions (rollout and variant split), never for grant, role, default or anonymous results | P0-3, P0-9 |
| 8 | Labs copy and the Terms of Use | `content/legal/terms-of-use.md` ("Availability and changes to the service": features may change or be removed; "Disclaimers": as is and as available); `docs/legal/monetisation-readiness.md` | The Terms already cover features that change or disappear and give no uptime promise, so no "Labs" clause is needed. The risk is copy: "premium", "exclusive", "early access" or "members" wording would look like a paid tier, and an email announcing Labs features would be marketing email (review item 2.4) | Go with changes | C12: Labs copy says "experimental, may change or be removed", never premium or paid wording; no email or push announces Labs features | P0-7 |
| 9 | Restore: is the Axiom replay enough, or do grants need a separate ledger? | `docs/d1-restore-reconciliation.md` (runbook step 4) | `feature_audit_log` is in D1, so a restore rolls it back together with the grants: it cannot be the replay source. Axiom `besidka-prod` is the ledger, and it is enough if every write logs what replay needs. P0-6 currently logs only `{ action, flag }`. Most serious case: a restore revives an opt-in that the user withdrew, so a feature could spend their key again without consent. Also revived: revoked admin roles, deny grants, objections, kill-switch changes | Go with changes | C8: every write logs the target user id, flag, action and effect (ids only, no email or reason) under `attributes.featureAccess`; the restore doc adds a feature-access replay step that reads Axiom, not the audit table, and replays opt-outs first | P0-2, P0-6, P0-7, P0-8 |
| G1 | GDPR records, Art. 9, transfers | Art. 30 record; DPIA | New categories: roles, grants, opt-ins, audit log, exposure events. No Art. 9 data or inference. No new processor (Cloudflare D1, KV, Analytics Engine and Axiom are already listed). New recipient only through question 6. No Art. 49(1)(a) transfer consent needed | Go (records in P0-9) | P0-9 input list (4.4) | P0-9 |
| G2 | Public documents | `content/legal/*.md` | Privacy Policy: a new paragraph on feature access and experiments, the right to object (C3), retention rows. Cookie Policy: one Preferences row (C10). Terms: no change | Go (text in P0-9, Cookie row in P0-11) | C10 | P0-9, P0-11 |
| G3 | Materiality and consent version | `docs/legal.md` materiality checklist (WP260 rev.01 paras 29 to 31 as cited there; the exact paragraph range is **(unverified)**); GDPR Art. 13(3) | Experiments and staged rollout are a **new purpose** with a new basis (Art. 6(1)(f)), and the checklist says "When unsure, treat it as material". So the Privacy Policy change is **material**: `LEGAL_NOTICES` entry, effective at least 30 days after publication. The 30 days are the project's own rule (`docs/legal.md`); the GDPR and WP260 set no fixed period, only that users are told before the new processing starts. Until the notice takes effect, Phase 0 runs in production only for the owner and for named testers who were told individually beforehand (a short message saying what is recorded and how to object, plus the Labs page). That keeps the per-user processing (grants, roles, opt-ins, audit rows, `featureAccess` log lines) limited to people who already have the information. `CURRENT_CONSENT_VERSION` does not change: no consented purpose or consent wording changes. The Cookie Policy row is minor (an existing category gets one key) | Go with changes | C2: rollout percentages and variants stay inert in production until the notice takes effect, and grants go only to the owner and named, informed testers until then | P0-3, P0-6, P0-9 |
| G4 | 2026-10-28 review items and breach runbook | `docs/legal/compliance-review-2026-10.md`; `docs/legal/breach-runbook.md` | Age gate, session replay, DSA, AI Act Art. 50 and TCO are not touched (no public user content, no generated content, no new external requests if `/admin` and `/profile/labs` load nothing from third parties). Marketing email: see question 8. Breach runbook: a new incident type "admin account or admin MCP client compromised" needs a containment entry | Go (runbook entry in P0-9) | None in code | P0-9 |
| G5 | Third-party terms and licences | OpenFeature specification; Cloudflare Flagship docs | Phase 0 adds no new dependency. OpenFeature is used only as a shape. P0-10 (Flagship) is a public beta: before P0-10, check that Cloudflare's DPA covers a beta product and that `@cloudflare/flagship` is Apache-2.0 **(unverified)** | Go | C14 note | P0-10 |
| G6 | Monetisation guard | `docs/legal/monetisation-readiness.md` | Labs and roles are free, not sold, not a reward for referrals or donations | Go | C12 | P0-7 |
| G7 | Accessibility | Section 3 | WCAG 2.2 AA applies to `/admin`, `/profile/labs`, the side panel and the context panel. The side panel resize is a dragging movement and needs a single-pointer alternative (2.5.7) | Go with changes | C10b: a click-based way to change the panel width (for example width presets in the header) | P0-11 |

### 4.3 Required design changes by ticket

**P0-2 (BES-234), feature access tables**

- **C5.** `feature_audit_log.before` and `after` hold ids and flag data only
  (never emails or names). On account deletion `purgeUserData` nulls
  `actorUserId` and `targetUserId` **and** removes user ids and `reason` from
  `before`/`after` in every row that references the user.
- **C8 (restore doc).** In `docs/d1-restore-reconciliation.md`, the feature
  access section says the audit table is restored with D1 and cannot be the
  replay source. Replay from Axiom `attributes.featureAccess`, in this order:
  opt-outs and experiment objections, role revocations, deny grants and grant
  revocations, rule changes (kill switch, rollout). Keep the existing
  "only touch rows that existed at B" guard.

**P0-3 (BES-236), registry, evaluator, guards, exposure**

- **C1.** Exposure fields per sink. Analytics Engine: `feature_exposure`,
  flag, variant and reason only (drop `doubles: [bucket]`; no path, no user
  id). Axiom `attributes.features`: flag, value, variant and reason (no
  bucket). Emit only for reason `ROLLOUT` and for hash-based variant splits;
  never for grant, role, default or anonymous results.
- **C2.** New runtime config `featuresRolloutEnabled` (env
  `NUXT_FEATURES_ROLLOUT_ENABLED`, default `false`). While it is false, the
  evaluator treats `rollout_bps` as 0 and assigns no hash variant. Grants and
  roles work regardless. Production sets it to true only after the P0-9
  notice's `effectiveAt`. Until then, production grants go only to the owner
  and to named testers who were told individually what is recorded and how
  to object (an operating rule for the admin, recorded in
  `docs/feature-flags.md`).
- **C3.** Reserved key `experiments` in `feature_opt_ins`: a row with
  `optedOutAt` set means the user objected. The evaluator then skips the
  rollout and variant-split steps for that user (grants and roles still
  apply). The registry spec asserts `experiments` is never a flag key.
- **C4.** A registry entry with `variants` must have `spend: 'none'` in v1
  (registry spec test), so an experiment never changes what a user's key
  spends.
- **C13.** Test: an account whose email was changed to an admin address
  without verifying it is not admin. **C13b.** In production (not dev or CI),
  `isAdminUser` also requires `twoFactorEnabled === true`.
- **C14.** No targeting on user attributes in v1: evaluation uses only the
  user id, roles, grants and opt-ins.

**P0-4 (BES-238), client access**

- **C11.** Feature state is never written to cookies, localStorage,
  sessionStorage or IndexedDB. It lives only in the SSR payload and
  `useState`.

**P0-6 (BES-242), admin API and UI**

- **C2 (UI).** While `featuresRolloutEnabled` is false, the rollout slider and
  the variants editor are disabled with a one-line explanation.
- **C6.** An hourly sweep (existing hourly cron pattern in `server/plugins/`)
  deletes `feature_audit_log` rows older than 365 days.
- **C7.** The UI and API grant and revoke only the `tester` role in v1. Admin
  comes only from `NUXT_ADMIN_EMAILS`. The grant form shows "Do not write
  names or emails in the reason".
- **C8.** The shared writer in `server/utils/features/admin.ts` logs
  `attributes.featureAccess = { action, flag, targetUserId, effect,
  expiresAt }` on every write (ids only, never email or reason).
- **C15.** Admin reads (user search, flag detail with grants, audit view) log
  `attributes.featureAccess = { action: 'admin.read', resource, resultCount }`
  with the actor id on the wide event. Never the search text.

**P0-7 (BES-246), Labs**

- **C3 (UI).** A switch "Include my account in gradual rollouts and
  experiments", on by default, with one sentence next to it saying that the
  user can object to this at any time by turning it off (Art. 21(4)). Turning
  it off writes the `experiments` objection row. Not exposed over MCP.
- **C8.** The opt-in route logs `attributes.featureAccess = { action:
  'opt_in.set', flag, optedIn }` (the user id is already on the wide event).
- **C12.** Copy says "experimental, may change or be removed". Never
  "premium", "exclusive", "members", "early access" or anything that suggests
  a paid tier. No email or push notification announces Labs features.

**P0-8 (BES-250), MCP feature tools**

- **C9.** No MCP tool returns another user's email, name or grant `reason`.
  `list_feature_access` returns numeric user ids with their grants.
  `set_feature_access` accepts `email` or `userId` and its result echoes only
  the user id.
- **C8.** `set_feature_access` logs through the same writer, with
  `actorKind: 'mcp'` and the client id.

**P0-10 (BES-258), Flagship provider**

- **C14.** Flagship receives only an opaque targeting key (for example an
  HMAC of the user id with a server secret), never the email or other
  attributes. Before starting, confirm that Cloudflare's DPA covers the beta
  product.

**P0-11 (BES-262), side panel**

- **C10.** `besidka:side-panel-width` is a Preferences key: registered in the
  cookie consent module, removed when Preferences are not granted (the panel
  still works with the default width), listed in the Cookie Policy
  Preferences table, and `pnpm run legal:hash` recorded as `minor`.
- **C10b.** A single-pointer alternative to dragging the seam (WCAG 2.5.7),
  for example width presets in the panel header.

### 4.4 Input for P0-9 (BES-254)

P0-9 must deliver, starting from this verdict:

**Art. 30 record** (`docs/legal/art30-record.md`)

1. Row "Feature access management": roles and grants; basis Art. 6(1)(f);
   retention until revoked, expired or account deletion; recipients none
   beyond Cloudflare (processor); security codes M1, M2, M3.
2. Row "Experiment assignment and staged rollout": computed bucket and
   variant, not stored; basis Art. 6(1)(f); not profiling (section 4.2,
   question 1), no Art. 22 effect; right to object through the Labs switch.
3. Row "Feature opt-ins and experiment objections": basis Art. 6(1)(b) for
   opt-ins, Art. 21 objection records under Art. 6(1)(c) or (f) as for the
   other receipts (row 12); retention account lifetime.
4. Row "Admin audit log" (operations): basis Art. 6(1)(f); retention 12
   months (built by C6); ids anonymised on account deletion (C5).
5. Row 18 (aggregate analytics): exposure events are pseudonymous, not
   anonymous (question 7); basis Art. 6(1)(f); about three months.
6. Row 10a or a new row: the admin's MCP client receives other users' numeric
   ids (C9) when the controller uses `admin:features`.

**DPIA** (`docs/legal/dpia.md`)

1. New section 3.12 "Feature access, rollout and experiments" (tables,
   evaluator precedence, env admins, admin UI, `admin:features`, exposure).
2. Section 4 legal-basis rows for the purposes above.
3. Section 5 risk rows, each marked built or planned: admin account takeover
   exposes user emails through search (C13b, C7); prompt-injected admin agent
   grants or denies features (per-user only, rate limit, destructive
   annotation, opt-in still required for spend); a variant raises what a
   user's key spends (C4); re-identification through exposure events (C1); a
   restore revives a withdrawn opt-in or a revoked role (C8); a second admin
   sees all emails (C7).
4. Section 3.11: add `admin:features`, its non-admin strip, and C9.
5. A written legitimate-interests assessment (Art. 5(2), 6(1)(f)) for staged
   rollout and experiments, the admin audit log and the `featureAccess` log
   lines: purpose, necessity, balancing, safeguards (C1, C3, C4, C14).

**Privacy Policy** (`content/legal/privacy-policy.md`)

1. A paragraph on experimental features: some features reach a few accounts
   or a share of accounts first, chosen at random from the account id;
   which features an account can use, which it switched on in Labs and admin
   changes to its access are recorded; the basis is legitimate interests;
   the Labs switch (or email) is how to object. Name the new legitimate
   interest (releasing features safely and learning which version works) in
   "Why I am allowed to process your data" (Art. 13(1)(d)).
2. Retention rows: grants and roles, opt-ins and objections, the audit log
   (12 months), exposure events, and the Axiom `featureAccess` log lines,
   which hold target user ids and outlive account deletion: state Axiom's
   actual retention for the plan in use (check the Axiom settings), not only
   "as kept by Axiom".
3. Access and export (Art. 15, 20): roles, grants, opt-ins, objections and
   audit rows about a user are that user's data. Say how they are provided
   (today: on request by email, like everything except the memory export);
   Art. 15(4) allows leaving out the admin's free-text reason where it would
   affect others.
4. Do not extend "cannot be linked back to you" to exposure events.
5. Keep "Access to production data is limited to the controller" true (C7).
6. Add `admin:features` only where the policy lists scopes; check the
   connected-apps section.

**Breach runbook** (`docs/legal/breach-runbook.md` section 2.2): a
containment entry "admin account or admin MCP client compromised": remove the
address from `NUXT_ADMIN_EMAILS` (secret update and redeploy), delete
`user_roles` admin rows, revoke the connected app holding `admin:features`,
set `NUXT_FEATURES_DISABLED=*` if rules were changed, review the audit table
and Axiom `attributes.featureAccess`.

**Notification decisions**

- Privacy Policy change: **material**. Add a `LEGAL_NOTICES` entry,
  effective at least 30 days after publication. Record the hash as
  `material` with the notice id.
- `CURRENT_CONSENT_VERSION`: **no bump**, with the reason (no consented
  purpose or consent wording changes).
- Terms of Use: no change. Cookie Policy: the P0-11 row, `minor`.
- Tell the coordinator the notice's `effectiveAt`, which is the earliest date
  production may set `NUXT_FEATURES_ROLLOUT_ENABLED=true` or grant features
  beyond the owner and named, informed testers (C2). The 30 days are the
  project's rule, not a GDPR period.

### 4.5 Judgement calls

These are positions, not settled law. They are listed so a reviewer can
challenge them.

- **Bucketing is not profiling.** If a supervisory authority read Art. 4(4)
  broadly, nothing changes in practice: the basis, the objection switch and
  the absence of Art. 22 effect already cover the stricter reading.
- **Material notice for experiments.** One could argue that staged rollout is
  part of running the service and not a new purpose. The project rule says
  "when unsure, treat it as material", and the cost is one email plus a
  30-day wait before rollout percentages in production.
- **2FA for admins (C13b).** Stronger than the law strictly requires. Chosen
  because the admin search is the first place where one account can see
  every user's email.
- **Objection switch (C3).** Art. 21 does not require a self-service switch;
  an email request would do. Chosen because it is cheap and makes the
  Art. 6(1)(f) balancing robust.

## 5. Later tracks

Each later pre-check adds a section here with the same structure as
section 4: overall verdict line, what the track processes, the go/no-go table
including G1 to G7, design changes by ticket, input for its legal-docs ticket,
judgement calls.

## 6. Sources

- GDPR, Regulation (EU) 2016/679: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- WP29, Guidelines on automated individual decision-making and profiling,
  WP251 rev.01 (endorsed by the EDPB).
- WP29, Guidelines on transparency, WP260 rev.01, paras 29 to 31.
- EDPB Guidelines 2/2019 on Art. 6(1)(b) in the context of online services,
  section on service improvement (paragraph numbers not re-checked).
- EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) of the ePrivacy
  Directive, version 2.0, adopted 7 October 2024:
  https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
- CJEU C-413/23 P, EDPS v SRB, 4 September 2025 (read through commentary,
  for example https://fpf.org/?p=247273).
- Directive (EU) 2019/882 (European Accessibility Act), Art. 2(2), 3(23),
  3(30), 4(5): https://eur-lex.europa.eu/eli/dir/2019/882/oj
- Ustawa z dnia 26 kwietnia 2024 r. o zapewnianiu spełniania wymagań
  dostępności niektórych produktów i usług przez podmioty gospodarcze,
  Dz.U. 2024 poz. 731: https://eli.gov.pl/eli/DU/2024/731/ogl/pol/pdf ;
  gov.pl guidance: https://www.gov.pl/web/dostepnosc-cyfrowa/polski-akt-o-dostepnosci--uslugi-handlu-elektronicznego
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Prawo komunikacji elektronicznej, art. 399 and 400 (as cited in
  `content/legal/cookie-policy.md`).
