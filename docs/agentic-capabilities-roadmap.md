# Agentic capabilities roadmap

Status: **approved plan, Phase 0 in progress** (written 2026-11-08). This
file is the source of truth for the programme. The Linear project
"Agentic capabilities" (P-BES-3) holds the tickets, and the Linear document of
the same name points here once the docs sync has mirrored this file. Every
ticket that merges updates the status table in section 2.

## 1. Goal

Grow Besidka toward claude.ai-class capabilities (artifacts, documents, deep
research, connectors, skills, Google Drive) while keeping three properties:

- **BYOK.** Heavy work runs on the user's own provider and search keys or in
  their browser, never on the host's money.
- **About $0 for the host** in production (cost model in section 5).
- **Host-portable.** Cloudflare today; a VPS, Vercel or AWS later. Platform
  specifics stay behind small interfaces (`JobRunner`, `BlobStore`, P0-5).

Rule for every phase: **maximise MCP coverage except chatting and spending
the user's keys.** Listing, sharing, access lists, artifacts, documents from a
supplied spec, and connector and skill management go into MCP. Starting a
research run or anything else that spends a key does not
(`docs/mcp-server.md`, "What MCP does not do").

## 2. Phases and status

| Phase | Scope | Linear | State |
|---|---|---|---|
| 0 Foundation | Per-user feature access, admin, rollout and A/B, Labs, shared side panel, chat context panel, larger file manager | BES-224 | In progress: pre-check (P0-14) and this design (P0-1) in review |
| 1 Artifacts | Sandboxed HTML/React/SVG/Mermaid/Markdown artifacts, versions, per-viewer storage, LLM bridge on the viewer's key, public shares | BES-225 | In progress: A-2 runtime on `main`; native stack `artifacts` in review (A-1 store and owner API); `artifacts` available at stage `internal` |
| 2 Documents | PDF, DOCX, XLSX, PPTX from a validated JSON spec (hybrid renderer); provider-native code execution | BES-226 | Ticketed, after Phase 1 |
| 3 Research | Custom deep research on any tool-calling model with Brave/Exa, 5 to 10 minutes, about 200 sources, Workflows orchestration | BES-227 | Ticketed, after Phase 2 |
| 4a Connectors | User-brought remote MCP servers (OAuth client, approvals, registry search) | BES-229 | Ticketed, in parallel with Phase 1 |
| 4b Google | Drive Picker with `drive.file`, built-in Drive tools, BYO Google OAuth client for Gmail and full Drive, Calendar | BES-230 | Ticketed, in parallel with Phase 1 |
| 4c Skills | Agent Skills by URL or zip for any model, scripts in provider containers | BES-231 | Ticketed, after Phase 3 (S-5 needs D-7) |
| 5 Voice | Voice input and output | not ticketed | Roadmap only |
| 6 Scheduled routines | Scheduled tasks that reuse artifacts, research, documents and connectors; background spend behind Labs opt-in | not ticketed | Roadmap only |
| 7 Browser agent | An agent that drives a browser, shown in the side panel | not ticketed | Roadmap only |
| Computer use | | not ticketed | Deferred indefinitely |

Phase 0 tickets: P0-1 BES-232, P0-2 BES-234, P0-3 BES-236, P0-4 BES-238,
P0-5 BES-240, P0-6 BES-242, P0-7 BES-246, P0-8 BES-250, P0-9 BES-254,
P0-10 BES-258 (blocked on Flagship GA), P0-11 BES-262, P0-12 BES-266,
P0-13 BES-272, P0-14 BES-303, P0-15 BES-304.

Every track has a **compliance pre-check** ticket that gates its first
implementation ticket, and a **launch content** ticket at the end:

| Track | Pre-check | Launch content |
|---|---|---|
| Phase 0 | P0-14 BES-303 | P0-15 BES-304 |
| Phase 1 | A-12 BES-305 | A-13 BES-306 |
| Phase 2 | D-10 BES-307 | D-11 BES-308 |
| Phase 3 | R-11 BES-309 | R-12 BES-310 |
| 4a | C-12 BES-311 | C-13 BES-312 |
| 4b | G-11 BES-313 | G-12 BES-314 |
| 4c | S-8 BES-315 | S-9 BES-316 |

