# Compliance pre-check: Skills (S-8, BES-315)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07
> (primary pages) and 2026-11-08 (own checks, marked "own check"). An
> independent review on 2026-11-08 re-checked the relicence, the GitHub
> quota claim and the provider quotes against the primary pages; its findings are
> listed in the pull request.
> This is the skills section of the agentic-capabilities pre-check record.
> The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, this file answers the
> track-specific questions of BES-315 and runs the gate in full below.
> A dated addendum at the end of this file (2026-11-13) covers authoring, the
> `authored` class, enabled-on-save, 20 kept versions and commands, and wins
> where it disagrees with the text above.

## Verdict

**GO WITH CHANGES**: skills can be built as designed (private, text-only,
pinned, reviewed, disabled by default), but the licence rule in the ticket is
stale and the importer needs a licence gate that reads the licence file, not
the `license` field.

- Skills runtime, importer, Skills page and MCP tools (S-1 to S-4, S-6):
  **GO WITH CHANGES** (Q1 to Q4, Q6 to Q12).
- S-5, Anthropic path (upload to the user's Anthropic workspace):
  **GO WITH CHANGES** (workspace visibility, no ZDR, deletion, rename rule).
- S-5, OpenAI path (inline or uploaded skills in OpenAI containers):
  **NO-GO as designed for v1**. OpenAI's own guidance names this product
  pattern as one to avoid. It is a risk call, not a terms breach. S-5 ships
  Anthropic-only.

## In plain words

- The ticket says Anthropic's document skills (docx, pdf, pptx, xlsx) are
  proprietary. That changed on 2026-11-06: they are now Apache-2.0. Copies
  pinned to an older commit still carry the old, restrictive licence.
- So the block must follow the licence file at the pinned commit, not the
  repository, a path or a date. The `license` field in `SKILL.md` changed in
  the same commit (from "Proprietary. LICENSE.txt has complete terms" to
  "Complete terms in LICENSE.txt"). It is still only a hint: the author
  controls it, a fork can edit it without touching the licence file, and the
  new string is identical in Apache-licensed skills such as `claude-api`, so
  today's string tells you nothing. The word "Proprietary" in it is a warning
  sign worth keeping.
- An imported skill is a private copy kept at the user's request and sent to
  the user's own provider. That is hosting, not publishing. The EU copyright
  directive's platform rule (Art. 17) does not apply to it. The Terms need a
  right-to-use promise and a power to disable a skill.
- GitHub's unauthenticated limit (60 requests an hour per IP) is real, but
  tests (including 75 requests in a row) show the zip download costs none of it
  and carries the commit SHA inside the zip. This is observed, not documented.
  (Amended 2026-11-13: the import makes one `api.github.com` call to resolve
  the ref; only the download is free of it.) An optional
  per-user GitHub token is still worth having for update checks. Never one
  shared Besidka token.
- Anthropic uploads are visible to everything in the user's workspace, are not
  zero-data-retention, and a skill whose name contains "claude" or "anthropic",
  such as `claude-api` (a real one), cannot be uploaded under that name. S-5
  must disclose, rename, and be able to delete the provider copy.
- User skills must never reach any public route (`/.well-known/...`,
  `/llms.txt`, sitemap, markdown twins, shared chats). Add a test.
- Legal text: one `LEGAL_NOTICES` entry is needed (new restrictions in the
  Terms and, with S-5, a new purpose at the provider). No new consent
  version.
- Owner needs to decide four small things (see Owner items).

## The licence rule in one table

This is the answer to the first acceptance criterion of BES-315. The
classifier steps are in "Licence classifier" below the question table.

| Class | Detected by | What Besidka does |
|---|---|---|
| `restricted` | The licence file matches a known restrictive text (the old Anthropic one), or a restriction phrase fires, or the `license` field says "Proprietary" or "All rights reserved" and there is no licence file | Import is blocked on every source (URL, GitHub, zip, paste, MCP). No user override. The owner can release a false positive by hash |
| `open` | The licence file body matches a known open licence (Apache-2.0, MIT and similar) and no restriction phrase fires | Allowed. Licence shown. `LICENSE` and `NOTICE` stored verbatim |
| `custom` | A licence file that matches nothing known and has no restriction phrase, or a field that disagrees with an open file | Allowed after the user reads the licence and ticks the review box |
| `none` | No licence file and no usable `license` field | Allowed with a warning and an extra tick: "I have the right to use this skill" (Owner item 2) |

## Track-specific questions

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Copyright in imported skills: hosting at the user's request; DSM Art. 17; Terms | DSA Art. 3(g)(iii), 6(1), 16(3) (EUR-Lex, accessed 2026-11-07). DSM 2019/790 Art. 2(6), 17(1) (EUR-Lex, own check 2026-11-08). `docs/legal/compliance-review-2026-10.md` §3.1. Polish copyright act art. 23: wording UNVERIFIED | Storing a skill the user imported is "storage of information provided by, and at the request of, a recipient" (DSA 3(g)(iii)), so hosting. Art. 6(1) gives no liability while Besidka has no actual knowledge and acts "expeditiously" once it has. Art. 16(3): a precise notice counts as actual knowledge. Art. 6 is a liability exemption, not a licence: Art. 6(2) takes away the exemption where the user acts under Besidka's authority or control, Recital 18 withholds it from a provider that plays "an active role of such a kind as to give it knowledge of, or control over, that information", and Art. 6(4) leaves courts and authorities free to order removal (own check of the saved EUR-Lex text). Nothing is disseminated to the public: skills are private, so Besidka is not an online platform (DSA 3(i), 3(k)). DSM Art. 2(6) defines the provider as one whose main purpose is "to store and give the public access to a large amount" of protected works uploaded by its users, "which it organises and promotes for profit-making purposes", and excludes "cloud services that allow users to upload content for their own use" (EUR-Lex, re-read 2026-11-08). A private per-user skill store fits that exclusion and has no profit purpose, so Art. 17 does not apply (analysis, not source text). Template position kept: the DSA may not apply at all (no remuneration, `compliance-review-2026-10.md` §3.1); Besidka follows the notice route voluntarily. Two cautions. (a) For GitHub and raw-URL imports the Besidka Worker itself fetches and writes the copy on the user's instruction, so the "provided by the user" premise is weaker than for an upload (analysis, not source text). That is the reason to run the licence gate on every source, not only on archives. (b) Once the gate or a report gives Besidka knowledge of a restriction, keeping the copy is the risk, so the gate blocks rather than warns. The user's own use is a separate point (Polish art. 23 personal use, wording UNVERIFIED): it covers the user, not Besidka. | go with changes | Terms: user promises the right to use each imported skill (same pattern as "Do not add files or notes to project knowledge that you have no right to use", Terms "Memory and project knowledge"); add skills to the `Your content` licence list; Besidka may disable a skill that is unlawful or abusive; the existing "Reporting illegal content" and "Copyright complaints" routes name skills. S-2: licence gate runs on URL, GitHub, zip and paste. No DMCA agent (owner decision 2026-10-28), nothing new | S-7 BES-294, S-2 BES-268 |
| 2 | Licence-restricted skills, Anthropic's in particular | Own check 2026-11-08: `raw.githubusercontent.com/anthropics/skills/main/skills/{docx,claude-api,frontend-design,doc-coauthoring}/SKILL.md`; the `SKILL.md` and `LICENSE.txt` of `docx` at `b118d29ea4`, `ef740771ac` and `2c5958ecac`; the file patches of the commit API response for `2c5958ecac`. Research `licences.md`, `codeexec-skills.md` §1.4: commit API `api.github.com/repos/anthropics/skills/commits/2c5958ecac`; old text `raw.githubusercontent.com/anthropics/skills/ef740771ac/skills/docx/LICENSE.txt`; README (main, and `f458cee31a`), all accessed 2026-11-07 | **The ticket premise is stale.** On 2026-11-06T22:32:28Z commit `2c5958ec` ("Move Office skills to the Apache 2.0 license (#2146)") relicensed docx, pdf, pptx and xlsx to Apache-2.0. The proprietary text was in force from at least 2025-10-16 (own check: byte-identical at `b118d29ea4`, path `document-skills/docx/LICENSE.txt`), moved to `skills/docx/` on 2025-12-01 (`ef740771`), and replaced on 2026-11-06. So an old pin can sit under `document-skills/`: a rule keyed on the path fails. Verbatim from the old text: users "may not" "Extract these materials from the Services or retain copies of these materials outside the Services"; "Reproduce or copy these materials"; "Create derivative works based on these materials"; "Distribute, sublicense, or transfer these materials to any third party" (research `codeexec-skills.md` §1.4). So under the old text even a copy on Besidka, for a user who holds an Anthropic key, is a breach; running on a non-Anthropic model is outside it a fortiori. The four old texts are byte-identical (md5 `f8515c36...`, normalised SHA-256 `aeebbce5...`). **The `license` field changed in the same commit, but it is not a safe test.** Own check (commit patch): all four `SKILL.md` files went from `license: Proprietary. LICENSE.txt has complete terms` to `license: Complete terms in LICENSE.txt`. The old string is the example value in the Agent Skills spec itself. The field cannot decide alone because the author controls it, a fork can edit it without touching `LICENSE.txt` (or the reverse), and the new string is identical in Apache-2.0 skills (`claude-api`, `frontend-design`), so today it carries no information. It stays a hint: "Proprietary" in it is a warning. The `LICENSE.txt` bytes decide. The repository root has no licence file (research `licences.md`): licensing is per skill folder. Whether the relicence reaches copies taken earlier is a legal point and UNVERIFIED, so treat old copies as restricted. The cost is low: the current version is Apache-2.0, so a blocked user re-imports it. | go with changes | Replace "block when the SHA predates `2c5958ec`", and any rule keyed on repository or path, with the content rule in "The licence rule in one table" and "Licence classifier" below. It needs no extra API call (the licence file is in the zipball). **Block message** for the Anthropic case: "This copy carries Anthropic's earlier proprietary licence. Anthropic moved these skills to Apache-2.0 on 2026-11-06. Import the current version, or use the built-in Anthropic skill on your own Anthropic key." No override for a match on the restrictive text or a restriction phrase. Store `LICENSE`/`NOTICE` files verbatim and show them (Apache-2.0 §4 attribution and notices; never strip). Heuristic by nature; the Terms state user responsibility | S-2 BES-268, S-1 BES-264, S-4 BES-280, S-7 BES-294 |
| 3 | Show the `license` field before install and on the Skills page; wording for "no licence" and "restricted to a product" | Agent Skills spec, `agentskills.io/specification` (own check 2026-11-08): `license` is "License name or reference to a bundled license file"; `compatibility` may indicate "intended product"; the spec's own example is `license: Proprietary. LICENSE.txt has complete terms`. GitHub ToS D.5 (research `licences.md`) | The spec has no machine-readable licence field and no field that says "restricted to a product". `compatibility` is about the environment, not rights, so do not infer a licence from it, but show it. A public GitHub repo with no licence grants others use "through the Service as permitted by GitHub's functionality" (ToS D.5), not a right to copy out. Default law: all rights reserved. The field is attacker-controlled text: render as plain text, truncated, never as a link or HTML. If the field and the file disagree, the stricter reading wins and both are shown (classifier steps 6 and 8). The spec's own example value is `Proprietary. LICENSE.txt has complete terms`, so a "Proprietary" field is common and not always a block. | go with changes | **Wording (S-4 review screen and card).** Recognised open licence: badge with the SPDX id and "Licence file: LICENSE.txt (view)". Custom: "Custom licence. Read it before you install." No licence: "No licence stated. The author keeps all rights by default. Besidka keeps a private copy for you only. Install it only if you have the right to use it." Needs the extra tick "I have the right to use this skill". Restricted: "Its licence limits use to <named service>, or forbids copying. Besidka cannot import it." (blocked). Licence changes between versions are called out in the update diff (already in S-4). Add `NonCommercial` to the warn list and revisit if Besidka ever earns (monetisation guard) | S-4 BES-280, S-2 BES-268 |
| 4 | GitHub: unauthenticated API from shared Workers egress, zipball under GitHub's terms, optional user token | REST rate limits (`docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`), zipball docs (`.../rest/repos/contents`), PAT docs, ToS section H, AUP s.4 and s.7 (all research `licences.md`, accessed 2026-11-07). Own check 2026-11-08: `api.github.com/repos/octocat/Hello-World/zipball/master`. Repo: `server/db/schemas/keys.ts`, `.drizzle/migrations/20250617221739_fast_the_call/migration.sql` | Unauthenticated: 60 requests an hour per IP; authenticated 5,000. The research test saw the zipball 302 not consume core quota while `/commits` and `/contents` do; my own check saw `x-ratelimit-remaining: 60`, `used: 0` on the zipball response, and the downloaded zip's archive comment held the full 40-character commit SHA (`unzip -z`), with the short SHA in the top folder name. Review re-check 2026-11-08: 75 consecutive zipball requests to the same host all answered 302, the remaining-quota header stayed at 60, and `/rate_limit` showed the core count unchanged by them, while a `/commits` call lowered it by one. `github.com/<owner>/<repo>/archive/<ref>.zip` also answers 302 to `codeload.github.com` and the zip carries the same 40-character SHA, so an import can avoid the `api.github.com` host altogether; that route is the website, not the API, so the API terms do not name it but AUP s.4 still applies. **Observed, not documented**; the codeload leg's limits are undocumented, and "not counted" is not "unlimited" (ToS H lets GitHub judge abuse). A URL that already holds a 40-character SHA needs no resolution. So the pin can come from the zipball itself and S-2's "ref to SHA" API call is likely unnecessary. Update checks do need a ref to SHA lookup (or a re-download), which is where the quota bites at scale. ToS section H (re-read in the saved page 2026-11-08): "Abuse or excessively frequent requests to GitHub via the API may result in the temporary or permanent suspension of your Account's access to the API", GitHub decides what is abuse, and "You may not share API tokens to exceed GitHub's rate limitations". Shared Workers egress also means other tenants may already have used the 60 requests of an IP. So a single Besidka-owned token for all users is a ToS risk; a per-user token for that user's own imports is not. AUP s.4 bars "excessive automated bulk activity": per-user imports capped at 10 an hour, 25 MB each, are not that. A fine-grained token already includes read access to all public repositories (PAT docs), so no repository permission needs ticking. `keys.provider` is `text NOT NULL` with an enum in TypeScript only; the table has no CHECK, and the only migration that touched `keys` is the 2025 create, so adding `'github'` to the enum needs no SQL migration (still read any generated `.sql` for `DROP TABLE` before applying; if one appears, stop). | go with changes | S-2: **amended 2026-11-13: resolve the ref to a commit SHA with one `api.github.com` call on import (a URL that already holds a 40-character SHA needs no call), then download `codeload.github.com/<owner>/<repo>/zip/<sha>`; the allowlist is exactly those two hosts, with no `github.com/.../archive/<ref>.zip` fallback and no zipball redirect, `redirect: 'manual'` and no redirect followed;** send a `User-Agent` header (the REST API answered 403 without one, own check 2026-11-08); call the REST API (`/commits`) on import and for update checks; 403 or 429 gives the existing "GitHub rate limit reached" error. Optional per-user GitHub token stored through the `keys` path (encrypted, `NUXT_ENCRYPTION_KEY`, M4) as provider `github`, labelled "GitHub (public repositories, read-only)"; copy tells the user to grant no repository permissions; never a Besidka-wide token. Measure on the preview before deciding whether the token ships in the first layer (Owner item 3) | S-2 BES-268, S-1 BES-264 |
| 5 | S-5 provider uploads: Anthropic and OpenAI | Anthropic Skills guide and overview (`platform.claude.com/docs/en/build-with-claude/skills-guide`, `.../agents-and-tools/agent-skills/overview`), ZDR page, Commercial Terms D.2 and D.4 (research `codeexec-skills.md`, accessed 2026-11-07). OpenAI Skills guide (`developers.openai.com/api/docs/guides/tools-skills`), Your data, Usage Policies, Services Agreement (same file). Own check 2026-11-08: `anthropics/skills` `claude-api/SKILL.md` | **Anthropic.** "Custom Skills are accessible to your entire workspace" and "Any API key with access to a workspace can read, use, and delete every custom Skill". Agent Skills "is not covered by ZDR arrangements". "Deleting a Skill also deletes all of its versions." Names allow no "reserved words (anthropic, claude)" (the overview page words it "Cannot contain reserved words", which supports the substring reading below). Skills run only with the code execution tool, whose container data is "retained for up to 30 days" and is not ZDR (research `codeexec-skills.md` §1.1), and its hours are billed to the user's organisation beyond a free allowance. "Agent Skills is not covered by ZDR arrangements. Skill definitions and execution data are retained according to Anthropic's standard data retention policy", so a deleted skill is still subject to that policy (re-read 2026-11-08). Docs say "Use Skills only from trusted sources: those you created yourself or obtained from Anthropic", and content scanning "doesn't cover Skills uploaded through the Skills API". With version `latest`, "a version uploaded by anyone in the workspace immediately changes what your production agents run". The docs present referencing and uploading as normal API use and state no rule against a third-party app; terms for hosted prebuilt skills are not stated (UNVERIFIED). The Commercial Terms customer is the user holding the key (BYOK); whether Besidka needs its own Anthropic agreement is a counsel point, UNVERIFIED. A real skill, `claude-api`, would be rejected by that naming rule. S-5 caches the provider reference in KV for 30 days: after expiry the provider copy is orphaned and cannot be deleted by Besidka. **OpenAI.** The guide says "Avoid product designs where consumer end-users can freely browse, select, or attach arbitrary Skills from an open catalog" and "Prevent end-user control over arbitrary Skill selection". Import-by-URL with the user attaching what they imported is that pattern, even though Besidka runs no catalog. It is developer guidance on a docs page, not binding policy: the binding texts are the Usage Policies, Services Agreement and Service Terms, and none of them mentions skills (research `codeexec-skills.md` §2.6, 2.7; re-read of the guide 2026-11-08). The Usage Policies in force are the 2025-10-29 revision; the 2026-11-20 revision adds the model-access intermediary clause (an app-wide owner item). Org or project visibility and ZDR status of uploaded OpenAI skills: not stated, UNVERIFIED. Under BYOK the user is also the developer, which softens the point, but the product still gives end users the arbitrary choice. **Why the two providers get different verdicts.** Anthropic's page carries the same kind of caution ("Use Skills only from trusted sources: those you created yourself or obtained from Anthropic", re-read 2026-11-08), so the Anthropic path is also a guidance risk, not a clean bill. It stays go-with-changes because that caution is general, not a warning against this product design; the user reviews every file first; skills run only in the user's own workspace with no network; and the disclosure, pin, delete and rename rules below apply. OpenAI's page names the design itself. If the owner wants one rule for both, the consistent alternative is Anthropic path also deferred (Owner item 1). | Anthropic: go with changes. OpenAI: no-go (v1) | S-5 ships Anthropic-only; the OpenAI inline-zip and `skills.upload` parts leave v1 (revisit criteria below). Anthropic: (a) disclosure modal before the first upload (and a line on each skill's card): the skill's files become visible to everything in the user's Anthropic workspace, are not covered by zero data retention, stay until deleted and then follow Anthropic's standard retention policy, and that running them uses the code execution tool (container data kept up to 30 days, hours billed to the user's organisation beyond the free allowance); (b) pin a concrete version, never `latest`; (c) keep the provider skill id in D1 (not a 30-day KV key) so Besidka can `DELETE /v1/skills/{id}` when the user turns "Allow scripts" off, deletes the skill or deletes the account (delete provider copies before the key is purged, best effort; if it cannot, say so and name the Console); also warn on removing the Anthropic key while uploads exist; (d) names containing `anthropic` or `claude`: the overview says names "Cannot contain" the reserved words, so read it as a substring rule: adding a prefix does not help (`bsk-claude-api` would still be rejected; no live upload was tried, UNVERIFIED); the rename must *replace* the token (for example `claude-api` becomes `bsk-c-api`, or a substitute the user confirms). The Agent Skills spec requires `name` to match the parent folder, so rename both the frontmatter `name` and the uploaded root folder (if the upload has one; the current API accepts `SKILL.md` at the root), keep the original name in `display_name` (255 characters, not unique, derived from `name` when omitted; `display_title` under the old `skills-2025-10-02` beta header), and map the container name back to the catalog name. Show a visible notice and add a change note to the uploaded `SKILL.md` (Apache-2.0 §4(b)). Licence class decides who edits: `open` skills are renamed automatically; for `none` or `custom` skills do not modify silently, ask the user to confirm the rename or to rename it themselves; `restricted` skills never reach this step; (e) keep the "Use Skills only from trusted sources" line in the modal. OpenAI revisit criteria: OpenAI documents org-scoped or per-user skill isolation, or removes the open-catalog warning, or the owner accepts the risk in writing | S-5 BES-285, S-7 BES-294 |
| 6 | Agent Skills spec licence if quoted; trademark in "Skills"/"Agent Skills" | `github.com/agentskills/agentskills` README, `GOVERNANCE.md` s.1, `docs/LICENSE`; LF Projects Trademark Policy and Terms of Use (research `licences.md`, accessed 2026-11-07) | Spec and outbound code: Apache-2.0; documentation outside the spec: CC-BY-4.0 (GOVERNANCE s.1). Project is "Agent Skills a Series of LF Projects, LLC". "Agent Skills" is not on the LF registered or pending mark lists on the Trademark Policy page as fetched. Beyond that page: UNVERIFIED (no check of Anthropic marks or registers). The word "Claude" in skill names and in provider copy belongs to Anthropic: use it only to name the provider. | go | Quoting the spec or docs in `docs/skills.md` or the UI: short quotes with attribution and a link (CC-BY-4.0 needs attribution, a licence link and a change note). Call the UI feature "Skills"; write "Agent Skills (agentskills.io)" where the standard is named; no logo; say Besidka is not affiliated with or endorsed by the Agent Skills project, LF Projects or Anthropic | S-4 BES-280, S-9 BES-316, S-7 BES-294 |
| 7 | Never public: user skills out of `/.well-known/agent-skills/` and `/llms.txt` | `docs/agent-readiness.md` (Agent Skills index, "Skills and the digest contract", "Modules"); GDPR Art. 5(1)(f) | Host skills are served from the repo directory `skills/` through the `assets:agentSkills` server-asset mount and `runtimeConfig.agentDiscoverySkills`. The module also serves an older `/.well-known/skills/index.json`. `nuxt-llms` builds `/llms.txt` from `nuxt.config.ts`. Markdown twins negotiate only the routes in `config/agent-discovery-routes.ts`, and the private prefixes `/chats`, `/profile`, `/files`, `/shared` are excluded. `/profile/skills` and `/api/v1/skills` sit under prefixes already disallowed or private. The remaining leak paths are: a shared chat that carries a skill activation, and an index builder that someday reads the database. Separately, S-1 and S-2 disagree on the R2 key (S-1 writes `skills/<userId>/...`, S-2 writes `skills/u<userId>/...`). The repo directory `skills/` (a server asset) and an R2 prefix `skills/` are different stores, so the name alone is no leak path. | go with changes | Record as invariants: (1) no route under `/.well-known/` (both skills indexes), `/llms.txt`, the sitemap, `/raw/*.md` twins, `ai-catalog.json` or the MCP server card reads a user skill; (2) skill activation and `read_skill_file` parts are stripped from shared chats like other tool parts (DPIA row 25: "tool calls are stripped"), checked by a spec; (2b) skill objects have no public or signed-URL route: they are read only through authenticated owner-checked API calls, and wide events (Axiom) carry skill ids and counts, never skill text (DPIA row 6 pattern: "Counts and ids"); (3) one R2 key shape across S-1 and S-2, with the prefix named `user-skills/` for clarity (the tickets disagree today), plus `skills-staging/` for staging. Tests: S-1 a spec that the R2 key builder never yields a path the host skills mount serves; S-3 the share serializer drops skill parts; S-6 `list_skills`, `get_skill` and the `besidka-overview` host skill never return another user's skill and the host skill documents scopes only, not content. Add the invariant to `docs/agent-readiness.md` ("Skills and the digest contract") and `docs/skills.md` | S-1 BES-264, S-3 BES-276, S-6 BES-292 |
| 8 | Personal data in skills: Art. 30 category, retention, account purge, D1 restore | GDPR Art. 5(1)(e), 14(5)(b), 30; `docs/legal/art30-record.md` (rows 7, 9, 10 as models, M6, M7); `docs/d1-restore-reconciliation.md`; `CLAUDE.md` (cascade list) | Skill files can hold names, emails and internal company data of the user and of third parties (a pasted `SKILL.md`, a team skill, an MCP-created skill). Besidka did not get it from those people: Art. 14 applies; Art. 14(5)(b) (disproportionate effort) is the usual answer, stated in the Privacy Policy with the Terms duty on other people's data. Stores: D1 rows, R2 `user-skills/`, staging objects (1 hour, hourly sweep), KV provider-reference cache. Retention until the user deletes the skill or the account; old versions pruned after an update is accepted. New D1 tables that reference `users` with `ON DELETE CASCADE` add to the blast radius in `CLAUDE.md`. R2 objects are not removed by the cascade: they need the explicit batch delete and the hourly orphan sweep. **Restore security case:** a skill deleted because it was malicious returns, and with `enabled` stored it returns enabled. | go with changes | S-1: add the new tables to the cascade list in `CLAUDE.md`; account-purge path deletes R2 `user-skills/<userId>/` and `skills-staging/` (R2 batch delete, no per-object fan-out) and, first, the provider copies (Q5). Restore runbook entry in `docs/d1-restore-reconciliation.md`: after any restore run `UPDATE skills SET enabled = 0` for rows touched in the window (or all), replay skill deletions from Axiom, and mark rows whose R2 object is gone as `broken` | S-1 BES-264, S-7 BES-294 |
| 9 | Malicious skills: DPIA measures and Terms | Ticket text for the Snyk ToxicSkills (2026-02) and Trail of Bits (2026-06) figures: **cited by the ticket, not re-fetched**. Anthropic skills guide and OpenAI skills guide (research `codeexec-skills.md`). `docs/legal/dpia.md` rows 6, 31, 36; Anthropic Usage Policy "Effective Nov 12, 2026" (upcoming) | Both providers say skill content is untrusted: OpenAI "Skill content can influence planning, tool usage, and command execution"; Anthropic: use only trusted skills. Scanners are not a boundary (ticket). DPIA row 6 already locks memory writes after any non-memory tool result: an `activate_skill` or `read_skill_file` result is third-party text and must be inside that lock. The Anthropic Usage Policy (upcoming version) lists "Create or distribute malware, ransomware, or other types of malicious code"; the user answers for what they upload to their own workspace. | go with changes | DPIA measures as built or planned: full-content review and tick before install (S-4); text-only, extension allowlist, no binaries, no `.pyc` (S-2); findings as highlights, never "safe" (S-4); the review viewer is plain monospace text with no Markdown or image rendering (no IP leak via an image URL, `compliance-review-2026-10.md` §2.2); hidden characters shown visibly; skill text framed as untrusted data (S-3); approvals for writes and spend while a skill is active (C-6); memory write lock after skill tool results, with a spec (S-3); scripts only in the provider's container with no network, behind `skills.scripts` and per-chat confirmation (S-5); new skills disabled; per-skill and per-chat toggles. Terms: no importing skills built to harm people or systems; Besidka does not review skills; Besidka may disable a skill that breaks the law or the Terms (with a statement of reasons, as the Terms already promise for removals) | S-3 BES-276, S-4 BES-280, S-7 BES-294 |
| 10 | Transfers: skill text to the chosen provider; S-5 provider store | `docs/legal-memory-sensitive-data.md` §3 and decision of 2026-10-26; `docs/legal/art30-record.md` row 4, §6.1; `docs/legal/dpia.md` rows 8, 9 | The catalog (names, descriptions) goes into every send while a skill is enabled and the full text when the model activates one: same recipient, same purpose (answering the user's message), same provider consent as chat text. No new recipient and no new Art. 49(1)(a) consent. S-5 (Anthropic only) adds a new purpose at the same provider: storage of the skill in the user's workspace; same entity, no new recipient and no new country, but it must be disclosed because Anthropic holds it until deleted. GitHub (or the host of a raw URL) receives Besidka's request, with the requested URL and, with a user token, the token as credential: a source host, not a recipient of chat data. For DeepSeek, Moonshot AI and Qwen the existing per-provider transfer consent covers skill text in a send, because it is part of the send. | go | Disclose in the Privacy Policy "Skills you import" and the S-5 modal; add GitHub and URL hosts to "Who else receives your data"; no consent-version change | S-7 BES-294, S-5 BES-285 |
| 11 | MCP scopes `skills:read` and `skills:write`, consent labels | `docs/mcp-server.md` ("Scopes", "Consent is the effective scope", `data:delete`); `docs/legal/dpia.md` rows 29, 31, 36, 37; ticket S-6 | Consent is stored by scope name and "a tool added behind a scope the user already granted reaches existing approvals with no new prompt", so new scopes are right. `skills:read` returns full third-party and possibly private text (up to 200,000 characters per file): read-class, shown as such. `create_skill` and `update_skill` from an external agent write a persistent instruction source: the writes arrive disabled, `update_skill` on an enabled skill disables it, there is no enable, no `allowScripts`, no URL import and no activation over MCP. Deletes stay under `data:delete`. The S-6 validation reuse must include the licence gate, otherwise an agent can push a restricted skill past it. | go with changes | S-6: run the Q2 licence classifier inside the shared validation used by `create_skill` and `update_skill`; consent labels say what is read ("See your skills and their full text") and that writes are saved disabled; `skills:write` unticked by default; the scope list in the Privacy Policy and `besidka-overview` stay in step (`shared/utils/mcp-oauth-scopes.ts`); DPIA row for an injected agent installing instructions; the major version bump is as the ticket states (not re-verified against `docs/mcp-server.md`) | S-6 BES-292, S-7 BES-294 |
| 12 | Breach runbook: R2 `user-skills/`, optional GitHub token | `docs/legal/breach-runbook.md` §2.2, §2.5, §3 rows 2 and 5 | New rows needed. R2 prefix exposed: like row 5 (random ids lower but do not remove discovery; skills may hold third-party and company data). GitHub token leaked: revoke at GitHub, delete the `keys` row; token is public-read-only, so low harm, but it identifies the user; if `NUXT_ENCRYPTION_KEY` also leaked, treat as plaintext (row 3 logic). Stolen session installed or enabled a skill: disable every skill of that user, delete provider copies where a key is held, then the sessions steps. Anthropic skill copies in a user's workspace sit with the provider, not Besidka: tell the user to delete them in the Anthropic Console if the key was exposed. | go with changes | Add the three containment rows and the Art. 30 reference | S-7 BES-294 (runbook rows) |

## Licence classifier (S-2, `shared/utils/skills/licence.ts`)

Runs on every source and on `create_skill` and `update_skill` over MCP. Returns
`{ class, text, matched }`. The steps run in this order.

1. **Resolve.** Read `LICENSE*`, `COPYING*` and `NOTICE*` in the skill folder.
   Only if the folder has none, walk up to the repository root. The `license`
   field in `SKILL.md` is a hint, never the source of a decision to allow.
2. **Normalise.** CRLF to LF, trim, SHA-256. Hash the fixture files, not git
   blob ids.
3. **Known restrictive text.** The whole file hashes to the old Anthropic
   text (`aeebbce5340433ffe11573d0dab76f753526b908183d7bb31a5fe551607a2f17`):
   `restricted`.
4. **Restriction phrases**, on the whole text including any tail:
   "ADDITIONAL RESTRICTIONS"; "Notwithstanding anything in the Agreement";
   "all rights reserved" together with wording that forbids copying,
   derivative works or transfer, or limits use to a named service ("only
   within", "inside the Services"). "All rights reserved" alone must not
   block: it sits in many MIT copyright lines. A hit gives `restricted` and
   the text is shown. A legitimate licence caught by mistake is released by an
   owner-maintained exception list (hash of the text), because a heuristic is
   not infallible.
5. **Known open text.** Whole-file hashes are too narrow: the three Apache-2.0
   variants in `anthropics/skills` are 11,357 bytes (appendix unfilled),
   11,345 bytes (appendix with "Copyright 2026 Anthropic, PBC.") and 10,174
   bytes (`frontend-design`, no appendix), and only one would match a
   whole-file hash. Their text up to the line `END OF TERMS AND CONDITIONS` is
   identical (own check 2026-11-08; normalised SHA-256 of that head
   `7fb46adff9025f553b882b84ce593c37008d1e83019e4fdd6b21f8c800d0c485`). So for
   Apache-2.0: hash the head. The tail must be empty or the standard appendix
   with a single copyright line. Any other tail is not matched (class `custom`
   at best, and step 4 has already run on it, so an Apache header with
   restrictions appended cannot pass). For MIT, BSD and other short texts: mask
   the copyright line, then compare the body. Each shipped text is read in full
   before it goes on the list. A match with no phrase hit gives `open`.
6. **Field only.** No licence file and the field names a known permissive SPDX
   id: `open`, with the note "licence named, no file". The field says
   "Proprietary" or "All rights reserved" and there is no file: `restricted`
   (nothing grants any right). Any other field text: `custom`.
7. **Licence file that matched nothing:** `custom`.
8. **Disagreement.** The file is open but the field says "Proprietary": `custom`,
   both shown, extra tick. The field names an open licence but the file is
   restricted: `restricted` (the stricter reading wins).
9. **Nothing at all:** `none`.

Fixtures: the old `LICENSE.txt` (at `ef740771ac`, and the `document-skills/`
copy at `b118d29ea4`); the current Apache text; the 11,345-byte and 10,174-byte
Apache variants; an MIT skill; a skill with no licence (`doc-coauthoring` has
neither a `LICENSE.txt` nor a `license` field, own check 2026-11-08); a
skill whose field says "Proprietary" and has no file; an Apache header with
restrictions appended.

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR (Art. 30, DPIA, Art. 6 basis, Art. 9, Art. 49 transfers) | New Art. 30 activity (skills, row 10b) and DPIA rows. Basis: contract, Art. 6(1)(b), at the user's request; the optional GitHub token is a stored credential (M4). Art. 9: skill text can carry special-category data like any text, covered by the existing chat consent when it is sent; no new consent. Art. 14(5)(b) for third parties named in skills. Art. 49: no new consent (Q10). | S-7 writes rows (input list below). No change to `CURRENT_CONSENT_VERSION` |
| 2. Public documents (Privacy, Terms, Cookie Policy) | Privacy Policy: new section "Skills you import", recipients table, retention, scope list. Terms: right-to-use promise, licence-restricted import blocked, Besidka may disable, `Your content` licence list gets a skills item, reporting routes name skills. Cookie Policy: no change (no new cookie or storage). | S-7 |
| 3. Notification mechanics (WP260 materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION`) | Material by the `docs/legal.md` checklist: a new restriction on users in the Terms and, with S-5, a new purpose at the provider. GitHub and URL hosts see only the requested URL and Besidka's egress IP (and the user's own GitHub token, if saved). They hold no chat or skill content, but the Privacy Policy will list them under "Who else receives your data", and the checklist item "a new recipient, provider or processor" is then arguably met too, so do not rest the case on calling them non-recipients. The rule says "When unsure, treat it as material". See the S-7 input list. | One `LEGAL_NOTICES` entry |
| 4. `compliance-review-2026-10.md` items | Age gate: no change. IP leaks §2.2: the review viewer renders plain text only; the Worker fetches GitHub from Besidka's egress, not the user's IP. DSA §3.1: private storage, hosting at most, voluntary notice route extended to skills (Q1); add one sentence. AI Act §3.2: no new generated-content marking; skill-influenced output is ordinary model output. TCO §3.3: no public dissemination, so not engaged. Breach runbook: Q12. | Add the DSA sentence in S-7 |
| 5. Third-party terms and licences | Anthropic skills licence changed 2026-11-06 (Q2). Anthropic Skills API: workspace-wide, no ZDR (Q5). OpenAI: guidance against arbitrary user skills (Q5). GitHub ToS, AUP, rate limits (Q4). Agent Skills spec Apache-2.0 and CC-BY-4.0 (Q6). Apache-2.0 §4 duties are met by storing `LICENSE`/`NOTICE` verbatim and not redistributing. App-wide (not track-specific, unchanged): Gemini consumer-use clause; OpenAI 3.3(g) and the 2026-11-20 intermediary clause. | S-2, S-4, S-5 changes above |
| 6. Monetisation guard | No paid skills, no store, no sharing: unchanged. A skill under a non-commercial licence is a concern only if Besidka ever earns; warn on it now. | Add `NonCommercial` marker; re-check in `docs/legal/monetisation-readiness.md` if that changes |
| 7. Accessibility (WCAG 2.2 AA target from P0-14) | Review screen and diff must not rely on colour alone: the update diff in S-4 marks changes with `text-success`/`text-error` only (WCAG 1.4.1), and findings use a background highlight only. File tree, findings list "scroll to line" and the full-screen sheet need keyboard operation and managed focus (2.1.1, 2.4.3); toggles and checkboxes need 24 by 24 px targets (2.5.8); hidden characters are shown as text (`⟨U+202E⟩`), which helps; errors name the cause (3.3.1). | S-4 acceptance edits below |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| S-8 | BES-315 | Replace the Decisions line "Anthropic's document skills are proprietary" with: "Until 2026-11-06 the docx, pdf, pptx and xlsx skills carried a proprietary licence; they are now Apache-2.0. Copies from older commits carry the old text and are blocked by licence content. 'Never bundle or preset' stays as an owner choice, not a legal need." |
| S-1 | BES-264 | AC: skills tables added to the cascade list in `CLAUDE.md` and to `docs/d1-restore-reconciliation.md` (set `enabled = 0` for skills touched in the restore window; mark rows with a missing R2 object `broken`). AC: one R2 key shape, prefix `user-skills/` for clarity (S-1 writes `skills/<userId>/`, S-2 writes `skills/u<userId>/`: pick one), plus `skills-staging/`. AC: a spec that no host-skills route (`/.well-known/agent-skills/`, `/.well-known/skills/`) can serve a user skill key. AC: store the provider skill id and `provider_deleted_at` for S-5. AC: licence columns: `licenseField`, `licenseClass` (`open`, `custom`, `none`, `restricted`), `licenseFileSha256`, `licenseClassifierVersion`. AC: if `keys.provider` gains `github`, read the generated SQL for `DROP TABLE` first. |
| S-2 | BES-268 | AC: licence classifier (`shared/utils/skills/licence.ts`) implements the nine steps in "Licence classifier" (restrictive-text hash, restriction phrases on the whole text, Apache head hash, field-only rules, disagreement rule) and returns `{ class, text, matched }`; imports of class `restricted` are rejected on all sources with the block message from Q2; the `license` field alone never allows. AC: fixtures as listed there (old Anthropic text incl. the `document-skills/` copy, Apache in its three shapes, MIT, no licence, "Proprietary" field with no file, Apache header with restrictions appended). AC: when the owner adds a restrictive hash or phrase, stored skills are re-classified and a newly `restricted` one is disabled. AC: `LICENSE`/`NOTICE` files stored verbatim. AC (amended 2026-11-13): GitHub import resolves the ref to a commit SHA with one `api.github.com` call (or takes a 40-character URL SHA), downloads `codeload.github.com/<owner>/<repo>/zip/<sha>` with a `User-Agent`, allows exactly those two hosts with `redirect: 'manual'` and no redirect followed, and calls the REST API for update checks too, with the optional per-user token when present (provider `github`, public read-only). AC: never a Besidka-owned token. |
| S-3 | BES-276 | AC: `activate_skill` and `read_skill_file` results engage the memory write lock (DPIA row 6) and are dropped from shared chats; a spec for each. |
| S-4 | BES-280 | AC: review screen shows licence class, the first lines of the licence file, the raw `license` field as plain text and `compatibility`; wording as in Q3; "No licence stated" needs the extra tick. AC: the update diff marks lines with `+` and `-` and a text label, not colour alone; findings carry a text marker. AC: the viewer is plain monospace text, no Markdown or image rendering. AC: card shows "Provider copy: stored in your Anthropic workspace" with a remove action once S-5 uploads. Remove "proprietary" wording from the page note; the link to the built-in Anthropic document skills stays (D-8). |
| S-5 | BES-285 | AC: Anthropic only in v1; OpenAI inline and uploaded skills removed (NO-GO; revisit criteria in Q5). AC: disclosure modal text (workspace visibility, no ZDR, retained until deleted and then under Anthropic's retention policy, code execution container data kept up to 30 days and billed to the user's organisation beyond the free allowance, "use only trusted skills"). AC: pinned version, never `latest`. AC: provider skill id persisted in D1; the provider copy is deleted when scripts are turned off, the skill is deleted, or the account is deleted (before the key is purged); removing the Anthropic key warns about live uploads. AC: names containing `anthropic` or `claude` have the token replaced (read the rule as a substring rule, so a prefix does not clear it: `claude-api` becomes `bsk-c-api`), in both the frontmatter `name` and the uploaded root folder if there is one; original name kept in `display_name` (`display_title` under the old beta header); change note in the uploaded `SKILL.md`; visible message; automatic for `open` skills, user-confirmed for `none` and `custom`. |
| S-6 | BES-292 | AC: `create_skill` and `update_skill` run the licence classifier and return a clear error for `restricted`. AC: consent labels as in Q11. AC: DPIA row for an agent installing instructions maps to this ticket. |
| S-7 | BES-294 | Replace the Decisions line "Anthropic's document skills are proprietary and must never be bundled" with the Q2 wording. Replace "likely non-material" with the recommendation in the input list below. Add the licence-gate, GitHub, workspace-visibility and DSM Art. 17 reasoning. |
| D-8 | BES-301 | Context line says the document skills are "proprietary": reword as Apache-2.0 since 2026-11-06 (hosted prebuilt terms UNVERIFIED); referencing prebuilt ids on the user's key stays. |
| P0-14 | BES-303 | `docs/legal/agentic-capabilities-precheck.md`: add this file as the "Phase 4c: Skills" section (S-8 requires it). |
| S-9 | BES-316 | Launch content never calls a skill "safe"; names the licence block; no claim of affiliation with the Agent Skills project or Anthropic; `/llms.txt` and host skill text stay about Besidka, not user skills. |

## Input list for S-7 (BES-294)

- **Art. 30 rows:** new row 10b "Skills (user-imported instructions)". Purpose:
  let the user's chosen model follow instructions the user imported. Basis:
  contract, Art. 6(1)(b), at the user's request. Data subjects: users; third
  parties named in skill files. Categories: skill text and file names, source
  URL, commit SHA, licence field and class, enable state, activation parts in
  chats, MCP client id for MCP-created skills; optional GitHub token (encrypted,
  row 2 pattern). Recipients: the chat's provider or gateway on each send
  (independent controller, user's own account); Cloudflare (processor); with
  S-5, Anthropic's skills store in the user's workspace; GitHub or the host of
  a raw URL (receives the request and URL, plus the token if the user saved
  one). Transfers: as the provider (row 4); GitHub: United States, UNVERIFIED
  like Brave and Exa. Retention: until deletion of the skill or account;
  old versions pruned; staging objects one hour; provider copies until deleted
  (S-5). Security: M1, M3, M4, M6, M7 plus the review gate. Also add GitHub to
  the recipient table in section 6.
- **DPIA rows (next free numbers):** (1) malicious skill steers the model to
  exfiltrate or act (S-3 framing, C-6 approvals, memory lock, S-4 review,
  residual medium); (2) hidden instructions and padding (S-2 findings, S-4 plain
  viewer); (3) scripts (provider container, no network, opt-in, per-chat
  confirm; Anthropic only); (4) licence or copyright breach by an import
  (private storage, licence gate, Terms clause, reporting route; residual:
  heuristic); (5) provider workspace visibility, no ZDR and retention of
  uploaded skills (S-5 disclosure, deletion on disable and delete); (6) a
  restore revives a deleted malicious skill, enabled (reconciliation entry);
  (7) an injected agent installs instructions over MCP (disabled-by-default,
  review); (8) GitHub token held (encrypted, public-read-only, revoke).
  Section 3: a new "3.x Skills" description. Section 6 residual: licence
  detection is heuristic; scanner bypasses are known (ticket, not re-fetched).
- **Privacy Policy paragraphs:** section "Skills you import" (what is stored,
  private, never shared or listed; when sent to the provider: catalog on each
  send while enabled, full text when the model activates one, same provider as
  the chat; MCP-created skills arrive disabled; deletion). Subsection "Importing
  from GitHub or a link": the Worker fetches the URL you give, the host sees
  Besidka's server, not you; optional GitHub token, encrypted, public repos
  only, remove any time. Subsection "Scripts and your provider account" (S-5):
  files are stored in your Anthropic workspace, visible to everyone with access
  to it, not covered by zero data retention, kept until deleted; Besidka asks
  Anthropic to delete them when you turn scripts off or delete the skill or the
  account. "Who else receives your data": add GitHub and URL hosts. "How long I
  keep things": add the skills row. Connected apps scope list: `skills:read`,
  `skills:write`. Backups line already covers D1.
- **Terms of Use paragraphs:** (a) `Your content` licence list: a new item for
  storing imported skills, sending their catalog and text to your provider, and
  (S-5) uploading them to your provider account. (b) New section "Skills":
  import only skills you have the right to use; Besidka blocks skills whose
  licence forbids copying or use outside a named service and cannot judge every
  licence, so the choice stays yours; Besidka does not review skills for safety
  or legality; skills run as instructions to the model at your risk; scripts
  run only in your own provider account; Besidka may disable a skill that
  breaks the law or these Terms and sends a statement of reasons; no sharing,
  no marketplace. (c) "What you may not do": skills built to harm people or
  systems. (d) "Reporting illegal content" and "Copyright complaints": name
  skills as reportable stored content. Record the reasoning: skills are private
  hosting, no public dissemination, DSM Art. 17 not engaged (Art. 2(6)
  exclusion for cloud services for the user's own content), no US agent
  designated (decision 2026-10-28).
- **AI Act / DSA records:** AI Act Art. 50: no change. DSA: one sentence in
  `compliance-review-2026-10.md` §3.1 that skills are private storage, hosting
  at most, covered by the voluntary notice route.
- **Materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION` expectation:** the
  coordinator's "likely non-material" does not fit the project checklist.
  Departure and reason: `docs/legal.md` lists "new obligations or restrictions
  on users" (the Terms right-to-use promise, the block and the disable power),
  and, with S-5, "a new purpose" as material. GitHub and URL hosts hold no chat or skill
  content, but the Privacy Policy will list them as recipients of the request,
  so the "new recipient" item is arguably met as well; the case does not rest
  on it. The checklist also says to treat unsure cases as material. Recommend
  **material**,
  one `LEGAL_NOTICES` entry (documents: Privacy Policy and Terms) published
  before `skills` leaves `internal`, covering the whole track including S-5
  text if S-5 ships in the same window; if S-5 ships later, add the S-5 part
  to the same entry only if it has not yet been published, else a second entry.
  Minimum notice 30 days. `CURRENT_CONSENT_VERSION` unchanged: no new Art. 9
  consent text and no new Art. 49 transfer consent. Run `pnpm run legal:hash`.

## Owner items

1. **OpenAI path of S-5.** Options: (a) no-go for v1, Anthropic-only
   (recommended: OpenAI names this pattern as one to avoid and the downside is
   an account or policy issue on the user's key); (b) ship OpenAI inline-zip
   only for skills the user wrote or pasted themselves. Recommendation: (a);
   revisit when OpenAI documents skill isolation. Note for the owner: both
   providers publish guidance, not binding policy, against untrusted skills.
   Anthropic's is a general caution and OpenAI's names this product design,
   which is why the verdicts differ (Q5). The consistent alternative is to
   defer S-5 for both providers; the text-only skills runtime (S-1 to S-4) is
   unaffected.
2. **No-licence skills.** Options: (a) warn plus an extra "I have the right to
   use this skill" tick (recommended: many useful skills have no licence, the
   copy is private, the user is responsible); (b) block. Recommendation: (a).
3. **GitHub token timing.** Options: (a) ship the importer with the
   unauthenticated path only (the `api.github.com` SHA call and the codeload download), measure on the preview, add the optional per-user token in
   the same stack only if quota errors appear or update checks need it
   (recommended); (b) ship the token slot with the first layer. Never a
   Besidka-wide token (ToS section H risk). Recommendation: (a); the token is
   close to certain to be needed for update checks at scale.
4. **Launch timing and notice.** Options: (a) one `LEGAL_NOTICES` entry at the
   point `skills` leaves `internal` (recommended); (b) skip the notice while
   skills stay on for a few named users only. Recommendation: (a), because any
   widening of access needs the 30-day notice anyway and the text must be live
   before then.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| anthropics/skills relicence commit `2c5958ecac` (PR #2146) | https://api.github.com/repos/anthropics/skills/commits/2c5958ecac | commit 2026-11-06T22:32:28Z | 2026-11-07 |
| Old proprietary `LICENSE.txt` (commit `ef740771ac`, 2025-12-01; same bytes at `b118d29ea4`, 2025-10-16, path `document-skills/docx/`) | https://raw.githubusercontent.com/anthropics/skills/ef740771ac/skills/docx/LICENSE.txt ; https://raw.githubusercontent.com/anthropics/skills/b118d29ea4/document-skills/docx/LICENSE.txt | none shown | 2026-11-07 ; 2026-11-08 (own check) |
| Own check: `SKILL.md` `license` line before and after the relicence (commit API file patches; raw `SKILL.md` at `ef740771ac` and `2c5958ecac`) | https://api.github.com/repos/anthropics/skills/commits/2c5958ecac | commit 2026-11-06T22:32:28Z | 2026-11-08 (own check) |
| Own check: `frontend-design/LICENSE.txt`, `doc-coauthoring/SKILL.md` | https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt ; .../skills/doc-coauthoring/SKILL.md | none shown | 2026-11-08 (own check) |
| Current docx licence and README | https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/LICENSE.txt ; https://raw.githubusercontent.com/anthropics/skills/main/README.md | none shown | 2026-11-07 |
| Old README (`f458cee31a`) | https://raw.githubusercontent.com/anthropics/skills/f458cee31a/README.md | 2026-05-09 (commit) | 2026-11-07 |
| Own check: `docx` and `claude-api` `SKILL.md` frontmatter | https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/SKILL.md ; .../skills/claude-api/SKILL.md | none shown | 2026-11-08 (own check) |
| Agent Skills specification | https://agentskills.io/specification | none shown | 2026-11-08 (own check) |
| Agent Skills repo: README, `GOVERNANCE.md`, `docs/LICENSE` | https://github.com/agentskills/agentskills ; https://raw.githubusercontent.com/agentskills/agentskills/main/GOVERNANCE.md | none shown | 2026-11-07 |
| LF Projects Trademark Policy and Terms of Use | https://lfprojects.org/policies/trademark-policy/ ; https://lfprojects.org/policies/terms-of-use/ | none shown | 2026-11-07 |
| GitHub Terms of Service (D.5, D.8, H) | https://docs.github.com/en/site-policy/github-terms/github-terms-of-service | effective 2026-04-27 | 2026-11-07 |
| GitHub Acceptable Use Policies (s.4, s.7) | https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies | none shown | 2026-11-07 |
| GitHub REST rate limits | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | none shown | 2026-11-07 |
| GitHub zipball docs | https://docs.github.com/en/rest/repos/contents | none shown | 2026-11-07 |
| GitHub fine-grained PAT docs | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens | none shown | 2026-11-07 |
| Own check: zipball of `octocat/Hello-World` (302 headers, archive comment; 75-request burst; `github.com/<owner>/<repo>/archive/<ref>.zip` route; 403 without `User-Agent`) | https://api.github.com/repos/octocat/Hello-World/zipball/master ; https://github.com/octocat/Hello-World/archive/master.zip | n/a | 2026-11-08 (own check) |
| Anthropic Skills guide and overview | https://platform.claude.com/docs/en/build-with-claude/skills-guide ; https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview | none shown | 2026-11-07 |
| Anthropic API and data retention (ZDR table) | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention | none shown | 2026-11-07 |
| Anthropic Commercial Terms (D.2, D.4) | https://www.anthropic.com/legal/commercial-terms | effective 2025-06-17 | 2026-11-07 |
| Anthropic Usage Policy (upcoming version) | https://www.anthropic.com/legal/aup | effective 2026-11-12 | 2026-11-07 |
| OpenAI Skills guide | https://developers.openai.com/api/docs/guides/tools-skills | none shown | 2026-11-07 |
| OpenAI Your data | https://developers.openai.com/api/docs/guides/your-data | none shown | 2026-11-07 |
| OpenAI Usage Policies (in force 2025-10-29; upcoming 2026-11-20) | https://openai.com/policies/usage-policies/ | see text | 2026-11-07 |
| DSA, Regulation (EU) 2022/2065 (Arts. 3, 6, 16, 17, 18, 19; recitals 13, 14) | https://eur-lex.europa.eu/eli/reg/2022/2065/oj | OJ 2022 | 2026-11-07 |
| DSM Directive (EU) 2019/790, Art. 2(6), Art. 17(1) | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790 | OJ 17.5.2019 | 2026-11-08 (own check) |
| Polish DSA implementing act, Dz.U. 2026 poz. 1296 | https://api.sejm.gov.pl/eli/acts/DU/2026/1296 | published 2026-10-06 | 2026-11-07 |
| Polish copyright act (art. 23 wording not read) | https://api.sejm.gov.pl/eli/acts/DU/2025/24 | consolidated 2025 | 2026-11-07 |
| Repo: `docs/agent-readiness.md`, `docs/mcp-server.md`, `docs/legal.md`, `docs/legal/dpia.md`, `docs/legal/art30-record.md`, `docs/legal/breach-runbook.md`, `docs/legal/compliance-review-2026-10.md`, `docs/legal-memory-sensitive-data.md`, `docs/d1-restore-reconciliation.md`, `content/legal/terms-of-use.md`, `server/db/schemas/keys.ts`, `app/utils/knowledge-zip.ts` | repo | n/a | 2026-11-08 |

## Unverified

- Whether the 2026-11-06 Apache-2.0 relicence reaches copies taken earlier
  (legal point). Settled by counsel or an Anthropic statement; the draft treats
  old copies as restricted.
- Terms of Anthropic's hosted prebuilt skills, and any rule on third-party
  apps referencing or uploading skills. Settled by an Anthropic statement or
  the Service Specific Terms; D-8 owns the prebuilt-id side.
- Whether Besidka needs its own Anthropic agreement under BYOK (counsel).
- OpenAI uploaded-skill visibility and ZDR status, and OpenAI's `/v1/skills`
  terms.
- Whether the GitHub zipball, archive and `codeload.github.com` downloads are
  free of rate limits at volume: single requests (research and own check) and a
  75-request burst of the redirect step (own check 2026-11-08, from one IP) show
  no core-quota use and the SHA in the archive comment. The codeload download
  leg was not run at volume, and none of this is documented. Settled by a burst
  test from the preview Worker, which has shared egress IPs.
- Whether Anthropic's reserved-word rule is a substring rule (the overview says
  names "Cannot contain" `anthropic` or `claude`; no live upload was tried).
  Settled by one test upload on a throwaway key.
- Polish copyright act art. 23 wording (personal use), as in the research.
- Snyk ToxicSkills and Trail of Bits figures: cited by the ticket, not
  re-fetched.
- The Anthropic Usage Policy quoted in Q9 is the upcoming version (effective
  2026-11-12); the text in force today was not fetched (research addendum B).
  Settled by fetching the prior revision.
- Licence of third-party bundled code inside individual skills (not audited).
  The classifier reads only the licence file of the skill folder or repository
  root; a script with its own licence inside a skill is not detected.
- Licences of other skill repositories (for example OpenAI's curated skills:
  `openai/skills` has no `LICENSE` at `main` on raw access, own check
  2026-11-08, repository licence not otherwise checked).
- "Agent Skills" trademark status outside the LF Projects page; Anthropic's
  marks.
- Whether GitHub is a transfer to the United States for Art. 30 purposes
  (UNVERIFIED like Brave and Exa in row 5).
- The MCP major-version rule as the ticket states it (not re-checked in
  `docs/mcp-server.md`).

## Addendum 2026-11-13: authoring, versions and commands

> Engineer-drafted, not lawyer-reviewed. This addendum amends the verdict and
> the S-7 input list above for the S-0 amendment of `docs/skills.md`
> (2026-11-13). Where it and the text above disagree, this addendum wins. It
> does not re-run the sources; the open points under "Unverified" still stand.
> Sharing by link (S-13) is **not** covered here: it needs its own addendum
> (S-8b) first.

### What changed in the design

The first release is no longer "imports only". The owner took the plan's
defaults on 2026-11-13 and asked for four things in writing: add a skill by
archive (`.zip` or `.skill`), add one by GitHub link, separate MCP actions to
create, edit, delete and rename skills, and optional sharing.

| Area | Before | Now |
| --- | --- | --- |
| Sources | GitHub, link, zip, paste, MCP | The same, plus writing a skill in the app and Besidka's own templates. The raw-link import moves out of the first release (S-2U, waits for C-3) |
| Licence class | `open`, `custom`, `none`, `restricted` | Adds `authored`, assigned only by the editor and templates, never by an import |
| Enabled state | Every new skill and every update starts disabled | A skill created in the app is saved enabled. Imports, updates, MCP writes, MCP renames and share copies stay disabled until the user enables them in the app |
| Versions | 2 kept, old versions pruned after an accepted update | Every save, rename, restore or import creates a version; up to 20 are kept (`SKILL_VERSIONS_KEPT`) |
| Commands | none | A command is a skill the user runs with `/name` (two user-set columns, `model_invocable` and `slash_command`) |
| MCP | list, get, create, update, delete | Adds `rename_skill`; the name `skills:share` is reserved in the docs only; MCP version 4.0.0 |
| GitHub fetch | `safeFetch` (C-3) | A narrow allowlisted fetcher (S-2G), not C-3-dependent. The allowlist is exactly `api.github.com`, which resolves the ref to a commit SHA (one call on import) and runs update checks, and `codeload.github.com`, which downloads `/<owner>/<repo>/zip/<sha>`. No `github.com` archive fallback, no zipball redirect, no redirect followed |
| Updates | A staged update, old versions pruned after accept | A pending version is persisted (a `skill_versions` row, its blobs and `skills.pending_version`), not staged. Staging in KV and R2 (1 h) exists only for the import preview of a new skill. Accept takes `{ version }` and creates a new version row with the next number over the same blobs, so `current_version` only increases; reject deletes the pending rows |
| Tool approvals while a skill is active | The C-6 approval card | The interim rule until C-6 ships: no tool is added by a skill, spending tools are offered only when the user picked them for that message, and `generate_image` is limited to one call per send |

### Answers to the five conflicts

1. **The licence gate on every source versus authoring.** The gate exists to
   stop Besidka storing third-party text it holds no right to. Text the user
   typed in the app, or took from Besidka's own template, raises no such issue.
   It gets class `authored` and no right-to-use tick, and the Terms promise
   covers "create, paste or import". A licence file the user adds still goes
   through the classifier, so a restricted licence text still blocks the save.
   A pasted `SKILL.md` is an import: it keeps class `none` and its tick, and
   an import can never produce `authored`.
2. **"New skills disabled" as a DPIA measure (Q9, `docs/skills.md` section 2,
   item 4).** The measure was written against third-party text and an injected
   agent. It still applies to imports, updates, MCP writes, MCP renames and
   share copies. It no longer applies to a skill the user creates in the app,
   because the user wrote it. An in-app save or rename keeps the current
   enabled state. The injection risk of an enabled, user-written skill is
   handled by the same measures as any skill: the text is wrapped and framed as
   untrusted, the memory write lock is engaged, and the interim tool rule
   applies. DPIA row 1 (a malicious skill steers the model) therefore names the
   interim rule as its measure until C-6 ships.
3. **Retention: "old versions pruned after an update is accepted" (Q8).** It
   becomes: up to 20 versions are kept per skill, and a pending version
   (persisted as a `skill_versions` row, not staged) is never pruned. Rejecting
   it deletes its rows. Older versions are deleted, and blobs no remaining version
   references are deleted with them. Art. 30 row 10b and the Privacy Policy
   "How long I keep things" row say "up to 20 versions" instead of "old
   versions pruned". Deleting a skill or the account removes all versions.
4. **"Plain text everywhere".** Kept. The editor's preview, called Model view,
   shows plain monospace text exactly as the model receives it and renders no
   Markdown, so no image URL leaks the viewer's IP and no text can hide. No
   amendment is needed.
5. **"Never public".** Commands comply. The invocation part
   (`data-skill-invocation`) is removed from shared chats, the visible text
   holds only the user's arguments, and the shared view shows a neutral
   "(private command)". Sharing by link (S-13) is the only real reversal. It is
   optional, comes last, and is gated by its own addendum, its own Art. 30 and
   DPIA rows, and a separate material `LEGAL_NOTICES` entry.

### Commands add no new recipient and no new purpose

An invocation is the same send to the same provider as an activation: the
user's own text and the skill body go to the chat's provider, on the user's
key, when the user presses Send. The picker, the chip, "Use in new chat", the
manager and every MCP tool make no model call. So Q10 stands unchanged: no new
recipient, no new Art. 49(1)(a) consent and no new consent version.
`CURRENT_CONSENT_VERSION` stays unchanged. `LEGAL_NOTICES` stays at **one entry
for the phase** (material, published at least 30 days before `skills` leaves
`internal`), plus one more entry for S-13 if it ships.

### Changes to the S-7 input list

S-7 is re-scoped to `docs(legal): skills and commands`. It stays a plain PR that
runs in parallel with the stack. Add these to the input list above.

- **Art. 30 row 10b** reads "Skills (user-created or imported instructions)".
  The purpose is to let the user's chosen model follow instructions the user
  created or imported. Categories add the source kinds `editor` and
  `template`, the version history (up to 20 versions with a note of up to 200
  characters), the licence class `authored`, and the command settings
  (`model_invocable`, `slash_command`, `argument_hint`). Retention reads "up to
  20 versions", not "old versions pruned". Recipients and transfers are
  unchanged. GitHub receives the requests for a GitHub import (the ref lookup at
  `api.github.com` and the download at `codeload.github.com`, and the lookup
  again on each update check); the fetch is limited to exactly those two hosts.
- **DPIA rows.** Add one row for **authored text** (stored privately, sent to
  the provider on the user's key, enabled on save with no licence tick;
  measures: the same wrapping, memory lock and interim rule). Add one
  row for **commands** (an invocation puts a skill body into the latest user
  turn; one invocation per message; a part that is private and removed from
  shares; the name cannot be probed because every failure answers one generic
  error; an agent cannot rename a skill into an active command name without the
  user, because `rename_skill` disables the skill and sets `needs-review`).
  Section 3 of the DPIA gets "authoring and commands" in the "3.x Skills"
  description.
- **Terms of Use.** The right-to-use promise reads "create, paste or import".
  The "no sharing, no marketplace" line stays until S-13 ships, and S-13
  changes it.
- **Privacy Policy.** The retention row says "up to 20 versions" instead of
  "old versions pruned".
- **Breach-runbook rows**, as listed in `docs/skills.md` section 13.

### Owner decisions recorded on 2026-11-13

1. Sharing is built later as the last optional stack (authored and open skills
   only, signed-in viewers, 7 days by default and 30 at most, with its own
   legal notice). The name `skills:share` is reserved in the docs only; S-6
   does not register a scope with no tools. It joins 4.0.0 if S-13 is ready
   before S-6 merges, and otherwise ships with S-13 as its own major bump
   (coordinator decision, 2026-11-13).
2. Skills authored in the app are saved enabled with no licence tick (class
   `authored`). Imports, updates, MCP writes and share copies stay disabled
   until the user enables them in the app.
3. The runtime (S-3 and S-12) ships before C-6, with the interim rule above.
