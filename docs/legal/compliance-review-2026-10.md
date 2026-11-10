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
| 8 | AI Act Art. 50 | Partly done 2026-11-04: provider C2PA kept byte-identical, an IPTC XMP tag (model id only) added otherwise, visible badge stays; no own signature or watermark, so xAI, Qwen and unverified gateway images likely fall short (see 3.2) | Image marking module `server/utils/ai/image-provenance.ts`, called before both image paths save to R2; Terms sentences on the machine-readable mark | Decide before 2.12.2026 what to do for providers and gateway models with no C2PA or watermark (see 3.2) |
| 9 | TCO Regulation 2021/784 | Watch | Nothing | Keep the contact address monitored |
| 10 | GDPR Art. 33 breach procedure | Done 2026-11-04: runbook written (`docs/legal/breach-runbook.md`) | Runbook: 72-hour clock, first-hour containment, risk table, UODO and user notices, processor notices, private breach record | Get a Profil Zaufany if not already held. Keep the breach record privately, not in this repository |
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
- **Artifacts (2026-11-08, A-9; pre-check `docs/legal/prechecks/artifacts.md`,
  row 1).** The conclusion holds, but it gets weaker. Public artifact links at
  `besidka.com/a#<token>` are treated as "dissemination to the public" (Art.
  3(k), Recital 14) whatever `noindex` says, and a standalone public page fits
  the "minor and purely ancillary feature" carve-out poorly, so do not rely on
  it. The remuneration argument is about the service, not the feature, so
  artifacts neither strengthen nor weaken it; it already had to carry public
  shared chats. What is new is executable content (phishing, tracking,
  key-spend attempts), so notices will be more likely and more serious.
  Response: the voluntary process is made real for artifacts. An in-app report
  form with the Art. 16(2) elements and categories that include `csam`,
  `terrorism`, `threat-to-life` and `phishing`; a receipt (Art. 16(4)), a
  decision with redress (Art. 16(5)) and a statement of reasons (Art. 17(3)),
  templates in `docs/legal/content-incidents.md`; takedown at artifact level
  that reaches shared chats; and an **Art. 18 path**: a report or anything else
  that suggests a crime threatening life or safety goes to the police or a
  prosecutor (receiving authority **[U]**, counsel question), recorded
  privately. The Polish act fines a breach of Arts. 16, 17 and 18 (art. 22zzn
  ust. 2) if it applies. The Terms keep the voluntary wording and claim no
  exemption.

### 3.2 AI Act Article 50

- **Timing.** Art. 50 applies from 2 August 2026. Art. 50(2) (machine-readable
  marking) applies from **2.8.2026**. Regulation (EU) 2026/1744 adds Art.
  111(4): a system placed on the market before 2.8.2026 has until
  **2.12.2026** (source:
  https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-111). Besidka
  generated images before 2.8.2026, so the later date is the working deadline.
- **Who is the provider.** The Commission guidelines on Art. 50 (20 July 2026)
  point strongly to Besidka being a provider, and this review treats it as one.
  The text of para 11 gives the example: a company that offers a generative app
  under its own name is a provider, free or paid. A BYOK relay with Besidka's
  name on it fits that example. Art. 3(3) covers supply free of charge. Not
  every step is settled: "placing on the market" (Art. 3(9) with 3(10)) needs a
  commercial activity, but "putting into service" (Art. 3(11)) does not, and a
  personal project can be a provider by putting the system into service. The
  Art. 2(12) open-source exemption was **not verified**. Para 74 lets a system
  provider rely on an upstream model provider's marking, without prejudice to
  its duty to demonstrate compliance. Deployer duties in Art. 50(4) (deep fakes)
  are unchanged: they attach to professional use, which a personal project is
  not.
- **What the upstream providers do.** Checked on 2026-11-04 against the owner's
  own stored images in production R2: Google `gemini-2.5-flash-image` (PNG),
  Google `gemini-3.1-flash-image` (JPEG) and OpenAI `gpt-image-2` (WebP) API
  outputs already carry a C2PA manifest with the IPTC `DigitalSourceType`
  `trainedAlgorithmicMedia`. Google's mentions SynthID. xAI and Alibaba Qwen
  document no embedded marking (Qwen has only an opt-in visible watermark
  flag). Gateway passthrough was not researched.
