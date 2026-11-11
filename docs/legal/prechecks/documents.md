# Compliance pre-check: Documents and code execution (D-10, BES-307)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07;
> additions on 2026-11-08 (Commission Art. 50 guidelines PDF, npm registry
> metadata, OWASP page, Code of Practice page) are marked "2026-11-08".
> This is the Phase 2 (documents and provider code execution) section of the
> agentic-capabilities pre-check record.
> The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, this file answers the
> track-specific questions of BES-307 and runs the gate in full below.
> The WCAG 2.2 AA target is the one P0-14 sets for all tracks.
> Independent review on 2026-11-08 re-checked quotes, licences, provider pages,
> the Commission guidelines and the repo claims against primary sources; its
> findings are listed in the pull request. Anything the reviewer could not
> re-fetch stays marked UNVERIFIED.

## Verdict

**Documents (D-2 to D-6): GO WITH CHANGES**: no licence vetoes a library and
the files stay private, but the notices file, marking, retention chain, label
and validator changes below are conditions for leaving `internal`.

**Code execution (D-7, D-8): GO WITH CHANGES**: provider-native code on the
user's own key is ordinary API use with no new recipient, once Besidka deletes
what it creates at the provider, discloses what stays, and shows a price note.

## In plain words

- Documents can be built. All five renderer libraries and the Noto Sans font
  have permissive licences (Apache-2.0 for the Brotli code inside fontkit). None is vetoed. The work is paperwork: one
  generated notices file, an MIT election for JSZip, and the missing licence
  texts for `@pdf-lib/fontkit` (MIT, plus Apache-2.0 for the Brotli code it
  inlines).
- The Commission's Art. 50 guidelines (C(2026) 7702, 5 Nov 2026) list text as a
  modality (para 60). This draft reads that as covering the rendered PDF, DOCX,
  PPTX and XLSX; the guidelines do not name those formats. Besidka is treated
  as the AI system provider, so marking is Besidka's duty. The Art. 111(4)
  grace to 2 Dec 2026 plausibly applies to a system that already generated
  text before 2 Aug 2026, but no source says so for a new output type, so this
  draft does not rely on it: marking ships with the feature. The metadata mark
  is one unsigned layer. That is probably below what the guidelines expect
  (paras 79 to 87), the same position as for xAI and Qwen images in
  `compliance-review` §3.2. The gap is recorded, not hidden.
- The ticket text (BES-302, D-9) says a deleted chat keeps its documents until
  file expiry. That is wrong for documents made in a chat: the chat delete path
  removes the file, and the spec must go with it. D-4 as written misses that
  path and leaves the spec object and a `documents` row with a possibly
  personal title behind.
- MCP `create_document` can sit under `files:write`, because it creates a
  private file and spends no key. But the label "Create text files and rename
  files" would be untrue. The label changes in D-5.
- Code execution: Anthropic and OpenAI keep files and container data on their
  side. Besidka must delete what it uploads, what the code creates, and the
  OpenAI container, and tell the user what stays (Anthropic container data up
  to 30 days, OpenAI abuse logs 30 days).
- "Anthropic's document skills are proprietary" is out of date since
  2026-11-06 (Apache-2.0 in the public repo). The terms of the hosted skills
  are not stated anywhere read. D-8 may still reference the hosted skill ids
  on the user's key, and "never bundle" stays as an owner choice. Do not state
  "proprietary" as fact in D-8 and D-9; use neutral wording.
- Owner needs to decide one thing before D-7's flag moves: whether the Terms
  mirror the providers' malware, DoS and critical-infrastructure rules (that is
  a "material" Terms change, so a 30-day notice).

## Track-specific questions