Pre-checks record their verdict in `docs/legal/agentic-capabilities-precheck.md`.
Phase 0's verdict is **GO with changes** (PR #731). The changes are already
in `docs/feature-flags.md` and the Phase 0 tickets.

### Execution order

1. Phase 0. P0-1 first; P0-9 and P0-12 in parallel; P0-11 side panel, then
   P0-13 chat context, before A-4 and any other panel consumer.
2. Two tracks in parallel: Phase 1 (A-1, A-2 and A-9 start together) and
   Phase 4a/4b (G-1 spike and G-2 owner tasks start at once).
3. Phase 2 (D-1 spike and D-7 code execution in parallel), then Phase 3
   (R-1, R-2, R-3 and R-6 can start once Phase 0 lands), then 4c.
4. Cross-phase joins: R-7 needs A-3 and D-3; G-5 save-to-Drive needs D-4;
   S-5 needs D-7. Phase 6 later reuses `DOC_RENDERER`, the orchestrator
   Workflow, artifacts and connectors.

## 3. Owner decisions (2026-11-07)

1. **Feature flags:** in-house evaluator now, OpenFeature-shaped, Cloudflare
   Flagship adapter later (Flagship public beta since 2026-05-26; pricing
   and Free-plan support unannounced). Design: `docs/feature-flags.md`.
2. **Artifact runtime:** a separate static Worker on `*.workers.dev`,
   `besidka-artifacts.chernenko.workers.dev`. Never a name that matches the
   auth wildcard `*-besidka.chernenko.workers.dev`. Follow-up option: a
   dedicated user-content domain.
3. **New MCP scope `artifacts:share`**, unticked by default. Shares created
   over MCP are always noindex, expire after at most 30 days, and have viewer
   storage and the LLM bridge off. This amends exclusion 2 of
   `docs/mcp-server.md` for artifacts only.
4. **Documents:** a hybrid renderer and one JSON-spec package. A lazy client
   chunk renders in chat; a separate `doc-renderer` Worker, reached through
   an RPC service binding, renders for MCP, research export and future
   schedules.
5. **Research overrides the "never on a general model" rule** in
   `docs/deep-research.md`. v1 failed because provider-executed search
   resolves inside one step; app-executed Brave and Exa tools loop correctly
   (`docs/deep-research-failed-attempt.md`). R-2 rewrites that rule.
6. **Gmail and full Drive only through a BYO Google OAuth client.** Drive
   uses the Picker with `drive.file` on Besidka's own client.
7. **Phase 4 connectors and Google run in parallel with Phase 1** after
   Phase 0.
8. **Side panel on the right.** The nav pill docks on the seam and keeps 5
   symmetric slots. Slot 5 is contextual: Chat context on chat pages, ⋯ More
   elsewhere.
9. **A chat context panel** (Outputs, Inputs, Used) instead of a sticky chat
   header.
10. **One native GitHub stack per feature or phase.** Each sub-issue is a
    layer, and the top layer is the feature's preview PR. Legal docs, spikes
    and owner tasks are plain PRs.
11. **Every UI change is verified** in the built-in browser, light and dark,
    at 1440, 768 to 1024 and 375 px. Mobile-affecting changes are also
    checked in the iOS Simulator in Safari and as a home-screen PWA, on the
    PR preview.
12. **No new OAuth client for Drive** (2026-11-07). Drive reuses the
    existing Google clients. A separate Google Cloud test project exists only
    to test the BYO client mode.

## 4. Decisions made in planning

- **No columns on `users` and no foreign key to `users`** in new tables
  (`research_jobs` precedent). `purgeUserData` deletes rows explicitly. The
  Better Auth admin plugin is rejected (it adds `users` columns).
- **Admin area at `/admin/*`**: role-gated, noindex, robots-disallowed, and
  reached from an admin-only Search popup row. Users get a `/profile/labs`
  tab for the features they can access and their opt-ins.
