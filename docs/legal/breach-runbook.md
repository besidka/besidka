# Personal-data breach runbook (GDPR Arts. 33 and 34): Besidka

> **Engineer-drafted. Not reviewed by a lawyer.** This is a working procedure
> written by the person who built the service on 2026-11-04. It is not legal
> advice. Points marked **unconfirmed** were not checked against a primary
> source or could not be checked from the repository. Check them once, before
> you need them.

| Field | Value |
|---|---|
| Date | 2026-11-04 |
| Controller | One private individual in Poland. No company, no DPO, non-commercial (`docs/legal/art30-record.md`, section 1) |
| Authority | Prezes Urzędu Ochrony Danych Osobowych (UODO) |
| Closes | `docs/legal/compliance-review-2026-10.md`, section 3.4 |
| Sibling documents | `docs/legal/art30-record.md`, `docs/legal/dpia.md`, `docs/d1-restore-reconciliation.md`, `docs/auth-security.md`, `docs/email.md` |
| Contact address | The address comes from `NUXT_PUBLIC_PRIVACY_EMAIL` and is shown by the `:privacy-email-link{}` component in the legal pages. Never write it in this file: the templates carry a placeholder, and you write the actual address into the filing and the email at incident time (Arts. 33(3)(b) and 34(2) need the contact itself) |

**How to use this.** Go top to bottom. Do the first-hour list before you finish
thinking. Then decide, notify, record. Write a time next to every action. If you
are unsure whether to notify, notify: a needless notice costs little, a missed
one can lead to a fine.

**Do this now, before any incident.**

1. Get a Profil Zaufany (Polish trusted profile). See 4.1.
2. Create the private breach record from section 7.
3. Make sure the Cloudflare and Axiom account emails reach a mailbox you read.
4. Know how the user notice is sent: a BCC batch from the privacy contact
   mailbox (5.2). Check that mailbox's daily sending limit now.
5. Turn on the phone alert for the privacy and security mailboxes
   (`docs/mail-alerts.md`): a processor's breach notice or a researcher's
   report starts the 72 hours, and it then pushes as urgent to every admin.

## 1. When to use this, and the clock

### 1.1 What counts as a breach

A personal-data breach is a security incident that destroys, loses, changes,
discloses or gives unauthorised access to personal data (GDPR Art. 4(12)). EDPB
sorts them in three kinds. One incident can be more than one.

| Kind | Meaning | Besidka example |
|---|---|---|
| Confidentiality | Someone who should not see the data can | A stolen session. A public share link to a private chat. A public R2 object. A leaked secret |
| Integrity | Data changed without authorisation | An attacker edits chats or memory. A bad migration rewrites rows |
| Availability | Data is gone or unreachable | A migration that wipes tables (D1 section in `CLAUDE.md`). A lost database. A long outage |

Personal data means anything about an identifiable person: email, name, chat
text, files, memory, API keys, session tokens, IP addresses in logs
(`docs/legal/art30-record.md`, section 4). A failed attack that reached no data
is not a breach. Record it anyway (section 7).

### 1.2 The 72-hour clock

- **Who.** You notify UODO within 72 hours of becoming aware (Art. 33(1)).
- **Aware.** You are aware when you have a reasonable degree of certainty that a
  security incident happened and personal data is affected (EDPB Guidelines
  9/2022). A short investigation to reach that certainty is allowed. Do not use
  it to stall. Write down when you first saw a sign and when you became sure.
- **No pause.** Weekends and holidays count (UODO breach guide, section 9.2).
- **In principle, a processor's notice starts your clock** from the moment you
  receive it (EDPB 9/2022; section 6).
- **Late is allowed, with reasons.** If you miss 72 hours, file anyway and
  attach the reasons for the delay (Art. 33(1)).
- **Phases.** You may file what you know and add the rest later, without further
  undue delay (Art. 33(4)).

## 2. First hour checklist

### 2.1 Start the record and save evidence

