# Compliance pre-check: Custom research (R-11, BES-309)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07 and
> 2026-11-08. This is the Phase 3 section of the agentic-capabilities
> pre-check record. The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, the gate is run in full in
> "Shared gate" below.

## Verdict

**NO-GO as designed. GO WITH CHANGES after the redesign below, with a
residual contractual risk that only Brave and Exa can close.**

Brave's Search API Terms forbid storing search results "in whole or in part"
beyond "transient storage required for operation", and Brave's help page says
retaining "any and all data" from the API is prohibited. Exa's Terms forbid
copying or displaying anything obtained through the service except browser
cache, unless the Terms or Exa in writing permit it; the only permission is
the API licence "for the limited purposes set forth in the documentation".
The planned 7-day `evidence.jsonl`, the 3-day Workflow state holding result
bodies and a public export with quotes do not fit either text.

The redesign (run-scoped evidence; after the run only references and a
model-written report with capped quotes; no public quotes) is the
least-retention design that still delivers a cited report. It is defensible
on the reading that a cited answer is the use both APIs are sold for. It is
not clearly permitted by the literal text: the reference list and the quotes
are still parts of the results, kept after the run and after the user stops
using the API. The owner either gets written confirmation from Brave and Exa
(owner item 2) or accepts that residual risk in writing before research
ships. R-3 and R-4 may start on the redesign once the coordinator accepts it;
launch waits for one of the two.

## In plain words

- Brave's help page says keeping any data from its API is prohibited; its API
  page says storage needs a plan with storage rights, and no self-serve plan
  has them. Exa's terms bar copying and republishing anything you get from
  its service unless Exa agrees in writing.
- So research may use search results while it runs, but throws the raw
  results away when the run ends. What stays is the report, written by the
  model in its own words with a few short quotes, and the list of links.
  Even that list is, read strictly, "part of" the results, so Brave and Exa
  should confirm it in writing.
- A research report must not be published with its quotes: not as a public
  artifact and not through a public chat share. Private export is fine.
- The same storage rule already bites the **existing chat**: when you use
  Brave or Exa search in a chat today, every result's snippet or page text is
  saved inside the chat history with no end date, although nothing ever shows
  or uses it again. That needs its own small fix ticket.
- Nothing in the text says whether Brave and Exa accept a third-party app
  using the customer's own key at all. Only the owner can ask them. This
  affects the whole app, not only research.
- Starting research with an explicit confirmation that shows the estimate,
  the hard cap, provider and model, and says that it keeps running after the
  tab closes, satisfies the owner's spend rule. No separate Labs opt-in is
  needed.
- Research about a private person (dossier building) is banned in the Terms
  and gets a DPIA risk row.