- **Rollout percentage and the global kill switch are UI-only, never MCP.**
  An injected agent could flip a feature for everyone. MCP may change access
  for one user (`docs/mcp-server.md`, exclusion 6).
- **Anything that spends the user's keys in the background needs an explicit
  opt-in, default OFF** (existing owner rule).
- **Workflows live in a separate orchestrator Worker**, deployed twice
  (`besidka-research`, `besidka-research-preview`), with HMAC callbacks into
  the app. A preview binding to a Workflow runs the deployed Workflow's code
  against its own bindings, and Nitro cannot export a `WorkflowEntrypoint`.
- **Money-spending Workflow steps use `retries.limit: 0` plus claim rows.**
  The default of 5 retries would bill the user's key repeatedly.
- **`DOC-001` (durable jobs) in `docs/chats/files-generation-tickets.md` is
  superseded** by a lightweight `documents` status row and the service
  binding. Durable orchestration comes from the Phase 3 Workflows when
  needed (D-6 updates that file).
- **New scopes instead of reusing old ones:** `artifacts:read`,
  `artifacts:write`, `connectors:read`, `connectors:write`, `skills:read`,
  `skills:write`. Reusing `chats:read` or `files:write` would silently extend
  existing grants to the new resources, because consent is stored by scope
  name. `admin:features` and `artifacts:share` are new scopes too. Each new
  scope is a major MCP version bump; ship `admin:features` and
  `artifacts:share` together as 2.0.0 if the timing allows, else 2.0.0 and
  then 3.0.0. The planned scope table is in `docs/mcp-server.md`.
- **Public artifact viewers who are not signed in** get in-memory state only.
  Storage and the LLM bridge need sign-in (the sandbox's opaque origin has
  no identity).
- **Deleting a chat keeps its artifacts** in an Artifacts library (cleanup
  nulls `originChatId`). Deleting the account removes them.
- **Brave-only users get snippet-only research** (no full page reads, which
  use Exa `/contents`). A raw-fetch `read_url` can later reuse the C-3
  SSRF-safe fetch wrapper.
- **Flag keys are dotted namespaces:** `artifacts.*`, `documents.*`,
  `code-execution.*`, `research.*`, `connectors.*`, `google.*`, `skills.*`.
- **Ticket titles use the commit types** and the Linear `Type` labels (feat,
  fix, chore, docs, test, ci). Spikes are `chore(...)`, legal docs are
  `docs(legal)`.
- **Adopted from the parallel research (2026-11):**
  - connectors: a CIMD-first OAuth client, PKCE and state held in KV, a
    refresh lock, a scope downgrade check, at most 40 tools per request, a
    tool-call audit log, presets (GitHub, Notion, Linear, Atlassian), and
    the registry only as a cached "search to add";
  - artifacts: a protocol compatible with MCP Apps, and an optional
    provider-native MCP fast path;
  - Drive: the `setFileIds` grant chip and URL auto-detection,
    snapshot/live/link semantics, no folder picking, Drive content hidden in
    shared chats, Save to Drive, and Google tools on REST instead of the
    official Drive MCP;
  - BYO client guidance to publish "In production";
  - skills: unzip limits and proprietary-skill licensing;
  - an encryption-key rotation note for self-hosters.
- **Rejected:** Google Testing mode for the family (7-day token expiry), the
  Cloudflare Agents SDK `MCPClientManager` as the core (Durable Object
  lock-in), the Better Auth `admin` plugin, and a custom full-Drive browser
  on Besidka's own client (restricted scopes).

## 5. Cost model (host vs user)

| Feature | Host (production) | User (BYOK) |
|---|---|---|
| Feature flags and admin | About 0: one D1 read per gated request, KV config cache | none |
| Artifacts | About 0: the static-assets Worker is free; R2 under 10 GB is free | 3k to 10k output tokens, about $0.01 to $0.15; bridge calls on the viewer's key, capped |
| Documents | Under $0.0001 CPU per document in the renderer Worker; client rendering is free | Spec tokens, about $0.01 to $0.20 |
| Code execution | 0 | Anthropic: 1,550 free container-hours per org per month, then $0.05/h; OpenAI about $0.03 per session; Gemini tokens |
| Research (max preset) | About $0.001 per run (about 40 Workflow steps; 500k steps per month are free on Paid) | Search about $0.20 to $0.50, plus tokens from about $0.20 (Flash) to $2 to $4 (Sonnet) |
| Connectors | About 0: outbound fetch, KV tool-list cache | Whatever the remote server charges |
| Skills | About 0: R2 text | Tokens for loaded skill bodies |
| Google Drive | 0 with the Picker and `drive.file` (no CASA); Calendar needs the free sensitive-scope verification | 0 |
| Gmail and full Drive | 0: runs on the user's own BYO Google OAuth client, so no CASA | 0 (Google API quotas on their project) |