1. Open the private breach record (section 7). Write the time of the first sign.
2. Save evidence before containment changes the system, if that takes minutes:
   - **D1 Time Travel bookmark** (30 days of point-in-time backup,
     `CLAUDE.md`, "Recovery if it goes wrong"):
     `npx wrangler d1 time-travel info besidka --env production`. Save the
     bookmark in the record. Do not restore unless data was lost. A restore has
     side effects: read `docs/d1-restore-reconciliation.md` first.
   - **Axiom.** Dataset `besidka-prod` holds request logs. `besidka-audit-prod`
     and `besidka-consent-prod` hold audit and consent events
     (`docs/axiom-map-fields.md`). Save the queries and results for the window.
     Retention depends on the plan in use (open item, `docs/legal/art30-record.md`,
     row 15), so save early. Logs hold counts, labels and ids, never chat text
     (M5). Start with a time-bounded query:
     `['besidka-prod'] | where _time between (datetime(...) .. datetime(...)) | order by _time asc`
   - **Cloudflare audit log** (account) and **Security events** (zone). Note any
     change, token or login you do not recognise.
   - **GitHub** Actions runs and audit log, if a secret may have leaked through
     the repository, a workflow or a token.

### 2.2 Contain, by incident type

| Incident | First action |
|---|---|
| Stolen session token, account takeover | Revoke sessions (2.3). One user: ask them to use "Sign out of all other sessions". Also delete that user's rows in `oauth_access_tokens`, `oauth_refresh_tokens` and `oauth_consents`, because an attacker may have connected an app |
| `NUXT_BETTER_AUTH_SECRET` leaked | Rotate it, knowing the cost (2.4) |
| `NUXT_ENCRYPTION_KEY` leaked | Rotate it with a re-encryption plan (2.5) |
| A share link exposes a private chat | Revoke shares (2.6) |
| A public artifact link exposes personal data, or an artifact is used to phish or leak data (planned, A-1 to A-7) | Take the artifact down or revoke its links (2.6; `docs/legal/content-incidents.md`, section 5). For many artifacts or an unknown scope, revoke all artifact links (2.6). If the runtime origin or its CSP is wrong, turn the global `artifacts` rule off in `/admin` first: it hides every artifact, the panel and `/a/` for everyone |
| Public or misconfigured R2 object or bucket (including the `artifacts/` prefix) | Remove public access in Cloudflare R2, then delete or replace the object |
| Vulnerable or abused route, or a flood | Disable the route or block traffic (2.7) |
| A connected AI app is abused | Delete the grants: tables `oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_consents` (row 10a of the Art. 30 record). Every `/mcp` call checks for a live consent row, so it stops at the next call (`docs/legal/dpia.md`, risk row 33) |
| Admin account or admin MCP client compromised (feature access, `docs/feature-flags.md`) | Remove the address from the `NUXT_ADMIN_EMAILS` Worker secret and redeploy. Delete any `admin` rows in `user_roles`. Revoke the connected app that holds `admin:features` (its rows in `oauth_access_tokens`, `oauth_refresh_tokens` and `oauth_consents`), then revoke the account's sessions (2.3). If rules were changed, set the `NUXT_FEATURES_DISABLED` var to `*` and redeploy, which turns every feature off for everyone. Review `feature_audit_log` and the Axiom `attributes.featureAccess` lines (actor, targets, `admin.read` counts) to see what was read and changed, and reverse it. The admin search shows every user's email and name, so assess it as an exposure of the account list (section 3) |
| VAPID private key leaked | Rotate it. Every push subscription is invalidated and browsers re-subscribe by themselves (`docs/push-notifications.md`, "VAPID keys") |
| Bad migration, lost data | Stop deploys and further migrations. Plan a Time Travel restore (`CLAUDE.md`; `docs/d1-restore-reconciliation.md`) |
| Leaked third-party token (Cloudflare API, GitHub, Axiom, Turnstile) | Revoke and re-issue at the vendor, update the Worker secret, then read the vendor audit log |

### 2.3 Revoke all sessions

