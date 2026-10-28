# Compliance review, 2026-10-28: six launch risks and extra findings

> **Engineer-drafted. Not reviewed by a lawyer.** This is a reasoned position by
> the person who built the service, based on primary sources and research. It
> is not legal advice. Where a point rests on an untested argument it says so.

| Field | Value |
|---|---|
| Date | 2026-10-28 |
| Branch | `feat/app-compliance-investigation-427c1c` |
| Scope | Six launch risks (age gate and COPPA, external fonts and IP leaks, session replay and CIPA, marketing email and CAN-SPAM, subscriptions and the California automatic renewal law, uploads and the DMCA) plus extra findings (DSA, AI Act Art. 50, the Terrorist Content Online Regulation, GDPR Art. 33, GDPR damages case law, the EU-US DPF) |
| Sibling documents | `docs/legal.md` (decision log, section "2026-10-28 compliance review: decisions"), `docs/legal/art30-record.md`, `docs/legal/dpia.md` |
| Consent version | Unchanged (`CURRENT_CONSENT_VERSION`). No new purpose or recipient, so no re-prompt |

## 1. Summary

| # | Topic | Status | Changed in this branch | Owner follow-up |
|---|---|---|---|---|
| 1 | Age gate and COPPA | Mostly fine. 18+ general-audience service | Age confirmed at sign-up (email checkbox, notice by the Google and GitHub buttons), and still in the app | Optional: decide whether the sign-up confirmation should be stored |
| 2 | External fonts and IP leaks | Fixed for fonts, icons and share pages. One low residual (see 2.2) | Fonts and icons self-hosted, Iconify fallback off, share-page avatar proxied | Done 2026-10-28 (see 2.2). Keep the rest as it is |
| 3 | Session replay and CIPA | Not applicable today | Nothing | Do not add session replay or ad trackers without revisiting |
| 4 | Marketing email and CAN-SPAM | Not applicable. All mail is transactional | Privacy Policy email list corrected | None |
| 5 | Subscriptions and California ARL | Not applicable. Nothing is sold | Nothing | Revisit before any paid tier |
| 6 | Uploads and the DMCA | Decided 2026-10-28: no agent; no safe harbour claimed; revisit only if a JDG is opened. Notice process published | New Terms section "Copyright complaints", Privacy Policy "Reports and notices about content", share defaults off, retention 12 and 24 months | None |
| 7 | DSA | Untested argument that it does not apply. Followed voluntarily | Stopped self-labelling as an "online platform" | Counsel check |
| 8 | AI Act Art. 50 | Visible badge shipped (not the art. 50(2) marking); provider metadata not stripped; provider status open, 2.12.2026 (see 3.2) | AI-generated badge on generated images in the chat UI, share pages and the image preview | None |
| 9 | TCO Regulation 2021/784 | Watch | Nothing | Keep the contact address monitored |
| 10 | GDPR Art. 33 breach procedure | Missing | Nothing | Write a short 72-hour procedure |
| 11 | GDPR damages and fonts case law | Context | Nothing | None |
| 12 | EU-US DPF | Context | Nothing | Watch the appeal |

## 2. The six launch risks

### 2.1 Age gate and COPPA

- **Position.** Besidka is a general-audience service for people aged 18 or
  over, because every provider it works with sets 18 as the minimum for an API
  account. COPPA (16 CFR Part 312) turns on a service directed to children under
  13, or on **actual knowledge** that it collects data from one. A general
  audience 18+ service with no child-directed content is outside it unless the
  operator learns otherwise.
- **Collecting a date of birth would hurt, not help.** It is new personal data,
  it proves nothing (anyone can type any date), and it creates the "actual
  knowledge" the operator is trying not to hold by accident. So no date-of-birth
  field was added.
- **GDPR Art. 8.** Poland sets the age of digital consent at 16. Besidka is
  adults-only, so Art. 8 does not arise. Memory and chat consents are asked of
  adults only.