Prices were researched in November 2026. Check them again before relying on
them.

## 6. Assumptions and the ticket that verifies each

| Assumption | Verified in | Result |
|---|---|---|
| The Worker runs on **Workers Paid** | P0-1 | **Yes, by three indicators, checked 2026-11-08** (section 6.1) |
| Flagship pricing and Free-plan support (blocks P0-10) | P0-10 | Open |
| A preview Workflow binding runs the deployed Workflow's code; `retries: 0` and `terminate()` behave as documented | R-1 | Open |
| Library Worker compatibility, bundle size, CPU, Cyrillic PDF | D-1 | Open |
| Drive Picker: app id = project number, reuse of a server-issued token, per-file grant persistence, shared drives, iOS Safari and PWA popup | G-1 | Open |
| Whether Better Auth encrypts stored OAuth tokens (Besidka uses its own Google store anyway) | G-3 | Open |
| Calendar scopes are sensitive, not restricted | G-2 | Open |
| Google's official Workspace MCP works with `drive.file` alone | G-7 (later) | Open |

### 6.1 Workers Paid: finding

Checked on 2026-11-08 with read-only commands only (`wrangler whoami` and
`wrangler d1 time-travel info`; no deploy, no change):

1. **D1 Time Travel goes back further than Free allows.**
   `wrangler d1 time-travel info besidka --env production --timestamp=2026-10-20T12:00:00Z`
   returned a bookmark for a point 19 days earlier. The Free plan keeps 7
   days of Time Travel; Workers Paid keeps 30. A timestamp 48 days back was
   refused with "Please provide a timestamp within the last 30 days". That
   message may come from the CLI rather than from the account's plan, so
   this indicator supports the conclusion but does not prove it alone.
2. **Email Sending is bound in production** (`send_email` binding `EMAIL` in
   `wrangler.jsonc`, `env.production`), and Email Sending needs Workers
   Paid (`docs/email.md`).
3. **The Worker bundle is above the Free plan's 3 MB limit**
   (`docs/mcp-server.md`, "Worker size").

Conclusion: **the production Worker is on Workers Paid.** It was not read
from the billing page of the dashboard: the CLI token has no billing scope.
If the plan ever drops to Free, the bundle size, Email Sending, the 30-day
Time Travel window in the restore runbooks, and the cost model above all
break. Account: the one `wrangler whoami` lists for this repo.

## 7. Cross-cutting conventions (every ticket)

- **Feature flag wiring:** registry entry, then `requireFeature` on every
  route, job and tool, then `useFeature` on the client, then a Labs opt-in
  if it spends keys. Details: `docs/feature-flags.md`, section 10.
- **MCP rule pack:**
  - flat `server/mcp/tools/*.ts` files with `withMcpPrivateTool`
    (`server/utils/mcp/private-tool.ts`), and logic in
    `server/utils/mcp/private/*.ts`;
  - exactly one scope per tool, and a new scope for anything that deletes,
    spends or publishes;
  - a scope lives in `shared/utils/mcp-oauth-scopes.ts`,
    `server/utils/mcp/tool-scopes.ts` and
    `app/components/OAuth/ScopeLabel.vue` (plus `ScopePicker.vue`, the
    connected-apps page and the Privacy Policy);
  - `DESTRUCTIVE_TOOLS` in `tests/unit/server/utils/mcp/tool-scopes.spec.ts`;
  - descriptions end with `Requires signing in (<scope>).`;
  - run `pnpm run mcp:surface`;
  - bump the version in `config/mcp-server.ts`, `server.json`,
    `plugins/besidka/plugin.json` and
    `plugins/besidka/.cursor-plugin/plugin.json`;
  - update the tables in `docs/mcp-server.md`;
  - never use the toolkit's per-tool `enabled` guard.