Sessions live in two places: the D1 `sessions` table and KV keys under `auth:`.
Clear both. Better Auth falls back to the D1 row when the KV entry is missing, so
clearing one store is not enough (`docs/d1-restore-reconciliation.md`).

```bash
npx wrangler d1 execute besidka --env production --remote --command="DELETE FROM sessions;"
npx wrangler kv key list --binding KV --env production --remote --prefix "auth:" > auth-keys.json
jq '[.[].name]' auth-keys.json > auth-key-names.json
npx wrangler kv bulk delete auth-key-names.json --binding KV --env production --remote
```

- Run it once. Do not repeat until the list is empty: new sign-ins write new
  keys, so it never empties.
- Everyone is signed out once. A cookie issued before the wipe can work for up to
  5 minutes (`docs/auth-security.md`, "Ending a session...").
- The prefix also holds pending reset and delete-account tokens and rate-limit
  counters. Losing them is expected.
- Take a Time Travel bookmark first. Any export that holds session tokens
  (`auth-keys.json` and `auth-key-names.json` here) goes to a temporary folder
  outside the repository and is deleted after use.

### 2.4 The auth secret (`NUXT_BETTER_AUTH_SECRET`)

**Never rotate it just to sign people out.** Use 2.3.

Rotate it only if the secret itself leaked. It also encrypts every stored TOTP
secret, every 2FA backup code, the `jwks.private_key` that signs MCP tokens, and
the HMAC on pending OAuth links. Rotation makes the TOTP secrets and backup codes
permanently undecryptable. Every 2FA user is locked out until you disable and
re-enrol their 2FA. MCP tokens fail until the `jwks` rows are deleted and a new
key is minted (`docs/auth-security.md`, "Two-factor authentication"). Plan for
that, rotate, then also run 2.3. Production secrets are Worker secrets
(`wrangler secret put ... --env production`). Previews are separate
(`docs/cloudflare-previews.md`).

### 2.5 The encryption secret (`NUXT_ENCRYPTION_KEY`)

Stored provider, gateway and search keys are encrypted by `crypto-shield`
(AES-256-GCM, key derived with PBKDF2-SHA512, random salt and IV per value)
through `server/utils/encryption.ts`, in the `keys.api_key` column. Signed file
tokens use the same secret (`docs/files.md`). Changing the secret makes every
stored key undecryptable.

A safe rotation needs a re-encryption job: decrypt each row with the old secret,
encrypt with the new, write back, then switch. None exists today. Write it, test
it on `besidka-preview`, take a bookmark, run it. If the keys must be treated as
exposed anyway (3, row 3), deleting the `keys` rows is simpler. Tell users to
revoke the old keys at their providers and add new ones.

**Artifact links (planned, A-7).** `artifact_shares.token_encrypted` holds every
live artifact link, encrypted with the same secret so owners can copy a link
again. The re-encryption job must cover that column too. A leak of the secret
plus a read of D1 exposes every live link: treat it as row 9 of section 3 and
revoke all artifact links (2.6). Lookups use `token_hash` only, which the
secret does not protect and does not need to.

### 2.6 Revoke share links

One chat: `POST /api/v1/chats/<slug>/share/revoke`
(`server/api/v1/chats/[slug]/share/revoke.post.ts`). It deletes the
`chat_shares` row and sets `chats.shared` to false. All shares, after a
bookmark:

```bash
npx wrangler d1 execute besidka --env production --remote --command="DELETE FROM chat_shares; UPDATE chats SET shared = 0;"
```

This also deletes `chat_share_files` (file grants). Count rows before and after
and write both numbers in the record. Signed file tokens expire after 1 hour.
Search engines may hold copies of pages that had indexing on: note it.

**All artifact links (planned, A-7).** Revoke softly, so the evidence stays
(the rows keep the token hash, the artifact and the times), after a bookmark:

```bash
npx wrangler d1 execute besidka --env production --remote --command="SELECT COUNT(*) FROM artifact_shares WHERE revoked_at IS NULL;"
npx wrangler d1 execute besidka --env production --remote --command="UPDATE artifact_shares SET revoked_at = unixepoch() WHERE revoked_at IS NULL;"
```