- **What changed.** The email sign-up checkbox now reads "I am 18 or over and
  agree to the Terms of Use and Privacy Policy". A notice next to the Google and
  GitHub buttons on sign-up and sign-in says that continuing confirms 18+ and
  accepts the Terms and Privacy Policy (`app/components/Auth/OAuthNotice.vue`).
  The in-app gate before the first message (box "I am 18 or over and I accept
  the Terms of Use") still records `age_confirmed_at`. The Terms ("Who may use
  it") and the Privacy Policy ("Age limit") say all of this, and keep "if you are
  under 18, do not create an account; tell me and I delete it".
- **Limit.** The sign-up confirmation is not stored on its own. The record is the
  one made in the app. If the owner wants proof of the sign-up step, that needs a
  new column (additive migration).
- **Owner.** Nothing required.

### 2.2 External fonts and IP address leaks

- **Risk.** A page that loads fonts from Google Fonts hands the visitor's IP
  address to Google. LG München I, 3 O 17493/20 (20 January 2022) awarded damages
  for exactly that without consent. Later rulings treated mass warning letters
  built on it as abusive: LG Baden-Baden 3 O 277/22 and AG Berlin-Charlottenburg
  217 C 64/22. The Bundesgerichtshof case VI ZR 258/24 has been referred to the
  Court of Justice and is pending.
- **What was found and changed.** Besidka already served Nunito and Atkinson
  Hyperlegible Mono and its icons from besidka.com. Two leaks remained: the
  Iconify API as a fallback for icons, now disabled (`docs/nuxt-icon-collections.md`),
  and the share-page author avatar, which the browser loaded straight from
  Google or GitHub. The avatar is now served by a same-origin proxy
  (`server/api/v1/shared/[slug]/avatar.get.ts`), and the raw avatar URL is never
  sent to viewers.
- **Result.** Third-party loads are two, both Cloudflare: Turnstile on the auth
  pages (no consent, security) and Cloudflare Web Analytics (only after consent).
  The Cookie Policy statement "two third-party scripts, both from Cloudflare" is
  accurate. The Privacy Policy and Cookie Policy now say fonts, icons and the
  share avatar are served from besidka.com.
- **Turnstile.** The Privacy Policy now says Cloudflare uses Turnstile signals
  for its own purposes as a controller on legitimate interests (Cloudflare's
  Turnstile Privacy Addendum), so for that use it is not only a processor. The
  addendum link stays: it is a condition of using Turnstile (`docs/legal.md`).
- **Residual, low.** The proxy covers share pages only. Inside the app, a
  signed-in user's own avatar (`Chat/Message.vue`) is still loaded by their own
  browser from Google or GitHub, so that host sees their IP address. It is their
  own account and their own data, at the provider they signed in with, so the
  risk is low and it is not fixed here.
- **Owner.** Extend the single Cloudflare "API flood limit" rate-limit rule
  (`docs/security-audit-2026-10.md`, item 4) with
  `or starts_with(http.request.uri.path, "/api/v1/shared/")`, because the avatar
  route makes an outbound fetch on a cache miss. The zone allows exactly one
  rule, so edit the existing one. **Done 2026-10-28** through the `cf` CLI
  (ruleset `http_ratelimit`, rule version 3). When adding any new embed (video,
  map, social), check what it loads.

### 2.3 Session replay and the California Invasion of Privacy Act (CIPA)

- **Risk.** Claims under CIPA (Cal. Penal Code sections 631 and 638.51, wiretap
  and pen-register theories) have been brought against sites that run session
  replay or share browsing data with third-party trackers without prior consent.
- **Position.** Besidka runs no session replay, no heatmaps, no advertising
  pixels and no analytics beyond Cloudflare Web Analytics, which loads only after
  consent, plus server-side aggregate counters with no identifier. Turnstile is a
  security check. Nothing here fits the pattern.
- **What changed.** Nothing in the code. The statements are already in the Cookie
  Policy ("There is no marketing category") and the Privacy Policy.
- **Owner.** Do not add session replay, a chat widget or an ad or social tracker
  without revisiting this and the Cookie Policy.

### 2.4 Marketing email and CAN-SPAM

- **Position.** Every email Besidka sends is a "transactional or relationship
  message" under 15 U.S.C. 7702(17) and 16 CFR 316.3: email address
  verification, password reset, confirmation of a new email address,
  confirmation of account deletion, and security notices (password changed,
  sign-in method connected or disconnected, two-factor authentication turned on
  or off, backup codes regenerated, account email changed, passkey added or
  removed). For such messages CAN-SPAM's main rule is the ban on false or
  misleading header information. The opt-out, physical-address and
  advertisement-label rules apply to commercial messages, and there are none.
  There is no mailing list and no newsletter.
- **What was wrong.** The Privacy Policy said "I send exactly two kinds of
  email". That was false. It now lists the real set in three groups and keeps
  "I never send marketing email". The legal-basis row now covers the security
  notices (legitimate interests) separately from verification and confirmation
  (contract).
- **Owner.** If a marketing email is ever added, it needs an opt-in, an opt-out,
  and a rewrite of this section. Also see the postal-address consequences in
  `docs/legal.md`.

### 2.5 Subscriptions and the California automatic renewal law

- **Position.** California's automatic renewal law (Bus. & Prof. Code section
  17600 and following) governs automatic renewal and continuous service offers.
  Besidka has no subscription, no trial, no payment and no paid tier, so it does
  not apply. The Terms already say there is no payment and describe what would
  change if that ever did.
