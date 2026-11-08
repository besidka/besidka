# Compliance pre-check: Google Drive, Gmail and Calendar (G-11, BES-313)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07 and
> 2026-11-08. This is the Phase 4b section of the agentic-capabilities
> pre-check record. The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, the gate is run in full in
> "Shared gate" below. The generic transfer answer for user-chosen recipients
> is in `docs/legal/prechecks/connectors.md` (C-12, BES-311).

## Verdict

**Besidka client (`drive.file` + Picker, later `calendar.events`): GO WITH
CHANGES.** Build it, with a chat-level "carries Google data" flag that drives
a provider allow-list for every model call, per-tool confirmation of Google
tools, references-only persistence of tool results, deletion of
Google-derived copies when Google access ends, and the Limited Use statement
published before `calendar.events` is submitted for verification.

**BYO Google OAuth client for public users (G-7, G-8): UNCERTAIN, an owner
risk call. Recommendation: NO-GO for public launch; owner-only behind
`internal`.** No Google text permits or forbids a hosted service that runs
many users' personal OAuth clients. The per-project personal-use exemption,
the "OAuth-based plugins" exemption and the redirect-URI licence route
support it. The identity, credential and circumvention clauses (APIs Terms
§2(c), §2(d), §4(b); User Data Policy identity clause) can be read against it
when one operator serves the public with many users' restricted-scope tokens
on one unassessed server. If Google reads it that way, the exposure includes
Besidka's own Google project, which carries Google sign-in and the Picker.
Owner-only use (the owner's own project, used by the owner) is genuine
personal use and is fine. If the owner accepts the risk for the public, the
"GO WITH CHANGES" conditions in row 1 apply.

## In plain words

- Drive through Google's Picker on Besidka's own Google client is fine. It is
  the path Google itself recommends.
- "Bring your own Google client" for Gmail and full Drive is a grey zone, not
  a clear ban. Google lets a person run an unverified app for personal use,
  and some tools (rclone, Home Assistant, WordPress mail plugins) have users
  create their own client. But Google's terms also say the consent screen
  must show the real app, that credentials identify *your* app, and that you
  must not try to get around limits such as the number of users you may
  serve. Here Besidka's server would hold every user's Gmail tokens without
  the security assessment Google normally requires.
- The cost of guessing wrong falls on Besidka's own Google project, which
  also runs "Sign in with Google". So the recommendation is: keep BYO for
  your own account only, drop the public BYO guide and video, and offer
  Gmail to the public later, through Google's official Workspace MCP servers
  once they leave Developer Preview.
- Google forbids using its users' data to train or improve general AI
  models (strictly this binds sensitive and restricted scopes; Besidka
  applies it to Drive too, so that adding Calendar later changes nothing).
  Once a chat holds Google data, every model call in that chat goes only to
  providers whose API terms exclude training. DeepSeek and Moonshot AI are
  blocked; Gemini only on a paid key (the user confirms it); gateways only
  with their zero-retention or no-logging setting.
- Google's newest policy gives as an example that apps let users confirm
  agentic tool use "granularly". So Google tools ask before they run ("Allow
  once" or "Allow in this chat"), with no "Always allow".
- When Google access ends (the user disconnects, or Google stops accepting
  the token), Besidka deletes the tokens and the copies it made of Google
  files within 24 hours.

## Track-specific questions

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Is the BYO-client model a circumvention of Google's verification? | Google APIs Terms of Service §2(a), §2(c), §2(d), §3(a), §4(b); OAuth 2.0 Policies (production definition, domains, identity); API Services User Data Policy (identity; enforcement); restricted-scope verification page; Unverified apps page; Drive API Terms; verification FAQ | **For BYO**: the OAuth policy treats an app "not shared with anyone else" or used by "fewer than 100 people (all of whom are known personally to you)" as personal use, outside "production"; personal use is exempt from verification, and each project has its own cap. The Unverified apps page exempts "OAuth-based plugins" for a popular platform, "such as SMTP for WordPress". The OAuth policy allows redirect URIs and origins on domains "that you have been explicitly given license to use (for example, as part of a service agreement for an identity management platform)", so with an explicit licence in Besidka's Terms, users may point their clients at `besidka.com`. Home Assistant routes every user's own client through a vendor-hosted redirect (`my.home-assistant.io`). **Against BYO**: §2(c): "You will not misrepresent or mask either your identity or your API Client's identity"; §4(b): credentials "are intended to be used by you and identify your API Client"; §2(d): limits include "the number of users you may serve" and you "will not attempt to circumvent" them; the User Data Policy: permission requests "must accurately represent the identity of the application that seeks access". The plugin and Home Assistant cases run on infrastructure the user operates; in Besidka the operator holding every user's tokens is Besidka. rclone's own guide concedes users are "theoretically expected" to submit for verification. The Drive API Terms and the verification FAQ state verification and an assessment for restricted scopes without naming the personal-use exception. The CASA assessment is part of verification, which personal-use apps skip, so it is not a textual bar; the substantive concern is that BYO puts many users' restricted-scope tokens on one unassessed server, the risk CASA exists to address. **Enforcement risk**: the User Data Policy lets Google revoke access when an app "enables end-users or other parties to violate" the Terms; §2(a) bars knowingly enabling end users to violate them; §3(a) allows suspension without notice. That reaches Besidka's own Cloud project. No Google statement on hosted BYO was found (UNVERIFIED). | **uncertain (owner risk call)**; recommended **no-go for public**; **go** for owner-only behind `internal` | Default: G-7 and G-8 ship behind a flag only the `internal` audience can see; no public guide, no public video (remove both from G-12); G-3 keeps the `byo` mode in the schema. Keep BYO redirect URIs and origins on a separate path (or host) from sign-in, so a block of one does not take down the other. **If the owner accepts the risk for the public (GO WITH CHANGES)**: (1) the user's consent screen names both, for example "<name>'s client for Besidka", with homepage and privacy policy on `besidka.com` under an explicit licence in the Terms of Use; (2) the user acknowledges in the key-kind UI that the project is theirs, used only by them (and at most a few people they know), and that they accepted the Google APIs Terms; (3) Besidka meets the Workspace restricted-scope security measures itself (row 12, row 13); (4) Limited Use, the allow-list and deletion apply (row 3); (5) a kill switch and a `checkedAt` re-check in the guide. The ticket's option "no Besidka branding in the user's consent screen" is rejected: it makes the identity representation less accurate. | parent BES-230, G-3 BES-273, G-7 BES-290, G-8 BES-295, G-12 BES-314 |
| 2 | Limited Use and AI providers that may train on API data | API Services User Data Policy "Additional Requirements for Specific API Scopes"; Workspace user data and developer policy "Limited use of user data" (updated 2026-09-03); OAuth verification FAQ (GenAI questions); APIs Terms §5(c); Gemini API terms; each provider's API data terms (Sources) | Workspace policy prohibits "Transferring, selling, or using user data to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model". The FAQ adds the data must not be "stored in conjunction with" foundational models. Transfers are allowed only "to provide or improve your appropriate use case or user-facing features that are visible and prominent ... and only with the user's consent". Limited Use applies to raw data and data "derived from" the scopes. **Scope**: the rules bind sensitive and restricted scopes ("apply to data derived from both Sensitive and Restricted scopes"); `drive.file` is non-sensitive, so for the first release they are a design choice Besidka applies uniformly. §5(c) still requires "explicit opt-in consent" before non-public Drive content is exposed to third parties. **Derived copies**: Google content also lives on in assistant replies (persisted, re-sent on later turns and after a model switch, shown on public share links, returned by MCP `get_chat`), in memory extraction, TypeSafe AI checks and web-search queries the model writes. **Human review**: abuse-monitoring review at a provider matches the Limited Use security exception's own example ("investigating a bug or abuse"); review for product quality (unpaid Gemini) does not, which is why that tier is blocked. Our reading, not confirmed by Google. | **go with changes** | Chat-level flag "carries Google data", set from the first Google part or tool result. For a flagged chat the allow-list (table below) applies to every model call: chat, model switch, title, deep research and custom research. Flagged chats are excluded from memory extraction. TypeSafe AI checks and Brave/Exa searches are skipped in flagged chats (or the owner adds them to the table after checking their terms). Sharing a flagged chat needs an explicit opt-in that names the Google content (§5(c)). MCP `get_chat` withholds or marks flagged messages (G-10 finalises). Blocked models are shown unavailable with the reason "This provider may train on your Google data". | G-4 BES-278, G-5 BES-283, G-8 BES-295, G-9 BES-297, G-10 BES-299 |
| 3 | Does Limited Use bind Besidka in BYO mode too? | Verification exceptions page: all apps must comply with the User Data Policy "regardless of whether they have been verified" | Yes. It binds the software processing the data, verified or not. | **go** | Apply the allow-list, deletion and disclosure rules to every mode, including owner-only BYO. | G-3 BES-273 |
| 4 | Snapshots in R2: deletion on disconnect or revoke? | OAuth 2.0 Policies (revoke and delete tokens; Cross-Account Protection); Workspace policy "Honor user requests to delete their data"; APIs Terms §5(e); GDPR Art. 5(1)(b), 17 | No quoted Google clause ties deletion of stored copies to revocation. §5(e) bars "permanent copies" and cache beyond the cache header unless the content owner permits. For files the user owns, the attach action is the owner's permission for a limited copy; for files shared with the user (and mail from others), no owner permission exists, so the 30-day snapshot rests on being a temporary working copy for the user's own request, a reading Google has not confirmed. A snapshot is justified only by the user-facing feature the user consented to; when Google access ends that purpose is gone. `invalid_grant` also results from token expiry, password changes and Google's per-client refresh-token limit. Cross-Account Protection (RISC) is Google's only revocation signal. | **go with changes** | Disconnect in Besidka, and a detected end of access (`invalid_grant` on refresh; RISC later), both: revoke at `https://oauth2.googleapis.com/revoke`, delete tokens, delete all files with `externalSource = 'google'` and their R2 objects within 24 hours. The disconnect dialog and the help page say "when Google access ends", not only "when you revoke". Snapshot creation labelled at attach time ("Saves a copy in your Besidka files for 30 days"). No "keep as ordinary files" option in v1. | G-3 BES-273, G-4 BES-278 |
| 5 | MCP and Drive snapshots | Workspace policy transfer limits | A user-authorised MCP app is a third party. Handing it Google data is a transfer outside Besidka's own prominent feature, and the receiving AI client's training terms are unknown. | **go** (preliminary, as planned) | Keep Google-derived files out of MCP `list_files`/`read_file` (G-4 already excludes snapshots) and treat flagged chats in `get_chat` per row 2. G-10 finalises. | G-4 BES-278, G-10 BES-299 |
| 6 | Third parties in Gmail and Calendar data | GDPR Art. 2(2)(c), 6(1)(f), 9, 14(5)(b) | The household exemption covers the user, not Besidka, which processes senders', recipients' and attendees' data as controller of its own service. Art. 14 notice to each third party is disproportionate; Art. 14(5)(b) requires appropriate measures including public information, plus minimal retention. Third parties' Art. 9 data (for example a clinic's appointment email) has no consent basis: the chat consent covers the user's own data only; mitigated by references-only persistence and exclusion from memory. Tool results saved in chat history would keep third-party mail content indefinitely. | **go with changes** | Google tool results (Drive search and read, Gmail, Calendar) are persisted in `messages.parts` as references only (file id, message id, event id, title or subject, date), not bodies; the model sees bodies only in the turn that fetched them. Privacy Policy paragraph under Art. 14(5)(b). DPIA row for third parties' Art. 9 data. | G-5 BES-283, G-8 BES-295, G-9 BES-297, G-10 BES-299 |
| 7 | Transfers to third-country providers | GDPR Art. 49(1)(a); `docs/legal-memory-sensitive-data.md`; C-12 | Limited Use adds no geographic restriction; it adds the training and transfer limits of row 2. The existing per-provider Art. 49(1)(a) consent still applies. DeepSeek and Moonshot AI are blocked on training grounds anyway. | **go** | None beyond row 2. | none |
| 8 | Drive Picker | Picker web guide (updated 2026-10-12): "you must correctly identify yourself in your requests"; API key restricted to the website and `docs.google.com`; `setAppId` = project number | The key in project `chernenko-chat` is already restricted to the Picker API and the required referrers. The Picker stores nothing itself. It needs the API key and project number of the project that owns the OAuth client, so it works only with the Besidka client. | **go** | None. Owner-only BYO uses no Picker. | G-1 BES-267 |
| 9 | Branding | Drive branding guide (updated 2026-09-03); Sign in with Google branding (updated 2026-07-07); APIs Terms §6(c) | In the app, always "Google Drive" in full; the Drive logo may only be resized; a Drive icon button needs a tooltip such as "Save to Google Drive"; when shown with Besidka's logo, Besidka's must be larger; no wording implying partnership or endorsement. Gmail and Calendar brand pages not fetched (UNVERIFIED). | **go with changes** | "Google Drive" in full in the "+" menu, file-manager tab, connection page and tooltips; Drive logo unmodified; Gmail and Calendar as text only until their guidelines are checked. | G-4 BES-278, G-6 BES-288, G-9 BES-297 |
| 10 | Verification artefacts for G-2 | OAuth verification help; OAuth 2.0 Policies (homepage on a verified domain, privacy policy URL, smallest set of scopes); restricted-scope verification page (video requirements) | `drive.file` needs brand verification only, including Search Console proof of the authorised domain. `calendar.events` (sensitive; class to confirm in the console) needs homepage, privacy policy with the Limited Use statement and a demo video. The video is in English and shows the OAuth grant with the app name on the consent screen and the address bar with the client ID, then each scope's use. A test account without personal data; the owner's video style (frame 0 title slide) is fine if those elements are visible. A narrower Calendar scope (app-created or owned events) may meet G-9's needs; not checked. | **go with changes** | Publish the Limited Use statement (G-10) before submitting `calendar.events` (and, by choice, before the Drive launch). Calendar demo video with a dedicated test account and the required elements. Check the Calendar scope table for a narrower scope before choosing `calendar.events`. | G-2 BES-270, G-9 BES-297, G-10 BES-299 |
| 11 | Official Workspace MCP servers (Developer Preview) | Workspace Developer Preview Program terms (page updated 2026-11-05), items (ii), (iv), (vi) | Program terms: preview features "may not be included in public applications" before GA; no end-user access outside your domain; Google "may use any data submitted, stored, sent, or received via any Pre-GA APIs" to improve them. Which servers are GA today is UNVERIFIED. | **no-go until GA** | Do not recommend, preset or integrate a preview Workspace MCP server for users. Re-check at GA; then it is the preferred public Gmail path. | C-2 BES-235 (catalog), roadmap |
| 12 | Breach runbook | Workspace policy security section (tokens encrypted at rest; key material in an HSM or equivalent key management; notify Google of unauthorised access); `docs/legal/breach-runbook.md` | New secrets: Google access and refresh tokens in `google_connections` (encrypted), the owner-only BYO client secret in `keys`. For restricted scopes, the policy expects HSM-grade or equivalent key management; Besidka's token key is a Worker secret (`NUXT_ENCRYPTION_KEY`), and whether that is "equivalent" is open. | **go with changes** | Runbook: revoke all Google tokens via the revoke endpoint, delete them, delete BYO client secrets, tell affected BYO users (the owner, while owner-only) to rotate the client secret in their Cloud project, tell affected users, and notify Google's security contact for any known or suspected unauthorised access to Google user data. Record the key-management position (Worker secret now; plan a KMS before any public restricted-scope path). | G-3 BES-273, G-10 BES-299 |
| 13 | Prompt injection from mail and Drive content | Workspace policy security section ("Protecting against prompt injection techniques by either using Google Cloud Platform's Model Armor or other prompt injection protection"); DPIA risk table | Mail and documents are untrusted input. For restricted scopes (owner-only BYO now; public BYO if it ever ships) prompt-injection protection is a **required** security measure. | **go with changes** | Name the measure that fulfils it: untrusted framing plus per-tool approval (row 14) at minimum, no send tool, approvals for drafts and events; screening (TypeSafe AI or Model Armor) optional only for non-restricted paths. List each measure with its ticket in the DPIA (G-10). | G-5 BES-283, G-8 BES-295, G-9 BES-297, G-10 BES-299 |
| 14 | (Added) Agentic invocation consent | Workspace policy notice section | The notice section, which applies to all covered Workspace scopes, gives as an example that apps "granularly require users to confirm the MCP, tool, skill, or other agentic behavior invocation". It illustrates in-context consent rather than stating a separate rule; we read it as per-tool confirmation at minimum. | **go with changes** (conservative reading) | Google tools ask before they run: "Allow once" or "Allow in this chat"; no "Always allow" for Google tools. Attaching a picked file is itself the user's action and needs no extra prompt. | G-5 BES-283, G-8 BES-295, G-9 BES-297 |
| 15 | (Added) Drive API Terms | Google Drive API Terms of Service (8 Jul 2022) | Not allowed without Google's written consent: "Backup of user or app content from a developer's app or project to Drive". "Save to Drive" of one file at the user's request is not a backup feature. | **go with changes** | Save to Drive is per file, user-initiated, never automatic or bulk; no "back up my chats to Drive" feature without Google's written consent. | G-5 BES-283 |

### Provider allow-list for Google data

Based on each provider's API data terms as checked on 2026-11-07 (Sources).
Rule: allowed only where the default API terms exclude training on inputs;
where a tier decides it, the user confirms the tier; gateways only with a
per-request zero-retention or no-logging setting that Besidka sends, and only
to an allowed upstream provider. Applies to every model call in a chat
flagged as carrying Google data (row 2).

| Recipient | Trains on API inputs by default? | Google data allowed? | Condition |
|---|---|---|---|
| Anthropic | No | Yes | none |
| OpenAI | No (since 2023-03-01) | Yes | none |
| Google Gemini API | Paid: no. Unpaid: yes, with human review | Only on a paid key | The terms move EEA/CH/UK key holders to paid-tier data terms even on free quota, but Besidka cannot verify the key holder's location, so every user confirms per key: "This key is on a Google Cloud project with billing enabled". |
| xAI | No (not without explicit permission) | Yes | none; which terms bind a self-serve key is UNVERIFIED |
| DeepSeek | No no-training promise for API traffic; the privacy policy lists training on inputs with an opt-out | **No** | blocked |
| Moonshot AI | Yes by default | **No** | blocked |
| Qwen (Alibaba Model Studio, international) | No | Yes | Only Qwen models Alibaba serves itself (third-party vendor models follow the vendor's terms) |
| OpenRouter | OpenRouter no; upstream per endpoint | Only with ZDR | Besidka requests zero-data-retention endpoints in the provider preferences and the upstream provider is allowed here. ZDR is stricter than Limited Use needs (it bans training, not retention); chosen for simplicity. |
| Vercel AI Gateway | Vercel no; upstream per provider; the no-training filter does not apply to BYOK | Only with ZDR | Besidka sends `providerOptions.gateway.zeroDataRetention: true`. Works only on a Pro or Enterprise team or a team with purchased credits (Hobby returns 403), and skips upstream BYOK keys not marked ZDR-compliant. On a 403 or `zdr_not_attested`, block the send with that reason. |
| Cloudflare AI Gateway | No statement (UNVERIFIED); logs payloads by default | Only without payload logging | Besidka sends `cf-aig-collect-log-payload: false`; upstream provider allowed here |
| Cloudflare Workers AI | No | Yes | none |

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR | New categories: Google Drive file content and metadata; for owner-only BYO, mail and calendar data with third parties. Basis 6(1)(b) for the user's own data on request; 6(1)(f) for third parties in mail and calendars. The chat's Art. 9(2)(a) consent covers the user's own Art. 9 data only; third parties' Art. 9 data has no consent basis and is mitigated (row 6). Transfers: existing per-provider consent plus the allow-list. | Art. 30 rows and DPIA rows via G-10. |
| 2. Public documents | Privacy Policy: Google section with the exact Limited Use statement; what is read, stored (30-day snapshots), sent (allowed providers only), deleted when access ends; how to revoke at Google. Terms: Google features follow Google's terms; no Gmail send; for any public BYO, the licence to use `besidka.com` redirect URIs and origins. No cookie change expected (the Picker runs in a Google iframe on user action; check whether it sets cookies the Cookie Policy must list). | G-10. |
| 3. Notification | New purpose and new data source: material. `LEGAL_NOTICES` entry with 30-day notice before Google features reach users outside `internal`. `CURRENT_CONSENT_VERSION` unchanged; the Google consent is Google's consent screen plus Besidka's pre-consent disclosure. | G-10. |
| 4. Compliance-review items | Age gate: Google bars child-directed apps from Google-account APIs; the existing age gate stays. §2.2: the Picker loads Google scripts in the browser only after the user opens it. AI Act and DSA: n/a. Breach runbook: row 12. | G-4 (load the Picker script only on click). |
| 5. Third-party terms | Google APIs Terms, User Data Policy, Workspace policy, Drive API Terms, Picker guide, branding: rows 1 to 15. | Above. |
| 6. Monetisation guard | No paid Google tier, no partner claims. | None. |
| 7. Accessibility | The Picker is Google's UI; Besidka's connection page, chips and approval prompts follow WCAG 2.2 AA. | G-4, G-6. |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| (parent) | BES-230 | Post: public BYO Google client is uncertain and recommended NO-GO; BYO stays owner-only behind `internal` unless the owner accepts the risk (row 1 conditions); public Gmail path deferred to Workspace MCP GA. G-7/G-8 public scope stops before G-3 is built with BYO support. |
| G-2 | BES-270 | Add: "Submit `calendar.events` only after the Privacy Policy carries the Limited Use statement (G-10). Demo video in English with a dedicated test account, the consent screen's app name, the address bar with the client ID and each scope's use. Check for a narrower Calendar scope first. Search Console proof for brand verification." |
| G-3 | BES-273 | Add: "Disconnect and a detected end of access (`invalid_grant`) revoke at Google, delete tokens and delete all `externalSource = 'google'` files and R2 objects within 24 hours; the dialog says 'when Google access ends'. The `byo` mode exists in the schema but is reachable only for `internal`. BYO redirect URIs live on a path separate from sign-in. Chat-level 'carries Google data' flag." |
| G-4 | BES-278 | Add: "Server-side allow-list (table in `docs/legal/prechecks/google.md`) for every model call in a flagged chat, including model switch, title and research; blocked models shown unavailable with the reason. Gemini needs a per-key paid-tier confirmation. Gateway flags as in the table; Vercel 403 or `zdr_not_attested` blocks the send. Flagged chats excluded from memory extraction, TypeSafe AI checks and Brave/Exa search; sharing a flagged chat needs an explicit opt-in naming the Google content. Snapshot creation labelled at attach time. 'Google Drive' in full; Drive logo unmodified. Picker script loads only on click. Snapshots downloadable (APIs Terms §5(d))." |
| G-5 | BES-283 | Add: "Drive tools ask per tool ('Allow once' or 'Allow in this chat', no 'Always'). Tool results saved as references only (file id, title, modified date). Save to Drive is per file and user-initiated, never automatic or bulk." |
| G-6 | BES-288 | Add: "Tab label 'Google Drive' in full; files from Google show their source and the 30-day copy note." |
| G-7 | BES-290 | Change scope: "Owner-only. Visible only to the `internal` audience; no public guide page, no public video. If the owner later accepts the risk for the public, implement the row 1 conditions first." |
| G-8 | BES-295 | Change scope: "Owner-only (`internal`). Per-tool approval, references-only persistence, allow-list, no send tool; prompt-injection protection as a required measure (untrusted framing plus approval)." |
| G-9 | BES-297 | Add: "Per-tool approval for reads as well as writes; references-only persistence; allow-list; Calendar as text, no logo, until Calendar branding is checked; narrowest Calendar scope that fits." |
| G-10 | BES-299 | Use the input list below. |
| G-12 | BES-314 | Remove the public BYO Google client guide page and video; keep the Drive launch content. |
| C-2 | BES-235 | Add: "No Google Workspace MCP preset while the servers are in Developer Preview." |
| (MCP) | none (G-10 decides) | `get_chat` withholds or marks messages of chats flagged as carrying Google data. |

## Input list for G-10 (BES-299)

- Limited Use statement, exactly: "The use of information received from Google
  Workspace scopes will adhere to the Google User Data Policy, including the
  Limited Use requirements." (Workspace policy wording.) Place it in the
  Privacy Policy and on the Google connection page.
- Limited Use decisions: chat-level flag and allow-list (table above); no
  training anywhere; abuse-review reading (row 2); deletion within 24 hours
  when access ends; Google data not exposed to MCP apps (files, and flagged
  chats in `get_chat`); references-only chat persistence; per-tool approval;
  derived Google data in assistant messages and memory (flagged chats
  excluded from extraction).
- Art. 30 rows: "Google Drive files you pick" (Besidka client); "Google tool
  calls" (Drive search and read, Calendar); owner-only BYO Gmail and Drive as
  a note, not a public activity.
- DPIA rows: Google data to a training provider (flag plus allow-list);
  third-party personal data, including Art. 9 data, in mail and calendars
  (references-only, Art. 14(5)(b), memory exclusion); prompt injection from
  documents and mail (row 13); token theft (encryption, key-management
  position, revoke-all runbook); stale copies after access ends (24-hour
  deletion).
- Privacy Policy paragraphs: Google section (read, store, send, delete, revoke
  at myaccount.google.com/permissions); third-party data in mail and
  calendars; snapshot retention 30 days.
- Help page: how to manage and delete Google-derived data and revoke access
  (Workspace policy requires user help documentation); snapshots downloadable
  (APIs Terms §5(d) data portability).
- Terms of Use paragraphs: Google features follow Google's terms; Besidka
  never sends email; drafts and events only after the user approves.
- Materiality: material; `LEGAL_NOTICES` 30-day entry before public launch;
  `CURRENT_CONSENT_VERSION` unchanged.

## Owner items

1. **Public BYO Google client (risk call).** Options: (a) owner-only, public
   Gmail later through Google's Workspace MCP servers after GA (no cost;
   timing unknown) — recommended; (b) accept the risk and ship public BYO
   with the row 1 conditions; if Google disagrees, it can suspend users'
   projects and Besidka's own project (sign-in and the Picker); (c) put Gmail
   and `drive.readonly` on Besidka's client with verification and an annual
   CASA assessment (assessor fees, figures only from vendor pages,
   UNVERIFIED). Under (b), plan a sign-in fallback before launch.
2. **Gemini "not for consumer use" (app-wide).** The Gemini API terms say use
   is "for professional or business purposes, not for consumer use". Users
   bring their own keys and accept those terms themselves; record it. The
   paid-tier confirmation covers the Google-data side.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| Google API Services User Data Policy | https://developers.google.com/terms/api-services-user-data-policy | 15 Feb 2024 | 2026-11-07 |
| Google Workspace user data and developer policy | https://developers.google.com/workspace/workspace-api-user-data-developer-policy | 3 Sep 2026 | 2026-11-07 |
| Google APIs Terms of Service | https://developers.google.com/terms | 9 Nov 2021 | 2026-11-07 |
| Google Drive API Terms of Service | https://developers.google.com/drive/api/terms | 8 Jul 2022 | 2026-11-07 |
| OAuth 2.0 Policies | https://developers.google.com/identity/protocols/oauth2/policies | 5 Aug 2026 | 2026-11-07 |
| Restricted scope verification | https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification | 30 Oct 2026 | 2026-11-07 |
| OAuth app verification (Help Center) | https://support.google.com/cloud/answer/9110914 | undated | 2026-11-07 |
| Unverified apps (Help Center) | https://support.google.com/cloud/answer/7454865 | undated | 2026-11-07 |
| When verification is not needed (Help Center) | https://support.google.com/cloud/answer/13464323 | undated | 2026-11-07 |
| OAuth API verification FAQ (Help Center) | https://support.google.com/cloud/answer/13463817 | undated | 2026-11-07 |
| Drive API scopes guide | https://developers.google.com/workspace/drive/api/guides/api-specific-auth | 3 Sep 2026 | 2026-11-07 |
| Google Picker web guide | https://developers.google.com/workspace/drive/picker/guides/web-picker | 12 Oct 2026 | 2026-11-07 |
| Google Drive branding | https://developers.google.com/workspace/drive/api/guides/branding | 3 Sep 2026 | 2026-11-07 |
| Sign in with Google branding | https://developers.google.com/identity/branding-guidelines | 7 Jul 2026 | 2026-11-07 |
| Workspace Developer Preview Program | https://developers.google.com/workspace/preview | 5 Nov 2026 | 2026-11-07 |
| Gemini API Additional Terms | https://ai.google.dev/gemini-api/terms | effective 23 Mar 2026 | 2026-11-07 |
| Anthropic privacy center (API training, retention) | https://privacy.claude.com | articles of 18 Aug 2026 and 1 Jul 2026 | 2026-11-07 |
| OpenAI "Your data" | https://developers.openai.com/api/docs/guides/your-data | none shown | 2026-11-07 |
| xAI security FAQ | https://docs.x.ai/developers/faq/security | 10 Oct 2026 | 2026-11-07 |
| DeepSeek privacy policy | https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html | 10 Feb 2026 | 2026-11-07 |
| Moonshot AI model use agreement | https://platform.moonshot.ai/docs/agreement/modeluse | 30 Jul 2026 | 2026-11-07 |
| Alibaba Model Studio data retention | https://www.alibabacloud.com/help/en/model-studio/data-retention-policy | 27 Oct 2026 | 2026-11-07 |
| OpenRouter privacy and ZDR | https://openrouter.ai/privacy, https://openrouter.ai/docs/guides/features/zdr | 31 Aug 2026; none | 2026-11-07 |
| Vercel AI Gateway ZDR | https://vercel.com/docs/ai-gateway/security-and-compliance/zdr | 22 Sep 2026 | 2026-11-07 |
| Cloudflare AI Gateway logging | https://developers.cloudflare.com/ai-gateway/observability/logging/ | 5 Nov 2026 | 2026-11-07 |
| Cloudflare Workers AI data usage | https://developers.cloudflare.com/workers-ai/platform/data-usage/ | 16 Oct 2026 | 2026-11-07 |
| rclone Google Drive docs (secondary) | https://rclone.org/drive/ | 6 Nov 2026 | 2026-11-07 |
| Home Assistant Google Mail (secondary) | https://www.home-assistant.io/integrations/google_mail/ | none shown | 2026-11-07 |

## Unverified

- Google's own position on a hosted service operating many users' personal
  OAuth clients: no statement found either way.
- Scope classes: whether `gmail.compose` and `calendar.events` are listed as
  restricted or sensitive, and whether a narrower Calendar scope exists that
  fits G-9; confirm in the Cloud console (G-2).
- Gmail and Calendar branding pages: not fetched.
- Which official Workspace MCP servers are GA today.
- Whether the Picker sets cookies that the Cookie Policy must list.
- Whether provider abuse-monitoring review falls in the Limited Use security
  exception (our reading: yes).
- OpenRouter's exact request field for ZDR-only routing: confirm in its API
  reference when G-4 is built.
- Refresh-token limit wording: not re-read in Google's OAuth web-server guide.
- CASA assessor fees and timelines: only vendor pages.
- Whether a Worker secret meets the "equivalent" key-management bar for
  restricted scopes.