## Track-specific questions

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Brave: may results returned to the user's key be stored (7-day evidence, notes, report quotes)? | Brave Search API Terms of Use §1 ("Search Results"), §3(a)(ii), §3(b)(i), (ii), (xiii), (xiv), §4(a), §4(b), §4(c), §9(a)(ii), §13(c); help FAQ "What data can be retained?"; API page FAQ | "Search Results" are "any outputs from calls made to the API", including third-party content (LLM Context page text). §3(b)(i): the Customer shall not "store, cache, or create a database of Search Results, in whole or in part, other than transient storage required for operation of Customer Applications or related software, service or systems". Help FAQ: "It is prohibited to retain any and all data received through the Brave Search API." §4(b) makes compliance with the Documentation a duty, so the FAQ arguably binds. The API page allows storage only "with a plan that includes storage rights"; the current plans (Search, Answers, Enterprise) name none. A 7-day file outlives the run that needs it and exists only for re-use, which is what "cache" and "database" mean; a store deleted automatically when the run ends is the transient comparison. After the agreement ends (the Term ends when the user stops using the API), §3(b)(xiv) and §13(c) require erasing all copies of Search Results; references and quotes kept in Besidka would then remain. **Derivative works (§3(b)(ii))**: the term is undefined; under the California law the agreement chooses, it most likely carries its copyright meaning. A report in the model's own words from facts across many sources is the use Brave sells LLM Context for ("LLM grounding, and RAG pipelines") and is licensed by §3(a)(ii) ("use the Search Results with the Customer Applications"); reading (ii) to ban it would empty the licence. The risk grows with verbatim text and with a report that mirrors the result list. **AI use (§3(b)(xiii))**: model input is not banned, but results may not be used to "train ... or otherwise improve" models "offered by ... third parties"; DeepSeek, Moonshot AI and the Gemini free tier may train on API input, so a run on those models may hand Brave results to a model trainer. | **no-go as designed**; go with changes after redesign (residual risk) | Evidence becomes **run-scoped**: raw result bodies live only while the run runs; deleted when the report is written, the run is cancelled or it fails; a sweep deletes leftovers older than the maximum run length plus one hour. After the run, persist only references (URL, domain, title, provider, retrieved_at, content hash) and the model-written report. Workflow step outputs never carry result bodies (pass R2 keys or ids). Paraphrase by default, quote caps (row 3), no result-list dump in the report. The preflight names the model provider's training policy for providers that train on API input; owner option: disable Brave- and Exa-sourced research on those providers. No "your Brave plan must permit storage" disclaimer: the plan cannot be bought self-serve, so the default must fit every plan. | R-1 BES-245, R-3 BES-251, R-4 BES-255, R-5 BES-263, R-6 BES-271 |
| 2 | Exa: same question for `/search` results and `/contents` text, including redistribution in a report, an export and a public artifact | Exa Terms of Service §1.1, §4.2(a), (e), (f), (j), §4.1, "Use of Third-Party Materials" (§6.1 by sequence), "Disclaimers" (§7.1 by sequence); Exa Privacy Policy "Query Data"; Exa security page; Exa `llms.txt` | §4.2(a) bars to "download, modify, copy, distribute, transmit, display, perform, reproduce, duplicate, publish ... any information contained on, or obtained from or through, the Services, except for temporary files that are automatically cached by your web browser for display purposes, or as otherwise expressly permitted in these Terms or by us in writing". Unlike Brave, there is **no transient carve-out**; read literally it covers even the run-scoped copy and showing results. The only permission route is §1.1, the API licence "for the limited purposes set forth in the documentation", which documents search and contents retrieval for AI applications. §4.2(f) bars using the Services "to develop any competitive product or service"; Exa sells its own deep research ("Exa Agent"), so a research feature could be argued to compete. §4.2(j) bars automated queries that "mine" or "extract" from the Services; it reads as aimed at the website, but a run issues many automated queries. Counter-evidence for the BYOK question: Exa documents a hosted MCP server for "any other MCP client", so third-party clients on a user's key are an expected use. Exa disclaims copyright responsibility for third-party material and puts infringement risk on the user (§4.1, Disclaimers). Exa uses query data to train its models unless the account has Zero Data Retention (an add-on: Enterprise plan or a dashboard upgrade for team owners). Section numbers 6.x and 7.x are garbled in the PDF text layer; cite them by heading. | **no-go as designed**; go with changes after redesign (residual risk, higher than Brave) | Same run-scoped evidence rule as row 1. Report quotes capped (row 3). A **public artifact export** of a research report strips verbatim quotes and source excerpts (links stay) or is blocked. The same applies to a **public chat share** of a chat holding a research report: `filterPublicParts` already removes search tool parts, but the report is a text part and needs its own treatment. The preflight modal says Exa may keep and train on the queries the model writes (existing Privacy Policy wording, extended to "many queries per run"). §4.2(f) and (j) go into owner item 2. | R-4 BES-255, R-6 BES-271, R-7 BES-274, new share ticket (or R-7) |
| 3 | Copyright in fetched page text: temporary copies, TDM, quotation; does a public export change the answer? | Directive 2001/29/EC Art. 5(1), 5(3)(d); Directive (EU) 2019/790 Art. 2(2), 3, 4, 7(1); CJEU C-145/10 Painer; Polish copyright act art. 23, 26³, 29 (wording not re-read) | Brave and Exa fetch the pages; Besidka receives text and a model analyses it to answer the user. **Temporary copies (Art. 5(1))**: the copy must be "transient or incidental", "an integral and essential part of a technological process", with the "sole purpose" of enabling a lawful use, and with "no independent economic significance". A run-scoped store deleted automatically at run end fits; a 7-day archive does not. **TDM (DSM Art. 4)**: reproductions for text and data mining may be retained "for as long as is necessary for the purposes of text and data mining", unless the rightholder "expressly reserved" use "in an appropriate manner, such as machine-readable means". Whether answer-time reading of a few pages is TDM under Art. 2(2) is not settled, so Art. 5(1) is the primary basis and Art. 4 a fallback. Art. 3 is limited to research organisations and heritage institutions. DSM Art. 7(1) protects only Arts. 3, 5 and 6 from contract override, so Art. 4 gives no answer to the Brave and Exa terms. **Private use (Polish art. 23)** is not available: Besidka, a service, makes the copies, not the user privately. **Quotation (Art. 5(3)(d), Polish art. 29)**: needs a work already lawfully made public, the source "including the author's name" unless impossible, fair practice, and an extent "required by the specific purpose". The quoting text need not itself be a protected work (Painer); Polish art. 29 may be read more strictly but must be read in line with the directive. Long quotes and quotes without a role in the argument are the weak point. A public export republishes the quotes to everyone and removes the private-use context. | **go with changes** | Quote caps in the report prompt and a server-side check: at most 25 words per verbatim quote, at most 2 quotes per source, and verbatim text at most 10% of the report's words; everything else paraphrased with a citation that names the source and, where the page shows one, the author. Run-scoped storage (row 1) doubles as the Art. 4(2) "as long as necessary" limit. Public export and public share strip quotes (row 2). | R-4 BES-255, R-7 BES-274 |
| 4 | Third parties' personal data in sources; research targeting a private individual | GDPR Art. 6(1)(f), 9(2)(e), 14(5)(b), 35 | Sources will name people. Besidka processes them as controller for the run (the user decides the topic; Besidka runs the pipeline). Basis: Art. 6(1)(f), helped by run-scoped retention and no profiling. Art. 14 notice to each person named in a web page is impossible or disproportionate; Art. 14(5)(b) then requires "appropriate measures to protect the data subject's rights and freedoms and legitimate interests, including making the information publicly available": a Privacy Policy paragraph, run-scoped storage and the Terms ban below. Special-category data of third parties in sources: the user's sensitive-data consent covers only the user's own data; for third parties, Art. 9(2)(e) where the person made the data manifestly public, otherwise the processing is incidental, not targeted, run-scoped and not stored after the run. A run aimed at one private person builds a dossier, which a balancing test cannot justify and which is a stalking or doxxing risk. EDPB guidance on web scraping (Opinion 28/2024 on AI models; ChatGPT Taskforce report) was not re-read for this check (Unverified). | **go with changes** | Terms of Use: research about a private individual, or compiling a profile of a person who is not a public figure, is prohibited (stalking, doxxing, background checks). DPIA rows: "dossier building" and "special-category data of third parties in sources", with measures (Terms ban, run-scoped evidence, no cross-run person index, report category in the existing report flow). Privacy Policy describes third-party data in sources. No automated person detection in v1. One line in the modal: "Do not research private individuals." | R-10 BES-289, R-6 BES-271 |
| 5 | Spend after the user leaves: is a per-run confirmation with a hard cap explicit consent, or must `research.custom` also be a Labs opt-in? | Owner rule `feedback_no_spend_without_consent` (memory): background LLM work on user keys needs explicit opt-in, default OFF, forward-only; "manual buttons (Refresh, extract-now) are fine as explicit consent"; "disclose model + key in the UI" | This is an owner-policy question, not a legal one. A run starts only when the user presses Start in a modal that shows the cost, like the "extract-now" button the rule already accepts: explicit, default off, forward-only (one run). The rule did not consider runs that continue after the tab closes; the modal disclosure covers that. A Labs opt-in adds nothing; feature flags (P0) gate rollout anyway. | **go with changes** | No Labs opt-in. The confirmation states: the estimated cost range labelled "estimate"; the hard cap the user confirms; the model, provider and key used; the search provider and that it bills the user's own key; that the run keeps going after the tab is closed; how to stop it ("Stop and write report" still bills the final synthesis, within the cap; "Cancel" stops without a report). The Start button repeats the cap ("Start research, up to $X"). | R-6 BES-271 |
| 6 | Estimate accuracy (±30%): wording; what if actual > estimate but < cap? | Directive 2005/29/EC Art. 6, 7 (as guidance) | An estimate presented as a price would mislead; a cap that can be exceeded would be worse. "90% of the cap triggers synthesis" does not hold the cap if synthesis over many sources costs more than 10%. | **go with changes** | Wording "estimate" everywhere, never "cost". The cap is enforced in code: the cap check reserves the projected synthesis cost, and if it does not fit, synthesis runs on fewer notes; money-spending steps keep `retries.limit: 0`. When actual exceeds the estimate but not the cap, the result card shows the actual cost and "Higher than estimated, within your cap of $X". | R-3 BES-251, R-6 BES-271, R-9 BES-284 |
| 7 | Transfers: DeepSeek, Moonshot AI, Qwen, gateways; orchestrator Worker | `docs/legal-memory-sensitive-data.md` (Art. 49(1)(a) per provider); Cloudflare DPA | Research sends chat content and source text to the chosen model provider like a chat send. The existing per-provider transfer consent must gate the start as it gates a send. The `besidka-research` Workflow Worker runs in the same Cloudflare account; Cloudflare stays the processor, no new recipient. | **go with changes** | The research start endpoint runs the same sensitive-data and `providerTransferConsents` checks as the chat send before any spend. | R-5 BES-263, R-6 BES-271 |
| 8 | Retention: evidence, Workflow state, step outputs, `research_step_claims`; account and chat deletion; D1 restore | GDPR Art. 5(1)(e), 17; `docs/d1-restore-reconciliation.md` | With row 1, evidence retention drops from 7 days to the run. Claims and job rows hold no content. A deletion while a run is live could let a running step write new evidence after the purge. A D1 restore can revive a job in a running state; a revived job must never resume and spend again. | **go with changes** | Account purge and chat deletion first cancel any live Workflow instance for the chat, then delete the run's R2 prefix and job rows (chat cascade already removes `research_jobs`). The sweep marks any job without a live Workflow instance as failed without spending. Add `research_step_claims` and the evidence prefix to `docs/d1-restore-reconciliation.md` with the rule "revived running jobs are failed, never resumed". | R-3 BES-251, R-5 BES-263, R-10 BES-289 |
| 9 | Prompt injection from fetched pages | DPIA risk table; `server/utils/search/injection-screening.ts`; Privacy Policy "Prompt-injection screening" | Sources are untrusted. Existing measures: untrusted framing, optional TypeSafe AI screening of titles and snippets. Screening sends Brave and Exa results to TypeSafe AI; with up to ~200 sources per run that is more Search Results handed to a third party (owner item 2). | **go** | Keep the research tool set closed: only `brave_search`, `exa_search`, `read_url`; no connectors, memory writes, file writes or MCP tools inside a run. List as a DPIA measure. | R-4 BES-255, R-10 BES-289 |
| 10 | AI Act Art. 50 | Regulation (EU) 2024/1689 Art. 50(2); `compliance-review-2026-10.md` §3.2 | The report is AI-generated text shown in the chat. Machine-readable marking of chat text is an app-wide gap (assistant text carries no mark today), not specific to research. Exports inherit marking from D-4 (documents) and A-4 (artifacts). | **go** | None in Phase 3 beyond inheriting D-4/A-4. App-wide chat-text marking is owner item 3. | none |
| 11 | Future raw-fetch `read_url` as a crawler | RFC 9309; DSM Art. 4(3) | Not in v1 (`read_url` uses Exa `/contents`). If Besidka ever fetches pages itself it becomes the party reproducing content and must honour reservations. | **go** (precondition recorded) | Precondition for that follow-up: own user agent with a contact URL, robots.txt per RFC 9309, machine-readable TDM reservations (TDMRep, `ai.txt`) respected, run-scoped storage, the SSRF wrapper from C-3. | future ticket |
| 12 | MCP `cancel_research_job` under `chats:write`, read tools under `chats:read` | `docs/mcp-server.md` | Cancelling stops spend; reading jobs is chat data. Both fit the existing scope labels. No start tool, so MCP never starts spend. But if cancel ran the "Stop and write report" path, MCP would trigger a paid synthesis. | **go with changes** | `cancel_research_job` maps to Cancel, not to Stop and write report: no model call after cancel; any partial output is what already exists. No Stop-and-write tool over MCP. | R-8 BES-279 |
| 13 | Breach runbook: new store, new secret | `docs/legal/breach-runbook.md` | New: the run-scoped R2 evidence prefix and the HMAC key the Workflow Worker uses for `POST /internal/research/step`. A leaked key lets an attacker drive steps that spend user keys. | **go with changes** | Runbook: rotate the HMAC key, cancel all running jobs, delete the evidence prefix; key stored as a secret in both Workers. | R-1 BES-245, R-10 BES-289 |

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR | New purpose "multi-step research" over existing categories (chat content, search queries) plus third-party personal data in sources. Basis 6(1)(b) for the user's own research, 6(1)(f) for third parties named in sources. Art. 9: the user's consent covers the user's own data; third parties' special-category data rests on 9(2)(e) or incidental, run-scoped processing (row 4). Transfers: existing per-provider consent (row 7). | Art. 30 row and DPIA rows via R-10. |
| 2. Public documents | Privacy Policy: research purpose, run-scoped source storage, third-party data in sources. Terms: no research on private individuals; search results are used under the user's own Brave or Exa terms. No cookie change. | R-10. |
| 3. Notification | New purpose and new Terms prohibition: material under the WP260 checklist (new purpose of processing, new user obligation). `LEGAL_NOTICES` entry with the 30-day notice. `CURRENT_CONSENT_VERSION` unchanged (the consented purposes still describe it). | R-10. |
| 4. Compliance-review items | Age gate unchanged. No new browser-side third-party requests (§2.2). DSA: a report is private unless shared or exported (row 2). AI Act row 10. TCO n/a. Breach runbook row 13. | Rows 2, 10, 13. |
| 5. Third-party terms | Brave and Exa terms are the blocker (rows 1, 2). The BYOK key-sharing question (Brave §4(a), §3(b)(ix); Exa silent) is app-wide. | Owner items 1 and 2. |
| 6. Monetisation guard | No paid tier, no credits, spend only on user keys. | None. |
| 7. Accessibility | Preflight modal and progress card follow WCAG 2.2 AA (focus, Esc, live region for progress). | R-6. |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| (parent) | BES-227 | Post the storage finding with the options: (1) run-scoped redesign (recommended); (2) evidence in memory or Workflow state only (Workflow state persists 3 days, so it fails the same test); (3) require a storage-rights plan (rejected: not self-serve). R-3/R-4 start only after the coordinator accepts option 1. Launch gate: written answer from Brave and Exa, or a written owner risk acceptance. |
| R-1 | BES-245 | Add: "Record the Workflow instance state retention and whether it can be shortened or deleted per instance; step outputs carry ids and R2 keys only, never search-result bodies." |
| R-3 | BES-251 | Replace "evidence JSONL, 7-day retention" with: "Evidence is run-scoped: `research/<jobId>/` holds raw result bodies only while the job runs; deleted on report, cancel or failure; a sweep deletes leftovers older than the maximum run length plus one hour. Persisted after the run: references only (URL, domain, title, provider, retrieved_at, content hash)." Add: purge on account and chat deletion after cancelling the live instance; the cap check reserves the projected synthesis cost. |
| R-4 | BES-255 | Add: "Segments receive result bodies from the run-scoped store and return notes and references only. The synthesis prompt and a server-side check cap verbatim quotes at 25 words, 2 per source and 10% of the report's words; citations name the source and author where shown; no result-list dump. Research tool set is closed: `brave_search`, `exa_search`, `read_url` only." |
| R-5 | BES-263 | Add: "Start runs the same sensitive-data and provider-transfer consent checks as a chat send. Finalize deletes the evidence prefix. The sweep fails jobs with no live Workflow instance without spending (covers D1 restores)." |
| R-6 | BES-271 | Add the confirmation contents of row 5, the "estimate" wording and over-estimate note of row 6, the provider-training note of row 1, the Exa query-training line of row 2 and "Do not research private individuals." No Labs opt-in. |
| R-7 | BES-274 | Add: "Private exports (PDF/DOCX file, private artifact) keep the report. A public artifact share of a research report strips verbatim quotes and source excerpts (links stay) or is blocked; default block. The same rule applies to a public chat share of a chat that holds a research report." |
| R-8 | BES-279 | Add: "`cancel_research_job` runs Cancel, never Stop and write report; no model call after an MCP cancel." |
| R-9 | BES-284 | Add: "Verify the over-estimate note, that the cap is never exceeded including synthesis, and that the evidence prefix is empty after each of the three live runs." |
| R-10 | BES-289 | Use the input list below. |
| (new) | none | Fix ticket for the existing chat (owner item 1): `redactSearchToolPartsForPersistence`, modelled on `redactMemoryToolPartsForPersistence`, keeps title, URL and date and drops `snippet`; plus an owner-approved one-off backfill (additive UPDATE, no schema change). |

