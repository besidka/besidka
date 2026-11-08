# Skills design (Phase 4c)

Status: **design, 2026-11-08.** Not built. This document is the source of
truth for the skills track: S-1 (BES-264) to S-6 (BES-292) implement it, and
C-1 (BES-233) wrote it. Where a ticket body and this document disagree, this
document wins; section 13 lists every ticket that has to change. The legal
reasoning (licence gate, never-public invariant, S-5 provider verdicts) is in
the compliance pre-check `docs/legal/prechecks/skills.md` (S-8, BES-315,
PR #739). The shared approval model and the outbound URL rules are in
`docs/connectors.md`; the flag rules are in `docs/feature-flags.md` (lands
with P0-1, PR #732).

A **skill** is a folder of instructions (`SKILL.md` plus optional reference
files and scripts) in the open Agent Skills format. A user imports one from
GitHub, a link, a zip or pasted text; the model sees a short catalog of the
user's enabled skills and loads one when the task calls for it. Skills are
third-party instruction text, so the whole design treats them like software
the user installs: pinned, reviewed in full, disabled until the user enables
them, and never trusted to override the user or Besidka's rules.

## Contents

1. [Agent Skills format](#1-agent-skills-format)
2. [Decisions](#2-decisions)
3. [Import, pinning and archive rules](#3-import-pinning-and-archive-rules)
4. [Licence gate](#4-licence-gate)
5. [Runtime](#5-runtime)
6. [Threat model](#6-threat-model)
7. [Scripts in provider containers (S-5)](#7-scripts-in-provider-containers-s-5)
8. [Data model](#8-data-model)
9. [Limits](#9-limits)
10. [UI placement and review](#10-ui-placement-and-review)
11. [MCP exposure](#11-mcp-exposure)
12. [Never public](#12-never-public)
13. [Ticket changes](#13-ticket-changes)
14. [SDK verification](#14-sdk-verification)
15. [Rejected alternatives](#15-rejected-alternatives)
16. [Revisit criteria](#16-revisit-criteria)
17. [Open questions](#17-open-questions)

## 1. Agent Skills format

Summary of the Agent Skills specification ("Agent Skills (agentskills.io)",
an LF Projects series; spec Apache-2.0, other docs CC-BY-4.0; Besidka is not
affiliated with or endorsed by the Agent Skills project, LF Projects or
Anthropic). The UI calls the feature "Skills".

A skill is a directory whose root holds `SKILL.md`: YAML frontmatter, then a
Markdown body.

| Field | Rule in the spec | Besidka |
| --- | --- | --- |
| `name` | Required, 1 to 64 characters, lowercase letters, digits and hyphens, no leading, trailing or double hyphen, equal to the folder name | Required, `^[a-z0-9]+(-[a-z0-9]+)*$`, 1 to 64; invalid rejects. A folder-name mismatch is a **warning**, the frontmatter `name` wins |
| `description` | Required, 1 to 1,024 characters | Required; longer is cut to 1,024 with a warning |
| `license` | Optional, a licence name or a reference to a bundled file | Shown as plain text; a hint for the licence gate, never a reason to allow (section 4) |
| `compatibility` | Optional, at most 500 characters (environment, intended product) | Shown, at most 500; never read as a licence |
| `metadata` | Optional string map | Non-string values stringified with a warning |
| `allowed-tools` | Optional, experimental | Informational only ("requested tools, not granted"); never grants a tool |

Optional folders: `scripts/` (executable code), `references/` (docs loaded on
demand, one level deep), `assets/` (templates, data). The spec recommends a
body under about 5,000 tokens and 500 lines; about 100 tokens per skill of
metadata are always in context. YAML is parsed leniently (host guide), safety
rules are strict.

Host behaviour taken from the spec's client guide
(`agentskills.io/client-implementation/adding-skills-support.md`): an
`activate_skill` tool whose `name` is an enum of enabled skills, skill content
wrapped in tags, resources listed without reading them, activations protected
from history compaction, duplicate activations collapsed, untrusted skills
gated, and no skill tool registered when no skill is enabled.

## 2. Decisions

Binding for S-1 to S-6. **(pre-check)** marks a decision from
`docs/legal/prechecks/skills.md`; **(this doc)** marks one that settles a
disagreement between tickets and is listed in section 13.

1. **User imports only.** No marketplace, no presets, no sharing, no public
   listing.
2. **Pinned and immutable.** A GitHub import is pinned to a 40-character
   commit SHA; other sources to `sha256-<first 16 hex>` of the content. Never
   auto-updated. An update is an explicit check, a diff, a review and an
   accept.
3. **Text only.** Extension allowlist plus strict UTF-8; no binaries, no
   `.pyc`, no symlinks.
4. **Disabled until enabled in the app.** Imports, updates, MCP-created and
   MCP-updated skills all start disabled.
5. **Scanners are not a boundary.** Besidka highlights links, commands and
   hidden characters for the user's review; it never calls a skill "safe".
6. **Licence gate on every source (pre-check).** The licence **file** at the
   pinned commit decides, through the classifier in section 4; the `license`
   field alone never allows. Restricted skills are blocked with no override.
7. **Anthropic's document skills (docx, pdf, pptx, xlsx) are Apache-2.0 since
   2026-11-06 (pre-check).** Copies pinned before commit `2c5958ec` carry the
   old proprietary licence and are blocked by licence content, not by path or
   date. Not bundling or presetting them is an owner choice, not a legal need;
   the built-in ids stay reachable on the user's own Anthropic key (D-8).
8. **Skill text is untrusted instructions.** Wrapped as `<skill_content>`,
   with a system rule that skills guide how to do the user's task and cannot
   override the user, Besidka's rules, or ask for secrets. While a skill is
   active, every tool not marked read-only asks for approval even when set to
   "Always allow" (`docs/connectors.md` section 7.1, rule F1).
9. **Plain text everywhere (this doc).** Skill files are shown as plain
   monospace text in the review screen, the file viewer and the chat side
   panel. No Markdown rendering, no images (an image URL in a skill would leak
   the viewer's IP and could hide text).
10. **Scripts never run in Besidka.** Only in a provider container on the
    user's own key, behind `skills.scripts`, a Labs opt-in, a per-skill toggle
    and a per-chat confirmation. **Anthropic only in v1 (coordinator decision,
    2026-11-08)**; the OpenAI path is not built.
11. **Never public (pre-check).** No user skill content, name or activation
    reaches a public route or a shared chat (section 12).
12. **New MCP scopes `skills:read` and `skills:write`.** Writes arrive
    disabled; deletes stay on `data:delete`, because skills are user content
    (unlike connectors, see `docs/connectors.md` section 2, item 11).
13. **No new nav pill slots.** Profile tab, Search popup row, "+" menu section,
    context panel "Used" section.

Feature flags (registered by S-1 at stage `internal`, `default: false`,
`allowRoles: ['admin']`):

| Flag | Gates | `spend` |
| --- | --- | --- |
| `skills` | Page, tab, Search row, routes, "+" menu section, runtime | `none` (the catalog and bodies are tokens of the user's normal send) |
| `skills.import-url` | GitHub and link imports (zip and paste work without it) | `none` |
| `skills.scripts` | Provider-container execution (section 7), Labs opt-in | `foreground`, so `optIn: 'required'` |

## 3. Import, pinning and archive rules

### 3.1 Sources

| Source | How | Version |
| --- | --- | --- |
| GitHub URL `github.com/<owner>/<repo>[/tree\|blob/<ref>/<path>]` | One download of `https://github.com/<owner>/<repo>/archive/<ref>.zip` (redirects to `codeload.github.com`), through `safeFetch` purpose `skills-github` (section 4.2 of `docs/connectors.md`) with a `User-Agent`. The SHA comes from the zip's archive comment (GitHub writes the full 40-character SHA there) or from the URL when it already holds one. No REST API call on import | Commit SHA |
| Link to a raw `SKILL.md` | One `safeFetch` (purpose `skills-url`, at most 256 KiB, `text/*`). Folder name from the URL path's parent segment | `sha256-<16 hex>` of the content |
| Upload `.zip` or `.skill` | At most 5 MiB compressed; unzipped in a browser worker for the preview, then the **original archive** is uploaded and the server re-inflates it with hard limits | `sha256-<16 hex>` of the archive |
| Paste | `SKILL.md` text only (`POST /api/v1/skills/import/text`) | `sha256-<16 hex>` of the text |
| MCP `create_skill` | Files as text (section 11) | `sha256-<16 hex>` of the canonical file set |

GitHub's unauthenticated REST limit is 60 requests an hour per IP, shared
across Workers egress. Observed on 2026-11-08 (pre-check Q4, not
documented): the archive download does not count against that quota. The REST
API (`GET /repos/{owner}/{repo}/commits/{ref}` with
`Accept: application/vnd.github.sha`) is used only for update checks. A 403 or
429 gives "GitHub rate limit reached" with the fix "Try again in an hour or
upload a zip". A per-user GitHub token (`keys.provider = 'github'`, public
read-only, encrypted) is **not** in the first layer: S-2 measures on the
preview first (pre-check owner item 3). Never a Besidka-wide token (GitHub
Terms section H). A connector's GitHub PAT is never reused for imports
(different purpose and consent).

### 3.2 Archive rules

Client (`app/workers/skill-import.ts`, reusing `readZipSummary` from
`app/utils/knowledge-zip.ts`) and server
(`server/utils/skills/import/zip.ts`, `fflate` streaming `Unzip` with per-entry
and total counters that abort mid-stream) apply the same rules; the server
never trusts the client's result.

- Reject: zip64, more entries than `SKILL_MAX_FILES`, total uncompressed
  over `SKILL_MAX_TOTAL_BYTES`, an entry over `SKILL_MAX_FILE_BYTES`, a
  compression ratio over 100:1, symlink entries (external attributes
  `0xA000`), absolute paths (`/`, `C:\`), `..` segments, backslashes, NUL and
  control characters, a path over 200 characters or deeper than 6 levels.
- Skip silently: directories, `__MACOSX/`, `.DS_Store`.
- Extension allowlist: `.md .txt .json .yaml .yml .toml .csv .py .js .ts .sh
  .ps1 .rb .go .html .css .xml .sql .ini .cfg .tex`, plus `LICENSE`,
  `LICENCE`, `COPYING` and `NOTICE` with or without an extension. Denylist:
  `.pyc .so .dll .exe .bin .class .jar .wasm`. Any file that fails
  `TextDecoder('utf-8', { fatal: true })` is rejected.
- Paths are NFC-normalised. The skill root is one top-level folder that holds
  `SKILL.md`, or `SKILL.md` at the archive root. Two candidate roots reject.
- GitHub archives inflate only entries under the requested path.

### 3.3 Findings

`scanSkillText(path, text)` (`shared/utils/skills/findings.ts`) returns
highlights, never a verdict:

- URLs (http, https, IP addresses);
- shell patterns: `curl`, `wget`, `| sh`, `bash -c`, `rm -rf`, `sudo`,
  `chmod +x`, `eval`, `base64 -d`, `pip install`, `npm i`, `powershell -enc`;
- bidi, zero-width and format characters U+202A to U+202E, U+2066 to U+2069,
  U+200B to U+200F, U+FEFF (shown visibly as `⟨U+202E⟩`);
- lines over 2,000 characters and runs of more than 50 blank lines (padding
  that hides text below the fold);
- injection phrasing ("ignore previous", "system prompt");
- references to secrets (`API_KEY`, `.env`, `~/.ssh`).

### 3.4 Staging, commit and update

1. `POST /api/v1/skills/import/preview` (multipart `file` or JSON `{ url }`)
   validates, classifies the licence, scans, and stages: manifest in KV
   `skills:stage:<stageId>` (1 h), files in R2
   `user-skills-staging/u<userId>/<stageId>/<path>` (1 h, plus the hourly
   sweep). Returns the frontmatter, file list, `SKILL.md`, findings, warnings
   and licence class.
2. `POST /api/v1/skills/import/commit` `{ stageId, acknowledged: true }` (and,
   for class `none` or `custom`, `licenceAcknowledged: true`) moves the files to
   `user-skills/u<userId>/<skillPublicId>/<version>/<path>` and creates the
   row with `enabled=false`, `status='ready'`.
3. `POST /api/v1/skills/[id]/update/check` re-resolves the ref (REST call) or
   re-fetches the link. Unchanged: `{ upToDate: true }`. Changed: staged as
   `pendingVersion` with a per-file diff (at most 2,000 lines), new findings and
   any licence change.
4. `POST /api/v1/skills/[id]/update/accept` `{ stageId, acknowledged: true }`
   promotes the pending version, disables the skill, and prunes versions beyond
   `SKILL_VERSIONS_KEPT`.

A name collision at commit answers 409 "A skill named X exists: replace as an
update?", handled as steps 3 and 4. Rate limit: 10 imports per hour per user;
at most `SKILLS_PER_USER` skills.

### 3.5 R2 layout

| Prefix | Content | Lifetime |
| --- | --- | --- |
| `user-skills/u<userId>/<skillPublicId>/<version>/<path>` | Committed files, `contentType` `text/*`, `customMetadata.sha256` | Until the skill, the version (pruned) or the account is deleted |
| `user-skills-staging/u<userId>/<stageId>/<path>` | Staged files | 1 h, swept hourly |

The `user-` prefix keeps user content visibly apart from the repository's
host skills directory `skills/` (served at `/.well-known/agent-skills/`
through the `assets:agentSkills` server-asset mount). The `u<userId>` segment
matches `knowledge/u<userId>/`, so the account purge reuses the same
list-by-prefix and batch-delete code (`storage.delete(keys)`, at most 1,000
keys per call). Reads go through `readSkillFile`, which checks ownership in D1
first; there is no public or signed-URL route to these objects.

## 4. Licence gate

`shared/utils/skills/licence.ts` (S-2) runs on every source, on update and on
MCP `create_skill` and `update_skill`, and returns
`{ class, text, matched }`. Steps, in order (from the pre-check):

1. **Resolve.** Read `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*` in the
   skill folder; only if there are none, the repository root (GitHub imports).
2. **Normalise.** CRLF to LF, trim, SHA-256.
3. **Known restrictive text.** The whole file hashes to the old Anthropic text
   (`aeebbce5340433ffe11573d0dab76f753526b908183d7bb31a5fe551607a2f17`):
   `restricted`.
4. **Restriction phrases** on the whole text: "ADDITIONAL RESTRICTIONS";
   "Notwithstanding anything in the Agreement"; "all rights reserved" together
   with wording that forbids copying, derivative works or transfer, or limits
   use to a named service ("only within", "inside the Services"). "All rights
   reserved" alone does not block. A hit: `restricted`. False positives are
   released by an owner-maintained exception list of text hashes.
5. **Known open text.** Apache-2.0: SHA-256 of the text up to
   `END OF TERMS AND CONDITIONS` equals
   `7fb46adff9025f553b882b84ce593c37008d1e83019e4fdd6b21f8c800d0c485`, and the
   tail is empty or the standard appendix with one copyright line. MIT, BSD
   and similar: mask the copyright line, compare the body. A match with no
   phrase hit: `open`.
6. **Field only** (no licence file): a known permissive SPDX id gives `open`
   ("licence named, no file"); "Proprietary" or "All rights reserved" gives
   `restricted`; anything else `custom`.
7. **A licence file that matched nothing:** `custom`.
8. **Disagreement:** open file but "Proprietary" field gives `custom` (both
   shown); open field but restricted file gives `restricted`. The stricter
   reading wins.
9. **Nothing at all:** `none`.

| Class | What happens |
| --- | --- |
| `restricted` | Blocked on every source, no user override. Anthropic case message: "This copy carries Anthropic's earlier proprietary licence. Anthropic moved these skills to Apache-2.0 on 2026-11-06. Import the current version, or use the built-in Anthropic skill on your own Anthropic key." |
| `open` | Allowed. SPDX badge and "Licence file: LICENSE.txt (view)". `LICENSE` and `NOTICE` stored verbatim (Apache-2.0 section 4) |
| `custom` | Allowed after the user reads the licence and ticks the review box: "Custom licence. Read it before you install." |
| `none` | Allowed with an extra tick "I have the right to use this skill": "No licence stated. The author keeps all rights by default. Besidka keeps a private copy for you only. Install it only if you have the right to use it." |

A licence containing `NonCommercial` shows a warning (monetisation guard).
When the owner adds a restrictive hash or phrase, stored skills are
re-classified (`licenseClassifierVersion` bump) and a newly `restricted` skill
is disabled with a notice. The classifier reads only the skill's licence file;
third-party code bundled inside a skill with its own licence is not detected
(stated limit).

Fixtures (`tests/fixtures/skills/`): the old Anthropic `LICENSE.txt` at
`ef740771ac` and the `document-skills/` copy at `b118d29ea4`; the current
Apache text and its 11,345-byte and 10,174-byte variants; an MIT skill; a
skill with no licence (`doc-coauthoring`); a "Proprietary" field with no file;
an Apache header with restrictions appended.

## 5. Runtime

S-3 wires skills into `server/api/v1/chats/[slug]/index.post.ts` after the
knowledge tools, only when the `skills` flag is on and the chat has at least
one enabled skill.

### 5.1 Selection

Optional body field `skillIds: z.array(z.string().max(64)).max(20).optional()`
(a new field; `chatToolSchema` is not widened). Ownership and `enabled` are
verified and the choice is stored in `skill_chat_settings`; an omitted field
means the stored per-chat state. At most 20 enabled skills per chat.

### 5.2 Catalog

`buildSkillCatalog({ skills, budgetTokens: 1500, family })`
(`server/utils/skills/runtime/catalog.ts`) builds an `<available_skills>`
block of `- name: description` lines sorted by name. Tokens are estimated with
`KNOWLEDGE_CHARS_PER_TOKEN` (`shared/utils/project-knowledge-policy.ts`; Latin
versus Cyrillic, see "Cyrillic multiplier" in `docs/memory-architecture.md`).
Over budget: descriptions shortened to their first sentence, then names only
with "(+N more; call activate_skill with an exact name)". The catalog goes in
the stable prefix of `buildChatInstructions` after the knowledge block, so it
caches with the prompt (`docs/providers/general.md`). No catalog and no tools
when the chat has no enabled skill, and no catalog when tool calling is off
for the message.

### 5.3 Tools

`getSkillTools({ db, userId, chatPublicId, enabledSkills, guard, logger })`
(`server/utils/skills/runtime/tools.ts`), both tools marked
`withFollowUpTurn()`, with a `skillSteps` budget of 4 in `resolveToolLoop`:

- `activate_skill({ name: z.enum(enabledNames) })` loads the current
  version's `SKILL.md` body (frontmatter stripped) through `readSkillFile`,
  cut at 40 KiB with a notice that the rest is readable with
  `read_skill_file`. Returns
  `<skill_content name="…" source="…" version="…">…</skill_content>` and a
  `<skill_resources>` list (path, bytes, kind; scripts marked "text only, not
  executable here"). A second activation in the same chat returns "Already
  active; content is in context" without the body. Sets
  `guard.untrustedResultSeen = true`. Emits a `data-skill-activation` part
  `{ skillId, name, version, activatedAt }`.
- `read_skill_file({ skill: z.enum(enabledNames), path: z.string().max(200) })`
  normalises the path, requires it in `skill_files` for the current version,
  returns text cut at 64 KiB with a notice, and sets the guard. Screened with
  `screenTextsForInjection` (`server/utils/search/injection-screening.ts`) only
  when the user has a TypeSafe AI key and the toggle on, as for knowledge.

Both results engage the memory write lock (DPIA row 6), are stripped from
later model context by the text-only sanitizer, and never feed memory
extraction or chat search.

### 5.4 Activation persistence and re-injection

The text-only history sanitizer (`docs/chats/model-switch-context.md`,
`sanitizeMessagesForModelContext`) drops tool parts, so an activation would be
forgotten on the next send or after a model switch. `reinject.ts` collects the
chat's `data-skill-activation` parts on every send (owned, still-enabled skills
only; a deleted or disabled skill gets a one-line notice instead), loads the
bodies of their **current** versions, and adds an `<active_skills>` block,
newest first, capped at 12,000 tokens (Cyrillic-aware). The block sits after
the catalog and before the date clauses. When tool calling is off (image
mode), already-active skills are still injected and the catalog is omitted.

`data-skill-activation` counts as a meaningful part only alongside text
(`app/composables/chat.ts`), and is registered in
`shared/utils/message-metadata.ts` and
`server/utils/chats/persist-user-message.ts`. Branching keeps the data part;
re-injection works only for a branching user who owns the skill.

## 6. Threat model

| # | Threat | Attacker | Mitigation | Ticket |
| --- | --- | --- | --- | --- |
| K1 | Malicious instructions that steer the model to exfiltrate data or act (Snyk ToxicSkills, 2026-02: 36.82% of 3,984 public skills flawed, 13.4% critical) | Skill author | Full-content review before install with a required tick; skill text wrapped and framed as untrusted; F1 forced approvals for every tool not marked read-only while a skill is active; memory write lock; disabled by default; per-skill and per-chat toggles | S-3, S-4, C-6 |
| K2 | Scanner bypass (Trail of Bits, 2026-06: newline padding, `.pyc`, prompts aimed at LLM analysers) | Skill author | Scanners are not a boundary: findings are highlights; padding and long lines are findings themselves; `.pyc` and binaries rejected; no LLM judges a skill | S-2, S-4 |
| K3 | Hidden text: bidi overrides, zero-width characters, padding below the fold | Skill author | Hidden characters shown as `⟨U+…⟩`; plain monospace viewer, no Markdown rendering; line and blank-run findings | S-2, S-4 |
| K4 | Silent update that turns a reviewed skill malicious | Repository owner | Pinned SHA, never auto-updated; update = diff + new findings + licence change + review + accept, and the skill is disabled again | S-2, S-4 |
| K5 | Archive attacks: zip slip, symlinks, zip bombs, zip64, huge entries | Skill author | Section 3.2 rules on client and server, streaming inflate with abort | S-2 |
| K6 | YAML attacks: alias expansion ("billion laughs"), huge frontmatter | Skill author | `yaml` with `maxAliasCount: 0`, size cap, or a minimal frontmatter splitter | S-2 |
| K7 | Scripts executing arbitrary code | Skill author | Never in Besidka; only in the user's own provider container with no network, behind flag, opt-in, per-skill toggle and per-chat confirmation | S-5 |
| K8 | SSRF through import URLs | Malicious user | `safeFetch` purposes `skills-github` and `skills-url` (`docs/connectors.md` section 4) | C-3, S-2 |
| K9 | Licence or copyright breach by an import | User | Licence gate on every source; restricted blocked; private storage only; Terms right-to-use promise and disable power (S-7) | S-2, S-7 |
| K10 | Injected agent installs instructions over MCP | Agent with `skills:write` | Created and updated skills are disabled with status `needs-review`; no enable, no `allowScripts`, no URL import, no activation over MCP; licence gate runs | S-6 |
| K11 | Skill content leaks to the public | Bug | Never-public invariant with specs (section 12) | S-1, S-3, S-6 |
| K12 | D1 restore revives a deleted malicious skill, enabled | Operator restore | `docs/d1-restore-reconciliation.md`: `UPDATE skills SET enabled = 0` for rows touched in the window (or all), replay deletions from Axiom, mark rows whose R2 object is gone `broken` | S-1 |
| K13 | Provider-side copy outlives the user's intent | n/a | Provider skill id stored in D1; the copy is deleted when scripts are turned off, the skill or the account is deleted, before the key is purged | S-5 |
| K14 | Cross-connector exfiltration triggered by a skill | Skill author | `docs/connectors.md` rule F2 applies regardless of skills | C-6 |

## 7. Scripts in provider containers (S-5)

Anthropic only in v1. The OpenAI path (inline zip or uploaded skills in the
shell tool) is **not built**: OpenAI's own skills guide says to avoid product
designs where end users attach arbitrary skills (pre-check Q5).

Applies when all hold: direct Anthropic model on the user's own Anthropic key
(never a gateway, never a Besidka key); the D-7 code-execution tool is
available for the model; `skills.scripts` is on with an active Labs opt-in;
the skill has a `scripts/` folder and its "Allow scripts in provider
containers" toggle is on; the skill is enabled for the chat.

1. **Disclosure before the first upload** (modal, and one line on the skill
   card afterwards): the files become visible to everything in the user's
   Anthropic workspace; Agent Skills is not covered by zero data retention;
   files stay until deleted and then follow Anthropic's standard retention;
   running them uses the code execution tool (container data kept up to 30
   days, hours billed to the user's organisation beyond the free allowance of
   1,550 container-hours a month, then $0.05 an hour with a 5-minute minimum);
   "Use Skills only from trusted sources".
2. **Upload** with `uploadSkill({ api: anthropic.skills(), files, displayTitle })`
   using the decrypted key (`useDecryptText`, never stored elsewhere). At most
   20 skills per request and 30 MB per skill. Pin the returned version, never
   `latest`.
3. **Reserved words.** Anthropic skill names cannot contain `anthropic` or
   `claude`; read it as a substring rule. The token is replaced, not prefixed
   (`claude-api` becomes `bsk-c-api`), in the frontmatter `name` and the root
   folder; the original name goes into `display_title`; a change note is added
   to the uploaded `SKILL.md` (Apache-2.0 section 4(b)) and shown to the user.
   Automatic for `open` skills, user-confirmed for `none` and `custom`;
   `restricted` never gets here.
4. **Store** `provider_skill_id`, `provider_skill_version` and
   `provider_uploaded_name` on the `skills` row (D1, not KV). Re-upload when the
   Besidka version changes or the provider answers not-found.
5. **Send**: `providerOptions.anthropic.container.skills = [{ type: 'custom', skillId, version }]`
   plus D-7's code execution tool; `activate_skill` stays.
6. **Per-chat confirmation**: the first script run in a chat shows a C-6 style
   card "Run scripts from <skill> in Anthropic's container on your key?",
   remembered for the chat.
7. **Outputs**: D-7's adapter downloads produced files with the user's key and
   stores them with `persistFile` (`originProvider`, `originModel`); stdout in
   `ChatCodeExecution.vue`; cost accounted like
   `server/utils/ai/external-search-cost.ts`.
8. **Delete**: `DELETE /v1/skills/{id}` on the user's key when "Allow scripts"
   is turned off, the skill is deleted, or the account is deleted (before the
   key is purged), then `provider_deleted_at`. If it fails, say so and point
   to the Anthropic Console. Removing the Anthropic key while uploads exist
   shows a warning listing them.

The "+" menu shows a `badge badge-soft` "scripts" on such a skill, or the muted
note "Scripts need a Claude model with code execution".

## 8. Data model

All in `server/db/schemas/skills.ts`, exported from `server/db/schema.ts`. One
migration in S-1 with only `CREATE TABLE` and `CREATE INDEX`. Defaults in
application code. **No foreign key to `users` and no cascade to `chats`
(this doc, same rule as `docs/connectors.md` section 8):** `purgeUserData`
deletes the rows and the R2 prefixes explicitly, and the purge coverage spec
fails when a table with a `user_id` is missed. Activations are message parts,
not a table.

### 8.1 `skills`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `user_id` | integer, not null | |
| `name` | text | unique per user |
| `description` | text | at most 1,024 |
| `license_field` | text, null | raw `license` frontmatter |
| `license_class` | text | `open`, `custom`, `none`, `restricted` |
| `license_file_sha256` | text, null | |
| `license_classifier_version` | integer | |
| `compatibility` | text, null | at most 500 |
| `metadata` | json, null | string map |
| `allowed_tools` | json, null | informational |
| `source_kind` | text | `github`, `url`, `zip`, `text` |
| `source_url` | text, null | |
| `source_ref` | text, null | requested ref (branch or tag) |
| `current_version` | text | SHA or `sha256-<16 hex>` |
| `pending_version` | text, null | update awaiting review |
| `sha256` | text | of the current file set |
| `files_count`, `bytes` | integer | |
| `enabled` | integer (bool) | false on create and on every update |
| `allow_scripts` | integer (bool) | S-5, default false |
| `status` | text | `ready`, `needs-review`, `broken` |
| `created_via` | text | `app`, `mcp` |
| `created_by_client_id` | text, null | MCP client id |
| `provider_skill_id` | text, null | S-5 |
| `provider_skill_version` | text, null | S-5 |
| `provider_uploaded_name` | text, null | S-5 (renamed name) |
| `provider_deleted_at` | timestamp, null | S-5 |
| `created_at`, `updated_at` | timestamps | |

Indexes: unique (`user_id`, `name`); (`user_id`, `updated_at`).

### 8.2 `skill_files`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer, autoincrement | |
| `skill_id` | text | |
| `user_id` | integer | |
| `version` | text | |
| `path` | text | normalised relative path |
| `r2_key` | text | |
| `bytes` | integer | |
| `sha256` | text | |
| `kind` | text | `skill-md`, `reference`, `script`, `asset`, `licence`, `other` |

Unique (`skill_id`, `version`, `path`); index (`user_id`).

### 8.3 `skill_chat_settings`

`id`, `user_id`, `chat_public_id` (text), `skill_id`, `enabled`, timestamps.
Unique (`chat_public_id`, `skill_id`). Deleted by the chat-deletion cleanup.

### 8.4 KV keys

| Key | TTL | Content |
| --- | --- | --- |
| `skills:stage:<stageId>` | 1 h | staged manifest |

### 8.5 Status transitions

| Event | `status` | `enabled` |
| --- | --- | --- |
| App import committed (after review) | `ready` | false |
| MCP `create_skill` | `needs-review` | false |
| Update staged (app check or MCP `update_skill`) | `needs-review` (pending version set) | false |
| Update accepted in the app | `ready` | false until the user enables |
| R2 object missing on read, or after a restore | `broken` | false |
| Licence re-classified as `restricted` | `broken` with a licence notice | false |

## 9. Limits

Constants in `shared/utils/skills-policy.ts` (S-1).

| Constant | Value | Used by |
| --- | --- | --- |
| `SKILL_MAX_FILES` | 200 | S-2 |
| `SKILL_MAX_TOTAL_BYTES` | 5 MiB uncompressed | S-2 |
| `SKILL_MAX_FILE_BYTES` | 1 MiB | S-2, S-4 |
| `SKILL_MAX_SKILL_MD_BYTES` | 256 KiB | S-2 |
| `SKILL_MAX_UPLOAD_BYTES` | 5 MiB compressed | S-2 |
| `SKILL_MAX_GITHUB_ARCHIVE_BYTES` | 25 MiB compressed | S-2 |
| `SKILL_MAX_RAW_URL_BYTES` | 256 KiB | S-2 |
| `SKILL_MAX_RATIO` | 100:1 | S-2 |
| `SKILL_MAX_PATH_LENGTH` | 200 | S-2, S-3 |
| `SKILL_MAX_PATH_DEPTH` | 6 | S-2 |
| `SKILLS_PER_USER` | 50 | S-2, S-6 |
| `SKILL_VERSIONS_KEPT` | 2 | S-2 |
| `SKILL_IMPORTS_PER_HOUR` | 10 per user | S-2 |
| `SKILL_STAGE_TTL` | 1 h | S-2 |
| `SKILL_DIFF_MAX_LINES` | 2,000 | S-2, S-4 |
| `SKILL_FINDING_LONG_LINE` | 2,000 characters | S-2 |
| `SKILL_FINDING_BLANK_RUN` | 50 lines | S-2 |
| `SKILLS_ENABLED_PER_CHAT` | 20 | S-3 |
| `SKILL_CATALOG_BUDGET_TOKENS` | 1,500 | S-3 |
| `SKILL_ACTIVATE_MAX_BYTES` | 40 KiB | S-3 |
| `SKILL_READ_FILE_MAX_BYTES` | 64 KiB | S-3 |
| `SKILL_ACTIVE_BLOCK_MAX_TOKENS` | 12,000 | S-3 |
| `SKILL_STEPS_PER_TURN` | 4 | S-3 |
| `SKILL_VIEWER_FILE_MAX_BYTES` | 1 MiB (`GET /api/v1/skills/[id]/files`) | S-4 |
| `SKILL_MCP_FILES_MAX` | 50 per `create_skill` or `update_skill` | S-6 |
| `SKILL_MCP_FILE_MAX_CHARS` | 200,000 | S-6 |
| `SKILL_MCP_TOTAL_MAX_BYTES` | 400 KiB (under the 512 KiB `MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES`) | S-6 |
| `SKILL_MCP_DELETE_BATCH` | 20 | S-6 |
| `SKILL_PROVIDER_UPLOAD_MAX_BYTES` | 30 MB (Anthropic) | S-5 |
| `SKILL_PROVIDER_SKILLS_PER_REQUEST` | 20 (Anthropic) | S-5 |

The 40 KiB activation cap is below the 256 KiB `SKILL.md` cap on purpose: a
large `SKILL.md` stays importable, and the model reads the rest in 64 KiB
pages through `read_skill_file`.

## 10. UI placement and review

| Place | What | Ticket |
| --- | --- | --- |
| Profile tab | `{ to: '/profile/skills', label: 'Skills', icon: 'lucide:sparkles' }` after Connectors, flag-gated | S-4 |
| Search popup | Settings row `search-option-skills`, same icon and label, flag-gated, id in `tests/unit/components/Search/Modal.spec.ts` | S-4 |
| User dropdown | Nothing | S-4 |
| "+" menu | Section "Skills" in `ToolsMenu/Content.vue`: `ToggleRow` per enabled skill (name, description tooltip), revealed only when the user has at least one enabled skill; `ActionRow` "Manage skills"; tile "N skills" | S-3 |
| Chat bubble | `Chat/SkillActivation.vue` chip (`badge badge-soft` with `lucide:sparkles`); click opens the P0-11 `UiSidePanel` with `SKILL.md` as **plain monospace text**, version, short SHA, source, "Manage skills" | S-3 |
| Context panel | "Used → Skills" (name, activation count, version) from `data-skill-activation` parts, owner view only | S-3 |
| Labs | `skills.scripts` opt-in with the cost note | S-5 |

Skills page (`app/pages/profile/skills.vue`, components in
`app/components/Profile/Skills/`): header "Skills teach the model how to do a
task your way. They are instructions written by others, so review them like
software you install."; "Import skill" (dialog
`modal modal-bottom sm:modal-middle js-skill-import-modal`, tabs GitHub · Link
to SKILL.md · Upload · Paste; GitHub and Link hidden without
`skills.import-url`).

Review screen (required before install and before accepting an update;
`max-w-5xl h-[85vh]` on desktop, full-screen sheet on mobile):

- Top: name, description, source (owner/repo/path with the short SHA, the
  link, or "Uploaded file"), licence class badge with the first lines of the
  licence file, the raw `license` field as plain text, `compatibility`, and
  `allowed-tools` as "requested tools, not granted".
- `alert alert-warning` "Installing a skill is like installing software. Only
  continue if you trust its author." plus finding counts by type, and the line
  "Besidka highlights links and commands so you can review them. It cannot tell
  whether a skill is safe."
- File tree (`menu menu-sm`, a `select` on mobile) and a plain monospace
  viewer with line numbers, a wrap toggle, findings marked with a background
  and a text marker (not colour alone), hidden characters shown as
  `⟨U+…⟩`.
- Footer: required checkbox "I reviewed this skill" (plus "I have the right to
  use this skill" for class `none`), "Install (disabled)", "Cancel".

Update diff: per-file unified diff with `+` and `-` markers and a text label,
not colour alone; new findings and licence changes called out; "Accept
update" disables the skill again.

Skill card: name, description, source and pinned SHA, licence badge, files and
bytes, "Added by <client>" for MCP-created skills, status badge, enable toggle
(the first enable shows a one-time confirmation), menu (View content, Check for
updates, Download as zip, Delete), and with S-5 "Allow scripts in provider
containers" and "Provider copy: stored in your Anthropic workspace" with a
remove action.

Tab-row width: see `docs/connectors.md` section 10 (eight tabs with Labs and
Connectors; fallback "Integrations").

## 11. MCP exposure

New scopes `skills:read` (read class) and `skills:write` (write class,
unticked by default). Labels: "See your skills and their full text" and "Add
or replace skills (saved switched off for your review)". Deletes stay on
`data:delete`.

| Tool | Scope | Annotations | Input | Output |
| --- | --- | --- | --- | --- |
| `list_skills` | `skills:read` | `readOnlyHint` | `{ cursor?, limit? ≤ 50 }` | `[{ id, name, description, enabled, status, licenseClass, sourceKind, sourceUrl?, sourceRef?, version, filesCount, bytes, createdVia, updatedAt }]` |
| `get_skill` | `skills:read` | `readOnlyHint` | `{ id, includeFiles?, path? }` | metadata and file list; with `path` the file text (at most 200,000 characters, `truncated` flag) |
| `create_skill` | `skills:write` | none | `{ files: [{ path, content ≤ 200,000 chars }] ≤ 50, total ≤ 400 KiB }`, must include `SKILL.md` | `{ id, name, enabled: false, status: 'needs-review', licenseClass, findings: [{ type, path, line }], reviewUrl }` |
| `update_skill` | `skills:write` | `destructiveHint` (replaces content) | `{ id, files: [...] }` (full replacement set) | pending version, `enabled: false`, `findings`, `reviewUrl`, `diffSummary` |
| `delete_skills` | `data:delete` | `destructiveHint` | `{ ids ≤ 20, confirm: z.literal(true) }` | `{ deleted, notFound }` |

Rules: files as text only, no URLs, no binaries; the same validation as the
app (`parseSkillMarkdown`, `normaliseSkillPath`, `scanSkillText`, the licence
classifier, which rejects `restricted` with a clear error); never enable,
never `allowScripts`, no activation or run tool; `update_skill` stages a
pending version, disables the skill and sets `needs-review`; `get_skill`
returns only the caller's own skills. Descriptions end with
`Requires signing in (<scope>).`; create and update add "The skill is saved
switched off. The user must review and enable it in Besidka at <reviewUrl>."
Logic in `server/utils/mcp/private/skills.ts`. Bookkeeping as for connectors:
`DESTRUCTIVE_TOOLS` gains `update_skill` and `delete_skills`, scope lists,
labels, `pnpm run mcp:surface`, a major `MCP_SERVER_VERSION` bump (ideally one
release together with `connectors:*`).

"What MCP does not do (and why)" additions (S-6): no enabling a skill, no
script permission, no URL or GitHub import, no activation. Why: a skill is a
persistent instruction source, and an injected agent must never switch one
on. **Revisit when** a confirm-in-app pending state exists that an agent cannot
complete.

## 12. Never public

Invariants, each with a spec:

1. No route under `/.well-known/` (`/.well-known/agent-skills/` and the legacy
   `/.well-known/skills/` index), `/llms.txt`, the sitemap, `/raw/*.md` twins,
   `ai-catalog.json` or the MCP server card reads a user skill. The host skills
   in the repository's `skills/` directory stay about Besidka. S-1 spec: the R2
   key builder never yields a path the host skills mount serves.
2. Shared chats carry nothing from a user skill: `activate_skill` and
   `read_skill_file` tool parts are stripped like all tool parts, and
   `filterPublicParts` also drops `data-skill-activation` parts **(this doc)**.
   The shared context panel shows no skills section. S-3 spec: no skill name
   or body text in the shared payload.
3. Skill objects have no public or signed-URL route; reads are authenticated
   and owner-checked in D1.
4. Axiom wide events carry skill ids and counts only (`attributes.skills`),
   never skill text or names.
5. MCP never returns another user's skill (S-6 spec); the `besidka-overview`
   host skill documents scopes, not content.

`docs/agent-readiness.md` ("Skills and the digest contract") gets a pointer
to this section in S-1.

## 13. Ticket changes

| Ticket | Change |
| --- | --- |
| BES-231 (parent) | R2 layout is `user-skills/u<userId>/…`; folder-name mismatch is a warning, long descriptions are cut with a warning; "proprietary document skills" wording replaced by section 2 item 7; OpenAI scripts path not built |
| S-1 BES-264 | No FK to `users` on any skills table (explicit purge plus the coverage spec), so no `CLAUDE.md` cascade-list change; R2 prefixes `user-skills/u<userId>/` and `user-skills-staging/u<userId>/`; licence columns; S-5 provider columns on `skills` (not KV, not a separate table); `skill_files.kind` gains `licence`; status transitions of section 8.5 |
| S-2 BES-268 | GitHub import through the archive URL with the SHA from the archive comment, REST only for update checks, no token in the first layer; licence classifier on every source; `licenceAcknowledged` for `none` and `custom`; staging prefix `user-skills-staging/` |
| S-3 BES-276 | Side panel shows `SKILL.md` as plain monospace text (not rendered Markdown); `data-skill-activation` stripped from shares, no "Used skill" chip on shared pages; activation cut at 40 KiB points to `read_skill_file`; memory write lock spec |
| S-4 BES-280 | Licence class and wording of section 4; extra tick for `none`; plain-text viewer; diff with `+`/`-` markers; "proprietary" wording removed |
| S-5 BES-285 | Anthropic only; provider id in D1 columns, KV cache removed; substring rename rule; disclosure text of section 7; pinned version; deletion triggers |
| S-6 BES-292 | Licence classifier in the shared validation; `update_skill` stages a pending version (status `needs-review`); labels of section 11 |
| S-7 BES-294 | Uses this document's licence and never-public sections; materiality per the pre-check input list |

## 14. SDK verification

Checked on 2026-11-08 in the installed packages.

- `ai@7.0.153`: `uploadSkill({ api, files, displayTitle?, providerOptions? }) → UploadSkillResult`
  (signature read in `dist/index.d.ts`; the result's fields were not read).
- `@ai-sdk/anthropic@4.0.88`: `anthropic.skills()` exists, and the provider
  options have a `container` object with a `skills` array.

Unverified (S-5 settles them first): the exact shape of `UploadSkillResult`
and of a `custom` container skill entry (`skillId` or `providerReference`, and
the version field); whether deleting through the provider API is exposed by the
SDK or needs a raw REST call; that Anthropic's reserved-word rule is a
substring rule (one test upload on a throwaway key). `yaml` and `fflate` are
transitive today (`yaml` 2.9.0 as a devDependency, `fflate` 0.8.3); S-2 adds
them as direct dependencies.

## 15. Rejected alternatives

| Alternative | Why not |
| --- | --- |
| A skills marketplace, presets or sharing | Moderation, DSA notice-and-action and licence exposure; skills stay private hosting |
| Trusting a scanner or an LLM judge | Known bypasses (Trail of Bits 2026-06); an LLM judge is itself injectable |
| Running scripts in the Worker | Arbitrary code next to user data and keys |
| OpenAI shell skills in v1 | OpenAI's guide names this design as one to avoid (pre-check Q5) |
| Licence decided by repository, path, date or the `license` field | A fork or an old pin defeats each; only the licence file content is reliable |
| One Besidka-wide GitHub token | GitHub Terms section H (sharing tokens to exceed limits) |
| Rendering `SKILL.md` as Markdown | Image URLs leak the viewer's IP and rendering hides text |
| A skill activations table | Activations are message parts, rebuilt from D1 each send |
| `skills/` as the R2 prefix | Confusable with the repository's host skills directory |

## 16. Revisit criteria

- **OpenAI scripts path**: OpenAI documents org-scoped or per-user skill
  isolation, removes the open-catalog warning, or the owner accepts the risk
  in writing.
- **Per-user GitHub token**: preview measurements show archive downloads or
  update checks hitting GitHub limits.
- **Sharing or a public skill gallery**: only with moderation, DSA Art. 16
  notice-and-action, a DPIA pass and a new legal notice.
- **Licence classifier**: when a new restrictive licence family appears in
  imports, add its hash or phrase and bump the classifier version.
- **Catalog budget (1,500 tokens) and active block (12,000 tokens)**: retune
  after measuring Cyrillic chats.
- **"Always allow" while a skill is active**: same criterion as
  `docs/connectors.md` section 18.

## 17. Open questions

| # | Question | Owner | Default until answered |
| --- | --- | --- | --- |
| 1 | Keep S-5 Anthropic-only, or defer S-5 for both providers for consistency | Owner | Anthropic-only (coordinator decision) |
| 2 | Allow `none`-licence skills with the extra tick, or block them | Owner | Allow with the tick (pre-check owner item 2) |
| 3 | Ship the per-user GitHub token in the first importer layer | Owner, after S-2 measures | Not in the first layer |
| 4 | Publish the skills legal notice when `skills` leaves `internal` (material, 30 days) | Owner, S-7 | One notice at that point |
| 5 | Whether the 2026-11-06 relicence reaches older copies | Counsel or Anthropic | Treat older copies as restricted |
| 6 | Eight profile tabs or one "Integrations" tab | Owner, after C-7 measures | Separate tabs if they fit |