- **Owner.** Revisit before any paid tier, together with `docs/legal.md` "Why no
  postal address is published". Monetisation changes several conclusions at once.

### 2.6 User uploads, share pages and the DMCA

- **Risk.** Users upload files and publish chats that can contain others'
  copyrighted material. The US safe harbour for hosting (17 U.S.C. 512(c))
  protects a service provider that has a designated agent registered with the
  Copyright Office, a notice-and-takedown procedure and a repeat-infringer
  policy.
- **What changed.**
  - **Terms.** A new "Copyright complaints" section, after illegal-content
    reporting. It lists the notice elements of 512(c)(3)(A), what I do on a
    valid notice, a way to say a removal was a mistake (reply to the statement
    of reasons or write to the contact address; the user's name and contact
    details go to the complainant only with the user's consent), a
    repeat-infringement rule (material repeatedly removed on copyright notices:
    sharing restricted, account suspended or terminated, a statement of reasons
    each time) and a false-notice warning. It names no agent, claims no
    registration and no US safe harbour, and does not offer a 512(g)
    counter-notice procedure.
  - **Privacy Policy.** A new section "Reports and notices about content", a
    legal-basis row (Art. 6(1)(c) where the law requires action, otherwise
    6(1)(f)) and a retention row. The existing text had no report-processing
    row to extend, so these are new.
  - **Share defaults.** New shares start with everything off (indexing, files
    and generated images, metadata, author name and avatar, branching), so
    less copyrighted or personal material is published by accident. This is a
    UI default. The SQL column defaults stay `DEFAULT true` because changing
    them rebuilds `chat_shares` on D1 and cascades `chat_share_files`
    (`docs/d1-restore-reconciliation.md`).
- **The designated-agent decision (decided 2026-10-28: no agent; no safe
  harbour claimed; revisit only if a JDG is opened).** Without a registered
  agent the 512(c) safe harbour is not available, so the procedure above is good
  practice and a commitment, not a shield. Registering is done at dmca.copyright.gov
  through Login.gov, costs $6 per designation and is renewed every 3 years. The
  catch: 37 CFR 201.38(b)(1)(i) requires the **service provider's own physical
  street address** to be on the public record. A P.O. box is accepted for the
  service provider under the exception in (b)(1)(ii), only with a personal-safety waiver
  (poboxwaiver@copyright.gov). The **agent's** address may be a P.O. box, or the
  agent may be a third-party agent. So registering breaks the
  no-postal-address position that `docs/legal.md` relies on, unless the waiver
  is granted. The owner decided not to register and not to publish a home
  address.
- **Retention (decided).** Reports and notices are kept until the matter is
  closed and then 12 months. A note that content was removed from an account on
  a copyright notice is kept 24 months, for the repeat-infringement rule. The
  emails are deleted on the same schedule.
- **Owner.** Nothing open. If an agent is ever registered, add the agent's
  details to the Terms section and update `docs/legal.md`.
- **Shared pages and search (2026-10-28).** Search Console showed 0
  impressions and 0 clicks for `/shared/` pages over 90 days, and no `/shared/`
  URL among the 17 indexed pages. Production had 21 active indexable shares (20
  by the owner, user id 1; 1 by another user). The owner decided not to change
  existing shares.

## 3. Extra findings

### 3.1 Digital Services Act (DSA) and the Polish implementing act

- **Might not apply at all.** The DSA covers "intermediary services", which are
  "information society services". Directive 2015/1535 Art. 1(1)(b) defines those
  as services "normally provided for remuneration". A free, non-commercial
  service run by a private individual with no revenue has a strong but untested
  argument that it is outside that definition (CJEU C-291/13 Papasavvas and
  C-484/14 Mc Fadden on the remuneration element).
- **Polish act.** The ustawa of 4 September 2026 amending the ustawa o
  świadczeniu usług drogą elektroniczną (Dz.U. 2026 poz. 1296, in force about 6
  November 2026) implements the DSA. The President of UKE is the Digital
  Services Coordinator. Its fines attach to a `usługodawca`, defined in UŚUDE
  Art. 2 pkt 6 as acting in `działalność zarobkowa lub zawodowa`. That is the
  same test as in `docs/legal.md` "Why no postal address is published", so a
  non-gainful individual very likely falls outside the fining regime. Worst case
  for a provider with zero turnover is capped at EUR 6,000 (art. 22zzo ust. 4).
- **Even if the DSA applies.** A natural person is at most a micro enterprise,
  which is exempt from Arts. 15 and 19 to 28 except Art. 24(3).
- **What changed.** The Terms no longer say "I host user content and treat myself
  as an online platform". They now say Besidka hosts content users choose to
  publish and voluntarily follows the notice-and-action rules (Arts. 11, 12, 14,
  16, 17, 18): the email contact point, the report elements of Art. 16(2),
  decisions by a person and statements of reasons. The sentence claiming a
  micro-enterprise exemption was removed from the public text, because
  over-claiming an exemption in user-facing text is a risk, while following the
  rules voluntarily costs nothing.
- **Gaps in this analysis.** The Polish act was read in its published text only.
  No commentary and no case law exist yet on whether a free hobby site is a
  `usługodawca`. A Polish `radca prawny` should confirm.

### 3.2 AI Act Article 50

- **Timing.** Art. 50 applies from 2 August 2026. Art. 50(2) (machine-readable
  marking) applies from **2.8.2026**, and Regulation (EU) 2026/1744 gives
  systems already on the market until **2.12.2026**.
- **Open point.** Art. 50(2) obliges **providers** of AI systems that generate
  synthetic images, audio, video or text to mark the output in a machine-readable
  format. Whether a non-commercial operator who only forwards a user's request to
  a provider with the user's own key (a BYOK relay) is a "provider" is
  unsettled (Art. 3(9) to (11) define provider, deployer and placing on the
  market). It stays an open item with the 2.12.2026 date. Deployer duties in
  Art. 50(4) (deep fakes) attach to those who use the system in the course of a
  professional activity, which a personal project is not.
- **Practical step, done.** An AI-generated badge now ships on generated images
  in the chat UI, on share pages and in the image preview. The badge is a
  visible label; it is **not** the art. 50(2) machine-readable marking.
  Generated images are stored and served without re-encoding
  (`server/utils/ai/image-generation.ts`, `persist-file.ts`), so markings a
  provider embeds (C2PA, SynthID) pass through Besidka intact. User uploads are
  re-encoded through the IMAGES binding (`server/utils/images.ts`), but those
  are not AI output. The Terms promise only the label, not that provider
  metadata survives.
- **What changed.** The AI-generated badge.

### 3.3 Terrorist Content Online Regulation (EU) 2021/784

- If Besidka is an information society service that hosts content at the request
  of users, it is a hosting provider under this Regulation, and a competent
  authority can issue a removal order that must be obeyed within **one hour**.
- **Practical step.** The contact address already published for reports and
  authorities must be monitored by a person. It is. Keep it that way and do not
  let the mailbox go unread for long periods. If the DSA argument in 3.1 holds,
  this one probably falls with it, but the cost of monitoring is zero.

### 3.4 GDPR Art. 33 breach procedure

- A personal-data breach must be notified to the supervisory authority (UODO)
  within 72 hours of becoming aware, unless it is unlikely to result in a risk,
  and to the users when the risk is high (Art. 34).
- **Gap.** There is no written procedure. A one-page runbook is enough: who
  decides, where the 72 hours start, what to record, the UODO notification form,
  the user notice, and the keys to rotate (`betterAuthSecret` rotation destroys
  2FA secrets, see `docs/auth-security.md`).
- **What changed.** Nothing. Owner follow-up.

### 3.5 GDPR damages case law (context)

The Court of Justice line on non-material damage under Art. 82 (C-300/21,
C-456/22, C-687/21, C-340/21, C-200/23, C-655/23) says in short: no minimum
seriousness threshold, but the claimant must still prove actual damage and a
causal link, fear of misuse can count if shown, and the compensation is
compensatory, not punitive. This is why a cheap, concrete fix (self-hosting
fonts, proxying the avatar) is worth more than arguing about whether an IP
address transfer caused harm. No action.

### 3.6 EU-US Data Privacy Framework (context)

The General Court upheld the adequacy decision in Latombe v Commission (T-553/23,
3 September 2025). An appeal is pending. Cloudflare, Google and Vercel rely on
the DPF in `docs/legal/art30-record.md` section 6. If the decision falls, those
rows need the fallback mechanism (SCCs) stated, which most of them already
publish. Watch the appeal.

## 4. Owner follow-ups, in one list

1. DMCA designated agent (2.6). Decided 2026-10-28: no agent; no safe harbour
   claimed; revisit only if a JDG is opened.
2. Retention for reports and notices (2.6). Decided: 12 months, 24 months for
   the copyright-removal note.
3. AI image labelling (3.2). Badge ships (visible label only, not the
   art. 50(2) marking). Provider metadata is not stripped. Open: whether a BYOK
   relay is an art. 50(2) "provider"; date 2.12.2026 for systems already on the
   market (Regulation (EU) 2026/1744).
4. Write a one-page Art. 33 breach runbook (3.4).
5. Keep the contact mailbox monitored (3.3).
6. Have a Polish `radca prawny` look at the DSA conclusion (3.1), the copyright
   notice text for EU users, and the legal-basis choices for the new
   report row and the security notices.
7. Optional: store the sign-up age confirmation (2.1).
8. Extend the Cloudflare "API flood limit" rule with
   `or starts_with(http.request.uri.path, "/api/v1/shared/")` (2.2). Done
   2026-10-28 via the `cf` CLI (ruleset `http_ratelimit`, rule version 3).

## 5. Deploying the legal text

The edited pages are `content/legal/privacy-policy.md`, `terms-of-use.md` and
`cookie-policy.md`, with `updatedAt: 2026-10-28`. They reach production through
the normal deploy, with no manual step (`docs/legal.md`, "How legal text reaches
production"): a push to `main` that touches `content/**` runs
`.github/workflows/production.yml`, the build bundles the new content dump and
checksum, and the first query per Worker isolate re-imports it into
`CONTENT_DB`. A docs-only commit does not deploy. The legal text and the app
changes it describes (share defaults, avatar proxy, sign-up notice) are in the
same branch and must ship in the same deploy.

After the deploy, open the three pages on `https://besidka.com` and check the
`Last updated` date, the privacy address and the anchors the app links to
(`#sensitive-information-in-your-chats`, `#transfers-outside-the-eu`, `#memory`,
`#getting-a-copy-of-your-data`), plus the new anchors
`/terms-of-use#copyright-complaints` and
`/privacy-policy#reports-and-notices-about-content`. If old text is still
served, request the page again and re-check. Do not edit `CONTENT_DB` by hand.

## 6. Sources

- 17 U.S.C. 512: https://www.law.cornell.edu/uscode/text/17/512
- 37 CFR 201.38 (designation of agent): https://www.ecfr.gov/current/title-37/chapter-II/subchapter-A/part-201/section-201.38
- Copyright Office DMCA directory FAQ: https://www.copyright.gov/dmca-directory/faq.html
- Polish act, Dz.U. 2026 poz. 1296: https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text.pdf
- EDPB Guidelines 4/2019 on data protection by design and by default: https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_201904_dataprotection_by_design_and_by_default_v2.0_en.pdf
- Digital Services Act, Regulation (EU) 2022/2065: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- AI Act, Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- 15 U.S.C. 7702 (CAN-SPAM definitions): https://www.law.cornell.edu/uscode/text/15/7702
- FTC, Complying with COPPA, frequently asked questions: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- Case law named above: LG München I 3 O 17493/20; LG Baden-Baden 3 O 277/22;
  AG Berlin-Charlottenburg 217 C 64/22; BGH VI ZR 258/24 (reference to the Court
  of Justice pending); CJEU C-291/13, C-484/14, C-300/21, C-456/22, C-687/21,
  C-340/21, C-200/23, C-655/23; General Court T-553/23.

Not independently re-read for this document: the case-law holdings above beyond
the one-line summaries (taken from the research note), Cal. Penal Code sections
631 and 638.51 and the California automatic renewal law text, Regulation
2021/784, and Directive 2015/1535.