- **What Besidka does now.** `server/utils/ai/image-provenance.ts` marks the
  bytes before they are saved to R2, on both paths: the direct `generate_image`
  tool (`server/utils/ai/image-generation.ts`) and gateway images
  (`server/utils/files/assistant-files.ts`). The rules:
  - A file that already has a C2PA manifest (PNG `caBX`, JPEG APP11 JUMBF,
    WebP `C2PA` chunk) is left **byte-identical**. Any change would invalidate
    the provider's signature, and the provider's mark is the stronger one.
  - A file that already has XMP with an AI `DigitalSourceType` is left alone.
    An existing plain XMP packet gets Besidka's `rdf:Description` merged in.
  - Otherwise an XMP packet is inserted at byte level, with no re-encoding.
    Pixels are identical (`magick compare -metric AE` = 0 on PNG, JPEG, lossy,
    lossless and alpha WebP). The tag holds `Iptc4xmpExt:DigitalSourceType` set
    to `trainedAlgorithmicMedia` (`compositeWithTrainedAlgorithmicMedia` when
    the model edited a user's image) and `Iptc4xmpExt:AISystemUsed` set to the
    model id. Nothing else: no `xmp:CreatorTool`, no prompt, no user data
    (owner decision, data minimisation).
  - The result is logged as `attributes.imageGeneration.provenance` or
    `attributes.assistantFiles.provenance` with one of `upstream-c2pa`,
    `upstream-xmp`, `existing-xmp-unmarked`, `added-xmp`, `merged-xmp`,
    `skipped-oversize`, `unsupported`.
  - The visible AI-generated badge in the chat UI, on share pages and in the
    image preview stays. It is a label for people, not the machine-readable
    mark. The Terms describe both.
- **Detection.** Art. 50(2) marking is only useful if it can be read (guidelines
  paras 69 and 70). Anyone can read IPTC and XMP with standard tools
  (`exiftool`, image viewers), and C2PA at https://contentcredentials.org/verify.
  Para 73 accepts watermarks, metadata, cryptographic provenance and
  fingerprints.
- **Residual gaps.**
  - Guidelines para 81 says technical feasibility is objective and does not
    depend on a provider's resources. Cost counts (paras 80 and 85), but para 86
    accepts metadata-only marking only in narrow closed-environment cases. The
    Code of Practice on marking and labelling AI-generated content (final 10
    June 2026) asks for at least two layers (digitally signed metadata plus an
    imperceptible watermark) and retention of existing markings (Measures 1.1
    and 1.2). It is voluntary and Besidka is not a signatory. Besidka keeps
    existing marks (Measure 1.2) but does not sign C2PA itself (no certificate)
    and adds no invisible watermark (that needs pixel processing, which does not
    fit on Workers).
  - Images from xAI, Qwen and unverified gateway models carry only Besidka's
    unsigned IPTC tag: one layer, likely below what Art. 50(2) requires. Para 74
    lets Besidka rely on a provider's mark only to the extent that mark
    complies.
  - Gateway passthrough is unverified.
  - Some files stay unmarked: those logged `existing-xmp-unmarked` (compressed
    XMP, or an existing non-AI `DigitalSourceType`), `unsupported` (format not
    handled) and `skipped-oversize`. Images stored before 2026-11-04 were not
    changed.
  - Metadata can be stripped by anyone who re-saves or screenshots the image.
    User uploads are re-encoded through the IMAGES binding
    (`server/utils/images.ts`) but those are not AI output.
- **Open owner decision before 2.12.2026.** For providers and gateway models
  with no C2PA or watermark: keep image generation for them and accept the risk,
  switch it off for them, or add a watermark.
- **Artifacts (2026-11-08, A-9; pre-check row 4).** Besidka stays the
  provider. The guidelines (para 68) put "source code" (programming, markup
  and configuration languages meant to be interpreted or executed) outside
  Art. 50(2), so HTML, JSX and Mermaid source are arguably out of scope; a
  rendered page is still text read by people (para 67) and Markdown is plain
  text, so mark anyway, at no cost. Planned marks: the banner "AI-generated by
  a Besidka user, not reviewed by Besidka." on `/a/` pages (also the Art.
  50(5) visible disclosure, so it must meet accessibility rules), the in-app
  "AI-generated" badge and panel note, `<meta name="ai-generated"
  content="true">` on `/a/` and the shared-chat artifact view, and in exports:
  `buildStandaloneArtifactHtml` adds the meta and an HTML comment
  "AI-generated by Besidka" with the model id only, when `modelId` is stored;
  `.md` and `.svg` downloads get a one-line comment; `.jsx` and `.mmd`
  downloads stay unmarked as source code (A-4). **Decision on downloads:**
  mark them as above; this closes the gap the ticket named. Content written
  through MCP may be human-written; over-labelling is harmless. **Open:**
  whether a bare meta tag is "effective, interoperable, robust" (treat it as a
  best-effort layer); where SVG sits between code and image; whether a feature
  added after 2.8.2026 keeps the Art. 111(4) grace (plan to mark at launch).
  Text artifacts are not deep fakes, so Art. 50(4) does not apply to Besidka;
  a user who publishes one professionally to inform the public is the
  deployer.