Count before and after. Check the timestamp unit against the A-1 schema before
running it (seconds or milliseconds). Artifacts in shared chats follow the chat
share: revoke those as above. Artifact links are never indexed, so no search
engine copies are expected.

**Stores to check in an artifact incident** (planned, A-1 to A-7): R2
`artifacts/<userId>/<artifactId>/v<n>`; D1 `artifacts`, `artifact_versions`,
`artifact_shares`, `artifact_storage` (viewer answers, possibly
special-category data), `artifact_reports` (reporters' names and emails); the
privacy mailbox (report emails); Axiom `attributes.artifacts` and
`attributes.artifactBridge` (ids only).

### 2.7 Disable a route or block traffic

- **Deploy.** Ship a change that returns 503 or removes the route. Production
  deploys from `main` through `.github/workflows/production.yml`.
- **Cloudflare WAF.** A custom rule on the path works in seconds. Read the
  existing rules first (`docs/agent-readiness.md`). The free zone has one
  rate-limit slot and it is used (`docs/security-audit-2026-10.md`). The custom
  rule quota of the plan is unconfirmed.

## 3. Decide: risk assessment

Answer two questions in the record, with reasons.

1. **Notify UODO?** Yes, unless the breach is **unlikely to result in a risk**
   to people's rights and freedoms (Art. 33(1)).
2. **Notify the people affected?** Yes, when it is **likely to result in a high
   risk** (Art. 34(1)).

Weigh the kind of data, how many people, how easily they are identified, how bad
the harm could be, whether the finder could read the data, and whether it was
reached or only exposed. Chat text can hold special-category data (health,
beliefs and similar, Art. 9). That is a strong sign of high risk (EDPB 9/2022
para 113; the UODO guide lists it among high-risk factors). Besidka chats can hold it (Art. 30 record, row 3).

| # | Situation | Reference | UODO | Users | Reasoning |
|---|---|---|---|---|---|
| 1 | Session tokens or the auth secret leaked | EDPB 9/2022 Annex B (vi). Guidelines 01/2021 Case 7 (credential stuffing) is the closest example, not on point. Case 6 only when solely the password hashes in `accounts` leaked | Yes | Yes. Tell them to sign in again | Session tokens are stored as they are (KV key `auth:<token>`). A valid token is full access to chats, files, keys and memory. Password hashes are a different item: open Case 6 for them |
| 2 | Stored encrypted BYOK keys exposed | EDPB 9/2022 paras 77 to 79; Case 10 | Record only | No | Strong encryption (AES-256-GCM) and the key not compromised: the data is unintelligible. Only if you can show the attacker never had access to the Worker, its deploys or the Cloudflare account (the key must be uncompromised, EDPB 9/2022 paras 76-78). Otherwise use the next row |
| 3 | Same, and `NUXT_ENCRYPTION_KEY` leaked too | Same | Yes | Yes. Tell them to revoke the keys at each provider and add new ones | Treat the keys as plaintext. A key spends money |
| 4 | A share link exposed a private chat | No EDPB case | Judge | Judge | Special-category data is a strong sign of high risk (EDPB 9/2022 para 113; the UODO guide lists it among high-risk factors). Look at the content, the indexing flag, how long the link was open and any access in the logs. An indexed link with sensitive text is a strong case. A link nobody opened is weaker |
| 5 | R2 bucket or object public by mistake | EDPB 9/2022 Annex B (vii); Case 5 | Record only if no evidence of access | Yes if accessed | Check R2 and Cloudflare logs for reads by anyone but the app. Keys are random UUIDs (`docs/d1-restore-reconciliation.md`), which lowers but does not remove discovery |
| 6 | Short outage | EDPB 9/2022 Annex B (iii) | Record only | No | Brief loss of availability, no data lost |
| 7 | Data lost, no backup | Guidelines 01/2021 Cases 1 and 2 | Yes | Yes if people lose what they cannot recover | D1 Time Travel (30 days) is the backup. If it holds the data, the loss is availability only. Check first |
| 8 | Logs with IP addresses lost or exposed | None. **Inference** | Likely record only | Likely no | Logs hold route, status, timing and user id, not chat text. Judge duration, volume and harm. Write the reasoning down |
| 9 | Live artifact links exposed (`token_encrypted` with the secret, or a bulk leak of links) | As row 4 | Judge | Judge, owners of exposed links | Like a share link: the content was meant for whoever had the link, but not for everyone. Look at the content (row 49 of the DPIA), how long, and access in the logs. Revoke all (2.6) |
| 10 | `artifact_storage` or `artifact_reports` exposed | As row 4; EDPB 9/2022 para 113 for special categories | Yes | Judge | Viewer answers can be health or belief data; reports hold reporters' names and emails, and a reporter may face retaliation. Lean towards telling them |
| 11 | Runtime origin, CSP or sandbox misconfigured, so artifacts could read the page or the network | None. **Inference** | Judge | Judge | Turn the global `artifacts` rule off first. Then check whether any artifact used it (reports, `runtimeNavigation` lines, unusual traffic). With no evidence of use, record only |

**Art. 34(3): you may skip telling people when** the data was encrypted and the
key is safe; or you took steps afterwards so that the high risk is no longer
likely; or telling each person would take disproportionate effort. In the last
case use a public notice or similar (a notice on the site).

UODO can order you to tell the people (Art. 34(4)) even when you decided not to.
Record your reasoning so you can defend it.

## 4. Notify UODO (within 72 hours)

### 4.1 Channels

From the UODO breach guide (section 9.3) and https://uodo.gov.pl/pl/525/2582:

| Channel | How |
|---|---|
| E-form on biznes.gov.pl | "Zgłoś naruszenie ochrony danych osobowych": https://www.biznes.gov.pl/pl/portal/ou889 |
| ePUAP | Send the form to the UODO inbox `/UODO/SkrytkaESP` |
| General letter on ePUAP | A "pismo ogólne" with the completed form attached |
| Post | UODO, ul. Moniuszki 1A, 00-014 Warszawa, with the form attached |

Sign with a Profil Zaufany or a qualified electronic signature. Use
kancelaria@uodo.gov.pl only if the e-channels are down, then confirm through a
standard channel.

**Unconfirmed:** biznes.gov.pl describes the filer as an entrepreneur or public
body. ePUAP `/UODO/SkrytkaESP` or paper post (DOCX form on that page) is the
safe route. **Get a Profil Zaufany now.** Do not start on day one of an
incident.

### 4.2 Phased and late filing

Tick "Zgłoszenie wstępne" (preliminary) when facts are missing. Send the
supplementary notification when you have them (Art. 33(4)). After 72 hours,
attach the reasons for the delay.

### 4.3 What to put in (Art. 33(3))

Fill this in first. Put no affected user's name or email in it.

```
(a) Nature of the breach
    What happened, in plain words:
    Kind: confidentiality / integrity / availability
    First sign (date, time):        Became aware (date, time):
    Categories of people affected (users, visitors, people named in chats):
    Approximate number of people:
    Categories of data (email, name, chats, files, memory, API keys,
      sessions, IP addresses):
    Approximate number of records:
    Special-category data possible, and why:
(b) Contact point: [write the actual privacy contact email here]. The controller is a
    private individual. There is no DPO.
(c) Likely consequences for the people affected:
(d) Measures taken or proposed
    Containment (what, when):   Fixes:   How people are told:
    Steps to reduce harm for the people affected:
Delay (only after 72 hours): reasons.      Phase: preliminary / supplementary
```

## 5. Notify users (Art. 34(2))

Use clear and plain language. Say what happened, give a contact point, describe
the likely consequences and what you did or propose, and what the user should do
(Art. 34(2), with Art. 33(3)(b) to (d)).

### 5.1 Email template

Keep it short. Do not promote anything.

```
Subject: Security incident at Besidka: what happened and what to do

Hello,

On [date] I found that [what happened, in one or two plain sentences].

What this means for you
[Which of your data was affected and which was not. Likely consequences in
plain words. If you cannot be sure, say so.]

What I did
[Contained on date. Fixed. Reported to the data protection authority (UODO)
on date, if so.]

What you should do
- [Sign in again. Your sessions were ended.]
- [Revoke your API key at your provider, then add a new one in Besidka.
  A leaked key can spend your money.]
- [If you shared a chat, I removed all share links. Share again if you want.]
- [Be careful with emails that claim to be from Besidka.]

Questions
Write to [write the actual privacy contact email here]. I will answer.

[Name]
```

### 5.2 How to send

Owner decision, 2026-11-04: Besidka has about 190 accounts, so **no in-app
mass-mail endpoint is built**. It would itself be a new attack surface and a new
mailer to keep compliant. Send the notice by hand:

1. Export the affected verified addresses with a one-off read-only query
   against the production database, to a file **outside the repository**:
   `npx wrangler d1 execute besidka --env production --remote --json --command="SELECT email FROM users WHERE email_verified = 1 AND id IN (...)" > ~/breach-<id>.json`
   (`cf d1 query` is an alternative). Only a SELECT keeps it read-only. Run it
   yourself in a plain terminal, **never through an AI assistant**: the output
   would land in the assistant's transcript.
2. Send the notice from the published privacy contact mailbox, in BCC batches
   small enough for that mail account's daily sending limit. Put your own
   address in To. Send a test to yourself first. Check To and CC before each
   batch: exposing addresses to other recipients is itself a breach (EDPB 9/2022
   Annex B (x)). Put no sign-in or password-reset links in the email; tell users
   to type besidka.com themselves.
3. Delete the export when done.

- **Never** put addresses in To or CC (other than your own in To), in the
  repository, in shell history or in a chat. Log counts only (M5).
- **Do not reuse the legal change notice sweep.** It sends 25 emails per cron
  tick, at most 300 a day, is tied to the `LEGAL_NOTICES` registry and the public
  change history, and sends fixed text (`docs/email.md`, "Legal change notices";
  `docs/legal.md`). A breach notice is not a policy change.
- **In-app notice.** The in-app banner is driven by `LEGAL_NOTICES`. Do not use
  it for a breach unless you build a separate, clearly worded one. A public
  notice on the site is the fallback for the Art. 34(3) effort exception.
- Write the date, the number sent and the number failed in the record.
- **Revisit when** the account count grows past what manual BCC batches can
  handle within a day.
- **If this ever needs automating.** The send path is `sendTemplateEmail()` in
  `server/utils/email-template.ts` (`docs/email.md`, "Send path"); the pattern to
  copy is `server/utils/account/security-emails.ts`. Any new `send...Email`
  export in `server/utils/account/` needs an entry in
  `shared/utils/account-emails.ts`, or `tests/unit/content/account-email-list.spec.ts`
  fails. Decide the wording and the registry category first.

## 6. Processor notices (Art. 33(2))

A processor must tell you without undue delay after it becomes aware of a
breach. **Your own 72 hours start when you receive its notice.**

| Processor | Terms | How it reaches you |
|---|---|---|
| Cloudflare | Customer DPA clause 3.1(e): "without undue delay" (https://www.cloudflare.com/cloudflare-customer-dpa/) | **Unconfirmed.** The channel is not stated. Watch the Cloudflare account email and its status page |
| Axiom | DPA section 5.3, to the registered account email (https://axiom.co/docs/legal/data-processing) | The registered account email. Unconfirmed that the DPA is accepted on the plan in use (Art. 30 record, row 15) |
| Google and GitHub sign-in | Not researched | Not researched |

When a processor reports a breach, write the time you got the notice in the
record. Ask what of yours it touched and what it did. The AI providers and
gateways the user chose are independent controllers on the user's own account
(Art. 30 record, section 3): their breaches are theirs to report.

## 7. The breach record (Art. 33(5))

Document every breach, even one you do not report: the facts, the effects, the
remedial action and, if you did not notify, the reasoning. **Keep it private,
not in this public repository** (your private notes). **Put no affected user's
personal data in it** (UODO advice). Use counts, categories and internal ids.

Copy-paste template:

```
Breach record  ID: (year-number)   Status: open / contained / closed

Timeline (UTC, every line dated)
First sign:  Aware (reasonable certainty):  Contained:
UODO notified (preliminary / supplementary):  Users notified:  Closed:

Facts
What happened / how found / cause:
Systems and stores involved (D1, KV, R2, Axiom, secrets, other):
Kind:  Categories and approximate number of people:
Categories and approximate number of records:
Special-category data possible: yes / no (why)

Assessment
Likely consequences:   Risk: unlikely / risk / high risk
Reasoning (table row, EDPB case, evidence of access):

Decisions
Notify UODO: yes / no, why.    Notify users: yes / no / public notice, why
(Art. 34(3) exception if used).    Processor notices (who, when):

Remedial action
Containment (what, when):  Evidence saved (bookmark, queries, audit log):
Fixes and follow-ups with dates:
DPIA, Art. 30 record or this runbook updated: yes / no
```

## 8. Afterwards

1. Fix the cause. Add a test if it was code.
2. Update `docs/legal/dpia.md` (risk table, and its review trigger "a complaint,
   breach or authority request touches this processing") and
   `docs/legal/art30-record.md` (security measures, processors, retention) when a
   risk changed. Keep both in step with the Privacy Policy.
3. Write a post-mortem in `docs/` if it helps the next person. Leave out
   personal data, secrets, account ids and addresses: the repository is public.
4. Close the record. If UODO writes back, answer within the time it sets and add
   the exchange to the record.

## 9. Out of scope and other duties

- **NIS2 does not apply.** Besidka is not a listed entity type and is below the
  medium-size threshold (Directive (EU) 2022/2555, Art. 2).
- **Polish KSC amendment.** It is reported as in force from 3 April 2026. This
  was **not verified**. Besidka is likely not covered.
- **CERT Polska.** UODO suggests reporting phishing and malware at
  https://incydent.cert.pl. For Besidka it is likely voluntary. **Unconfirmed.**

- **Judgment calls.**
  - Bulk revokes (all sessions, all shares) destroy evidence. Take a D1 Time
    Travel bookmark first (it lasts 30 days).
  - Notifying only verified addresses may miss people, and unverified ones may
    reach the wrong person. Decide case by case.
  - Filing with UODO requires your name and address. They go to the authority,
    not to publication.

## 10. Sources

- GDPR (Regulation (EU) 2016/679), Arts. 4(12), 33, 34:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
- EDPB, Guidelines 9/2022 on personal data breach notification, v2.0:
  https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf
- EDPB, Guidelines 01/2021 on examples regarding personal data breach
  notification:
  https://www.edpb.europa.eu/system/files/documents/2022-01/edpb_guidelines_012021_pdbnotification_adopted_en.pdf
- UODO, breach guide: https://uodo.gov.pl/pl/598/3563 (PDF:
  https://uodo.gov.pl/pl/file/5687). Reporting channels:
  https://uodo.gov.pl/pl/525/2582. E-form:
  https://www.biznes.gov.pl/pl/portal/ou889
- Cloudflare Customer DPA: https://www.cloudflare.com/cloudflare-customer-dpa/
- Axiom data processing terms: https://axiom.co/docs/legal/data-processing
- Repository: `CLAUDE.md`, `docs/d1-restore-reconciliation.md`,
  `docs/auth-security.md`, `docs/legal/art30-record.md`, `docs/legal/dpia.md`,
  `docs/legal/compliance-review-2026-10.md` (3.4), `docs/security-audit-2026-10.md`,
  `docs/push-notifications.md`, `docs/email.md`, `docs/legal.md`,
  `server/utils/encryption.ts`, `server/api/v1/chats/[slug]/share/revoke.post.ts`.

Not independently re-read for this document: the EDPB, UODO and DPA texts beyond
the clauses and numbers taken from the research notes (paragraph and section
numbers are as given there), and the current state of the biznes.gov.pl form.