Sources are listed in full under "Sources". All provider pages were accessed
2026-11-07 unless marked. Rows 1 to 6 are the Documents track; rows 7 to 14 are
the Code execution track. The two overall verdicts are at the top.

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Licences of renderer dependencies and font; where attributions go | Licence table below. Registry `latest` metadata (2026-11-08), LICENSE files from each repo, `docs.sheetjs.com/docs/miscellany/license`, OFL FAQ Q1.10, Q1.12, Q1.13 | All MIT, except JSZip (MIT OR GPL-3.0-or-later), SheetJS CE (Apache-2.0), the Brotli code inlined in `@pdf-lib/fontkit` (Apache-2.0) and the font (OFL 1.1, no Reserved Font Name). The `pptxgenjs` bundle file carries no licence text. `@pdf-lib/fontkit` ships no LICENSE file. Transitive closure also holds `pako` (MIT AND Zlib), `https@1.0.0` (ISC), `image-size` (MIT), `inherits` (ISC) and, only if a bundler polyfills Node `buffer`, `ieee754` (BSD-3-Clause). Client chunk is distribution; the renderer Worker is not conveyed to anyone (general reading, UNVERIFIED), and has no public surface (D-3: `fetch` returns 404, `workers_dev: false`) | go with changes | (a) Build step that collects licences from the real bundle graph into `THIRD_PARTY_NOTICES`, served as a static file from the main app (not from the renderer Worker, which has no public route), linked from the Terms or footer. (b) Keep `/*! */` legal banners in the client chunk and Worker bundle. (c) State "JSZip is used under the MIT licence". (d) Do not ship `dist/pptxgen.bundle.js`; import the package and let the collector run. (e) Add the upstream fontkit MIT text for `@pdf-lib/fontkit`, plus the Apache-2.0 text for the Brotli decoder it inlines; the collector must also read `/*!` banners and the inlined code in `docx` (`fflate`, `nanoid`) and fontkit, because a package-graph walk misses them. (f) Serve the font subset with `OFL.txt` next to it. (g) Prefer `write-excel-file`; SheetJS only from the `cdn.sheetjs.com` tarball, version pinned (SheetJS's install page names the CDN as the source for 0.20.3 and calls the npm copy out of date) | D-1 BES-277, D-2 BES-282, D-3 BES-286 |
| 2 | AI Act Art. 50(2): are generated documents synthetic text needing machine-readable marking; is XMP plus OOXML custom property enough and consistent with images | AI Act Art. 2(12), 50(2), 111(4) (Reg. (EU) 2026/1744); Commission guidelines C(2026) 7702, Brussels 5.11.2026, paras 10-11, 23, 60, 63-68, 69-70, 74-76, 80-87, 91-92 (2026-11-08); `compliance-review` §3.2 | In scope, by this draft's reading: text is a listed modality (para 60) and the rendered file is the final output people read. Besidka is treated as the AI system provider (§3.2; para 11 example). Open-source release does not lift Art. 50: Art. 2(12) says the Regulation does not apply to open-source systems "unless" they fall under Article 5 or 50 (read in the EUR-Lex text), and para 23 says the same. This settles the point §3.2 left unverified. The JSON spec is a "machine-readable specification" and out of scope (para 68); the rendered file is not. Rendering is format conversion (para 92 lists it as standard editing; Art. 50(2) also exempts systems that "do not substantially alter the input data"), but that covers the rendering step only: the content is the model's output, so the rendered file stays in scope. Marking AND detection are both needed (paras 69-70). Para 75 says detection should give a human-readable result and para 76 prefers published standard detection tools, so a published FAQ line on `exiftool` is a minimum, not a proven detection solution. Metadata-only marking suffices only in narrow closed cases (paras 86-87), which a consumer-facing app does not meet. **Sufficient? Probably not on its own:** one unsigned metadata layer is consistent with the image tag but likely below what Art. 50(2) expects (the Code of Practice asks for two layers, per §3.2; its text was not read here). XMP `DigitalSourceType` in PDF matches the image tag. The OOXML custom property is a non-standard name, so interoperability is weak. Art. 111(4) covers providers of systems placed on the market before 2 Aug 2026 generating text; whether it reaches a new output type of an existing system is unsourced, so the draft does not rely on it | go with changes | (a) Marking ships with D-2/D-4; a gate on leaving `internal`. (b) OOXML property names and values mirror the image XMP: IPTC `DigitalSourceType` URI plus model id as `AISystemUsed`, model id only, no prompt, user or chat id. (c) `validate()` provenance becomes three states: `ai`, `channel-only` (MCP), `missing`. (d) Publish how to read the mark (detection paras 75-76): an FAQ line naming `exiftool`, Acrobat metadata and Word or Excel custom properties; record that this is a minimum and that no human-readable detection tool exists yet. (e) Residual gaps recorded in `compliance-review` §3.2, with the owner decision before 2 Dec 2026 extended to documents: one unsigned layer, no text watermark (needs the model; only the upstream provider can), stripped by re-saving, printing or copy-paste, provider-made files (D-7/D-8) may lack it, MCP is channel-only | D-2 BES-282, D-4 BES-293, D-9 BES-302 |
| 3 | New data: spec in R2, file, `documents` row. Spec retention; chat and account deletion | `docs/files.md` (retention cleanup, 30 days, VIP null); `server/utils/files/chat-deletion-cleanup.ts` (`findChatsOriginFiles`, `cleanupFilesOrphanedByChatDeletion`, `findMessageOriginFiles`); `server/utils/account/purge-user-data.ts`; D-4 BES-293 | Spec lifetime should equal file lifetime. Chat deletion reaches a chat-made file only through the origin-message join and the "not referenced elsewhere" check in `chat-deletion-cleanup.ts`, which calls `storage.delete` directly and is a different path from `delete-files.ts` that D-4 hooks. A file still referenced (a `file` part with its URL in another chat, or knowledge) survives, and so does its spec. A branch copy holds only a `data-document` part with the document id, not the storage key, so it does not count as a reference: the file is deleted and the branch card shows "unavailable". MCP documents have no chat and live to file expiry. D-4 keeps the row as `failed`/`file_deleted` with `title` and nulls `originChatId` on chat delete: a possibly personal title then outlives chat and file. Art. 5(1)(e) | go with changes | (a) Hook spec-object deletion into `cleanupFilesOrphanedByChatDeletion` (reached from `deleteChat`, the single-message path and `history/delete/bulk.post.ts`), retention cleanup, bulk file delete and `purgeUserData` (prefix `documents/<userId>/`, batched R2 delete). (b) On file deletion delete the spec object; keep the row only while a persisted `data-document` part may still point at it, with `title` nulled. (c) On chat deletion delete the chat's rows (or null the title when the file survives). (d) Sweep rows with no file and no chat. (e) Add the table to `docs/d1-restore-reconciliation.md` | D-4 BES-293, D-9 BES-302 |
| 4 | MCP `create_document` under `files:write`: acceptable; label text truthful | `app/components/OAuth/ScopeLabel.vue`; `docs/mcp-server.md` Scopes; `docs/legal/dpia.md` §3.11 and row 37; D-5 BES-296 | Current label: title "Change your files", description "Create text files and rename files." That no longer describes PDF, DOCX, PPTX and XLSX creation. Reuse of the scope is within the recorded rule (row 37: extensions involve no deletion or spend): the tool creates a private file, counts against the 20 MB quota, uses host CPU only, publishes nothing. Existing grants get the tool silently, and the policy already tells users to re-check Connected apps. A label edit changes future consent screens only. D-5's channel-only provenance rests on guidelines paras 64-65 (output that only reproduces or arranges already existing content is not covered), para 91 and Art. 50(2) ("do not substantially alter the input data") and para 92 (format conversion): Besidka renders a caller-supplied spec without altering it, and the external client's own provider carries any Art. 50(2) duty for what the client wrote. This is the draft's analysis, not a Commission statement about MCP | go with changes | (a) New description: "Create text files and documents (PDF, Word, PowerPoint, Excel) and rename files." Classify as clarification. (b) Add `create_document` to the row 37 list of what reached existing approvals silently. (c) MCP documents must not appear under a plain "Generated by AI" label: the content is caller-supplied; use "Created by a connected app" (or `aiGenerated` when declared). D-5 saves them with `source: 'assistant'` and D-4 lists them under the file manager tab "Generated by AI", so the tab name and badge need the same fix. (d) Tool description tells the client to set `aiGenerated: true` for AI-written content | D-5 BES-296, D-4 BES-293, D-9 BES-302 |
| 5 | Security output: XLSX formulas (DDE, CSV injection), OOXML external relationships, PDF JavaScript; are validator rules DPIA measures | D-2 BES-282 validation rules; OWASP CSV injection (community.owasp.org, 2026-11-08); ECMA-376 and ISO 32000 not fetched | D-2 covers the main vectors: PDF action denylist, ZIP bounds, OOXML macro and embedding parts, external relationships except https and mailto hyperlinks, XXE, tokenised formula allowlist, string cells inert. Gaps found (analysis from general knowledge of these formats, not a fetched source): (1) a byte-grep denylist cannot see names inside compressed PDF object streams, so it is only reliable for PDFs Besidka rendered itself; provider-made PDFs (D-7/D-8) need a structural parse. (2) `/OpenAction` and `/AA` are not on the PDF list. (3) DDE and field instructions in Word (`w:instrText`, `w:fldSimple`: DDE, DDEAUTO, INCLUDETEXT, INCLUDEPICTURE, LINK) are not listed for DOCX. (4) PPTX `ppaction://program`, `ppaction://macro`, `ppaction://ole` are not named. (5) OWASP lists leading `=`, `+`, `-`, `@`, tab, CR, LF and full-width variants; `escapeCsvCell()` as described (prefix `'`) must cover all. OWASP offers the single-quote prefix only as an alternative and says "The above techniques are not reliable in Microsoft Excel after saving and re-opening the CSV file" (read 2026-11-08), so the prefix cannot be the only control. OWASP's "Excel-resistant mitigation" is a tab character inside the quoted field, with the trade-off that the tab stays in the data | go with changes | Add the five items to D-2 rules and tests; document the Excel round-trip residual for CSV export (or drop CSV export from v1); list all rules (existing and added) as DPIA measures with built/planned status | D-2 BES-282, D-9 BES-302 |
| 6 | Accessibility of generated PDFs; tagged headings as quality goal | P0-14 decision (file not in repo; per ticket text, PDF/UA is not required); `@pdf-lib` tagged-PDF support not verified | PDF/UA not required. Tagged headings in PDF: pdf-lib's support for a structure tree is UNVERIFIED. DOCX heading styles, PPTX slide titles, XLSX header row and the spec's required image `alt` and table `header` flag already carry structure | go | Record as quality goal: DOCX heading styles from `heading` blocks, document title and language set in all four formats, PPTX title per slide, XLSX header row and frozen header; PDF tagging only if the D-1 spike shows pdf-lib can do it cheaply | D-2 BES-282 |
| 7 | Provider terms for code execution on the user's key; prohibited uses the Terms must mirror | Anthropic Commercial Terms D.2-D.4 (eff. 2025-06-17), Usage Policy (eff. 2026-11-12); OpenAI Services Agreement 3.1-3.3 (eff. 2026-01-01), Usage Policies (in force 2025-10-29, new eff. 2026-11-20); Gemini Additional Terms (eff. 2026-03-23) | No code-execution-specific clause found in any of the three, and Anthropic's Service Specific Terms (eff. 2026-08-31) do not mention code execution, Skills or Files. The user is the customer on their own key; use through a third-party app is normal API use. Anthropic's Usage Policy, effective 2026-11-12, lists malware, DoS and botnets, bypassing security controls without authorisation and critical-infrastructure disruption; OpenAI's, from 2026-11-20, "destruction, compromise, or breach of another's system". Both take effect before D-7 can reach users. Current Terms cover "malware, exploits, phishing pages or other material designed to break into systems" and "Attack the service", not DoS or critical infrastructure. Previous in-force Anthropic text not fetched, UNVERIFIED | go with changes | Owner item 1 (mirror or not). In every case: the Code-running paragraph in the Terms says the provider's usage policy applies directly to code run on the user's key | D-9 BES-302 |
| 8 | Provider-side data: retention, ZDR, must Besidka delete after the send | Anthropic code execution and Files API pages, ZDR table; OpenAI code interpreter, shell, your-data pages, container delete reference; Gemini Files page | See provider table below. Anthropic code execution, Files API, Skills: not ZDR. Container data retained up to 30 days. Files persist until deleted, are visible to every key in the workspace, and files made by code execution persist too. A deleted file "may persist in active Messages API calls", is deleted "in accordance with Anthropic's data retention policy", and expiry is "not a guaranteed-deletion control" (metadata stays visible up to 30 days after expiry). OpenAI: container expires after 20 minutes idle, delete endpoint verified, Files API objects "until deleted", abuse logs 30 days, ZDR for containers UNVERIFIED. Gemini: Files auto-delete after 48 hours; inline input works; outputs come back inline | go with changes | D-7 deletes everything it creates, with a backstop: Anthropic uploads set `expires_in_seconds` to the 3,600 minimum (a Worker killed by a tab close never reaches `finally`), delete uploaded input AND downloaded output `file_id`s after persistence; OpenAI `DELETE /v1/containers/{id}` after the turn, per-file delete where the container must stay, delete any Files API object used for inputs; Gemini prefers inline input, Files API only if size demands it. Prefer inline file input for OpenAI too (docs say model-input files are uploaded to the container automatically); check in the spike. Never set an OpenAI `network_policy` allowlist or any internet access | D-7 BES-300 |
| 9 | Gemini free tier notice for code execution with files | Gemini Additional Terms (eff. 2026-03-23): unpaid use, human review, EEA/CH/UK paid terms; Privacy Policy "If you use a Google Gemini key" | Unpaid outside EEA/CH/UK: content "provide, improve, and develop Google products", human reviewers may read it. Besidka cannot know the key tier. Sandbox retention and network for Gemini code execution not stated, UNVERIFIED | go with changes | Gemini InfoNote in the "Run code" row reuses the Privacy Policy wording (shortened): files you attach may be used and read by reviewers on a free key outside the EEA, Switzerland and the UK | D-7 BES-300, D-9 BES-302 |
| 10 | Container output files: category, provenance, Art. 50 marking | Guidelines paras 63-68, 74, 92; `server/utils/ai/image-provenance.ts`; D-7 | Model-written code and stdout: source code, out of scope (para 68). Images and charts: in scope, route through `markAiGeneratedImage`; a chart drawn by code is arguably "simple data processing" (para 64), but over-marking is the safe default and the tag only says the model made it. `markAiGeneratedImage` handles PNG, JPEG and WebP only, so `gif` in D-7's allowlist would be saved unmarked. CSV, TSV, JSON, TXT, MD cannot carry a mark; whether CSV counts (para 65 "extract and structure data" against summaries) is a judgment call. Office and PDF files made by code or skills: D-2 stamp or `provenance: missing` | go with changes | (a) Drop `gif` from the D-7 allowlist, or accept and log it unmarked. (b) Provenance on the `files` row (`originProvider`, `originModel`) plus the visible AI badge for every container file. (c) Office and PDF from containers (D-7/D-8) leave `internal` only with a D-2 stamp function, or the gap is recorded and the owner decision before 2 Dec 2026 covers it | D-7 BES-300, D-8 BES-301, D-2 BES-282 |
| 11 | Art. 49(1)(a): any new transfer; gateways | `docs/legal/art30-record.md` §6.1; `docs/legal/dpia.md` rows 8-9; D-7 BES-300 | No new transfer. Code execution is limited to direct Anthropic, OpenAI and Google, which already have rows (DPF check 2026-10-26: Google LLC active; none found for Anthropic or OpenAI; SCCs under their terms). Gateways are excluded in D-7. The renderer is the same Cloudflare processor. Today's re-check of the DPF list not done, UNVERIFIED | go | State the exclusion of DeepSeek, Moonshot AI, Qwen and all gateway models in the records so a later provider addition triggers review; D-7 must reject the tool for those providers server-side | D-9 BES-302, D-7 BES-300 |
| 12 | Cost transparency: price note before first use | Anthropic code execution page (pricing); OpenAI pricing page; Directive 2005/29/EC; owner rule on spend | Anthropic: "$0.05 USD per hour, per container" after 1,550 free hours per organisation per month, 5-minute minimum, and billed when files are attached even if the tool is not called; code execution is free (beyond tokens) when `web_search_20260209` or `web_fetch_20260209`, or later, is in the same request. OpenAI: $0.03 (1 GB) to $1.92 (64 GB) per 20-minute session; the same page also says billed by the minute with a 5-minute minimum (both carried). Gemini: tokens only. Besidka is not the seller of the provider's product and the Terms state it cannot see or cap spend, so a legal duty under the Directive is not shown; the owner rule and low cost make the note the right default. Free hours are per org, so the user's own balance is unknowable | go with changes | InfoNote in the "Run code" row names the provider, the price from config (rates live in `wrangler.jsonc` vars, like web search), says Anthropic bills attached files even without a code call, and says free hours depend on the user's organisation. One-time confirmation per provider the first time the row is switched on (client-side preference; no new column). Default off per message | D-7 BES-300, D-8 BES-301 |
| 13 | D-8: may a third-party app reference the prebuilt skill ids; must the UI say "proprietary" | `github.com/anthropics/skills` commit 2c5958ec (2026-11-06T22:32:28Z, PR #2146) and README; Anthropic Skills guide and overview | The "proprietary" premise is stale for the public repo: since 2026-11-06 the docx, pdf, pptx and xlsx skill folders are Apache-2.0. Before that (from 2025-12-01, commit ef740771) they carried "All rights reserved" with no copying or derivatives. The relicence covers the public repo files. Terms of the hosted prebuilt ids, and any clause on third-party apps referencing them, are not stated anywhere read: UNVERIFIED. The docs present `skill_id` references as normal API use. Skills are not ZDR. Referencing an id copies nothing under either licence | go with changes | Replace "proprietary" in D-8 and D-9 with neutral wording (the hosted terms are unknown, so neither "proprietary" nor "open source" is asserted for the hosted ids). UI label: "Anthropic's skills, run on your Anthropic key". Keep "never bundle, vendor or redistribute" as an owner choice (version drift, supply chain), not a legal need. Keep the fixed four-id allowlist: OpenAI's skills guide warns against open catalogues for end users, which matters for S-5 and S-8, not D-8. D-8 stays optional | D-8 BES-301, D-9 BES-302 |
| 14 | Breach runbook: new stores, new tokens, containment | `docs/legal/breach-runbook.md` (§2 containment table, §3 risk table row 5); D-3, D-4, D-5 | New stores: R2 `documents/<userId>/<publicId>/spec.v1.json`, D1 `documents`, Workers Logs on `besidka-doc-renderer`, and provider-side files and containers. No new tokens: `DOC_RENDERER` is a binding, MCP reuses OAuth. Existing steps cover R2 exposure, share revocation and connected-app revocation. A leaked provider key exposes Besidka-uploaded files in the user's workspace (Anthropic Files API is workspace-wide) | go with changes | Add `documents`, spec objects and renderer logs to the systems list in the runbook; add "provider key leaked: tell the user to rotate, Besidka's per-turn deletion limits what sits there"; D-3 must keep spec text, titles and asset bytes out of Workers Logs (retention of Workers Logs not checked, UNVERIFIED) | D-3 BES-286, D-9 BES-302 |

### Licence table (Q1)

Registry metadata read 2026-11-08 (`registry.npmjs.org/<pkg>/latest`, resolved
by name, not by each package's declared semver range). LICENSE files were read
for the first seven rows on 2026-11-07 (each repository LICENSE file); the
transitive rows are registry metadata only, LICENSE files not read.

| Package | Version | Licence | Attribution plan |
|---|---|---|---|
| `docx` | 9.15.3 | MIT | Notices file; deps `fflate` (MIT), `nanoid` (MIT); `@types/node` is listed as a dependency of the package (types only; should not reach a bundle) |
| `pptxgenjs` | 4.0.1 | MIT | Notices file. Its `dist/pptxgen.bundle.js` embeds JSZip and core-js and holds no licence text, so import the package instead; listed dependencies: `https@1.0.0` (ISC), `jszip`, `image-size` (MIT), `@types/node` (types only) |
| `jszip` | 3.10.2 | MIT OR GPL-3.0-or-later | Elect MIT, say so in the notices file; pulls `pako` (MIT AND Zlib: both notices), `lie` and `immediate` (MIT), `setimmediate` (MIT) and `readable-stream` with its small helpers (`inherits` is ISC, the rest MIT); `ieee754` (BSD-3-Clause: reproduce the notice) appears only if a bundler polyfills `buffer` |
| `write-excel-file` | 4.1.1 | MIT | Notices file; dep `fflate` |
| SheetJS CE | CDN 0.20.3; npm 0.18.5 is stale | Apache-2.0 | Only if `write-excel-file` falls short. Tarball from `cdn.sheetjs.com`, version pinned; keep the licence, copyright and any NOTICE (none seen, tarball not inspected); Dependabot probably cannot update a tarball URL (general knowledge, UNVERIFIED). SheetJS asks that distributors list it in their open source disclosures and note any changes |
| `pdf-lib` | 1.17.1 | MIT | Notices file; deps `tslib` (0BSD), `@pdf-lib/upng` (MIT), `@pdf-lib/standard-fonts` (MIT), `pako` (MIT AND Zlib) |
| `@pdf-lib/fontkit` | 1.1.1 | MIT (package.json and README); no LICENSE file in repo or tarball. Its `dist/fontkit.umd.js` also inlines a Brotli decoder (6 file headers) under Apache-2.0, "Copyright 2013 Google Inc." (D-1 spike, PR #747) | Add the MIT text from `foliojs/fontkit` (copyright 2014-present Devon Govett) and the Apache-2.0 text with the Google copyright line for the inlined Brotli code; the client chunk ships it. Apache-2.0 is permissive, not a veto. The same UMD build inlines `base64-arraybuffer` (Niklas von Hertzen) and Node's `events` (Joyent), which a package-graph collector does not see. Fork copyright holders not checked, UNVERIFIED. Its one listed dependency is `pako` (MIT AND Zlib) |
| Noto Sans (Latin, Greek, Cyrillic) | repo `notofonts/latin-greek-cyrillic` | SIL OFL 1.1, "Copyright 2022 The Noto Project Authors", no Reserved Font Name | Embedding a subset in a PDF is allowed and the OFL text need not travel inside the PDF (FAQ Q1.10, Q1.12, Q1.13). Serving the subset as a font file is distribution: keep the copyright line and `OFL.txt` beside it. A standalone subset is a Modified Version; with no RFN no rename duty. Other Noto repos may carry another copyright line; confirm per font source |

No row is a licence veto. D-1 keeps the technical choice.

### Provider data table (Q8)

| Provider | Retention and ZDR | Delete route | Besidka action | Disclose |
|---|---|---|---|---|
| Anthropic | Code execution, Files API, Skills not ZDR. "Container data retained up to 30 days." Files persist until deleted or expiry; visible to any key in the workspace; files made by code execution persist too | `DELETE /v1/files/{id}` (deleted files follow Anthropic's retention policy and "may persist in active Messages API calls"); `expires_in_seconds` 3,600 to 7,776,000 (not a guaranteed-deletion control; content may be kept briefly for safety review, metadata visible up to 30 days). No container delete found in the page read, UNVERIFIED | Upload with a 1-hour expiry; delete inputs and downloaded outputs after persistence; container id only within one send | Container data can stay up to 30 days; container data includes uploaded files, and the page does not say a Files API delete reaches that copy; files sat in the user's workspace for the turn; billing note |
| OpenAI | Container discarded after 20 minutes idle, "not recoverable"; Files API objects "until deleted", abuse logs up to 30 days; `/v1/containers` ZDR status UNVERIFIED | `DELETE /v1/containers/{id}`; `DELETE /v1/containers/{id}/files/{file_id}` (verified) | Delete the container after the turn; avoid Files API for inputs if inline works; no network allowlist | 30-day abuse logs; ZDR not claimed |
| Google Gemini | Files API files deleted after 48 hours; unpaid tier training and human review | Manual delete available | Inline input first; delete Files API objects after the turn if used | Free-tier notice; sandbox retention not stated |

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR (Art. 30, DPIA, Art. 6 basis, Art. 9, Art. 49 transfers) | Documents: new store (spec, `documents` row), same purpose (contract, Art. 6(1)(b)), same processor (Cloudflare, including the new Worker), content can hold special categories and is covered by the chat consent (it lists file uploads). Code execution: same recipients and role as the existing provider rows (independent controllers, user's own account); treated as part of the existing purpose "answer the user's message" (Art. 30 row 4), not a new purpose, though the provider-side retention (container data 30 days) is new to users. No new transfer (Q11). Consent text covers attachments sent to the provider; no consent-text change | D-9 input list below. Record the DPF check date again on the drafting day |
| 2. Public documents (Privacy, Terms, Cookie Policy) | Privacy Policy "Your content" lacks documents and the real deletion behaviour. Line about Anthropic deleting API data "within 30 days" needs a Files API and container qualification. Terms need documents and code-result disclaimers, the marking description for documents, and the skills sentence without "proprietary". No cookie change | D-9 |
| 3. Notification mechanics (WP260 materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION`) | Documents: describing an opt-in feature inside existing purposes and recipients: expected `minor`. Code execution: `minor` for the privacy text, on the reading that it is part of "answer the user's message" with the same recipients. This is a judgment call: `docs/legal.md` lists "a new purpose of processing" as material and says "When unsure, treat it as material". The case for `minor`: same recipients, same role, opt-in per message, no change of legal basis, and no Besidka-side retention longer than file retention. The case against: a retention fact users did not have before (Anthropic container data up to 30 days, OpenAI 30-day abuse logs), which is close to the checklist's "a longer retention period" item, although the retention is the provider's and not Besidka's. D-9 records the reasoning in the PR; if the owner prefers the cautious reading, add one `LEGAL_NOTICES` entry (30 days). The Terms question is material if user restrictions are added (owner item 1). No consent version bump: consent text is unchanged. The `files:write` label edit is a clarification | D-9 records each outcome; if owner item 1 option A is chosen, one `LEGAL_NOTICES` entry and 30 days (14 only with a law or security reason, which this is not) |
| 4. `compliance-review-2026-10.md` items | Age gate: unchanged. IP leaks §2.2: client chunk, Worker module and font must be same-origin (no CDN, no `esm.sh`), as DPIA row 26. DSA §3.1: generated files are private; shares reuse `showFiles` tokens; no new public surface. AI Act §3.2: extended (Q2, Q10); that section cites the guidelines as "20 July 2026" but the Communication in force is C(2026) 7702 of 5.11.2026 (page published 2026-07-20, updated 2026-11-05); D-9 should cite the new number. The paragraph numbers §3.2 uses (11, 69, 70, 73, 74, 81, 85, 86) were re-read in the 5.11.2026 text on 2026-11-08 and still match. TCO: unchanged. Breach runbook: Q14 | D-9; D-2 and D-4 tests for same-origin assets |
| 5. Third-party terms and licences | Libraries and font: Q1. Provider terms: Q7. App-wide (not track blockers): Gemini terms "for professional or business purposes, not for consumer use"; OpenAI Services Agreement 3.3(g) on API-key transfer; OpenAI Usage Policies, effective 2026-11-20, prior approval for model-access intermediaries with a carve-out for apps that integrate models | Owner items 2 and 3 (app-wide) |
| 6. Monetisation guard | Container-hours and tokens are billed by the providers to the user. The price note must read as the provider's price, not Besidka's, and carry no payment or donation wording. No monetisation trigger | D-7 InfoNote copy reviewed against `docs/legal/monetisation-readiness.md` |
| 7. Accessibility (WCAG 2.2 AA target from P0-14) | New UI in D-4 (document card, preview panel with PDF iframe, XLSX table) and D-7 (code card, "+" row, InfoNote). Generated files: not required to be PDF/UA (Q6). Checks: iframe accessible name, `th scope` in the XLSX preview, polite status for rendering states, no colour-only state, 375 px reflow, keyboard path to Preview and Download | D-4 and D-7 acceptance criteria |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| D-1 | BES-277 | Add: "Libraries import from packages (not `dist/pptxgen.bundle.js`); the build emits the licence list of the bundled graph; SheetJS, if used, comes from the pinned `cdn.sheetjs.com` tarball." |
| D-2 | BES-282 | Add: "`THIRD_PARTY_NOTICES` is generated from the real client and Worker bundle graphs; `/*! */` legal comments survive the build; a spec asserts both." Add: "Provenance mirrors the image XMP (IPTC `DigitalSourceType`, model id as `AISystemUsed`); `validate()` returns `provenance: 'ai' | 'channel-only' | 'missing'`." Add rules and fixtures: PDF `/OpenAction`, `/AA`; DOCX field instructions (DDE, DDEAUTO, INCLUDETEXT, INCLUDEPICTURE, LINK); PPTX `ppaction://program`, `ppaction://macro`, `ppaction://ole`; provider-made PDFs validated by structural parse, not byte grep. Add: "`escapeCsvCell()` neutralises `=`, `+`, `-`, `@`, tab, CR, LF and full-width variants; CSV export uses the OWASP Excel-resistant form (tab prefix inside a quoted field) or is out of v1, and the Excel round-trip residual is documented." Add: "A stamp function adds provenance to an existing OOXML or PDF without re-rendering, or D-7/D-8 record `missing`." Add: "Title, language and heading styles are set in every format." |
| D-3 | BES-286 | Replace any plan to serve notices from the Worker: "The Worker has no public route; notices are a static file of the main app." Add: "Workers Logs carry no spec text, titles or asset bytes (test)." |
| D-4 | BES-293 | Add: "Spec object deletion is hooked into `cleanupFilesOrphanedByChatDeletion` (single chat, single message and bulk chat delete), retention cleanup, bulk file delete and `purgeUserData`; a test per path. A branch's `data-document` part is not a reference that keeps the file." Replace "chat deletion nulls `originChatId`" with: "chat deletion deletes the chat's `documents` rows whose file is deleted, and nulls `title` and `originChatId` where the file survives; file deletion nulls `title`; a sweep removes rows with no file and no chat." Add: "Server rejects or relabels files whose provenance is `missing`; marking present before the flag leaves `internal`." Add: "MCP documents are labelled 'Created by a connected app' unless `aiGenerated`; the file manager tab 'Generated by AI' does not mislabel them." Add: "Rendered, preview and notices assets are same-origin." |
| D-5 | BES-296 | Add: "`ScopeLabel.vue` `files:write` description reads 'Create text files and documents (PDF, Word, PowerPoint, Excel) and rename files.'; its unit test and `docs/mcp-server.md` updated." Add: "Tool description tells clients to set `aiGenerated: true` for AI-written content." Add: "`create_document` listed in DPIA row 37 as reaching existing approvals." Provenance is `channel-only` (no AI assertion) unless declared. |
| D-6 | BES-298 | Add to `docs/documents.md`: the licence and notices rules, the marking design and its residual gaps, the retention chain. |
| D-7 | BES-300 | Add: "Anthropic uploads carry `expires_in_seconds: 3600`; uploaded inputs and downloaded output `file_id`s are deleted after persistence, in `onEnd` and `finally`." Add: "OpenAI: `DELETE /v1/containers/{id}` after the turn; per-file delete where needed; any Files API input object deleted." Add: "Never enable sandbox network access or an OpenAI `network_policy`; test." Add: "Server rejects the tool for DeepSeek, Moonshot AI, Qwen and every gateway model." Add: "InfoNote and first-use confirmation: provider price from config, Anthropic bills attached files even if no code runs, free hours depend on the user's org; Gemini free-tier wording." Add: "Remove `gif` from the output allowlist or record it as unmarked." Add: "Office and PDF outputs enter only through D-2 `validate()` with structural parse." |
| D-8 | BES-301 | Replace "proprietary" with: "Anthropic's document skills are referenced by id on the user's key; Besidka bundles none (owner choice)." UI label "Anthropic's skills, run on your Anthropic key". Add: "Flag leaves `internal` only with the D-2 stamp function, or the provenance gap is accepted in the owner decision before 2 Dec 2026." |
| D-9 | BES-302 | Input list below; correct the retention statement (chat deletion removes chat-made files and their specs unless referenced elsewhere); replace "proprietary" with neutral wording; cite guidelines C(2026) 7702; record the materiality reasoning for code execution (gate item 3); add owner item 1 outcome. |

## Input list for D-9 (BES-302)

- Art. 30 rows: (a) new row next to row 3, for example 3a, "Document generation and
  rendering": purpose (files the user asks for), data (spec content from chats,
  rendered file, `documents` metadata including title), subjects (users, third
  parties named in content), recipients (Cloudflare as processor: R2, D1,
  Workers, `besidka-doc-renderer`; the browser renders on the user's device),
  retention (spec and file follow file retention, default 30 days, VIP none;
  deleted with the file; chat deletion removes chat-made files unless still
  referenced; account deletion purges; D1 Time Travel 30 days), security codes.
  (b) Extend row 10a: `create_document` under `files:write`, content supplied
  by the client, no provider key. (c) Extend row 4 ("answer the user's
  message"), no new row and no new purpose: code execution is a processing
  operation inside that purpose. Add to the row's data and recipients that
  prompts, attached files, generated code and outputs go to the user's own
  provider; same independent-controller role; provider retention per the table
  above; Besidka deletes inputs, outputs and the OpenAI container after the
  turn; Gemini inline. (d) §6.1: in the Anthropic, OpenAI and Google rows,
  describe code execution as an operation under the existing purpose, with the
  new DPF check date; state that DeepSeek, Moonshot AI, Qwen and gateways are
  excluded. This keeps the published record consistent with the `minor`
  verdict of gate item 3.
- DPIA rows (continue after row 37, with built/planned status):
  (1) malicious output: macros, external relationships, formula and DDE
  injection, PDF actions, Word fields, PPTX program actions (D-2 rules, with the
  gaps in Q5 marked planned until fixed); (2) spec and title outliving the chat
  (retention hooks, planned until D-4); (3) uploaded files lingering at a
  provider: Anthropic workspace-wide visibility and 30-day container retention,
  OpenAI 30-day abuse logs, residual Medium; (4) prompt-injected code
  exfiltrating data: no network on Anthropic containers, OpenAI hosted
  containers have none by default, Gemini unstated, Besidka never enables
  network; (5) misattributed or unmarked AI output: one unsigned layer, MCP
  channel-only, provider-made files, stripping; residual Medium; (6) skills:
  fixed four ids, hosted terms unverified; (7) renderer abused as a free
  service through MCP: caps; (8) unexpected provider spend: price note,
  default off; (9) third-party code in the client chunk: licences, same-origin,
  pinned versions; (10) content in renderer logs. Add §3.11 sentence on
  `create_document`, and the data flow lines for client render, server render,
  MCP and provider container.
- Privacy Policy paragraphs: "Your content": documents (spec and file, where
  stored, how long, how to delete, what chat deletion does and does not
  remove); each provider subsection: a "Running code" paragraph (what is sent,
  files uploaded to the provider's sandbox for the turn, deleted afterwards
  where possible, what stays: Anthropic container data up to 30 days, OpenAI
  30-day abuse logs, Gemini free-tier wording); qualify the "Anthropic deletes
  API data within 30 days" sentence in "Your AI provider" for Files API objects
  and containers; "Connected AI apps": `files:write` now creates documents from
  content the app supplies; AI-marking statement for documents.
- Terms of Use paragraphs: documents and code results are not checked by
  Besidka; extend the "AI system" paragraph that now describes image marking to
  documents (what is written, that it holds the model id and no personal data,
  that it can be missing or stripped, how to read it); Anthropic's document
  skills are the provider's and run under the user's own Anthropic agreement,
  Besidka does not license or distribute them (no word "proprietary"); "What you
  may not do" per owner item 1; a line that the provider's usage policy applies
  to code run on the user's key.
- AI Act / DSA records: extend `compliance-review` §3.2: documents in scope as
  text (para 60), spec out of scope (para 68), marking design, detection note,
  residual gaps, no use of the Art. 111(4) grace for documents, open-source
  point settled by para 23, provider-made file gap, guidelines citation fix. Also
  record, for the owner decision before 2 Dec 2026, that assistant text in chat
  is not covered by §3.2 at all (owner item 4). No DSA change.
- Materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION` expectation: documents
  and code-execution privacy text `minor` (opt-in features inside existing
  purposes and recipients); no notice; no consent bump. Exception: Terms user
  restrictions, `material` with a `LEGAL_NOTICES` entry and 30 days if owner
  item 1 option A is chosen; the registry spec requires `effectiveAt` at least
  `sendFrom` plus 33 days. `pnpm run legal:hash` after text edits. The flags
  `documents*` and `code-execution*` stay at `internal` until D-9 merges.

## Owner items

1. **Terms mirror of provider prohibitions (decides whether D-7's flag waits
   33 days).** Options. A: add the providers' categories to "What you may not
   do" (DoS and botnets, bypassing security controls without authorisation,
   disrupting critical infrastructure, high-risk automation without review).
   This adds user restrictions, which the `docs/legal.md` checklist calls
   material: a `LEGAL_NOTICES` entry and 30 days. B: rely on the existing
   "break the law" and "malware, exploits, phishing" bullets, add the line that
   the provider's usage policy applies directly to code run on the user's key,
   and classify it `minor`. Recommendation: B. Anthropic's terms bind the user
   as customer (D.2) and no read term makes Besidka a flow-down party, so no
   sourced duty requires A; A costs a 33-day wait and an email to every user.
   Revisit if OpenAI's 2026-11-20 intermediary rule is read as requiring flow
   down, or if the owner wants the belt and braces.
   **Outcome, 2026-11-11 (D-9, BES-302):** the owner chose option A ("Yes, add
   to Terms"), against the recommendation. The clause is in the Terms, with notice
   `2026-12-code-and-documents` effective 2026-12-19, the start of the beta.
2. **Gemini terms: "for professional or business purposes, not for consumer
   use"** (app-wide, already tracked in the Privacy Policy). Options: leave
   as disclosed; or add a pre-key-save notice. Recommendation: leave; no
   change from this track.
3. **OpenAI Services Agreement 3.3(g) (no buying, selling or transferring API
   keys) and the 2026-11-20 intermediary rule** (app-wide). Options: write to
   OpenAI for confirmation that a BYOK front end with stored encrypted keys
   is an app integrating models, or accept the carve-out text. Recommendation:
   ask OpenAI by email before 2026-11-20; keep the reply in the private folder.
4. **Art. 50(2) for chat text and for documents (app-wide, not a D-10
   blocker).** The guidelines list text as a modality (para 60) and
   `compliance-review` §3.2 treats Besidka as provider, yet §3.2 covers images
   only; assistant messages have a visible UI label but no machine-readable
   mark. The one-layer document mark is likely below what Art. 50(2) expects
   (Q2). Options: record text and document marking in the open decision due
   before 2 Dec 2026 with the image decision; or leave chat text out and accept
   the exposure. Recommendation: put both on the same decision and say so in
   D-9; this track's documents carry the metadata mark either way.
5. **Visible mark in generated documents.** Options: none (metadata only, as
   images); or a short "Created with AI" line in document properties text.
   Para 71 lets perceptible marks complement the machine-readable one.
   Recommendation: none by default (the chat card already shows the AI label);
   revisit together with owner item 4.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| Commission Communication C(2026) 7702, Art. 50 guidelines (PDF, paras 10-11, 23, 60, 63-68, 69-77, 80-87, 90-92) | https://ec.europa.eu/newsroom/dae/redirection/document/131215 | Brussels 5.11.2026 | 2026-11-08 |
| Commission page for the guidelines | https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems | Published 2026-07-20, updated 2026-11-05 | 2026-11-08 |
| Code of Practice on transparency of AI-generated content (page only; text measures not read) | https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content | Updated 2026-10-19 | 2026-11-08 |
| AI Act Art. 2(12), 3, 50, 111(4), 113; Reg. (EU) 2026/1744 | https://eur-lex.europa.eu/eli/reg/2024/1689/oj ; https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744 | OJ L 24.7.2026 (amending act) | 2026-11-07 (via `artifacts.md`) |
| `compliance-review-2026-10.md` §3.2, `art30-record.md`, `dpia.md`, `docs/legal.md`, `breach-runbook.md`, Terms, Privacy Policy, `ScopeLabel.vue`, `chat-deletion-cleanup.ts` | repo | n/a | 2026-11-08 |
| Anthropic code execution tool (pricing, retention, containers) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool | none | 2026-11-07 |
| Anthropic Files API | https://platform.claude.com/docs/en/build-with-claude/files | none | 2026-11-07 |
| Anthropic Skills guide and overview | https://platform.claude.com/docs/en/build-with-claude/skills-guide ; https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview | none | 2026-11-07 |
| Anthropic API data retention (ZDR table) | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention | none | 2026-11-07 |
| Anthropic Usage Policy (upcoming version) | https://www.anthropic.com/legal/aup | Effective 2026-11-12 | 2026-11-07 |
| Anthropic Commercial Terms D.2-D.4 | https://www.anthropic.com/legal/commercial-terms | Effective 2025-06-17 | 2026-11-07 |
| Anthropic Service Specific Terms | https://www.anthropic.com/legal/service-specific-terms | Effective 2026-08-31 | 2026-11-07 |
| anthropics/skills commit 2c5958ec, README, LICENSE.txt in docx, pdf, pptx, xlsx | https://github.com/anthropics/skills ; https://api.github.com/repos/anthropics/skills/commits/2c5958ecac | commit 2026-11-06T22:32:28Z | 2026-11-07 |
| OpenAI code interpreter, hosted shell, skills guide | https://developers.openai.com/api/docs/guides/tools-code-interpreter ; .../tools-shell ; .../tools-skills | none | 2026-11-07 |
| OpenAI container and container-file delete | https://developers.openai.com/api/reference/resources/containers/methods/delete ; .../containers/subresources/files/methods/delete | none | 2026-11-07 |
| OpenAI data controls | https://developers.openai.com/api/docs/guides/your-data | none | 2026-11-07 |
| OpenAI pricing (containers) | https://developers.openai.com/api/docs/pricing | none | 2026-11-07 |
| OpenAI Usage Policies (in force; upcoming) | https://openai.com/policies/usage-policies/revisions/2025-10-29/ ; https://openai.com/policies/usage-policies/ | 2025-10-29 ; effective 2026-11-20 | 2026-11-07 |
| OpenAI Services Agreement; service terms | https://openai.com/policies/services-agreement/ ; https://openai.com/policies/service-terms/ | Effective 2026-01-01; updated 2026-10-16 | 2026-11-07 |
| Gemini code execution; Files API; Additional Terms | https://aistudio.google.com/docs/code-execution ; https://aistudio.google.com/docs/files ; https://aistudio.google.com/docs/terms | none; none; effective 2026-03-23 | 2026-11-07 |
| Provider training and retention summary | `research/provider-training.md` (privacy.claude.com 7996866, 7996868; OpenAI your-data; Gemini terms) | various | 2026-11-07 |
| npm registry metadata for the five libraries and their dependency closure | https://registry.npmjs.org/<package>/latest | n/a | 2026-11-08 |
| LICENSE files: docx, PptxGenJS, JSZip, write-excel-file, SheetJS, pdf-lib, foliojs/fontkit, Noto OFL | https://raw.githubusercontent.com/... (see `licences.md`) | none | 2026-11-07 |
| SheetJS licence and install pages | https://docs.sheetjs.com/docs/miscellany/license ; https://docs.sheetjs.com/docs/getting-started/installation/nodejs ; https://cdn.sheetjs.com/ | none | 2026-11-07 |
| OFL 1.1 FAQ | https://openfontlicense.org/ofl-faq/ | none | 2026-11-07 |
| OWASP CSV injection | https://community.owasp.org/attacks/CSV_Injection | none (copyright 2026) | 2026-11-08 |

## Unverified

- Terms and licence of the hosted Anthropic prebuilt skill ids, any clause on
  third-party apps referencing them, and whether hosted content equals the
  repo files. Would settle it: a written answer from Anthropic or a terms page
  naming them.
- Whether the 2026-11-06 Apache-2.0 relicence reaches copies taken earlier.
  Moot while Besidka bundles none.
- OpenAI `/v1/containers` and uploaded-skill ZDR status and visibility; whether
  model-input files reach the container without a Files API object under the
  Responses API in the AI SDK version in use (D-7 spike).
- Gemini code-execution retention, network access and ZDR.
- Anthropic: a container delete endpoint (none found); the previous in-force
  Usage Policy text before 2026-11-12.
- Whether Besidka itself needs an agreement with Anthropic, OpenAI or Google
  under BYOK; counsel question, app-wide.
- Gemini terms date: the terms page showed "Effective March 23, 2026";
  `docs/legal-memory-sensitive-data.md` says "last updated 2026-04-28".
- Whether the Art. 111(4) grace could cover a new output type of an existing
  system: no source found. The text suggests it plausibly does; this draft does
  not rely on it.
- Text-specific marking measures in the Code of Practice (final text not
  read) and whether any upstream provider marks API text output.
- Whether C2PA or another standard covers OOXML and PDF text documents, and
  whether pdf-lib can write a tagged-PDF structure tree.
- Dependency licences are registry metadata for `latest` versions, not the
  versions the lockfile will resolve; LICENSE files of transitive packages not
  read. The build-time collector settles it.
- The PDF, DOCX and PPTX validator gaps in Q5 come from general knowledge of
  these formats; ISO 32000 and ECMA-376 were not fetched.
- NOTICE files in SheetJS CE and pdf-lib tarballs; Workers Logs retention for
  the renderer; today's DPF list status for Anthropic, OpenAI and Google
  (last checked 2026-10-26).
- The P0-14 file `docs/legal/agentic-capabilities-precheck.md` is not in the
  repo: its accessibility decision is taken from the ticket text.
- OpenAI Services Agreement 3.3(g) and the OpenAI Usage Policies (2026-11-20)
  quotes come from the research notes (read in a browser on 2026-11-07). The
  2026-11-08 review could not re-fetch them (HTTP 403 for scripted requests)
  and the saved HTML copies hold no policy text. Treat them as unconfirmed by
  a second read.
- Whether Dependabot can update a tarball-URL dependency (SheetJS): general
  knowledge only.
- Art. 50(2) is applied to PDF, DOCX, PPTX and XLSX by reading "text" (para 60)
  broadly; the Commission guidelines do not name office or PDF formats.