- **Revisit when.**
  - a provider starts or stops embedding C2PA (re-run the R2 check above);
  - the Commission publishes further guidance, or a standard under Art. 50(7)
    or Art. 40;
  - Besidka gains a signing certificate;
  - a cheap Workers-compatible watermark library appears.
- **What changed.** The marking module and its two call sites, the log
  attribute, the Terms sentences (recorded as `minor` in
  `shared/utils/legal-document-revisions.ts`: they describe service behaviour
  and add no purpose, recipient or obligation), and the unit tests
  (`tests/unit/utils/ai/image-provenance.spec.ts`).
- **Sources.** Commission guidelines on Art. 50:
  https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems.
  Code of Practice: https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content.

### 3.3 Terrorist Content Online Regulation (EU) 2021/784

- If Besidka is an information society service that hosts content at the request
  of users, it is a hosting provider under this Regulation, and a competent
  authority can issue a removal order that must be obeyed within **one hour**.
- **Practical step.** The contact address already published for reports and
  authorities must be monitored by a person. It is. Keep it that way and do not
  let the mailbox go unread for long periods. If the DSA argument in 3.1 holds,
  this one probably falls with it, but the cost of monitoring is zero.
- **Artifacts (2026-11-08, A-9; pre-check row 3).** Public artifact links are
  treated as dissemination to the public, as shared chats are (TCO recital 45
  uses the same test as DSA Recital 14). The Polish implementation (Dz.U. 2024
  poz. 1684, in force 2024-12-03) makes the **Szef ABW** the competent
  authority (art. 26a) with a 24/7 contact point (art. 26b); orders are
  administrative decisions (art. 26d); the fine is up to 4% of turnover (art.
  26f), and how that applies to a provider with no turnover is **[U]**. What
  changed:
  - **Contact point (Art. 15).** The Terms now say the privacy mailbox also
    receives removal orders, in English or Polish, and state the
    terrorist-content policy (Art. 7(1)).
  - **One hour (Art. 3(3)).** A-7 adds an admin takedown by URL, token,
    artifact id or user that needs no report, works at phone width and takes
    effect on the next request; the global `artifacts` rule off is the
    fallback. The mailbox needs a phone alert (owner item 3 of the pre-check),
    otherwise the hour cannot be met. There is no cover person (owner
    decision 2026-11-09: he works alone), so the push is the only safeguard;
    see `docs/legal/content-incidents.md`, section 1.
  - **Preservation (Art. 6).** A takedown disables and never deletes;
    `legalHoldUntil` keeps the removed content and the report rows for six
    months after the removal, through artifact and account deletion (A-1).
  - **Unable to act within the hour (Art. 3(7), 3(8)).** Tell the authority
    with the Annex III template; the Terms say so.
  - **Transparency (Art. 7(2)) and reporting (Polish art. 26e, for TCO Art. 21).** If
    any action was taken under the regulation in a calendar year, publish a
    transparency report and send the annual data to the ABW by 1 March.
  - Steps: `docs/legal/content-incidents.md`.

### 3.4 GDPR Art. 33 breach procedure

- A personal-data breach must be notified to the supervisory authority (UODO)
  within 72 hours of becoming aware, unless it is unlikely to result in a risk,
  and to the users when the risk is high (Art. 34).
- **Gap (closed 2026-11-04).** There was no written procedure. The runbook now
  exists at `docs/legal/breach-runbook.md`. It covers where the 72 hours start,
  the first-hour containment per incident type (including why `betterAuthSecret`
  rotation destroys 2FA secrets, see `docs/auth-security.md`), a risk table
  with the EDPB cases, the UODO channels and the Art. 33(3) fill-in, the user
  notice, processor notices, and a copy-paste breach record.
- **What changed.** The runbook, dated 2026-11-04. Engineer-drafted, not
  lawyer-reviewed. A few points are marked unconfirmed in it (the biznes.gov.pl
  e-form for a private individual, the Cloudflare notice channel, the Polish KSC
  amendment, CERT Polska reporting).
- **Owner follow-up (one action).** Get a Profil Zaufany if not already held, so
  the UODO filing can be signed. Keep the breach record privately, not in this
  public repository.

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
3. AI image marking (3.2). Partly done 2026-11-04: provider C2PA is kept
   byte-identical, otherwise Besidka adds an IPTC XMP tag (model id and
   `trainedAlgorithmicMedia` only), and the visible badge stays. Open before
   2.12.2026 (Regulation (EU) 2026/1744): xAI, Qwen and unverified gateway
   images carry only unsigned IPTC, likely below Art. 50(2). Keep image
   generation for them and accept the risk, switch it off for them, or add a
   watermark. Besidka is treated as a provider (guidelines para 11). Revisit
   conditions are in 3.2.
4. Art. 33 breach runbook (3.4): written 2026-11-04 (`docs/legal/breach-runbook.md`).
   Remaining: get a Profil Zaufany if not already held; keep the breach record
   privately.
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