- **D1:** only `CREATE TABLE`, `CREATE INDEX` and nullable `ADD COLUMN`, with
  defaults in app code. Grep the migration for `DROP TABLE`. Apply to
  preview first, with a Time Travel bookmark. Add every new table to
  `docs/d1-restore-reconciliation.md` and to the account purge.
- **Workers:** at most 6 simultaneous connections; capture bindings before a
  fan-out; no `useEvent()` in background code; evlog only, no console.
- **Legal** (the agent's job, not the owner's):
  - the track's compliance pre-check before building;
  - Art. 30 and DPIA rows for each new personal-data category;
  - a Privacy Policy edit and `pnpm run legal:hash`;
  - the WP260 materiality check;
  - AI Act Art. 50 marking where content is generated;
  - WCAG 2.2 AA for every new surface
    (`docs/legal/agentic-capabilities-precheck.md`, section 3).
- **Telemetry:** Analytics Engine `blob1` is the event name and holds no user
  ids. Axiom data goes under `attributes.*`.
- **Tests:** register every new spec in `scripts/test-affected-check.mjs`.
  Run `pnpm run format && pnpm run typecheck` before calling a ticket done.
- **Docs:** a CLAUDE.md "Project Docs" entry for each new doc, and an update
  to the status table in section 2. Docs mirror to Linear on merge
  (`scripts/linear-docs-sync.mjs`; a new file gets its Linear document and
  map entry automatically).
- **Monorepo:** `pnpm-workspace.yaml` gains `packages/*` and `workers/*`.
  `.github/workflows/production.yml` gets a `deploy-satellites` job that
  runs before `deploy`. Satellite Workers deploy from `main` only, so their
  layers merge before consumers rely on them.
- **Chat context section:** every feature that produces or consumes
  something in a chat (A-4 artifacts, D-4 documents, R-6 research, C-5
  connectors, S-3 skills, G-4 Drive files) registers its section in the
  P0-13 context panel and in the aggregate endpoint, as part of its own
  ticket.

## 8. UX and UI principles

Besidka's design is minimal. There is no left history sidebar. A floating
vertical nav pill sits on the right (`app/components/Sidebar.client.vue`;
bottom bar below `sm`), with a centred chat column (`max-w-4xl`), the "+"
tools menu (`docs/chats/chat-input-tools-menu.md`) and bubbles. New features
must fit this without bloating it.

- **One shared side panel** (`UiSidePanel`, P0-11) hosts every "view a
  result" surface: artifacts, document previews, research reports,
  connector approvals, MCP Apps and later the browser agent.
  - At lg and up it opens on the right. The chat column shifts left and the
    nav pill docks on the seam as the divider. The panel can be resized (the
    width is remembered per device as a consent-gated Preferences key) and
    expanded to full width. Esc closes it, and focus is trapped only at full
    width.
  - At md it overlays the chat at about 70% width, with a scrim.
  - Below md it is a full-screen bottom sheet with the chrome of the model
    picker and tools sheets (`docs/chats/model-picker.md`), swipe-down to
    close, and the iOS keyboard rules (`docs/chats/ios-keyboard.md`).
  - Opening is always explicit, except that the first artifact of a
    streaming generation may open it once per chat. The chat never jumps
    scroll position.
- **The nav pill keeps 5 symmetric slots:** Home, User menu, New chat
  (centre), Search, and slot 5. Seven is the hard maximum.
  - Slot 5 is contextual. On owned chat pages it is the **Chat** button with
    a count badge, which opens the Context panel; branch, share and memory
    exclusion move into that panel's header. On shared chat pages it opens a
    read-only Context panel. Everywhere else it stays ⋯ More.
  - On chat pages, pin sidebar and cookie settings move into the User menu.
    This is an owner-directed exception to the "Security and API Keys only"
    rule for that dropdown.
  - Connectors, Skills, Labs, the Artifacts library and Admin never get pill
    slots. They live in profile tabs, the "+" menu and Search popup rows.