## Input list for R-10 (BES-289)

- Art. 30 row "Custom research runs": purpose (answer the user's research
  request with multi-step search); categories (chat content, search queries,
  source text with third-party personal data, job metadata, cost); recipients
  (chosen AI provider or gateway; Brave or Exa as independent controllers
  under the user's account; TypeSafe AI if screening is on; Cloudflare as
  processor); retention (source text run-scoped with a max-run-plus-one-hour
  sweep; references and report with the chat); security (HMAC step key,
  run-scoped R2 prefix).
- DPIA rows: dossier building on a private individual; special-category data
  of third parties in sources; prompt injection from sources (closed tool
  set, untrusted framing, optional screening); spend after tab close
  (preflight, hard cap with reserved synthesis, Stop/Cancel,
  `retries.limit: 0`); third-party terms breach (run-scoped storage, quote
  caps, no public quotes); D1 restore reviving a running job.
- Privacy Policy paragraphs: research as a new purpose; what is kept after a
  run (report and links) and what is not (source text); third-party data in
  sources (the Art. 14(5)(b) public information); Exa trains on queries unless
  the account has Zero Data Retention (exists; extend to "many queries per
  run"); screening of many results by TypeSafe AI when on.
- Terms of Use paragraphs: no research on private individuals or profiles of
  non-public persons; search results are used under the user's own Brave or
  Exa terms. Brave §4(c) requires the Customer's end users to be bound by
  obligations "substantially similar" to §3(b); in BYOK the user is the
  Customer, but the Terms should still carry them: no storing, caching or
  building databases of results, no redistribution, no derivative works, no
  AI training with results. Research continues after the tab is closed and
  bills the user's keys up to the confirmed cap.
- AI Act / DSA records: none new; exports inherit D-4/A-4.
- Materiality: material. `LEGAL_NOTICES` entry, 30-day notice.
  `CURRENT_CONSENT_VERSION` unchanged.

## Owner items

1. **Existing chat persists Brave and Exa result text (app-wide, today).**
   Chat tool parts `web_search_brave` and `web_search_exa` are saved in
   `messages.parts` with their full `output`, including every result's
   snippet (Brave LLM Context text, Exa page text up to 1500 characters).
   Confirmed in code: the persistence filters in
   `server/api/v1/chats/[slug]/index.post.ts`
   (`normalizeAssistantMessagePartsForPersistence`,
   `stripUndeliveredInlineDataParts`, `redactMemoryToolPartsForPersistence`)
   touch only file, inline-data and memory parts. The snippets are never
   rendered (the UI reads title, URL and date), never re-sent to a model (the
   history sanitizer keeps only text from past assistant turns), never
   indexed and never shared publicly. Dropping them at save time loses
   nothing a user sees. Options: (a) a fix ticket that drops snippets at save
   time plus a one-off backfill of existing rows (owner decision, additive
   UPDATE); (b) keep as is and ask Brave and Exa for written permission.
   Recommendation: (a) now, and (b) in parallel, because titles and URLs
   still stay.
2. **Ask Brave and Exa in writing (app-wide; launch gate for research).**
   Brave §4(a) lets the customer share its key only with "affiliates,
   contractors and agents" and §3(b)(ix) bars combining the API with software
   not authorised by Brave other than Customer Applications; Exa's terms are
   silent on third-party apps. Ask both: is a BYOK app acting for the key
   holder acceptable; are run-scoped storage (minutes), a reference list
   after the run and short attributed quotes in a private report acceptable;
   is sending results to a model provider that may train on input, or to
   TypeSafe AI for screening, acceptable. Ask Exa also whether a multi-step
   research feature on a user's key falls under §4.2(f) (competitive product;
   Exa sells "Exa Agent" deep research) or §4.2(j) (automated queries); Exa's
   own MCP documentation for third-party clients supports the BYOK reading.
   Brave: searchapi-support@brave.com. Exa: hello@exa.ai or sales@exa.ai.
   Send now; the answer, or a written owner risk acceptance, is a launch gate
   for research (before R-9 sign-off).
