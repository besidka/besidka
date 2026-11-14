# Skills design (Phase 4c)

Status: **design, 2026-11-08, amended 2026-11-13 (S-0).** Not built. This
document is the source of truth for the skills track: S-1 (BES-264) to S-6
(BES-292) implement it, together with the tickets S-0, S-2G, S-10, S-11 and
S-12 added on 2026-11-13, and C-1 (BES-233) wrote it. Where a ticket body and
this document disagree, this document wins; section 13 lists every ticket that
has to change. The legal reasoning (licence gate, never-public invariant, S-5
provider verdicts) is in the compliance pre-check
`docs/legal/prechecks/skills.md` (S-8, BES-315, PR #739), which has a dated
addendum for the 2026-11-13 amendments. The shared approval model and the
outbound URL rules are in `docs/connectors.md`; the flag rules are in
`docs/feature-flags.md` (lands with P0-1, PR #732).

A **skill** is a folder of instructions (`SKILL.md` plus optional reference
files and scripts) in the open Agent Skills format. A user writes one in the
app, starts from one of Besidka's own templates, or adds one by archive
(`.zip` or `.skill`), pasted text, a GitHub link or an MCP agent. The model
sees a short catalog of the user's enabled skills and loads one when the task
calls for it. A **command** is a skill the user runs on purpose with `/name`
(section 5.5). Skills written by others are third-party instruction text, so
the design treats them like software the user installs: pinned, reviewed in
full, disabled until the user enables them, and never trusted to override the
user or Besidka's rules. Text the user typed in the app is also treated as
untrusted when it reaches the model, but it needs no licence tick and is saved
enabled (section 2, items 4 and 6).

## Contents

1. [Agent Skills format](#1-agent-skills-format)
2. [Decisions](#2-decisions)
3. [Import, pinning and archive rules](#3-import-pinning-and-archive-rules)
4. [Licence gate](#4-licence-gate)
5. [Runtime and commands](#5-runtime-and-commands)
6. [Threat model](#6-threat-model)
7. [Scripts in provider containers (S-5)](#7-scripts-in-provider-containers-s-5)
8. [Data model](#8-data-model)
9. [Limits](#9-limits)
10. [UI placement, manager, editor and picker](#10-ui-placement-manager-editor-and-picker)
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

Binding for the skills track (S-1 to S-14). **(pre-check)** marks a decision
from `docs/legal/prechecks/skills.md`; **(this doc)** marks one that settles a
disagreement between tickets and is listed in section 13. Items 1, 2, 4, 6, 8,
11, 12 and 13 were amended on 2026-11-13 (S-0), and items 14 and 15 are new;
the old wording is in the git history.

1. **Users bring their own skills.** A user can write a skill in the app,
   start from one of Besidka's own templates, or add one by archive (`.zip` or
   `.skill`), pasted `SKILL.md` text, a GitHub link, or an MCP agent. There is
   no marketplace, no public listing and no preset of third-party skills.
   Besidka's own templates are Besidka's text, not presets. Presets that set a
   model, reasoning or tools are deferred (section 5.6). Sharing by link is
   optional and built later (S-13, section 12.1); nothing in the first release
   shares a skill.
2. **Imports are pinned. Edits make versions.** A GitHub import is pinned to a
   40-character commit SHA; other sources to `sha256-<first 16 hex>` of the
   content. An import is never auto-updated. An update is an explicit check, a
   diff, a review and an accept. Every skill, imported or written, keeps
   numbered versions (1, 2, 3, and so on). A version is never rewritten: an
   edit, rename, import, update or restore creates a new version, and the
   newest 20 are kept (section 8.7).
3. **Text only.** Extension allowlist plus strict UTF-8; no binaries, no
   `.pyc`, no symlinks.
4. **Disabled until enabled in the app, except what the user writes in the
   app.** Imports, updates, MCP-created and MCP-updated skills, MCP renames and
   share copies all start or become disabled, and only the user enables them in
   the app. A skill the user creates in the app (blank, command or template) is
   saved enabled, because the user typed every byte. An in-app save or rename
   keeps the skill's current enabled state.
5. **Scanners are not a boundary.** Besidka highlights links, commands and
   hidden characters for the user's review; it never calls a skill "safe".
6. **Licence gate on every source (pre-check).** The licence **file** at the
   pinned commit decides, through the classifier in section 4; the `license`
   field alone never allows. Restricted skills are blocked with no override.
   One class is not decided by the classifier: text the user writes in the app
   (source `editor` or `template`) is class `authored` and needs no
   right-to-use tick (**this doc**). A licence file the user adds to such a
   skill still goes through the classifier, so restricted text still blocks.
   Pasted `SKILL.md` text is an import: it keeps class `none` and its tick.
7. **Anthropic's document skills (docx, pdf, pptx, xlsx) are Apache-2.0 since
   2026-11-06 (pre-check).** Copies pinned before commit `2c5958ec` carry the
   old proprietary licence and are blocked by licence content, not by path or
   date. Not bundling or presetting them is an owner choice, not a legal need;
   the built-in ids stay reachable on the user's own Anthropic key (D-8).
8. **Skill text is untrusted instructions.** Wrapped as `<skill_content>`,
   with a system rule that skills guide how to do the user's task and cannot
   override the user, Besidka's rules, or ask for secrets. While a skill is
   active, writes **and spend** need approval: every connector tool not marked
   read-only asks even when set to "Always allow" (`docs/connectors.md`
   section 7.1, rule F1), and Besidka's own spending tools offered to the
   model (today `generate_image`) go through the same approval card
   (`toolApproval` returns `user-approval` for them while an activation exists
   in the send or in the chat's re-injected skills). **Until C-6 ships, an
   interim rule replaces the card (owner decision 2026-11-13; S-3 and S-12 ship
   before C-6):** activating a skill never adds a tool; the tools that spend
   (web search, `generate_image`, code execution) are offered only when the
   user picked them for that message; while a skill is active, `generate_image`
   is limited to one call per send. The approval card is added when C-6 lands.
   As built in S-3 (section 5.7): the skill tools add no tool, the spending
   tools stay exactly what the user picked for the message, and the one-call
   limit of `generate_image` is the tool's own single-execution claim.
9. **Plain text everywhere (this doc).** Skill files are shown as plain
   monospace text in the review screen, the file viewer and the chat side
   panel. No Markdown rendering, no images (an image URL in a skill would leak
   the viewer's IP and could hide text).
10. **Scripts never run in Besidka.** Only in a provider container on the
    user's own key, behind `skills.scripts`, a Labs opt-in, a per-skill toggle
    and a per-chat confirmation. **Anthropic only in v1 (coordinator decision,
    2026-11-08)**; the OpenAI path is not built.
11. **Never public (pre-check).** No user skill content, name, activation or
    command invocation reaches a public route or a shared chat (section 12).
    The one planned exception is optional link sharing (S-13). It is not part
    of the first release, it needs its own pre-check addendum (S-8b) and its
    own legal notice, and section 12.1 holds its design.
12. **New MCP scopes `skills:read` and `skills:write`, and a reserved name
    `skills:share`.** Writes arrive disabled; deletes stay on `data:delete`,
    because skills are user content (unlike connectors, see
    `docs/connectors.md` section 2, item 11). `skills:share` is reserved in the
    docs only and is not registered by S-6 (section 11).
13. **No new nav pill slots.** Profile tab, Search popup row, "+" menu section,
    context panel "Used" section. Commands live in the same tab; there is no
    separate tab.
14. **A command is a skill (this doc).** One entity, one manager, one set of
    tables. Two columns the user sets, never the skill's own frontmatter,
    decide how a skill can be used: `model_invocable` and `slash_command`
    (section 5.5). Since 2026-11-14 the user never sees the columns: one
    **invocation mode** (Off, Auto, Only when I ask) sets `enabled`,
    `model_invocable` and `slash_command` together (section 5.7).
15. **Nothing spends without Send.** Opening the picker, "Use in new chat", the
    manager and every MCP tool make no model call. Only the user's Send
    spends. There is no prefetch, no background work and no MCP run or
    activate tool.

Feature flags (stage `internal`, `default: false`, `allowRoles: ['admin']`).
`skills`, `skills.import-url` and `skills.scripts` are already registered in
`shared/utils/features/registry.ts` on `main`. `skills.scripts` has no `spend`
set there, so `internalFeature` defaults it to `none`. S-1 adds
`skills.commands` and corrects `skills.scripts` to the row below. `skills.share`
is added by S-13.

| Flag | Gates | `spend` |
| --- | --- | --- |
| `skills` | Page, tab, Search row, routes, editor, "+" menu section, runtime | `none` (the catalog and bodies are tokens of the user's normal send) |
| `skills.import-url` | Only the `{ url }` (GitHub) import and `update/check`. Archive and paste imports, templates, writing a skill, and the accept and reject routes work without it and are gated by `skills` alone | `none` |
| `skills.commands` | The `/` picker, the invocation chip and the invocation part (section 5.5) | `none` (Send is the only spend, item 15) |
| `skills.scripts` | Provider-container execution (section 7), Labs opt-in | `foreground`, so `optIn: 'required'` |
| `skills.share` | Link sharing (S-13, section 12.1) | set by S-13 |

## 3. Import, pinning and archive rules

### 3.1 Sources

| Source | `source_kind` | How | Version |
| --- | --- | --- | --- |
| Editor: blank skill or blank command | `editor` | Written in the app (section 10); class `authored` | Besidka version 1, origin `editor` |
| Template | `template` | One of 3 to 4 Besidka-authored starters in `shared/utils/skills/templates/`; class `authored` | Besidka version 1, origin `template` |
| Upload `.zip` or `.skill` | `zip` | At most 5 MiB compressed; unzipped in a browser worker for the preview, then the **original archive** is uploaded and the server re-inflates it with hard limits | Provenance `sha256-<16 hex>` of the archive |
| Paste | `text` | `SKILL.md` text only (`POST /api/v1/skills/import/text`) | Provenance `sha256-<16 hex>` of the text |
| GitHub URL | `github` | One `api.github.com` call resolves the ref to a commit SHA, then one download of `codeload.github.com/<owner>/<repo>/zip/<sha>`, both through the narrow fetcher below; flag `skills.import-url` | Provenance: commit SHA |
| MCP `create_skill` | `mcp` | Files as text (section 11) | Provenance `sha256-<16 hex>` of the canonical file set |
| Share copy (S-13) | `share` | "Import a copy" of a shared skill (section 12.1) | Set by S-13 |
| Link to a raw `SKILL.md` | `url` | **Later (S-2U), not in the first release.** One `safeFetch` (purpose `skills-url`, at most 256 KiB, `text/*`) once C-3 is on `main`. Folder name from the URL path's parent segment | `sha256-<16 hex>` of the content |

Two kinds of version exist. Every skill has Besidka's own numbered versions
(1, 2, 3, and so on; `skills.current_version`). The provenance in the last
column (a commit SHA or `sha256-<16 hex>`) is stored as `source_version` on the
skill and on the version row (section 8).

**GitHub link forms (S-2G).** The parser accepts:

- `github.com/<owner>/<repo>`;
- `github.com/<owner>/<repo>/tree/<ref>[/<path>]`;
- `github.com/<owner>/<repo>/blob/<ref>/<path>/SKILL.md` (the parent folder is
  used);
- `github.com/<owner>/<repo>/commit/<sha>`.

A ref that contains `/` is resolved by trying candidate splits from shortest to
longest, at most 3. The pin is the commit SHA that `api.github.com` returns for
the ref (one call on import), or the 40-character SHA from the URL when it
already holds one. The download always uses the SHA. Only entries under the
requested path are inflated, with one exception: the repository-root
`LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*` entries are also inflated for a
subfolder import. They serve licence classification (section 4, step 1). They
are not stored as skill files unless the skill has none of its own; then they
are stored verbatim as the skill's licence. A repository that holds several skills
returns a list to pick from, up to `SKILL_GITHUB_PICK_MAX` (10; the answer
also carries the total and a `truncated` flag). The list is `{ pick }` with no
`stageId`; the client sends the same link again as `{ url, path }`, where
`path` is the chosen repository-relative folder, so the ref stays a branch and
update checks keep working. Each follow-up is a new import: it costs an hourly
import slot, a REST call and a download. Only public repositories work; a 404
says "Private or missing repository".

**A SHA must be on the named repository.** A commit SHA can belong to a fork
and still resolve under another repository's URL. So before importing a SHA that
came from the URL, Besidka checks that it is reachable from the named
repository: it reads the default branch with `GET /repos/{owner}/{repo}` (one
call, cached within the import) and then calls
`GET /repos/{owner}/{repo}/compare/{default_branch}...{sha}`. Only the status
`behind` or `identical` passes. Otherwise the import is rejected with "This
commit is not on any branch of owner/repo". The same check runs for a ref that
is a hex prefix of the SHA it resolved to, because the commit lookup also
resolves abbreviated ids from forks.

**A ref must be a branch or tag of the named repository.** The commit lookup
answers for any ref GitHub knows, including `pull/N/head` and `pull/N/merge`,
whose commits live in forks. So a link whose ref starts with `pull`, `refs`,
`keep-around` or `__gh__` is refused by the parser, never offered as a ref
candidate, and refused again when a stored ref is rechecked by an update check.
Any other name (not `HEAD`, not a hex id) is first confirmed with
`GET /repos/{owner}/{repo}/git/ref/heads/{ref}` and, on a 404,
`git/ref/tags/{ref}`; only then is the SHA trusted. A lightweight ref answers
with its commit, and an annotated tag is peeled by the commit lookup. When no
candidate exists, one `GET /repos/{owner}/{repo}` tells a missing repository
(404, "Private or missing repository") from a missing ref ("Branch, tag or
commit not found").

**The GitHub fetcher is a narrow, allowlisted fetcher, not C-3 (this doc).**
The host is never user-controlled.

- Besidka parses `owner`, `repo`, `ref` and `path` with strict regexes
  (`[A-Za-z0-9._-]`, length caps) and builds the URLs itself. The allowlist is
  exactly two hosts. `api.github.com` resolves the ref to a commit SHA (one
  call on import) and runs the update checks. `codeload.github.com` downloads
  `https://codeload.github.com/<owner>/<repo>/zip/<sha>`. There is no
  `github.com/<owner>/<repo>/archive/<ref>.zip` fallback and no zipball
  redirect. `raw.githubusercontent.com` is not needed, because the zip carries
  the files.
- Fetch rules: `redirect: 'manual'`, https only, an exact-host allowlist, and
  no redirect is followed. The S-2G spike verifies that codeload answers a SHA
  URL directly.
- Other limits: a streaming cap of `SKILL_MAX_GITHUB_ARCHIVE_BYTES` (15 MiB;
  the largest real skills repository checked, `anthropics/skills`, is 4.4 MiB
  compressed), a
  timeout, a `User-Agent`, and 10 imports per hour. The body is read into
  one buffer (sized from `Content-Length`, else doubled up to the cap), one
  archive is processed at a time per isolate (a second import answers 503
  "Another GitHub import is running, try again in a moment" with
  `Retry-After: 5`), and one 60 s deadline covers all GitHub calls of a request.
- Why this is enough without C-3: C-3's threats are SSRF to metadata or private
  ranges (T1) and DNS rebinding (T2). Both come from hosts the user chooses.
  With fixed public hosts there is nothing for them to act on, so the fetcher
  is about 100 lines and easy to review. C-3 is a general wrapper for
  connectors and arbitrary URLs; pulling it in would add OAuth-purpose rules,
  header rules and test vectors that skills do not need.
- The fetcher keeps C-3's call shape (`purpose: 'skills-github'`). When C-3
  lands, it becomes `safeFetch` with the same allowlist, and one line changes.

GitHub's unauthenticated REST limit is 60 requests an hour per IP, shared
across Workers egress. Observed on 2026-11-08 (pre-check Q4, not
documented): the archive download does not count against that quota. The REST
API (`GET /repos/{owner}/{repo}/commits/{ref}` with
`Accept: application/vnd.github.sha`) does count, and it runs once per import
and on every update check. An import of a SHA from the URL makes two more
calls, the repository lookup and the compare. Because the quota is shared by
the whole app, every API call draws from one global budget of
`SKILL_GITHUB_API_BUDGET_PER_HOUR` (50) a hour in KV, which fails closed with
the rate limit message when spent or when KV cannot be read; a verified
ref-to-SHA answer is cached for `SKILL_GITHUB_REF_CACHE_SECONDS` (60) and a
default branch for `SKILL_GITHUB_BRANCH_CACHE_SECONDS` (600). A 429, or a 403
with `x-ratelimit-remaining: 0`, gives "GitHub rate limit reached" with the fix
"Try again in an hour or upload a zip"; any other 403 gives "GitHub refused
the request". A per-user GitHub token (`keys.provider = 'github'`, public
read-only, encrypted) is **not** in the first layer: S-2G measures on the
preview first (pre-check owner item 3). `keys.provider` is a TypeScript-only
enum, so adding `github` should generate no SQL; whoever adds it runs
`pnpm run db:generate` and greps any generated `.sql` for `DROP TABLE` before
applying (a rebuild of `keys` is the cascade disaster `CLAUDE.md` describes). Never a Besidka-wide token (GitHub
Terms section H). A connector's GitHub PAT is never reused for imports
(different purpose and consent).

An import from a Claude Code skill folder reads three frontmatter keys only as
defaults for the two user-set columns (section 5.5): `disable-model-invocation`,
`user-invocable` and `argument-hint`. After import they have no effect.

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
- GitHub archives inflate only entries under the requested path, plus the
  repository-root `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*` entries for
  licence classification (section 3.1). The same size and text rules apply to
  them.

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

### 3.4 Import preview, commit and update

Staging (KV and R2 with a 1 h lifetime) exists only for the import preview,
before `import/commit`. The commit either creates a **new** skill or, after a
name collision, turns the staged files into a pending version of an existing
skill (see "A name collision" below). An update check and an MCP `update_skill`
never use staging: their pending version is persisted directly (see step 3).

1. `POST /api/v1/skills/import/preview` (multipart `file` or JSON `{ url }`;
   `{ url }` is a GitHub link, S-2G) validates, classifies the licence, scans,
   and stages: manifest in KV `skills:stage:<stageId>` (1 h), files in R2
   `skills-staging/u<userId>/<stageId>/<path>` (1 h, plus the hourly
   sweep). Returns the frontmatter, file list, `SKILL.md`, findings, warnings
   and licence class.
2. `POST /api/v1/skills/import/commit` `{ stageId, acknowledged: true }` (and,
   for class `none` or `custom`, `licenceAcknowledged: true`) moves the files to
   the content-addressed blob layout of section 3.5, writes **version 1 with
   origin `import`**, and creates the row with `enabled=false`,
   `status='ready'`. A GitHub repository that holds several skills first shows
   a checklist. The GitHub preview response carries `sourceUrl` (the
   repository URL), `sourceRef` (the branch, tag, `HEAD` or SHA from the link)
   and `sourcePath` (the skill folder, null at the repository root) next to
   `sourceVersion` (the commit SHA); a zip or paste preview returns them as
   null. Commit records them on the skill and on its version row.
3. `POST /api/v1/skills/[id]/update/check` (GitHub skills only, S-2G, behind
   `skills.import-url`)
   re-resolves the ref (REST call). Unchanged: `{ upToDate: true }`. Changed:
   the new files are downloaded and a **pending version is persisted**: a
   `skill_versions` row with the next version number (origin `update`), its
   `skill_files` rows, its blobs written under
   `user-skills/u<userId>/<skillPublicId>/blobs/`, and `skills.pending_version`
   pointing at it. `current_version` does not change, and the skill keeps
   running. The response carries a per-file diff (at most 2,000 lines), new
   findings and any licence change. Nothing is staged in KV or `skills-staging/`.
   A pending version that did not come from an update check (an import that
   replaced the skill) is never replaced by a check: it answers 409 "Review or
   reject the pending version first". A pinned (SHA) skill answers
   `{ upToDate: true, pinned: true }` without spending the import limit.
4. `POST /api/v1/skills/[id]/update/accept` (S-2, gated by `skills` alone)
   `{ version, sha256, acknowledged: true }`, where `sha256` is that of the
   pending version the user reviewed. On a mismatch it answers 409 "This update
   changed while you were reviewing it". When the pending version's licence
   class is `none` or `custom` and differs from the current version's class,
   the body must also carry `licenceAcknowledged: true`, or the answer is 400
   `licence-acknowledgement-required`, so an update cannot silently swap an
   open licence for one the user never saw. Otherwise it
   **creates a new `skill_versions` row with the next number** (the highest
   existing number plus 1) that points at the same blobs, with no blob copy and
   with the pending row's origin and its `source_kind`, `source_url`,
   `source_ref`, `source_path` and `source_version`. It copies those source
   fields to the skill row too. It then sets
   `current_version` to that new number, deletes the pending row, clears
   `pending_version`, disables the skill until the user enables it again, and
   prunes versions beyond `SKILL_VERSIONS_KEPT` (section 8.7).
   `current_version` only ever increases. If no in-app save happened since the
   pending row was created, the result is the same content as the pending
   version, renumbered.
5. **Reject** (S-2, gated by `skills` alone) takes `{ version, sha256 }` with
   the same 409 on a mismatch, then deletes the pending `skill_versions` and
   `skill_files` rows. The prune and the hourly sweep then remove the blobs that
   nothing references.

An MCP `update_skill` also writes a persisted pending version, the same way
(section 11).

**An in-app save while a pending version exists** is allowed. It gets the next
version number and becomes current. The pending version stays pending, and its
review diffs against the new current version.

**An update check on a skill with local edits.** The check compares the skill's
`source_version` with the latest upstream commit. A newer commit creates a
persisted pending version (step 3), which is not used until accepted; accepting
disables the skill, as for every update. If
any version newer than the last import has origin `editor`, `template`, `mcp`,
`rename` or `restore` (a local edit), the review screen warns "Accepting
replaces your local edits since the import" and shows the diff against the
**current** version, not against the last import. There is no merge in the first
release. Accepting makes the upstream version current. The local versions stay
in history, within the 20 kept, so the user can restore one.

Writing and editing in the app is a separate path (S-10): create from blank or
template, and `POST /api/v1/skills/[id]/versions` for a save (section 8.7).

**A name collision at commit** answers 409 "A skill named X exists", and the
user chooses one of two ways. It works the same for zip, `.skill`, paste and
GitHub imports.

- **Replace as an update.** `import/commit` with
  `{ stageId, asUpdateOf: <skillId> }` turns the staged files into a persisted
  pending version on the existing skill: origin `import`, the next version
  number, the blobs moved under `user-skills/u<userId>/<skillPublicId>/blobs/`,
  and the import's `source_kind`, `source_url`, `source_ref`, `source_path`
  and `source_version` recorded on that version. The stage is deleted. The user then reviews and accepts it
  through step 4, like any pending version. If the existing skill already has a
  pending version, the new one replaces it and the old pending row is deleted.
  The skill's own `source_kind`, `source_url`, `source_ref`, `source_path` and
  `source_version` (so its GitHub upstream) change only when that version is
  accepted.
- **Rename the incoming skill** and commit it as a new skill (step 2).

Rate limit: 10 imports per hour per user; at most `SKILLS_PER_USER` skills.

### 3.5 R2 layout

| Prefix | Content | Lifetime |
| --- | --- | --- |
| `user-skills/u<userId>/<skillPublicId>/blobs/<sha256>` | Committed file contents, content-addressed, `contentType` `text/*`. Which blob is which path in which version is in `skill_files` (section 8.3) | Until the skill or the account is deleted, or no remaining `skill_files` row references the blob (after a version is pruned) |
| `skills-staging/u<userId>/<stageId>/<path>` | Staged files of an import preview, before `import/commit` (a new skill, or a "replace as an update" commit). Never used by update checks or MCP | Until the stage is committed or deleted, or 1 h, swept hourly |

The earlier layout `…/<version>/<path>` would copy up to 200 files on every
one-line save, so it is replaced. There is no `r2_key` column: one key builder
derives the key from `userId`, the skill's public id and `blob_sha256`, and the
S-1 never-public spec tests that builder.

The `user-` prefix keeps user content visibly apart from the repository's
host skills directory `skills/` (served at `/.well-known/agent-skills/`
through the `assets:agentSkills` server-asset mount). Staging keeps the
pre-check's `skills-staging/` name: its objects live for an hour and are
never read by any route. R2 and the server-asset mount are different stores,
so neither prefix can be served by the host skills routes; the S-1 spec still
asserts it. The `u<userId>` segment
matches `knowledge/u<userId>/`, so the account purge reuses the same
list-by-prefix and batch-delete code (`storage.delete(keys)`, at most 1,000
keys per call). Reads go through `readSkillFile`, which checks ownership in D1
first; there is no public or signed-URL route to these objects.

## 4. Licence gate

`shared/utils/skills/licence.ts` (S-2) runs on every source, on update, on
every in-app save (S-10) and on MCP `create_skill` and `update_skill`, and
returns `{ class, text, matched }`. Steps, in order (from the pre-check):

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
| `restricted` | Blocked on every source, no user override. General message: "Its licence limits use to <named service>, or forbids copying. Besidka cannot import it." Anthropic case message: "This copy carries Anthropic's earlier proprietary licence. Anthropic moved these skills to Apache-2.0 on 2026-11-06. Import the current version, or use the built-in Anthropic skill on your own Anthropic key." |
| `open` | Allowed. SPDX badge and "Licence file: LICENSE.txt (view)". `LICENSE` and `NOTICE` stored verbatim (Apache-2.0 section 4) |
| `custom` | Allowed after the user reads the licence and ticks an extra box "I read the licence and may use this skill": "Custom licence. Read it before you install." |
| `none` | Allowed with an extra tick "I have the right to use this skill": "No licence stated. The author keeps all rights by default. Besidka keeps a private copy for you only. Install it only if you have the right to use it." |
| `authored` | Assigned by source, never by the classifier: only the editor and templates produce it, and **an import never does**. Saved enabled with no licence tick, because the user wrote the text (or took Besidka's own template). A licence file the user adds still goes through the classifier above, so a restricted licence file blocks the save with the `restricted` message |

`LICENSE` and `NOTICE` files are read-only in the editor and cannot be
deleted or changed when the class is `open` or `custom` (Apache-2.0 section 4).
Only `authored` skills and `open` skills may be shared (section 12.1).

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

## 5. Runtime and commands

S-3 wires skills into `server/api/v1/chats/[slug]/index.post.ts` after the
knowledge tools, only when the `skills` flag is on and the chat has at least
one enabled, model-invocable skill. S-12 adds slash commands (section 5.5).
Both ship before C-6, under the interim rule in section 2, item 8.

### 5.1 Selection

Optional body field `skillIds: z.array(z.string().max(64)).max(20).optional()`
(a new field; `chatToolSchema` is not widened). Ownership and `enabled` are
verified and the choice is stored in `skill_chat_settings`; an omitted field
means the stored per-chat state. At most 20 enabled skills per chat. The
"+" menu lists only enabled skills with `model_invocable` on.

### 5.2 Catalog

`buildSkillCatalog({ skills, budgetTokens: 1500, family })`
(`server/utils/skills/runtime/catalog.ts`) builds an `<available_skills>`
block of `- name: description` lines sorted by name. Only skills with
`enabled && model_invocable` enter the catalog. A slash-only command costs no
tokens until the user invokes it. Tokens are estimated with
`KNOWLEDGE_CHARS_PER_TOKEN` (`shared/utils/project-knowledge-policy.ts`; Latin
versus Cyrillic, see "Cyrillic multiplier" in `docs/memory-architecture.md`).
Over budget: descriptions shortened to their first sentence, then names only
with "(+N more; call activate_skill with an exact name)". The catalog goes in
the stable prefix of `buildChatInstructions` after the knowledge block, so it
caches with the prompt (`docs/providers/general.md`). No catalog and no tools
when the chat has no enabled, model-invocable skill, and no catalog when tool
calling is off for the message.

**Cyrillic multiplier.** `KNOWLEDGE_CHARS_PER_TOKEN` counts Latin at 3.2
characters per token and Cyrillic at 1.1 for Anthropic. So the 1,500-token
catalog holds about 1,650 Ukrainian characters. One Ukrainian description at
the full 1,024 characters is about 930 tokens; in English it would be about
320. That is why the editor shows a token estimate and warns above
`SKILL_DESCRIPTION_CATALOG_SOFT_MAX` (300 characters, "Shortened in the
catalog"), and why slash-only commands stay out of the catalog.

### 5.3 Tools

`getSkillTools({ db, userId, chatPublicId, enabledSkills, guard, logger })`
(`server/utils/skills/runtime/tools.ts`), both tools marked
`withFollowUpTurn()`, with a `skillSteps` budget of 4 in `resolveToolLoop`:

- `activate_skill({ name: z.enum(enabledNames) })` loads the current
  version's `SKILL.md` body (frontmatter stripped) through `readSkillFile`,
  cut at 40 KiB **and** at `SKILL_ACTIVATE_MAX_TOKENS` (6,000 tokens,
  estimated per model family), whichever comes first, with a notice that the
  rest is readable with `read_skill_file`. Returns
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

**Why the per-activation token cap exists.** The 40 KiB activation cap is about
20,480 Cyrillic characters, or about 18,600 tokens. Even Latin text at that
size is about 12,800 tokens. Either one exceeds the 12,000-token
`SKILL_ACTIVE_BLOCK_MAX_TOKENS` on its own. The cap of
`SKILL_ACTIVATE_MAX_TOKENS` (6,000) per activation or invocation lets the block
fit two. The spec itself recommends a body under 5,000 tokens, and the editor
warns above that. The rest stays readable through `read_skill_file`.

**Cache.** An invocation goes into the latest user turn (section 5.5), so the
cached prefix is untouched. Editing a model-invocable skill changes the
catalog, so it misses the cache once.

### 5.5 Commands (slash invocation)

A **command** is a skill that runs when the user asks for it by name, either
with `/name` or by attaching it. Since 2026-11-14 that is the mode **Only when
I ask**, and every enabled skill is also available as `/name` (section 5.7).
It is not a second entity. A command is built the way a skill is: the same
`SKILL.md` plus files, the same manager, the same tables, the same import,
licence gate, findings, versions, review, purge, restore and MCP tools. A
separate entity would duplicate every one of those and need its own
`commands:*` scopes, which means another major MCP version.

Two columns on `skills`, set by the user and never by frontmatter, decide how a
skill can be used:

| Column | UI label | Effect |
| --- | --- | --- |
| `model_invocable` | Mode Auto | Listed in the catalog. The model can call `activate_skill`. |
| `slash_command` | Every enabled skill (unless the name is reserved) | Offered in the composer's `/` picker. The user invokes it explicitly. |

"New command" in the manager creates a skill with `model_invocable` off,
`slash_command` on, and a short body that uses `$ARGUMENTS`: mode Only when I
ask. A blank skill and the skill templates start as Auto.

Why columns and not frontmatter: skill text is untrusted, and `allowed-tools`
"never grants a tool" (section 1). An imported skill must not be able to make
itself model-invocable or slash-invocable. On import, Claude Code's
`disable-model-invocation`, `user-invocable` and `argument-hint` are read only
as defaults for the columns. This also matches the ecosystem: Claude Code
folded `.claude/commands/*.md` into skills, and a `SKILL.md` round-trips to
and from Claude Code and agentskills.io.

**How an invocation works (BYOK-safe).** The model is the
`data-artifact-attachment` precedent (`docs/artifacts/attach.md`): a strict
user-message part, rewritten on the server from the D1 row, removed by
`filterPublicParts`, and dropped on replay when it no longer resolves.

1. **Choosing in the picker** removes the `/query` text and adds a chip to the
   attachments row. Nothing is sent and nothing is fetched for the model. The
   user types arguments and presses Send. That press is the only consent and
   the only spend.
2. **The send** carries
   `{ type: 'data-skill-invocation', data: { skillId, name, version } }`, at
   most one per message (`SKILL_INVOCATIONS_PER_MESSAGE`). A message may hold
   only an invocation: S-12 changes the request schema
   (`server/utils/chats/request-schema.ts`) to allow it.
   `resolveSkillInvocationPart` (new,
   `server/utils/skills/runtime/invocation.ts`) is called by both chat routes.
   It checks owner, `enabled`, `slash_command` and the flag, and answers one
   generic 400 for every failure so that ids cannot be probed.
3. **The server injects** the current version's body as
   `<skill_content name source version invoked="user">`, with `$ARGUMENTS`
   replaced by the user's text (or "ARGUMENTS: ..." appended when the body has
   no placeholder). It goes into the **latest user turn**, never the system
   prompt, so the prompt cache stays intact. The artifact context block does
   the same. Because no tool call is needed, it works on any model, including
   models without tool calling. Deep-research models hide the picker. The
   body is cut at `SKILL_ACTIVATE_MAX_TOKENS`, as an activation is.
4. **Persistence.** If `model_invocable` is on, the invocation also emits
   `data-skill-activation`, so the skill stays active through section 5.4
   re-injection. A pure command is one-shot: it applies only to its own turn
   and to a Regenerate of it.
5. **Never public.** The part is filtered from shares, so the skill name never
   reaches a shared chat (section 12). The visible text part holds only the
   arguments, because typing `/name␠` turns into the chip before sending. A
   client-side "Insert as text" (chip menu) expands the template into the
   textarea as the user's own text. It is offered only for skills of class
   `authored`, so third-party text never becomes trusted user text by default.
6. **The memory write lock is preset** (the `presetMemoryWriteLock` pattern)
   whenever an invoked or re-injected skill is in context. All skill text, the
   user's own included, is treated as untrusted. The invocation is labelled as
   user-selected but stays subordinate to the user's message and Besidka's
   rules. Arguments are the user's own text, so they add no injection
   channel.

The picker, chip and composer rules are in section 10.

### 5.6 Presets and built-in commands

- **Presets** (model, reasoning, tools) are deferred. If they are built later,
  they are D1 settings applied as **visible, removable composer tiles before
  Send**, never applied silently, because a preset that changes the model or
  tools is a spend escalation.
- **Built-in commands** are optional and later (S-14, flag
  `composer.builtin-commands`): `/new`, `/model`, `/search`, `/image`,
  `/memory`, `/project`, `/help`. They are client-only UI actions that change
  visible composer state. They never send and never become parts. They appear
  in the same picker under a "Besidka" group.
- **Reserve their names now.** The S-1 name validator holds
  `SKILL_RESERVED_SLASH_NAMES`. A skill can still have such a name, but its
  slash toggle is refused with "/memory is reserved by Besidka".

### 5.7 As built (S-3)

**Invocation mode (owner decision, 2026-11-14).** The enable toggle and the two
invocation toggles are replaced by one control with three values, and it is
the only UI that writes `enabled`, `model_invocable` and `slash_command`
(`shared/utils/skills/mode.ts`, `PATCH /api/v1/skills/[id]` with `mode`):

| Mode | Columns | Meaning |
| --- | --- | --- |
| Off | `enabled=false` (the other two columns are left as they were) | Not available in chats |
| Auto | `enabled`, `model_invocable`, `slash_command` all true | "The model uses it when the description matches. You can also run it with /name." |
| Only when I ask | `enabled`, `slash_command` true, `model_invocable` false | "Runs only when you attach it or type /name." |

The server derives the three columns from the mode in one statement. A
reserved name (`SKILL_RESERVED_SLASH_NAMES`) never fails the request: the mode
is applied and `slash_command` stays off, and the UI says "Rename to use
/name". A rename recomputes `slash_command` in both directions (a reserved new
name turns it off, leaving a reserved name turns it on again for an enabled
skill), so a reserved name no longer blocks a save. `PATCH /api/v1/skills/[id]`
takes only `mode` and `argumentHint` (a strict schema: the old `enabled`,
`modelInvocable` and `slashCommand` fields answer 400), so the three columns are
never written one by one; the MCP tools of S-6 use `mode` as well. The first
turn-on of a skill the user did not write keeps its
confirmation. In the manager, a **skill** is a skill with `model_invocable` on
and a **command** is one that runs only when asked; the "≈ N tokens in every
message" estimate is shown for Auto only. Blank skills and the writing-style
and code-review templates start as Auto; blank commands and the other two
templates start as Only when I ask. An import still starts Off, and its
default mode is Auto unless the frontmatter sets `disable-model-invocation`
(then Only when I ask); `user-invocable` is ignored.

**Catalog and tools** (`server/utils/skills/runtime/`). `catalog.ts` builds
`<available_skills>` from the user's enabled, model-invocable skills that are
not broken, at 1,500 tokens (`SKILL_CATALOG_BUDGET_TOKENS`), with the framing
that descriptions are untrusted. The name and the description of every line go
through the same delimiter neutraliser (the tool's name enum keeps the raw
names). `tools.ts` registers `activate_skill` and
`read_skill_file` only when the catalog is not empty and the model can call
tools, both with a follow-up turn and a loop budget of
`SKILL_TOOL_STEPS` (4). Neither adds a tool, both set the memory write guard,
a skill already active is not loaded twice, `activate_skill` loads at most 3
skills per send (`SKILL_ACTIVATE_CALLS_PER_SEND`; past that it answers
`limit-reached` with no skill identity, so no activation part is stored), and
`read_skill_file` is capped at 8 reads and 64 KiB. Deep-research models are refused earlier, so they get no
catalog. `section 5.1` (`skillIds` and `skill_chat_settings`) is not built:
the catalog is simply every qualifying skill.

**Persistence.** `activate_skill` and `read_skill_file` outputs are reduced to
the skill id, name, version, status and path before they are stored
(`persist.ts`), because the body is read again from the current version on
every later send. A `data-skill-activation` part is added for each activated
skill. For an attached Auto skill the part is written to the client at the
start of the send **and** handed to the persistence step: the stored reply is
built from the model's stream, so a chunk written only to the outer writer
would reach the screen but never D1 (the past-chat chip is passed the same way).
`reinject.ts` reads those parts from the chat's stored messages, loads each
skill's current version (12,000 tokens in all, newest first, and it stops
reading once the budget is spent), and adds the `<active_skills>` block to the
system prompt, also when tool calling is off. Only a skill that is still
model-invocable is re-injected: after a switch to Only when I ask, an earlier
activation does not carry over. Deleted, disabled, broken, switched or
unreadable skills share one `<skill_notice>` that names at most three of them
(from the stored activation parts) and counts the rest. The activation part counts as
a meaningful part only next to text, and `filterPublicParts` drops both skill
parts.

**Forced attach (the invocation core, moved here from S-12).** One shared
state, `useComposerSkillInvocation()`, holds at most one `{ skillId, name,
version, source }`; `source` is `menu` here and S-12 adds `text` for a typed
`/name`. The "+" menu lists enabled skills (six, then "All skills…" in a
searchable dialog and "Manage skills"), a tile with the sparkles icon and the
caption "Skill" shows the choice, and the send carries one
`data-skill-invocation` part (the message may hold only that part).
`resolveSkillInvocationPart` runs in both chat routes: any failure (flag off,
id that does not decode, somebody else's skill, disabled, broken, a second
invocation) is the same 400 `skill_invocation_unavailable`, **even with the
flag off**, unlike the artifact attachment which answers 404 for a gated
feature, so an id can never be probed. The first message of a new chat goes
through the PUT route (which validates and throws) and then the POST route
(which already sees a stored message, so a part that no longer resolves is
dropped). `prepareSkillsForSend` builds the text for the latest user turn: the
current body as `<skill_content name source version invoked="user">`, with
`$ARGUMENTS` replaced by splitting and joining (never a string replace, so
`$&` in the user's text stays text) or "ARGUMENTS: ..." appended. The user's
text is cut at 8 KiB (`SKILL_ARGUMENTS_MAX_BYTES`) and the expansion stops
once it is past the 40 KiB body cap, so many placeholders cannot multiply it.
The send route reads the attached skill before it stores a new user message
(`loadSkillInvocationContent`), so an attached skill that cannot be read stores
nothing; a stored message (a resend, a Regenerate, the first message of a new
chat) still drops it silently. A message
that is only an attached skill has no text for the model context sanitizer to
keep, so `appendTextAsLastUserTurn` adds a user turn instead of leaving the
conversation on the assistant. An Auto skill stays active through the
activation part; an Only when I ask skill is one-shot and applies to its own
turn and to a Regenerate of it, because the stored part resolves again. The
shared view and a visitor's branch drop a user message that is left with no
part (`dropEmptyUserMessages`). The same sanitizer drop would make the AI SDK
continue the previous answer (it continues the last message of
`originalMessages` when that is an assistant turn), so the stream is given a
stub user turn to end on and the reply stays a new message. The text is added
to the turn being sent only when its id matches, otherwise as a new turn, so an
older user turn never receives it. Regenerating a stored skill-only message
whose skill is gone is the same generic 400 (there is nothing left to send).

**Step card.** An `activate_skill` call renders as a compact card in the
assistant message, in the style of the artifact and document cards: "Using
skill…" while it runs, "Used skill · name" with `lucide:sparkles` when it
returned (a click opens the preview), "Could not use skill" on an error. It is
excluded from the reasoning box's tool steps, and counts as visible assistant
content so the bubble shows before any text. A `read_skill_file` call stays a
reasoning step ("Read a skill file"). The sent user bubble shows a chip with
the skill name above the text.

**Preview.** `ChatSkillPreview` is a read-only dialog (a bottom sheet below
`sm`): name, description, mode and `SKILL.md` as plain monospace text (no
Markdown, no `v-html`; the first 60,000 characters), with **Edit**, which opens
`/profile/skills?skill=<id>&edit=1` (the page opens the details and the editor,
then removes the two parameters), and an "All skills" link. The composer tile,
the chip in a sent message and the step card all open it, from one
`useSkillPreview()` state mounted in the chat layout.

**Existing skills.** Skills that were enabled before this layer keep
`slash_command=false` (the old default), and selecting the mode they already
show does nothing, because the control only sends a change. The "+" menu and
the attach path do not need `slash_command`; S-12 must treat a missing
`slash_command` on an enabled skill as "not offered as /name yet" and offer a
one-time backfill, since a data migration is outside the additive-only rule.

**Not verified in S-3.** No model send ran with `skills` on: there is no
provider key on the test account, and the step card in the browser comes from
the `/chats/test?scenario=skill` fixture. The send path is covered by
`tests/integration/api/chats-skills.spec.ts` with a scripted model.

**Interim rule, as built.** The skill tools never add a tool. The web search
tools, `generate_image` and code execution stay exactly what the user picked
for the message. While a skill is active `generate_image` is limited to one
call per send, which the image tool already guarantees by claiming its single
execution (a second call fails with `generation-busy`, covered in
`tests/integration/server/image-generation.spec.ts`). The memory write lock is
set when an invoked or re-injected skill is in context, when the catalog lists
a skill whose source is not authored (anything but `editor` and `template`,
`isAuthoredSkillSource`, so a new source kind is locked by default), and by any
`activate_skill` or `read_skill_file` result. The persisted reply of a send
uses the same follow-up tool list as the live answer guarantee, which leaves
the skill tools out. A send that ran only skill tools and ended without text
therefore stores no reply and no empty-answer failure text (the reply has no
meaningful part, so the activation part is not stored either and a reload
shows no reply); before, it stored the failure text. A skill round followed by
`generate_image` and no closing text no longer gets the failure text after the
image. `create_document` is a follow-up tool and behaves as it did before.

**Context panel.** An attached skill, an activation and a successful
`activate_skill` call appear once each under Used (kind `skill`, label
"Attached" or "Used"); the shared context panel shows none.

## 6. Threat model

| # | Threat | Attacker | Mitigation | Ticket |
| --- | --- | --- | --- | --- |
| K1 | Malicious instructions that steer the model to exfiltrate data or act (Snyk ToxicSkills, 2026-02: 36.82% of 3,984 public skills flawed, 13.4% critical) | Skill author | Full-content review before install with a required tick; skill text wrapped and framed as untrusted (an invocation is labelled user-selected but stays subordinate to the user's message); the interim tool rule until C-6 (section 2, item 8), then F1 forced approvals for every tool not marked read-only while a skill is active; memory write lock, preset on invocation; disabled by default for everything but text the user wrote in the app; per-skill and per-chat toggles | S-3, S-4, S-12, C-6 |
| K2 | Scanner bypass (Trail of Bits, 2026-06: newline padding, `.pyc`, prompts aimed at LLM analysers) | Skill author | Scanners are not a boundary: findings are highlights; padding and long lines are findings themselves; `.pyc` and binaries rejected; no LLM judges a skill | S-2, S-4 |
| K3 | Hidden text: bidi overrides, zero-width characters, padding below the fold | Skill author | Hidden characters shown as `⟨U+…⟩`; plain monospace viewer, no Markdown rendering; line and blank-run findings | S-2, S-4 |
| K4 | Silent update that turns a reviewed skill malicious | Repository owner | Pinned SHA, never auto-updated; update = diff + new findings + licence change + review + accept, and the skill is disabled again | S-2, S-4 |
| K5 | Archive attacks: zip slip, symlinks, zip bombs, zip64, huge entries | Skill author | Section 3.2 rules on client and server, streaming inflate with abort | S-2 |
| K6 | YAML attacks: alias expansion ("billion laughs"), huge frontmatter | Skill author | `yaml` with `maxAliasCount: 0`, size cap, or a minimal frontmatter splitter | S-2 |
| K7 | Scripts executing arbitrary code | Skill author | Never in Besidka; only in the user's own provider container with no network, behind flag, opt-in, per-skill toggle and per-chat confirmation | S-5 |
| K8 | SSRF through import URLs | Malicious user | GitHub import: the narrow allowlisted fetcher (section 3.1): the host is never user-controlled, `redirect: 'manual'`, exact-host allowlist. A raw-link import (S-2U) waits for `safeFetch` purpose `skills-url` (`docs/connectors.md` section 4) | S-2G, S-2U, C-3 |
| K9 | Licence or copyright breach by an import | User | Licence gate on every source; restricted blocked; private storage only; Terms right-to-use promise and disable power (S-7) | S-2, S-7 |
| K10 | Injected agent installs instructions over MCP | Agent with `skills:write` | Created, updated and renamed skills are disabled with status `needs-review`; no enable, no toggles on an existing skill, no `allowScripts`, no URL import, no activation over MCP; licence gate runs; 30 skill writes per hour per user | S-6 |
| K11 | Skill content leaks to the public | Bug | Never-public invariant with specs (section 12) | S-1, S-3, S-6 |
| K12 | D1 restore revives a deleted malicious skill, enabled | Operator restore | `docs/d1-restore-reconciliation.md`: `UPDATE skills SET enabled = 0` for rows touched in the window (or all), replay deletions from Axiom, mark rows whose R2 blob is gone `broken` (section 8.8) | S-1 |
| K13 | Provider-side copy outlives the user's intent | n/a | Provider skill id stored in D1; the copy is deleted when scripts are turned off, the skill or the account is deleted, before the key is purged | S-5 |
| K14 | Cross-connector exfiltration triggered by a skill | Skill author | `docs/connectors.md` rule F2 applies regardless of skills | C-6 |
| K15 | Slash-name hijack over MCP: an agent renames a skill to a name the user types every day (`/summarize`) | Agent with `skills:write` | `rename_skill` disables the skill and sets `needs-review`, so it never fires until the user re-enables it. The in-app rename keeps the skill enabled | S-6 |
| K16 | An imported skill makes itself model-invocable or slash-invocable | Skill author | `model_invocable` and `slash_command` are columns the user sets, not frontmatter; Claude Code keys are read only as defaults at import (section 5.5); MCP never sets them on an existing skill | S-2, S-6, S-12 |
| K17 | Storage and request abuse through saves | Malicious user or injected agent | `SKILLS_MAX_USER_BYTES` (50 MiB of unique blobs), per-save caps, 120 saves per hour, 30 MCP skill writes per hour | S-10, S-6 |
| K18 | A GitHub import shows `owner/repo` as the source for a commit the repository never held: a SHA in the URL can belong to a fork of it | Malicious link author | Before a SHA from a URL is imported, the repository default branch is read and `compare/{default_branch}...{sha}` must answer `behind` or `identical`; otherwise "This commit is not on any branch of owner/repo" (section 3.1). The same check covers a hex-prefix ref. Pull request and internal refs (`pull/N/head`, `pull/N/merge`, `refs/`, `keep-around`, `__gh__`) are refused outright, and any other ref must first be confirmed as a branch or tag of the repository (`git/ref/heads`, `git/ref/tags`), because the commit lookup resolves fork commits through pull refs. Extra API calls count against the app-wide GitHub budget | S-2G |

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
   folder; the original name goes into `display_name` (255 characters;
   `display_title` under the old `skills-2025-10-02` beta header, which is
   what the SDK's `displayTitle` maps to, to confirm in S-5); a change note is added
   to the uploaded `SKILL.md` (Apache-2.0 section 4(b)) and shown to the user.
   Automatic for `open` skills, user-confirmed for `none` and `custom`;
   `restricted` never gets here.
4. **Store** `provider_skill_id`, `provider_skill_version` and
   `provider_uploaded_name` on the `skills` row (D1, not KV). Re-upload lazily:
   when `current_version` differs from the uploaded version, not on every save,
   or when the provider answers not-found.
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

All in `server/db/schemas/skills.ts`, exported from `server/db/schema.ts`. Four
tables in **one migration in S-1**, which holds only `CREATE TABLE` and
`CREATE INDEX`. A later nullable `ADD COLUMN` is allowed by the repo rules; only
table rebuilds are banned. Defaults are set in application code
(`$defaultFn`).
The S-1 pull request greps the generated SQL for `DROP TABLE`. A
`besidka-preview` Time Travel bookmark is taken before the bottom layer is
created, because creating it triggers a deploy that applies the migration
(`docs/stacked-prs.md`). **No foreign key to `users` and no cascade to `chats`
(this doc, same rule as `docs/connectors.md` section 8):** `purgeUserData`
deletes the rows and the R2 prefixes explicitly, and the purge coverage spec
fails when a table with a `user_id` is missed. The purge deletes the S-5
provider copies first (best effort, before the key is purged), then all four
tables (and the share tables, once S-13 exists), then `user-skills/u<userId>/`
and `skills-staging/u<userId>/`. The skills pre-check (question 8, S-1 row)
asks to add the skills tables to the `CLAUDE.md` cascade list; that list holds
tables with a cascade FK to `users`, and these tables have none, so no table is
added. S-1 adds one sentence after the `documents` note instead: the skills
tables have no foreign key and are purged explicitly (coordinator to confirm,
see section 13). Activations and invocations are message parts, not a table.

### 8.1 `skills`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `user_id` | integer, not null | |
| `name` | text | unique per user, so slash names are unique too |
| `description` | text | at most 1,024 |
| `license_field` | text, null | raw `license` frontmatter |
| `license_class` | text | `open`, `custom`, `none`, `restricted`, `authored` |
| `license_file_sha256` | text, null | |
| `license_classifier_version` | integer | |
| `compatibility` | text, null | at most 500 |
| `metadata` | json, null | string map |
| `allowed_tools` | json, null | informational |
| `source_kind` | text | `editor`, `template`, `zip`, `text`, `github`, `url`, `mcp`, `share` |
| `source_url` | text, null | |
| `source_ref` | text, null | requested ref (branch or tag) |
| `source_path` | text, null | subfolder inside the repository |
| `source_version` | text, null | provenance of the last import: commit SHA or `sha256-<16 hex>` |
| `current_version` | integer | Besidka's own 1, 2, 3, and so on |
| `pending_version` | integer, null | the `skill_versions` row of an update awaiting review (persisted, not staged); null when none. `current_version` does not change |
| `files_count`, `bytes` | integer | of the current version, for the list |
| `enabled` | integer (bool) | false on import, update, MCP write and share copy; true on creation in the app |
| `model_invocable` | integer (bool) | section 5.5 |
| `slash_command` | integer (bool) | section 5.5 |
| `argument_hint` | text, null | at most 100; read as a default from Claude Code's `argument-hint` on import |
| `allow_scripts` | integer (bool) | S-5, default false |
| `status` | text | `ready`, `needs-review`, `broken` |
| `created_via` | text | `app`, `mcp`, `share` |
| `created_by_client_id` | text, null | MCP client id |
| `provider_skill_id` | text, null | S-5 |
| `provider_skill_version` | text, null | S-5 |
| `provider_uploaded_name` | text, null | S-5 (renamed name) |
| `provider_deleted_at` | timestamp, null | S-5 |
| `created_at`, `updated_at` | timestamps | |

The `sha256` column of the earlier design is dropped (it moves to the version
row). Indexes:
unique (`user_id`, `name`); (`user_id`, `updated_at`).

### 8.2 `skill_versions`

| Column | Notes |
| --- | --- |
| `id` | |
| `skill_id` | text, the public id |
| `user_id` | integer |
| `version` | integer |
| `origin` | `import`, `update`, `editor`, `template`, `mcp`, `rename`, `restore`, `share` |
| `created_by_client_id` | MCP client id, null otherwise |
| `source_kind` | text, null; as on `skills` |
| `source_url` | text, null |
| `source_ref` | text, null |
| `source_path` | text, null |
| `source_version` | provenance (text, null) |
| `sha256` | of the canonical file set; accept and reject are bound to it (section 3.4) |
| `files_count`, `bytes` | |
| `license_class`, `license_file_sha256` | |
| `findings` | json of counts by type |
| `note` | at most 200 characters |
| `created_at` | |

Indexes: unique (`skill_id`, `version`); (`user_id`).

### 8.3 `skill_files`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer, autoincrement | |
| `skill_id` | text | |
| `user_id` | integer | |
| `version` | integer | |
| `path` | text | normalised relative path |
| `blob_sha256` | text | the R2 blob (section 3.5) |
| `bytes` | integer | |
| `kind` | text | `skill-md`, `reference`, `script`, `asset`, `licence`, `other` |

There is no `r2_key` column (section 3.5). Indexes: unique (`skill_id`,
`version`, `path`); (`user_id`); (`skill_id`, `blob_sha256`) for pruning.

### 8.4 `skill_chat_settings`

`id`, `user_id`, `chat_public_id` (text), `skill_id`, `enabled`, timestamps.
Unique (`chat_public_id`, `skill_id`). Deleted by the chat-deletion cleanup.
Unchanged by the 2026-11-13 amendments.

### 8.5 KV keys

| Key | TTL | Content |
| --- | --- | --- |
| `skills:stage:<stageId>` | 1 h | staged manifest of an import preview, before `import/commit`; never used by update checks or MCP |

### 8.6 Status transitions

| Event | `status` | `enabled` |
| --- | --- | --- |
| Created in the app (blank, command, template) | `ready` | true |
| In-app save or rename of an existing skill | unchanged | unchanged |
| App import committed (after review) | `ready` | false |
| MCP `create_skill` | `needs-review` | false |
| Update check finds a newer upstream commit (app) | unchanged (pending version set) | unchanged |
| MCP `update_skill` | `needs-review` (pending version set) | false |
| MCP `rename_skill` | `needs-review` | false |
| Update accepted in the app | `ready` | false until the user enables |
| Share copy imported (S-13) | as for an app import | false |
| R2 blob missing on read, or after a restore | `broken` | false |
| Licence re-classified as `restricted` | `broken` with a licence notice | false |

### 8.7 Versioning and storage

**Settings versus content.** The toggles (`model_invocable`, `slash_command`),
`argument_hint` and `enabled` are settings. Changing them does not create a
version. The name, the description and every file are content. Every save,
rename, restore or import creates a version.

**A save writes only the files that changed.**

1. R2 puts first (they are idempotent, because the key is the content hash).
2. Then one `db.batch()` inserts the version and its file rows and updates
   `skills.current_version`, guarded on `baseVersion`. A stale `baseVersion`
   answers 409.

Blobs from a failed batch are orphans. The hourly sweep removes blobs older
than 1 h that no `skill_files` row references.

**Pending versions** are persisted, not staged: a `skill_versions` row with the
next number, its blobs under the same `blobs/` prefix, and
`skills.pending_version` pointing at it (section 3.4).

**Prune.** Keep `SKILL_VERSIONS_KEPT` (20) versions. A pending version, and a
version pinned by a share, are never pruned. After a version's rows are
deleted, the blobs that no remaining row references are deleted. Deleting a
skill is one prefix delete. `SKILLS_MAX_USER_BYTES` (50 MiB of unique blobs)
caps the worst case of rewriting 1 MiB files across 20 versions and 50 skills.

**Accept** also creates a new version. It does not promote the pending row's
number: it adds a row with the next number that points at the same blobs, then
deletes the pending row (section 3.4). Accept and reject are bound to the
reviewed content: the body is `{ version, sha256 }`, and a mismatch answers 409
"This update changed while you were reviewing it". So `current_version` only ever
increases, and no blob is copied.

**Restore** creates a new version. It never rewrites history.

### 8.8 Purge, cleanup and restore

- `purgeUserData` (`server/utils/account/purge-user-data.ts`) runs in the order
  at the top of this section. The coverage spec in
  `tests/unit/utils/account/purge-user-data.spec.ts` must see `user_id` on
  every skills table.
- Chat deletion removes `skill_chat_settings` rows.
- `docs/d1-restore-reconciliation.md` gets a new "Skills" section and summary
  rows (S-1):
  - `UPDATE skills SET enabled = 0` for rows touched in the window (or all);
  - replay skill deletes from Axiom;
  - diff the `user-skills/` blobs against `skill_files.blob_sha256`, and mark a
    row with a missing blob `broken`;
  - set `current_version` to the newest complete version;
  - with S-13, revoked shares come back: replay the revokes and turn the share
    flag off until that is done.

### 8.9 Later: sharing tables (S-13)

In S-13's own migration, not S-1's:

- `skill_shares`: `id`, `skill_id`, `user_id`, `token_hash`,
  `token_encrypted`, `pinned_version`, `created_via`, `client_id`,
  `expires_at`, `revoked_at`, `takedown_at`, `takedown_reason`,
  `import_count`.
- `skill_share_reports`: modelled on `artifact_reports`.

## 9. Limits

Constants in `shared/utils/skills-policy.ts` (S-1).

| Constant | Value | Used by |
| --- | --- | --- |
| `SKILL_MAX_FILES` | 200 | S-2 |
| `SKILL_MAX_TOTAL_BYTES` | 5 MiB uncompressed | S-2 |
| `SKILL_MAX_FILE_BYTES` | 1 MiB | S-2, S-4 |
| `SKILL_MAX_SKILL_MD_BYTES` | 256 KiB | S-2 |
| `SKILL_MAX_UPLOAD_BYTES` | 5 MiB compressed | S-2 |
| `SKILL_MAX_GITHUB_ARCHIVE_BYTES` | 15 MiB compressed | S-2G |
| `SKILL_MAX_RAW_URL_BYTES` | 256 KiB | S-2U |
| `SKILL_MAX_RATIO` | 100:1 | S-2 |
| `SKILL_MAX_PATH_LENGTH` | 200 | S-2, S-3 |
| `SKILL_MAX_PATH_DEPTH` | 6 | S-2 |
| `SKILLS_PER_USER` | 50 | S-2, S-6 |
| `SKILL_VERSIONS_KEPT` | 20 (was 2) | S-1, S-2, S-10 |
| `SKILLS_MAX_USER_BYTES` | 50 MiB of unique blobs per user | S-1, S-10 |
| `SKILL_IMPORTS_PER_HOUR` | 10 per user | S-2, S-2G |
| `SKILL_SAVES_PER_HOUR` | 120 per user | S-10 |
| `SKILL_SAVE_MAX_CHANGES` | 50 per save | S-10 |
| `SKILL_SAVE_MAX_BYTES` | 2 MiB per save | S-10 |
| `SKILL_EDIT_MAX_FILE_BYTES` | 256 KiB; larger files open read-only | S-10, S-11 |
| `SKILL_ARGUMENT_HINT_MAX` | 100 characters | S-1, S-10 |
| `SKILL_INVOCATIONS_PER_MESSAGE` | 1 | S-12 |
| `SKILL_RESERVED_SLASH_NAMES` | `new`, `model`, `search`, `image`, `memory`, `project`, `help` (section 5.6) | S-1 |
| `SKILL_GITHUB_PICK_MAX` | 10 skills chosen from one repository | S-2G |
| `SKILL_GITHUB_MAX_ARCHIVE_ENTRIES` | 20,000 entries in a repository archive (the directory scan; the 1,000-entry upload cap does not apply) | S-2G |
| `SKILL_GITHUB_API_MAX_BYTES` | 2 MiB per `api.github.com` answer | S-2G |
| `SKILL_GITHUB_TIMEOUT_MS` | 30 s per GitHub request, body read included | S-2G |
| `SKILL_GITHUB_REQUEST_DEADLINE_MS` | 60 s for all GitHub calls of one request | S-2G |
| `SKILL_GITHUB_API_BUDGET_PER_HOUR` | 50 `api.github.com` calls an hour for the whole app (KV, fails closed) | S-2G |
| `SKILL_GITHUB_REF_CACHE_SECONDS` | 60 (verified ref to SHA, KV) | S-2G |
| `SKILL_GITHUB_BRANCH_CACHE_SECONDS` | 600 (default branch, KV) | S-2G |
| `SKILL_DIFF_TOTAL_CELL_BUDGET` | 8,000,000 diff cells for one review; past it files are counted, not diffed | S-2G |
| `SKILL_DESCRIPTION_CATALOG_SOFT_MAX` | 300 characters | S-11 |
| `SKILL_STAGE_TTL` | 1 h (import preview only) | S-2 |
| `SKILL_DIFF_MAX_LINES` | 2,000 | S-2, S-4 |
| `SKILL_FINDING_LONG_LINE` | 2,000 characters | S-2 |
| `SKILL_FINDING_BLANK_RUN` | 50 lines | S-2 |
| `SKILLS_ENABLED_PER_CHAT` | 20 | S-3 |
| `SKILL_CATALOG_BUDGET_TOKENS` | 1,500 | S-3 |
| `SKILL_ACTIVATE_MAX_BYTES` | 40 KiB | S-3 |
| `SKILL_ACTIVATE_MAX_TOKENS` | 6,000, Cyrillic-aware, in addition to the byte cap (sections 5.3 and 5.4) | S-3, S-12 |
| `SKILL_READ_FILE_MAX_BYTES` | 64 KiB | S-3 |
| `SKILL_ACTIVE_BLOCK_MAX_TOKENS` | 12,000 | S-3 |
| `SKILL_STEPS_PER_TURN` | 4 | S-3 |
| `SKILL_VIEWER_FILE_MAX_BYTES` | 1 MiB (`GET /api/v1/skills/[id]/files`) | S-4, S-10 |
| `SKILL_MCP_FILES_MAX` | 50 per `create_skill` or `update_skill` | S-6 |
| `SKILL_MCP_FILE_MAX_CHARS` | 200,000 | S-6 |
| `SKILL_MCP_TOTAL_MAX_BYTES` | 400 KiB (under the 512 KiB `MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES`) | S-6 |
| `SKILL_MCP_DELETE_BATCH` | 20 | S-6 |
| `SKILL_PROVIDER_UPLOAD_MAX_BYTES` | 30 MB (Anthropic) | S-5 |
| `SKILL_PROVIDER_SKILLS_PER_REQUEST` | 20 (Anthropic) | S-5 |

The 40 KiB activation cap is below the 256 KiB `SKILL.md` cap on purpose: a
large `SKILL.md` stays importable, and the model reads the rest in 64 KiB
pages through `read_skill_file`.

## 10. UI placement, manager, editor and picker

### 10.1 Placement

| Place | What | Ticket |
| --- | --- | --- |
| Profile tab | `{ to: '/profile/skills', label: 'Skills', icon: 'lucide:sparkles' }` after Labs (and after Connectors once that exists), flag-gated. Commands live in the same tab. `isTabActive` already covers child routes | S-4 |
| Search popup | Settings row `search-option-skills`, same icon and label, flag-gated, id in `tests/unit/components/Search/Modal.spec.ts` | S-4 |
| User dropdown | Nothing | S-4 |
| "+" menu | Section "Skills" in `ToolsMenu/Content.vue` (section 10.5) | S-3, S-12 |
| Composer | The `/` picker and the invocation chip (section 10.5) | S-12 |
| Chat bubble | `Chat/SkillActivation.vue` chip (`badge badge-soft` with `lucide:sparkles`) for an activation, `Chat/SkillInvocation.vue` for an invocation; click opens the P0-11 `UiSidePanel` with `SKILL.md` as **plain monospace text**, version, short SHA, source, "Manage skills" | S-3, S-12 |
| Context panel | "Used → Skills" (name, activation count, version) from `data-skill-activation` and `data-skill-invocation` parts, owner view only | S-3, S-12 |
| Labs | `skills.scripts` opt-in with the cost note | S-5 |

Tab-row width: six profile tabs exist today (Security, API Keys, Memory,
Preferences, Connected apps, Labs), and the documented rule only guarantees
six. Skills is the seventh (the eighth once Connectors exists). Re-check the
row at 768, 1024 and 1440 px in light and dark. If it overflows, use the
`docs/connectors.md` section 10 fallback: one "Integrations" tab.

### 10.2 Manager (S-4)

`app/pages/profile/skills.vue`, components in `app/components/Profile/Skills/`
(List, Row, Filters, DetailPanel, ImportDialog, WorkspaceDialog, DiffView),
state in `app/composables/skills-library.ts`.

- **Header:** one line, "Skills teach the model how to do a task your way.
  Commands are skills you run with /name." On the right, a `btn btn-primary
  btn-sm` **New** that opens a daisyUI `dropdown` (a `modal modal-bottom`
  sheet below `sm`) with: Blank skill, Blank command, From a template, Upload
  .zip or .skill, Paste SKILL.md, and From GitHub (behind `skills.import-url`).
- **Filters** follow the documents-library precedent
  (`app/pages/chats/documents/index.vue`, `buildFilterOptions`). Top row:
  `HistoryBoxTabs` by source: **All sources**, Created, Imported, From apps.
  Kind row: `HistoryFilterButtons` with `badge-xs` counts: **All**, Skills,
  Commands (a skill that is both counts in both). Each row is hidden when it
  has fewer than two options, so there are never two identical "All" controls.
  `UiSearchInput` appears from 8 items. State lives in the URL query
  (`?source=&kind=&query=`).
- **Review banner:** `alert alert-warning alert-soft` "N skills need review"
  when any skill is `needs-review`, linking to the first one.
- **Rows** (`ul.list`, like `HistoryArtifactRow`): the name (shown as `/name`
  for a command) and a one-line description, as plain text; `badge
  badge-soft` for Skill and Command, and a status badge (Off, Needs review,
  Broken); a meta line ("Created by you · v7 · 2 h ago",
  "github.com/o/r/skills/x @ abc1234", or "Added by <client>"); an estimate
  such as "≈ 95 tokens in every message", shown only in mode Auto; a compact
  **mode control** (a `select select-sm` with Off, Auto and Only when I ask;
  the first turn-on of an imported or MCP skill asks for confirmation; a
  reserved name adds "Rename to use /name"); and a kebab menu: Edit, Use in
  new chat (S-12, behind `skills.commands`), Versions, Download .zip, Check for
  updates (GitHub only), Share (S-13), Delete.
- **Detail:** a click opens `UiSidePanel` (`open({ viewKey: 'skill:<id>' })`),
  docked from 1128 px, an overlay at md and a full-screen sheet below md.
  Inside the panel: **Instructions** (`SKILL.md` as plain monospace text with line
  numbers; findings marked with a background and a text marker; hidden
  characters shown as `⟨U+202E⟩`), **Files** (a `menu menu-sm` tree, a `select`
  on mobile), **Versions** (for example v7 "Edited in Besidka", v6 "Imported
  @abc1234", v5 "From Claude (MCP), pending"; each has "Compare with current",
  a unified diff with `+` and `-` and text labels, not colour alone, capped at
  `SKILL_DIFF_MAX_LINES`, and "Restore", which creates a new version) and
  **Settings** (the mode control with what each mode does, the argument hint,
  licence and source, and later the S-5 scripts toggle). The header holds the
  mode control and an **Edit** button.
- **Use in new chat** (S-12, behind `skills.commands`) opens `/chats/new` with
  the chip queued through
  `useChatInputPrefill().queue()` (`app/composables/chat-input-prefill.ts`).
  Nothing is sent.
- **States:** loading (skeleton rows, and `UiSidePanelSkeleton` in the panel);
  empty ("No skills yet. Create one, start from a template, or import a .zip or
  a GitHub link." and the New button); no results for filters; error (inline
  `alert alert-error alert-soft` with Retry, inside the view in the panel);
  broken skill (row badge plus "Files are missing. Restore an earlier version
  or delete it.").
- **Mobile:** a single-column list with full-width toggles; the New menu and
  the import dialog are bottom sheets; the detail is a full-screen sheet. Check
  Safari and the PWA in the iOS Simulator on the top layer's preview.

### 10.3 Create and import

- **Blank skill or blank command** opens the editor with a minimal template
  (frontmatter name and description, plus a body). The command template uses
  `$ARGUMENTS`.
- **From a template:** 3 to 4 Besidka-authored starters shipped as text under
  `shared/utils/skills/templates/`, for example writing style, code-review
  checklist, meeting notes, and translate with glossary. They are Besidka's own
  text, so they are not presets of third-party skills.
- **Archive, paste and GitHub import:** a dialog `modal modal-bottom
  sm:modal-middle js-skill-import-modal` with tabs Upload, Paste and GitHub.
  It leads to the review screen below, then "Install (disabled)". A GitHub
  repository with several skills shows a checklist ("This repository has 17
  skills. Choose which to import."), up to `SKILL_GITHUB_PICK_MAX` (10). The
  GitHub tab is hidden without `skills.import-url`.

Review screen (S-4; required before an import is installed and before an
update is accepted; shared with the editor in read-only mode;
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
- Footer: required checkbox "I reviewed this skill" (plus "I read the licence
  and may use this skill" for class `custom`, or "I have the right to
  use this skill" for class `none`), "Install (disabled)", "Cancel".

Update diff: per-file unified diff with `+` and `-` markers and a text label,
not colour alone, against the **current** version; new findings and licence
changes called out; when local edits exist since the import, the warning
"Accepting replaces your local edits since the import" (section 3.4); "Accept
update" disables the skill again.

### 10.4 Editor (S-11)

- **Shell:** the editor shares one shell with the review screen,
  `Profile/Skills/WorkspaceDialog.client.vue`, in read-only or edit mode:
  `max-w-5xl h-[85vh]` on desktop and a full-screen sheet below `sm` (the
  file-manager size). It is a dialog, not the side panel, because the side
  panel closes on route change and an editor needs an unsaved-changes guard.
  The guard follows the `TextFileModal` precedent: "Discard your unsaved
  changes?" through `useConfirm`. The iOS focus mechanism comes from
  `docs/chats/model-picker.md`: wrapper `inert` during `showModal()`, close
  button focused.
- **Left, the file tree.** Toolbar: Add file, Rename, Delete. Paths are
  validated live with the same `normaliseSkillPath` and extension allowlist as
  import. Imported `LICENSE*` and `NOTICE*` files are read-only and cannot be
  deleted (Apache-2.0 section 4). Files over `SKILL_EDIT_MAX_FILE_BYTES`
  (256 KiB) open read-only. On mobile the tree is a `select`.
- **Right, when `SKILL.md` is selected:**
  - **Name** (regex; uniqueness checked on blur; a reserved name is allowed and
    only keeps /name off) and **Description** (counter out of 1,024);
  - a live **token estimate** per model family, using
    `KNOWLEDGE_CHARS_PER_TOKEN` and the most conservative family; above 300
    characters it warns "Shortened in the catalog";
  - a collapsed **Advanced (YAML)** textarea for `license`, `compatibility`,
    `metadata`, `allowed-tools` and unknown keys, never rendered as HTML;
  - the **body**, a `textarea textarea-bordered font-mono` (the global
    `--radius-box` applies), bound to `useMarkdownTextarea` without the
    long-paste chip, like `Projects/InstructionsCard.vue`.
- **Other text files** use the same `textarea`.
- **Two tabs, Write and Model view** (the `NoteEditor` tab pattern). Model view
  is the preview: it shows the catalog line exactly as the model sees it, then
  the body as wrapped and sent (plain monospace), with findings highlighted and
  a token count against the caps. It does **not** render Markdown, which keeps
  section 2, item 9 (no image IP leak, no hidden text) with no amendment.
- **Live validation:** the shared `parseSkillMarkdown` and `scanSkillText`
  (`shared/utils/skills/*`) run client-side with a 300 ms debounce. Errors show
  inline with line numbers. Hidden characters offer the quick fix "Remove
  hidden characters". Shell commands and URLs are highlighted as on the review
  screen.
- **Footer:** an optional change note (up to 200 characters), Cancel and
  **Save**. Save sends `{ baseVersion, changes[] }`. A stale base returns 409
  "This skill changed since you opened it", with Reload and Compare. A save in
  the app keeps the skill's current enabled state.
- **Mobile:** full-screen, with the keyboard lift from the `TextFileModal`
  sheet rules.

**As built (S-11).** `EditDialog.client.vue` is the editor and
`app/composables/skill-editor.ts` holds its state; `WorkspaceDialog` gained
`mode="edit"` and `isDirty`, so Escape, the close button, the backdrop and
Cancel all ask "Discard your unsaved changes?".

- **One text for `SKILL.md`.** Name, Description, Advanced (YAML) and the body
  compose into one string (`shared/utils/skills/compose.ts`, written with
  `yaml`'s `stringify`). Validation, findings, the Model view and Save all read
  that string. An untouched file is sent back as it was read: the frontmatter
  keeps its bytes until the name, description or advanced YAML changes, so
  opening a skill never makes it dirty. When the frontmatter cannot be split
  into fields (no block, invalid YAML, a repeated key, a description that is
  not text) the editor shows the whole file in one box, so a broken skill stays
  fixable.
- **Changes** are built from the working set in the order the server applies
  them: deletes, renames, then the content of every new or changed file at its
  final path. A rename may not land on the original path of another file, so
  the saved renames never depend on their order. Files are read lazily from
  the version the editor opened on; only opened and changed files are sent.
- **Read-only.** A licence file of an open or custom skill allows nothing
  (no edit, rename, delete, or a new root `LICENSE` or `NOTICE` name). A file
  over `SKILL_EDIT_MAX_FILE_BYTES` opens read-only but can still be renamed or
  deleted. Sizes are counted in bytes.
- **Validation** runs 300 ms after the last keystroke
  (`parseSkillMarkdown`, `scanSkillTextWithCounts`). Errors block Save; hidden
  characters are a warning with the quick fix; findings show in the Model view.
  The name pattern and the reserved-name rule (only while "Use as /name" is on)
  are checked as you type, uniqueness on blur against the skills list. A
  `name-taken` or `reserved-name` answer from the server lands on the Name
  field.
- **409 `stale-base`** shows a banner above the editor and turns Save off.
  Compare shows what was saved since the version the editor opened on
  (`GET /versions/<latest>/diff?against=<base>`); a base that was pruned says
  so. Reload fetches the latest version and discards the draft after a
  confirmation. A rebase of the draft onto the latest version is not built.
- **Model view** shows the catalog line (`formatSkillCatalogLine`, the same
  function as the token estimate; no line for a slash-only command), then the
  text through the plain-text `FileViewer`, and the activation token count
  against `SKILL_ACTIVATE_MAX_TOKENS`. The byte cap
  (`SKILL_ACTIVATE_MAX_BYTES`) is not in the policy file yet, so only the token
  cap is shown.

### 10.5 "+" menu and composer (S-3, S-12)

As built in S-3 (section 5.7):

- **"+" menu row "Add skill"** in the Add section of `ChatInput/ToolsMenu/
  Content.vue`, after "Add artifact" (an `ActionRow`, `lucide:sparkles`, hint
  "Skills you made or imported", a badge of 1 while a skill is attached,
  `data-testid="tools-action-skills"`). It is shown only when the `skills` flag
  is on and the user has at least one enabled skill (the list is fetched once
  while the flag is on; none when it is off), and hidden for a deep-research
  model; the Add section renders for this row alone when files are not
  visible. The row opens `ChatInput/SkillPicker.client.vue`, a dialog (bottom
  sheet below `sm`, like the artifact picker) that lists enabled skills of any
  mode with name, one-line description and mode badge, a search field from
  eight skills (`COMPOSER_SKILLS_SEARCH_MIN`) and a "Manage skills" link to
  `/profile/skills`. Choosing one sets the single invocation (replacing the
  previous one) and closes the picker. An earlier inline "Skills" section that
  listed every skill in the menu was removed as too heavy. This replaces the
  per-chat `ToggleRow` catalog choice and `skill_chat_settings`: the catalog is
  every Auto skill.
- **Tile:** a pill `SettingTile` with `lucide:sparkles`, caption "Skill", the
  name as value and a remove button, after the setting tiles and before the
  artifact tiles. Tapping it opens the read-only preview (section 5.7), not the
  menu.
- **Send:** the message carries one `data-skill-invocation` part and may have
  no text. The send button is enabled for a tile alone. A failed send of a new
  chat restores the tile with the rest of the draft.
- **Sent messages:** the bubble shows a chip with the skill name above the text
  (it opens the preview); a shared chat shows nothing for it.
- **Reasoning and cards:** `activate_skill` is a card in the answer, not a
  reasoning step (section 5.7).

Planned for S-12 (the typed command), which adds `source: 'text'` to the same
state:

- **The `/` picker.**
  - **Trigger:** the text before the caret matches `^\s*\/[a-z0-9-]*$`, that is,
    the start of the message only.
  - **When it does not open:** during IME composition (`isImeEvent`), inside an
    open fence (guarded even though it cannot happen at the start), or when an
    invocation chip already exists.
  - **Shared state:** `useState('chat-input:open-popover')`, so opening it
    closes the tools menu and the model picker.
  - **Rendering:** an anchored `ul role="listbox"` above the textarea (the
    combobox pattern with `aria-expanded` and `aria-activedescendant`), up to 8
    rows: `/name`, a one-line description and a Skill or Command badge. A
    footer row "Manage skills". The empty state reads "No command named /xyz.
    Esc keeps it as text." A loading row comes first, then results.
  - **Keys:** Up and Down move; Enter and Tab choose. While the picker is open,
    `onKeydown` returns `true`, so **Enter never sends**. Esc closes and keeps
    the text. A space after an exact name chooses it.
  - **Mobile:** the same inline list, not a bottom sheet. A sheet would call
    `showModal`, steal focus and close the iOS keyboard. Rows are `min-h-11`
    and are lifted by the existing `useVisualViewportInset`.
- **Chip:** the typed `/name` becomes the same tile as the one in the "+" menu
  (S-3), with the caption "Command" for a skill that runs only when asked. The
  textarea placeholder shows `argument_hint`.
- **Sent messages:** the bubble shows the chip above the text. The context
  panel lists the invocation under "Used" (kind Skill).

Skill cards keep the earlier details: "Added by <client>" for MCP-created
skills, the status badge, the first-enable confirmation, and with S-5 "Allow
scripts in provider containers" and "Provider copy: stored in your Anthropic
workspace" with a remove action.

## 11. MCP exposure

An agent can add, edit, rename and delete skills over MCP, as well as list and
read them. Sharing is optional and arrives later (S-13).

New scopes: `skills:read` (read class) and `skills:write` (write class,
unticked by default). The name `skills:share` is reserved (section 12.1).
Labels: "See your
skills and their full text" and "Add or replace skills (saved switched off for
your review)". Deletes stay on `data:delete`. The scopes make the server a
**major version bump**: `config/mcp-server.ts` is at `3.1.0` on `main`, so the
release is `4.0.0`. Coordinator decision, 2026-11-13: `skills:share` is a name reserved in the docs only: S-6 does not
register a scope that has no tools, because a consent line that grants nothing
confuses users. If S-13 is ready before S-6 merges, the scope joins 4.0.0;
otherwise it ships with S-13 as its own major version bump.
The sharing tools behind it arrive with S-13.

Commands are skills, so there are no separate command tools. Outputs include
`modelInvocable`, `slashCommand` and `argumentHint`.

| Tool | Scope | Annotations | Input and caps | Behaviour |
| --- | --- | --- | --- | --- |
| `list_skills` | `skills:read` | `readOnlyHint` | `{ cursor?, limit? ≤ 50, kind? 'skill' or 'command' }` | Metadata only: `[{ id, name, description, enabled, status, licenseClass, sourceKind, sourceUrl?, sourceRef?, version, filesCount, bytes, createdVia, modelInvocable, slashCommand, argumentHint?, updatedAt }]` |
| `get_skill` | `skills:read` | `readOnlyHint` | `{ id, version?, path? }` | Metadata and file list; with `path`, the file text (at most 200,000 characters) plus a `truncated` flag |
| `create_skill` | `skills:write` | none | `{ files: [{ path, content ≤ 200,000 chars }] ≤ 50, total ≤ 400 KiB, must include SKILL.md; slashCommand?, modelInvocable?, argumentHint? }` | Saved disabled with `needs-review`. The licence gate runs and rejects `restricted`. Returns `{ id, name, enabled: false, status: 'needs-review', licenseClass, findings: [{ type, path, line }], reviewUrl }` |
| `update_skill` | `skills:write` | `destructiveHint` | `{ id, baseVersion, changes[] (put, delete or rename a file) ≤ 50, total ≤ 400 KiB }` | Writes a persisted pending version (section 3.4), disables the skill, sets `needs-review`. Changing `name` is rejected with "use rename_skill". `LICENSE` and `NOTICE` are protected. Returns the pending version, its `sha256`, `findings`, `reviewUrl` and `diffSummary`. The app's accept and reject are bound to `{ version, sha256 }`, so a change after the user opened the review is refused with 409 |
| `rename_skill` | `skills:write` | `idempotentHint`, not destructive | `{ id, name }` (regex, 1 to 64 characters, unique per user, reserved slash names refused) | Rewrites only the frontmatter `name`, as a new version (origin `rename`, note "Renamed from x"). Disables the skill and sets `needs-review` |
| `delete_skills` | `data:delete` | `destructiveHint` | `{ ids ≤ 20, confirm: z.literal(true) }` | `{ deleted, notFound }`, plus provider-copy deletion with S-5 |

**How `rename_skill` handles the name rules.**

- The rule that `name` equals the folder name holds by construction. Files are
  stored relative to the skill root, and the folder name is derived from `name`
  on download and on the S-5 upload, so no path moves.
- The `/command` follows the name. The tool output warns "/old no longer
  works".
- It disables the skill and sets `needs-review`, because an agent could
  otherwise rename a skill to a name the user types every day (section 6, K15).
  The in-app rename uses the same server path but keeps the skill enabled.

**Rules.**

- Files as text only, no URLs, no binaries. The same validation as the app
  (`parseSkillMarkdown`, `normaliseSkillPath`, `scanSkillText`, the licence
  classifier, which rejects `restricted` with a clear error).
- MCP never enables a skill and never sets toggles on an existing skill.
  Create-time toggles (`slashCommand`, `modelInvocable`, `argumentHint`) take
  effect only once the user enables the skill. There is no `allowScripts`, no
  activation or run tool, and no URL or GitHub import over MCP.
- `get_skill` and `list_skills` return only the caller's own skills.
- A limit of 30 skill writes per hour per user.
- Descriptions end with `Requires signing in (<scope>).`. The write tools add
  "The skill is saved switched off. The user must review and enable it in
  Besidka at <reviewUrl>."
- Logic lives in `server/utils/mcp/private/skills.ts` and the tools in
  `server/mcp/tools/{list-skills,get-skill,create-skill,update-skill,rename-skill,delete-skills}.ts`.
- Bookkeeping as for connectors: `DESTRUCTIVE_TOOLS` gains `update_skill` and
  `delete_skills`; scope lists (`shared/utils/mcp-oauth-scopes.ts`,
  `server/utils/mcp/tool-scopes.ts`), `app/components/OAuth/ScopeLabel.vue`,
  the scope picker and the connected-apps page; `pnpm run mcp:surface`; the
  `4.0.0` bump in `config/mcp-server.ts`, `server.json` and both plugin
  manifests; `docs/mcp-server.md` (tables and "What MCP does not do"); and the
  Privacy Policy scope list.

**Sharing tools (S-13, later).** Behind the reserved name: `share_skill
{ id, expiresInDays ≤ 30 }` and `revoke_skill_shares` under `skills:share`, and
`list_skill_shares` under `skills:read`. See section 12.1.

"What MCP does not do (and why)" additions (S-6): no enabling a skill, no
toggles on an existing skill, no script permission, no URL or GitHub import, no
activation or run tool. Why: a skill is a persistent instruction source, and an
injected agent must never switch one on. **Revisit when** a confirm-in-app
pending state exists that an agent cannot complete.

## 12. Never public

Invariants, each with a spec:

1. No route under `/.well-known/` (`/.well-known/agent-skills/` and the legacy
   `/.well-known/skills/` index), `/llms.txt`, the sitemap, `/raw/*.md` twins,
   `ai-catalog.json` or the MCP server card reads a user skill. The host skills
   in the repository's `skills/` directory stay about Besidka. S-1 spec: the R2
   key builder never yields a path the host skills mount serves.
2. Shared chats carry nothing from a user skill: `activate_skill` and
   `read_skill_file` tool parts are stripped like all tool parts, and
   `filterPublicParts` also drops `data-skill-activation` and
   `data-skill-invocation` parts (S-3, with a spec). The shared context panel
   shows no skills section. A user message that was only an attached skill is
   left out of the shared view and of a visitor's branch
   (`dropEmptyUserMessages`), instead of the neutral "(private command)" text
   planned earlier. The visible text part of an invocation holds only the
   arguments. S-3 and S-12 specs: no skill name or body text in the shared
   payload.
3. Skill objects have no public or signed-URL route; reads are authenticated
   and owner-checked in D1.
4. Axiom wide events carry skill ids and counts only (`attributes.skills`),
   never skill text or names.
5. MCP never returns another user's skill (S-6 spec); the `besidka-overview`
   host skill documents scopes, not content.

Commands comply with these invariants through part filtering and chip
conversion (section 5.5). Optional link sharing is the only real reversal, and
it is gated by its own addendum.

`docs/agent-readiness.md` ("Skills and the digest contract") gets a pointer
to this section in S-1.

### 12.1 Optional sharing by link (S-13, not in the first release)

Decided on 2026-11-13: build it later, as the last optional stack. Authored and
open skills only, signed-in viewers, 7 days by default and 30 at most, with its
own legal notice. Flag `skills.share`. It comes after the stack
"skills" (section 13).

- **Own stack, in order:** (1) S-8b, a `docs(legal)` pre-check addendum as a
  plain PR first; (2) the D1 layer (`skill_shares`, `skill_share_reports`,
  section 8.9); (3) routes and UI; (4) the MCP layer.
- **Link and viewer:** the token is in the path, `/skills/s/<token>`, stored as
  `token_hash` plus an encrypted copy. Signed-in viewers only. The route sends
  `X-Robots-Tag: noindex`, is robots-disallowed, and is excluded from the
  sitemap, `/llms.txt` and the markdown twins. A share is pinned to one
  version, and pruning keeps it. It expires in 7 days by default and 30 at most
  (shares created over MCP: 30 at most). It is revocable, with "Revoke all".
- **What the viewer sees:** the `WorkspaceDialog` in read-only mode, with every
  file in plain text, findings highlighted and the licence class shown.
- **"Import a copy"** runs the normal staged review. The copy has
  `source_kind = 'share'`, the classifier reruns, and it is saved **disabled**.
- **Licence rule:** share only `authored` skills and `open` skills (with
  `LICENSE` and `NOTICE` included; a modified `open` skill gains a CHANGES note
  under Apache-2.0 section 4(b)). Never `none`, `custom` or `restricted`,
  because Besidka would then distribute third-party text it holds no right to.
- **DSA and reports:** a link that any account holder can open counts as public
  dissemination. So the feature needs a Report button that reuses the artifact
  report and takedown path (the `app/pages/admin/artifact-reports.vue`
  pattern) with a `skill_share_reports` table, statements of reasons, and a
  takedown that also hides the share for viewers.
- **MCP:** the `skills:share` scope (reserved name), unticked by default, with
  `share_skill { id, expiresInDays ≤ 30 }`. `revoke_skill_shares` sits under
  `skills:share`, as the owner asked. The artifacts precedent would put revoke
  under `:write`, because it only reduces exposure; that is noted for the
  owner. `list_skill_shares` goes under `skills:read`.
- **Legal:** this reverses invariant 11 (section 2) and the "no sharing" line
  in the Terms. It needs a pre-check addendum (S-8b), new Art. 30 and DPIA rows
  (recipients are other users; the category is shared skill text), the DSA
  sentence changed from "private storage" to "hosting with public links", and
  a **separate material `LEGAL_NOTICES` entry**.

## 13. Ticket changes

**Order and dependencies (2026-11-13).** S-0 (this amendment) comes first, then
one native stack "skills", bottom to top: S-1, S-2, S-2G, S-10, S-4, S-11, S-3,
S-12, S-6. S-7 (legal) runs in parallel as a plain PR and gates `skills`
leaving `internal`. Then the testers, then S-9. The optional S-13 follows as
its own stack. S-2U waits for C-3, and S-5 waits for C-6 (its per-chat script
confirmation) and needs D-7 (on `main`). **Nothing in the first release waits
for C-3 or C-6**: GitHub import uses the narrow fetcher (section 3.1), and S-3
and S-12 use the interim tool rule (section 2, item 8). The lower layers can
ship early with `gh stack merge --squash` up to a given PR; for example, merge
S-1 to S-11 (the manager) while S-3, S-12 and S-6 are still in review. The
context-panel section needs P0-13. The MCP version number and order against
C-9, P0-8, P0-13 and A-8 are set at merge time; S-6 and C-9 ideally ship in one
major release (MCP `4.0.0` for the skills scopes).

Breach-runbook rows that S-7 adds (pre-check question 12): R2
`user-skills/` exposure (like the existing R2 row: random ids lower but do not
remove discovery; skills can hold third-party and company data); a leaked
per-user GitHub token, once it exists (revoke at GitHub, delete the `keys`
row; public-read-only, so low harm, but it identifies the user); a stolen
session that installed or enabled a skill (disable all of that user's skills,
delete provider copies where a key is held, then the session steps); and a
note that Anthropic workspace copies sit with the provider, so an exposed key
means the user deletes them in the Anthropic Console.

Ticket keys without a BES id are new on 2026-11-13.

| Ticket | Change |
| --- | --- |
| S-0 (new) | `docs(skills): authoring, versions, commands and GitHub import in the first release`. This amendment, the pre-check addendum, and the roadmap order. Plain PR, no flag |
| BES-231 (parent) | R2 layout is `user-skills/u<userId>/…`; folder-name mismatch is a warning, long descriptions are cut with a warning; "proprietary document skills" wording replaced by section 2 item 7; OpenAI scripts path not built; the phase now covers authoring, versions and commands, and moves ahead of Phase 3 (research deferred by the owner on 2026-11-12) |
| S-1 BES-264 | One migration with four tables, `CREATE TABLE` and `CREATE INDEX` only (a later nullable `ADD COLUMN` is allowed by the repo rules; only table rebuilds are banned) (section 8): `skills`, `skill_versions`, `skill_files`, `skill_chat_settings`; no FK to `users` on any of them (explicit purge plus the coverage spec); one sentence added to `CLAUDE.md` after the `documents` note, no cascade-list entry; blob layout `user-skills/u<userId>/<skillPublicId>/blobs/<sha256>` and `skills-staging/u<userId>/`, with the key builder, blob put and prune in `server/utils/skills/storage.ts`; `SKILL_VERSIONS_KEPT` 20; the reserved-name validator; the purge, the chat-delete cleanup and the hourly orphan sweep; the "Skills" section of `docs/d1-restore-reconciliation.md`; registry: add `skills.commands` and set `skills.scripts` to `spend: 'foreground'`, `optIn: 'required'`; a `besidka-preview` Time Travel bookmark before the bottom layer is created; `DROP TABLE` grep in the PR; status transitions of section 8.6 |
| S-2 BES-268 | Re-scoped to archive and paste: `.zip`, `.skill` and pasted `SKILL.md`; licence classifier on every source, and `authored` never assigned by import; `licenceAcknowledged` for `none` and `custom`; staging in KV and R2 with a 1 h lifetime for the import preview only; commit writes version 1 with origin `import`, disabled, or, after a name collision (409), takes `asUpdateOf` to turn the staged files into a pending version of the existing skill (replacing any older pending one), or the user renames the incoming skill; the accept and reject routes of section 3.4, gated by `skills` alone and bound to `{ version, sha256 }` (409 "This update changed while you were reviewing it" on a mismatch); Claude Code frontmatter mapped to toggle defaults; `yaml` and `fflate` as direct dependencies; route 404 spec when the flag is off |
| S-2G (new) | `feat(skills): import from GitHub links pinned to a commit`: the narrow fetcher (`server/utils/skills/import/github.ts`), the URL parser (`shared/utils/skills/github-url.ts`), `{ url }` on the import routes, and `update/check` with a persisted pending version (the local-edit warning and diff of section 3.4). Accept and reject are in S-2, not here: accept creates a new version row with the next number over the same blobs, so `current_version` only increases, and accepting disables the skill. The ref is resolved with one `api.github.com` call, a SHA from the URL must pass the reachability check of section 3.1 (K18), the repository-root licence files are inflated for subfolder imports, and the zip comes from `codeload.github.com/<owner>/<repo>/zip/<sha>`. Flag `skills.import-url`, which gates only `{ url }` and `update/check`. Not C-3-dependent |
| S-10 (new) | `feat(skills): versioned saves, file edits, diff and restore API`: list and create from blank or template; `PATCH` for settings only; versions list and save with `{ baseVersion, changes[], note? }` (409 on a stale base); diff, restore, files and download; templates; 120 saves per hour; every save reruns the classifier |
| S-4 BES-280 | Re-scoped: the manager page of section 10.2 (list, filters, detail panel, import dialog, review screen, diff view); licence class and wording of section 4; extra tick for `none` and for `custom`; scripts toggle tooltip names Anthropic only; plain-text viewer; diff with `+`/`-` markers; "proprietary" wording removed; tab row checked at 768, 1024 and 1440 px |
| S-11 (new) | `feat(skills): skill and command editor`: the `WorkspaceDialog` in edit mode, file tree, frontmatter fields, Model view, live validation and token estimate, unsaved-changes guard, the 409 flow, the iOS sheet rules |
| S-3 BES-276 | Re-scoped: catalog from model-invocable skills only, with Cyrillic-aware caps and `SKILL_ACTIVATE_MAX_TOKENS`; the **interim rule** of section 2 item 8 instead of the approval card (a spec for each point; C-6 later adds the card as an acceptance criterion on BES-244, not a blocker); side panel shows `SKILL.md` as plain monospace text (not rendered Markdown); `data-skill-activation` stripped from shares, no "Used skill" chip on shared pages; activation cut at 40 KiB and 6,000 tokens points to `read_skill_file`; memory write lock spec |
| S-12 (new) | `feat(skills): slash commands in the composer`: section 5.5 and the picker of section 10.5; `data-skill-invocation` part and `resolveSkillInvocationPart`; `$ARGUMENTS` substitution; one-shot versus persistent invocation; `filterPublicParts` drops the part; replay drops a part that no longer resolves; Enter never sends while the picker is open; iOS Simulator check that the keyboard stays open; the manager's "Use in new chat" action (the `useChatInputPrefill().queue()` chip). Flag `skills.commands` |
| S-5 BES-285 | Anthropic only; provider id in D1 columns, KV cache removed; substring rename rule; disclosure text of section 7; pinned version; deletion triggers; re-upload lazily when `current_version` differs from the uploaded version, not on every save; its own stack, needs C-6 and D-7 |
| S-6 BES-292 | Re-scoped: tools `list_skills`, `get_skill`, `create_skill`, `update_skill`, `rename_skill` and `delete_skills` (section 11); licence classifier in the shared validation; outputs gain `licenseClass`, `modelInvocable`, `slashCommand` and `argumentHint`; `update_skill` (a persisted pending version, which the app's accept (S-2, bound to `{ version, sha256 }`) turns into a new numbered version over the same blobs) and `rename_skill` set `needs-review` and disable the skill; `skills:share` not registered (reserved in the docs only); MCP `4.0.0`; the top layer, so it is the preview PR |
| S-7 BES-294 | Re-scoped to `docs(legal): skills and commands`; a plain PR in parallel with the stack that must merge, and its `LEGAL_NOTICES` entry be published, at least 30 days before `skills` leaves `internal`. Uses this document's licence and never-public sections; "Anthropic or OpenAI" becomes Anthropic only; adds the breach-runbook rows above; records the DSM Art. 17, GitHub and workspace-visibility reasoning from the pre-check; materiality per the pre-check input list (material). Also: Art. 30 row 10b reads "created or imported"; retention of up to 20 versions; an invocation equals a send to the same provider; DPIA rows for authored text and for commands; the Terms right-to-use promise for "create, paste or import" |
| S-8 pre-check (PR #739) | Its S-1 row and question 8 ask to add the skills tables to the `CLAUDE.md` cascade list; with no FK to `users` there is nothing to add (section 8). Staging prefix kept as `skills-staging/`, committed files moved to `user-skills/` as it recommends. A dated 2026-11-13 addendum records authoring, `authored`, enabled-on-save, 20 kept versions and commands. Coordinator to confirm |
| S-9 BES-316 | Plain PR after the testers. Never says "safe". Names the licence block. Claims no affiliation with the Agent Skills project or Anthropic |
| S-13 (new, optional) | `feat(skills): share a skill or command by link`: its own stack (S-8b legal addendum as a plain PR, D1 layer, routes and UI, MCP layer); section 12.1. Flag `skills.share` |
| S-2U (later) | `feat(skills): import a raw SKILL.md from any link`: needs `safeFetch` purpose `skills-url`, so it waits for C-3 |
| S-14 (optional) | `feat(composer): built-in slash commands`: client only; flag `composer.builtin-commands` (section 5.6) |

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
| A skills marketplace or a public gallery | Moderation, DSA notice-and-action and licence exposure; skills stay private hosting |
| Presets of third-party skills | Besidka's own templates are the only starters; presets that set model, reasoning or tools are deferred and, if built, are visible removable tiles (section 5.6) |
| Sharing in the first release | Optional and later (S-13, section 12.1): it reverses the never-public invariant and needs its own pre-check addendum and legal notice |
| A separate "commands" entity | It would duplicate import, licence gate, findings, versions, review, purge, restore, MCP and legal rows, and need `commands:*` scopes, which means another major MCP version (section 5.5) |
| Command flags in frontmatter | Skill text is untrusted; an imported skill must not make itself model-invocable or slash-invocable |
| Injecting an invoked skill into the system prompt | It would break the prompt cache; the body goes into the latest user turn |
| Pulling C-3 in for GitHub import | Its threats come from user-chosen hosts; the fixed-host narrow fetcher is enough (section 3.1) |
| Storing every file again in each version (`…/<version>/<path>`) | A one-line save would copy up to 200 files; content-addressed blobs write only what changed (section 3.5) |
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
- **A public skill gallery or marketplace**: only with moderation, DSA Art. 16
  notice-and-action, a DPIA pass and a new legal notice.
- **Link sharing (S-13)**: built only after the S-8b pre-check addendum, with
  its own `LEGAL_NOTICES` entry (section 12.1).
- **Raw-link import (S-2U)**: when C-3's `safeFetch` is on `main`. At that point
  the GitHub fetcher also becomes `safeFetch` with the same allowlist.
- **Presets**: if built, as visible, removable composer tiles (section 5.6).
- **Interim tool rule (section 2, item 8)**: replaced by the C-6 approval card
  when C-6 ships.
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
| 3 | Ship the per-user GitHub token in the first importer layer | Owner, after S-2G measures | Not in the first layer |
| 4 | Publish the skills legal notice when `skills` leaves `internal` (material, 30 days) | Owner, S-7 | One notice at that point |
| 5 | Whether the 2026-11-06 relicence reaches older copies | Counsel or Anthropic | Treat older copies as restricted |
| 6 | Seven or eight profile tabs, or one "Integrations" tab | Owner, after S-4 and C-7 measure the row | Separate tabs if they fit |

### Decided on 2026-11-13

The owner took the plan's defaults:

| # | Decision |
| --- | --- |
| 7 | **Sharing (S-13):** built later as the last optional stack. Authored and open skills only, signed-in viewers, 7 days by default and 30 at most, with its own legal notice. The name `skills:share` is reserved in the docs only. S-6 does not register a scope that has no tools. If S-13 is ready before S-6 merges, the scope joins 4.0.0; otherwise it ships with S-13 as its own major bump. |
| 8 | **Skills authored in the app** are saved enabled with no licence tick (class `authored`). Imports, updates, MCP writes and share copies stay disabled until the user enables them in the app. |
| 9 | **Runtime** (S-3 and S-12) ships before C-6, under the interim rule in section 2, item 8. The approval card comes with C-6, and connectors cannot exist before C-6 anyway. |
| 10 | **GitHub update versus local edits** (coordinator, 2026-11-13): the update check compares the skill's `source_version` with the latest upstream commit, and a newer commit creates a persisted pending version, not used until accepted (accepting disables the skill). If any version newer than the last import has origin `editor`, `template`, `mcp`, `rename` or `restore`, the review screen warns "Accepting replaces your local edits since the import" and shows the diff against the current version. There is no merge in the first release. Accepting makes the upstream version current, and the local versions stay in history (within the 20 kept) so the user can restore one (section 3.4). |

### Decided on 2026-11-14

| # | Decision |
| --- | --- |
| 11 | **Invocation mode (owner, after testing the S-5 manager on a phone):** one control with Off, Auto and Only when I ask replaces the enable toggle and the two invocation toggles. Every enabled skill is available as `/name` and from the "+" menu. A reserved name keeps `/name` off and the UI says "Rename to use /name". Section 5.7. |
| 12 | **Visible step:** an `activate_skill` call is a compact card in the answer ("Used skill · name"), which opens a read-only preview with an Edit button. Section 5.7. |
| 13 | **The invocation core ships in S-3, not S-12:** one invocation per message (`menu` source here, `text` in S-12), a generic 400 for every failure even with the flag off, injection into the latest user turn. Section 5.7. |

The owner also asked for these to be possible, and this document states each:
adding a skill by archive (`.zip` or `.skill`, section 3.1), adding one by
GitHub link (sections 3.1 and 10.3), separate MCP actions to create, edit
(`update_skill`), delete and rename skills (section 11), and optional sharing
(section 12.1).