- **Chat context panel** (P0-13): a header with the title, project, cost,
  branch, share and memory exclusion, and the sections **Outputs**,
  **Inputs** and **Used**, each hidden when empty. Data comes from
  `GET /api/v1/chats/[slug]/context`, derived from persisted message parts
  and chat metadata, with no new tables.
- **Inline first, panel second.** Results appear as compact cards in the
  message, and the panel is the detail view.
- **Composer.** New capabilities are rows or tiles in the existing "+" menu,
  never new permanent buttons, and stay hidden until usable.
- **File manager** (P0-12): grow the modal on desktop to about `max-w-5xl
  h-[85vh]` and keep the bottom sheet on mobile. Tabs: All, Uploaded,
  Generated by AI, Google Drive.
- **States.** Every new surface designs its empty, loading and error states.
  Skeletons are honest, with no fake percentages. Use DaisyUI components
  only, and badges with daisyUI modifiers only.
- **Definition of done for UI:** checked in the built-in browser in light and
  dark at 1440, 768 to 1024 and 375 px, with screenshots attached to the PR
  through `gh pr create/edit --attach` (never committed). Mobile-affecting
  changes also need the iOS Simulator in Safari and as a home-screen PWA, on
  the PR preview. Accessibility follows WCAG 2.2 AA
  (`docs/legal/agentic-capabilities-precheck.md`, section 3.2).

## 9. PR strategy

Per `docs/stacked-prs.md` ("Native stack"):

- **One stack per feature track, never one stack for the whole plan.**
  - Phase 0 has two stacks: **0a** P0-2, P0-3, P0-4, P0-5, P0-6, P0-7, P0-8
    (flags, admin, MCP), and **0b** P0-11, P0-13 (UI shell).
  - Then one stack each for Phase 1, Phase 2 (with D-7 and D-8 code
    execution as their own stack), Phase 3, 4a, 4b and 4c.
- **Each Linear sub-issue is one stack layer:** one small PR with a
  conventional-commit title, because `gh stack merge --squash` puts one
  commit per layer on `main`.
- **Plain PRs** for independent tickets: legal docs, spikes, owner console
  tasks, P0-1, P0-9, P0-12, P0-14 and the launch-content tickets.
- **Previews.** Only the top layer builds and deploys `pr-<n>`, and that PR
  is the feature's preview PR. Lower layers check UI on the local dev server.
  The final light, dark and iOS checks run on the top layer's preview.
- **Short-lived stacks.** Run `gh stack sync` after `main` moves. A D1
  migration lands in the lowest layer that needs it.
- **Merges are done by the owner** (`gh stack merge --squash`).

## 10. Roadmap phases 5 to 7

- **Phase 5, voice:** speech in and out on the user's own provider keys.
  Related Linear issues: BES-16, BES-23.
- **Phase 6, scheduled routines:** tasks that run on a schedule and reuse
  the research Workflow, `DOC_RENDERER`, artifacts and connectors. Every
  routine spends keys in the background, so it requires a Labs opt-in and a
  cost cap.
- **Phase 7, browser agent:** an agent that drives a browser, shown in the
  side panel. It needs its own compliance pre-check (third-party sites,
  credentials).
- **Computer use:** deferred indefinitely.

## 11. References

- Design of the flag system: `docs/feature-flags.md`.
- Compliance pre-checks and the accessibility decision:
  `docs/legal/agentic-capabilities-precheck.md`.
- MCP rules and planned scopes: `docs/mcp-server.md`.
- Stacks: `docs/stacked-prs.md`. Previews: `docs/cloudflare-previews.md`.
- Restore: `docs/d1-restore-reconciliation.md`.
- Existing research: `docs/deep-research.md`,
  `docs/deep-research-failed-attempt.md`.
- Existing document plans: `docs/chats/files-generation-plan.md`,
  `docs/chats/files-generation-tickets.md`.
- Linear: project P-BES-3, https://linear.app/besidka/project/agentic-capabilities-6f32acc85522