3. **Chat-text AI marking (app-wide).** Assistant text carries no
   machine-readable Art. 50(2) mark. The owner decision is already open in
   `compliance-review-2026-10.md` §3.2; research adds volume, not a new
   question.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| Brave Search API Terms of Use | https://api-dashboard.search.brave.com/terms-of-service | Last updated 1 Sep 2026 | 2026-11-07 |
| Brave help and feedback FAQ ("What data can be retained?") | https://api-dashboard.search.brave.com/documentation/resources/help-feedback | none shown | 2026-11-07 |
| Brave Search API page and FAQ | https://brave.com/search/api/ | none shown | 2026-11-07 |
| Brave pricing documentation | https://api-dashboard.search.brave.com/documentation/pricing | none shown | 2026-11-07 |
| Brave LLM Context documentation | https://api-dashboard.search.brave.com/documentation/services/llm-context | none shown | 2026-11-07 |
| Exa Terms of Service (PDF) | https://exa.ai/terms | no "Last Revised" shown; PDF created 2025-03-04 | 2026-11-07 |
| Exa Privacy Policy | https://exa.ai/privacy-policy | Last updated 29 Jun 2026 | 2026-11-07 |
| Exa security (Zero Data Retention) | https://exa.ai/docs/reference/security | none shown | 2026-11-07 |
| Exa contents retrieval docs | https://exa.ai/docs/reference/contents-retrieval | none shown | 2026-11-07 |
| Exa `llms.txt` (Exa Agent, MCP for "any other MCP client") | https://exa.ai/llms.txt | none shown | 2026-11-07 |
| InfoSoc Directive 2001/29/EC | https://eur-lex.europa.eu/eli/dir/2001/29/oj | | 2026-11-08 |
| DSM Directive (EU) 2019/790 | https://eur-lex.europa.eu/eli/dir/2019/790/oj | | 2026-11-08 |
| CJEU C-145/10 Painer | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62010CJ0145 | 1 Dec 2011 | 2026-11-08 |
| GDPR | https://eur-lex.europa.eu/eli/reg/2016/679/oj | | 2026-11-08 |
| Unfair Commercial Practices Directive 2005/29/EC | https://eur-lex.europa.eu/eli/dir/2005/29/oj | | not re-read (guidance only) |
| Polish copyright act (ustawa o prawie autorskim i prawach pokrewnych) | https://isap.sejm.gov.pl | | wording of art. 23, 26³, 29 not re-read |
| RFC 9309 (Robots Exclusion Protocol) | https://www.rfc-editor.org/rfc/rfc9309 | Sep 2022 | 2026-11-07 |
| Owner spend rule | memory note `feedback_no_spend_without_consent.md` (owner's Claude memory, not in the repo) | | 2026-11-08 |

## Unverified

- Brave legacy plans "Data with Storage Rights" and "Data for AI": seen only in
  a search snippet and a 2024 forum post; not on any current plan page. A user
  on such a plan may hold storage rights; the design does not rely on it.
- Exa Master Subscription Agreement, DPA and any written permission to store
  or republish: not fetched or not found.
- Whether Brave or Exa treat a BYOK app as the key holder's "agent" or as
  authorised software: no text; settle by owner item 2.
- Cloudflare Workflows instance-state retention and per-instance deletion:
  settle in R-1.
- Polish copyright act art. 23, 26³ and 29 wording: not re-read; the analysis
  relies on the EU directives they implement.
- EDPB Opinion 28/2024 and the ChatGPT Taskforce report on web scraping: not
  re-read for this check; the Art. 14(5)(b) position follows the GDPR text and
  the existing DPIA approach.
- Painer paragraph numbers: the operative-part point was checked, paragraph
  numbers were not.
