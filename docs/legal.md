# Legal pages

The Privacy Policy, Terms of Use and Cookie Policy are Nuxt Content documents in
`content/legal/`, rendered by `app/components/LegalDocument.vue` through three
thin pages under `app/pages/(legal)/`. They are Studio-editable like the landing
page.

Structural facts worth knowing before editing:

- **Three separate documents, deliberately.** Google OAuth verification requires
  a privacy policy on its own URL, and GDPR Art. 7(2) expects consent matters to
  be "clearly distinguishable" from contract terms.
- Slugs are `/privacy-policy`, `/terms-of-use`, `/cookie-policy`. The old
  `/privacy` and `/terms` were indexed, so `nuxt.config.ts` `routeRules` 301s
  them. Keep those redirects.
- **The published contact address is configuration, not content.** The pages
  write it as the MDC component `**:privacy-email-link{}**`, which resolves to
  `app/components/content/PrivacyEmailLink.vue`. That component reads
  `useRuntimeConfig().public.privacyEmail` (from `NUXT_PUBLIC_PRIVACY_EMAIL`,
  which `wrangler.jsonc` sets for the local, production and preview configs) and
  renders a `NuxtLink` to `mailto:<address>` whose text is the address. Keep the
  component form exactly: `**:privacy-email-link{}**`. The markdown twins and
  MCP render it as the plain address.
- **Failure mode: the address vanishes silently.** If the env var is unset or
  empty the component still renders, as a link to `mailto:` with no visible
  text, and nothing errors. Any verification must assert that the address is
  *present* in the rendered page, not merely that the page renders.
- The old `{{ privacyEmail }}` interpolation is gone from the pages.
  `LegalDocument.vue` still passes `:data="{ privacyEmail }"` to
  `ContentRenderer` and still has a comment about `{{ privacyEmail }}`. Both are
  vestigial: nothing in the markdown reads that data any more, so a
  `{{ privacyEmail }}` written in a page would publish literally.
- Frontmatter is **not** rendered through MDC. `description` becomes a meta tag
  and `summary` renders as plain text, so a component there would publish
  literally. Keep the email address out of frontmatter, and keep `summary` and
  `description` double-quoted without inner double quotes: an unquoted `: ` in a
  frontmatter value breaks the YAML (`tests/unit/config/content-frontmatter.spec.ts`
  guards this).
- **The list of account emails is generated, not typed.** The Privacy Policy
  "Email I send you" list is the block component `::account-email-list` (closed
  with `::`), `app/components/content/AccountEmailList.vue`. It imports
  `shared/utils/account-emails.ts` directly, like `PrivacyEmailLink.vue`, and
  renders the same three-item ordered list the policy used to have by hand. The
  registry has one entry per email with its `category` and the exact
  `policyText`; identical texts collapse and first-seen order is kept. The MCP
  `get_page` markdown renders the component through `createPageComponentRenderers`.
  The `/raw/legal/*.md` twins and `Accept: text/markdown` render both
  components through the same renderers (`agent-discovery-page-components`
  plugin, `docs/agent-readiness.md`). A new content component needs a renderer
  in `server/utils/mcp/pages.ts`, or the twins publish it as a literal
  `::name` directive.
  **Failure mode: the list vanishes silently.** A mistyped tag
  (`::account-emails`) renders nothing and nothing errors, so verification must
  assert the rendered text (`tests/unit/content/account-email-list.spec.ts`
  and `tests/unit/components/content/AccountEmailList.spec.ts` do).
- **A new email still needs its `policyText` reviewed in the PR.** The list
  and the date update on their own, but GDPR Art. 13 asks for notice of a new
  purpose or recipient, not only a new date. Read the wording, decide whether
  the email is a new purpose, and update `docs/legal/art30-record.md` if it is.
- **`updatedAt` is derived at build time, and the frontmatter value is the
  floor.** `nuxt.config.ts` hooks `content:file:afterParse` for the `legal`
  collection and sets `updatedAt` to the latest of the frontmatter date, the
  last git commit date of the page file and, for pages that use
  `::account-email-list`, the last git commit date of
  `shared/utils/account-emails.ts`, and, for pages that use
  `::legal-change-history`, the last git commit date of
  `shared/utils/legal-notices.ts` (`config/legal-updated-at.ts`). Any commit to
  a page, typo fixes included, moves its date, so the date means "last
  committed change", not "last substantive change". Raise the frontmatter value
  only to pin a later date than git reports. In a shallow clone git is ignored
  and the frontmatter value is used, because every file would report HEAD's
  date. The CI jobs that run `pnpm run build` (`build` in `production.yml` and
  `preview-build.yml`) therefore check out with `fetch-depth: 0`; a new job that
  builds needs the same. Nuxt Content caches parsed files in `.data/content`
  keyed on the file text, so a local build can keep a stale date after a
  registry-only change; remove `.data/content` to refresh. The legal pages spec
  asserts valid ISO dates, not fixed values.
- **The change history is generated too.** Every page ends its "Changes"
  section with a `### Change history` heading (its auto id is
  `#change-history`, which the notice email links to) and the block component
  `::legal-change-history{document="<slug>"}` (closed with `::`),
  `app/components/content/LegalChangeHistory.vue`. It lists the
  `LEGAL_NOTICES` that include that document, newest first, once their
  `publishedAt` has passed, and says "No material changes have been announced
  yet." when there is none (so a mistyped tag or a wrong `document` value
  cannot fail silently as an empty block). The `document` attribute arrives as
  `props.document`; the renderer in `server/utils/mcp/pages.ts` reads the same
  prop for `/raw/*.md`, `Accept: text/markdown` and MCP `get_page`, and lists
  every notice when the value is not a legal page id. `legal-pages.spec.ts`
  asserts each page parses to exactly one such node whose `document` equals its
  slug.
- `SURFACE_BY_PATH` in `server/utils/landing/client-events.ts` maps page paths
  to analytics surfaces and must track these slugs, or client analytics events
  from a legal page are rejected.
- **The Turnstile Privacy Addendum link is a compliance obligation, not
  a nice-to-have.** Enabling Cloudflare Turnstile (the `captcha` plugin —
  see `docs/auth-security.md`) requires this site's Privacy Policy to
  reference Cloudflare's Turnstile Privacy Addendum
  (https://www.cloudflare.com/en-gb/turnstile-privacy-policy/). It lives
  in the "Who else receives your data" section, right after the
  recipients table. A future edit to that section must keep this link —
  removing it silently breaks the condition Cloudflare attaches to using
  Turnstile at all.

## Consent records

The consent gate (`CURRENT_CONSENT_VERSION = '2026-11-a'` in
`server/utils/legal/consent.ts`) is one gate for every signed-in user (existing,
email, Google, GitHub, passkey). It has two separate unticked boxes: the Terms of
Use with the 18+ confirmation, and the explicit Art. 9(2)(a) consent described
in the Privacy Policy section `#sensitive-information-in-your-chats`.

- **The records live on `user_settings`, not in `CONSENT_DB`.** The nullable
  columns are `terms_accepted_at`, `terms_version`, `age_confirmed_at`,
  `sensitive_content_consent_at`, `sensitive_content_consent_version`,
  `sensitive_content_consent_withdrawn_at` and `provider_transfer_consents`
  (JSON, per provider: `consentedAt`, `withdrawnAt`). The migration is
  `.drizzle/migrations/20261026144709_legal_consent/migration.sql` (additive
  `ALTER TABLE ... ADD`, no rebuild). Withdrawal writes a withdrawal timestamp
  and keeps the earlier ones. The columns go away with the account. Times are
  stored in whole seconds; the code floors `now` before it writes or compares,
  so a withdrawal and a re-consent inside the same second leave a current
  consent.
- **Only the latest grant and withdrawal live in the database.** A re-consent
  overwrites the grant time and version, and a second withdrawal overwrites the
  withdrawal time. The full history (every grant, withdrawal and transfer
  consent, with the version) is in the Axiom wide events under
  `attributes.legalConsent` (`action`, `version`, `provider`). So the proof of
  an earlier grant lasts as long as the Axiom retention of the plan in use;
  that retention is an open placeholder in `docs/legal/dpia.md` section 8.
- **Why not `CONSENT_DB.consent_receipts`.** That table is pseudonymous by design:
  no user id, cookie receipts only. A record that proves what a named user
  agreed to needs the user id, and putting it in `CONSENT_DB` would either break
  that pseudonymity or break the rule that `CONSENT_DB` stays isolated from the
  main database. The earlier plan to reuse it (in
  `docs/legal-memory-sensitive-data.md`) is superseded.
- **The predicate is `server/utils/legal/consent.ts`.** Status is `current` only
  when `sensitive_content_consent_version` **and** `terms_version` both equal
  `CURRENT_CONSENT_VERSION`, `terms_accepted_at` and `age_confirmed_at` are set,
  and the consent was not withdrawn after it was given. One version string
  therefore gates the Terms acceptance, the age confirmation and the Art. 9
  consent together. `currentLegalConsentCondition()` is the same rule as SQL for
  the background memory passes.
- **Bumping the version re-prompts everyone.** Change `CURRENT_CONSENT_VERSION`
  when the consent text changes in a way that matters (a new purpose, a new kind
  of recipient). Every user then has status `outdated` and must confirm the gate
  again before the next send. `CURRENT_CONSENT_TEXT_SHA256`, next to the
  version, is a hash of the two consent boxes' wording in
  `app/components/Legal/ConsentModal.client.vue` (the `data-consent-text`
  spans). `tests/unit/server/utils/legal/consent-text-version.spec.ts` fails
  when the wording changes and the hash does not, so a wording change cannot
  ship without a deliberate decision on the version.
- **One version covers chats, project memory and memory.** There is no separate
  memory consent. A `2026-10-a` text was never shipped and nobody consented to
  it, so no record can be in that state.
- **Refusal or withdrawal blocks sending and storing new content.** Owner
  decision, 2026-10-26: the consent covers storing, so content writes are gated
  as well as sends. The server answers 403 with the code
  `LEGAL_CONSENT_REQUIRED` on: chat send and new chat, chat title generation
  (which falls back to a plain title instead), deep research start and
  clarify, file upload and create, project knowledge items (create and
  description edit) and notes (create and edit), project instructions, memory
  entry create and edit, "tell Besidka what to remember" (preview and apply),
  memory import, extract-now, backfill start and step, project memory refresh,
  and chat branch from an own chat or from a share. The extraction and backfill
  sweeps skip such users. Reading, exporting and deleting stay open: the
  knowledge commit (it only removes items and rebuilds the index), item and
  entry delete, memory reset, the share handoff (it sends a push with a link
  and stores nothing) and clearing the legacy about-me text are not gated.
- **Consent is read once per request.** A withdrawal that arrives while an
  answer is streaming does not drop that answer: the assistant message of the
  request already under way, and a deep-research job already started, are
  still saved. The next message is refused. Accepted, owner decision
  2026-10-26; the policy speaks of new messages.
- **Rollout.** When this ships, every existing user has status `missing` until
  they consent. Until then the extraction sweep skips their chats (including
  users who opted in to background extraction), and a backfill that is running
  stalls: the sweep skips it and its step route answers 403. Both resume after
  the user consents.
- **The client shows the dialog for any consent 403.** Every consent refusal
  carries `code: 'LEGAL_CONSENT_REQUIRED'` or `'TRANSFER_CONSENT_REQUIRED'`
  (with `data.provider`). `useLegalConsent().handleConsentError()` reloads the
  consent state and opens the matching dialog. The client cache is keyed by the
  signed-in user and cleared on sign-out.
- **Transfer consents** (Art. 49(1)(a)) for DeepSeek, Moonshot AI and Qwen are
  stored in `provider_transfer_consents` and managed in **Profile → Security →
  Privacy & consent**. Deleting the DeepSeek, Moonshot AI or Qwen key withdraws
  the consent (their `server/api/v1/profiles/keys/<provider>/index.delete.ts`
  routes call `withdrawProviderTransferConsent`). The gateway-vendor and
  `router` consents below have no key of their own, so deleting a gateway key
  does not withdraw them; only the Privacy & consent page does. Owner decision,
  2026-10-26: the same consent is required for a model reached through a
  gateway (Vercel, OpenRouter or Cloudflare) when its id names one of these
  vendors (`deepseek/`, `moonshotai/`, `alibaba/` or `qwen/`), because the
  gateway passes the request on to that company. Models a gateway runs itself,
  such as Cloudflare's `@cf/` Workers AI ids, do not need it. The mapping is
  `resolveTransferConsentProviderId()` in `shared/utils/legal-consent.ts`, used
  by the chat send, title generation, the memory model resolver and the client.
  Owner decision, 2026-10-26 (delta audit finding 5):
  - The vendor list covers the other mainland-China/Singapore-linked vendors
    present in the Vercel and OpenRouter catalogs on that date, each a
    gateway-only entry (`route: 'gateway'`) in `transferConsentProviders`:
    `zai` (`z-ai/`, `zai/`; Singapore, JINGSHENG HENGXING TECHNOLOGY PTE.
    LTD., docs.z.ai privacy policy and DPA), `minimax` (`minimax/`; Singapore
    entity Nanonoble Pte. Ltd., storage stated as US), `tencent` (`tencent/`;
    China, since Tencent Cloud names no fixed Hunyuan region and says servers
    may be in mainland China) and `bytedance` (`bytedance/`,
    `bytedance-seed/`; BytePlus states processing in Malaysia, Indonesia
    and/or the EU, shown as "Malaysia or Indonesia"). `zhipuai/` and `baidu/`
    were not in either catalog. Follow-up owner decision the same day: the
    other mainland-China vendors present are mapped defensively to China,
    like `tencent`: `xiaomi` (`xiaomi/`), `meituan` (`meituan/`), `stepfun`
    (`stepfun/`), `inclusionai` (`inclusionai/`), `teleai` (`xingchen-agi/`,
    China Telecom's TeleAI) and `dotsstudio` (`dots-studio/`). Provider ids
    never contain a hyphen, because they are JSON path segments in the
    `json_set` writes to `provider_transfer_consents`.
  - OpenRouter's `~vendor/...-latest` aliases resolve to the vendor after the
    `~` (before this, `~deepseek/...` needed no consent at all).
  - Router ids that can reach any vendor need one generic `router` consent
    (`route: 'router'`): every `openrouter/` meta-router (`openrouter/auto`,
    `openrouter/free`, ...) and any model string containing `@preset/`
    (OpenRouter accepts `@preset/<slug>` as the model and as a
    `model@preset/<slug>` suffix). The transfer dialog
    (`TransferConsentModal.client.vue`) has its own router wording; the
    consent modal and its hash are unchanged. Vercel AI Gateway's catalog
    had no router id. All of it lives in the existing
    `provider_transfer_consents` JSON, no migration.
  Writes to `provider_transfer_consents` are one atomic `json_set` UPDATE each,
  so concurrent grants and withdrawals for different providers cannot drop one
  another. The consent routes share the `legal-consent` bucket of
  `server/utils/memory/rate-limit.ts`.
- The gate copy, the Privacy Policy section, `docs/legal/dpia.md` and
  `docs/legal/art30-record.md` must be edited together. If a change alters what
  the user agrees to, bump the version.
- **Adding TypeSafe AI did not bump the version (2026-10-26).** The Art. 9
  box names recipients by category, not by vendor: "the AI providers, AI
  gateways and search providers whose keys I add (for my chats, project
  memory and memory)", and it already names the automatic check before text
  is saved to memory. TypeSafe AI is an AI provider whose key the user adds,
  used at the time only for memory checks, so the agreed wording covers it and
  the hash is unchanged. A wording that listed vendors would have needed a bump. The
  recipient is listed in the Privacy Policy (recipients table, Memory and
  Transfers sections), in `docs/legal/art30-record.md` row 11a and in
  `docs/legal/dpia.md` section 3.7a and risk row 20. Design:
  `docs/memory-architecture.md` 3.19.
- **The TypeSafe AI roles, one list for every legal document.** The source of
  truth is `JEV_ROLE_IDS` in `shared/utils/jev-policy.ts`: `memoryChecks`,
  `autoWebSearch`, `extractionPrefilter`, `injectionScreening`, `rerank`,
  `sharePiiCheck` and `pastChatRetrieval`. Default: all seven are on once the
  user saves a TypeSafe AI key (`user_settings.typesafe_roles` null means all
  on, and a missing role id means on); saving the key is the opt-in, each role
  has its own switch under Profile → API Keys → Smart checks, and deleting the
  key stops every role. Failure direction, from the code: `memoryChecks` fails
  open to the deterministic gate alone and can only add a refusal;
  `autoWebSearch` fails toward searching; `extractionPrefilter` fails toward
  generating memory as usual; `injectionScreening` treats undecided text as
  unscreened (search results are kept, project files and notes are stored
  `ready` and queued in KV for re-screening by the hourly knowledge sweep,
  kept 14 days, at most 5 failed attempts); `rerank` keeps the original
  order; `sharePiiCheck` only ever warns, and shows the generic reminder when
  Jev did not answer; `pastChatRetrieval` fails toward searching the past
  chats. Every text is stripped of never-store values before it is sent. A new
  role means editing the Privacy Policy table "TypeSafe AI checks", the
  DPIA table in section 3.7a, Art. 30 row 11a and this list in the same
  change.
- **Broadening TypeSafe AI to per-role checks did not bump the version
  (2026-10-26).** The pinned Art. 9 wording names recipients by category:
  "the AI providers, AI gateways and search providers whose keys I add (for
  my chats, project memory and memory)". TypeSafe AI is an AI provider whose
  key the user adds. The new checks (Auto web search, the memory pre-filter,
  injection screening, re-ranking, the share personal-data check and
  past-chat retrieval) send text from the user's chats, project memory and
  memory to that provider, which the wording already covers. Nothing about
  what is collected, or for which purpose beyond that, changes, and the hash
  is unchanged. Each check has its own toggle under Profile → API Keys →
  Smart checks. **Open owner and counsel question:** whether screening
  Brave and Exa results and project knowledge files (third-party text, not
  strictly "my chats, project memory and memory") and sending whole
  transcripts for the pre-filter still fit that wording, or need a wording
  change and a version bump. See `docs/legal/memory-legal-changes-draft.md`.
- **Connected AI apps (OAuth) have their own consent record, 2026-10-29.**
  Besidka is an OAuth 2.1 authorization server for its MCP server at
  `https://besidka.com/mcp` (Better Auth `@better-auth/mcp`). The user's
  approval of a client and its scopes (read: `chats:read`, `projects:read`,
  `memory:read`, `files:read`, `settings:read`; write: `projects:write`,
  `memory:write`, `chats:write`, `files:write`, `settings:write`, see
  `shared/utils/mcp-oauth-scopes.ts`) is a row in `oauth_consents`
  (`server/db/schemas/oauth.ts`: user id, client id, scopes, timestamps). It is
  **not** on `user_settings`, **not** in `CONSENT_DB`, and **not** a copy of the
  gate record above. Two things it is, and it must not be read as anything
  more:
  - an **authorisation instruction** to Besidka to disclose the approved data
    to that client (the Art. 6(1)(b) basis, a judgment call: `docs/legal/dpia.md`
    section 6, item 13), and
  - the carrier of the **Art. 9(2)(a) explicit consent** for sensitive data in
    what the client reads, per client and per scope. The gate's wording names
    "the AI providers, AI gateways and search providers whose keys I add", so
    it does not reach a connected client. The `/oauth/consent` page text must
    therefore say that chats, projects, files and memory can hold sensitive and
    third-party data, that approving sends it to that app, that the app may be
    outside the EU and that Besidka has no contract with it (the Art. 49(1)(a)
    warning). Without that text the record proves nothing. The Privacy Policy
    section `#connected-ai-apps` promises it.
- **`CURRENT_CONSENT_VERSION` is not bumped for connected apps (2026-10-29).**
  `CURRENT_CONSENT_TEXT_SHA256` covers only the two `data-consent-text` spans in
  `app/components/Legal/ConsentModal.client.vue`, and that file is unchanged, so
  the hash is unchanged and `consent-text-version.spec.ts` keeps passing. The
  new consent is collected on the OAuth approval screen, not by widening the
  gate, so nobody is re-prompted. The new Terms clause (`#connected-apps`) does
  not need a new Terms acceptance either: the feature is opt-in, and its
  approval screen is where the user meets it. The version would have to change
  if the modal wording ever named connected apps or MCP, or if the gate were
  made to cover them.
- **Six new scopes, still no consent version bump (2026-10-30).** UI parity
  added `files:read`, `settings:read`, `chats:write`, `files:write`,
  `settings:write` and `data:delete` (all permanent deletion, 11 resource
  scopes in all; `docs/mcp-server.md`). The gate record and
  its text are unchanged; the approval screen (`ScopePicker`, `ScopeLabel`,
  the legal paragraph naming files) and the Privacy Policy and Terms carry the
  new wording, including that deletions are permanent. Any client whose stored
  scope list is a strict subset of the current one gets the new scopes only as
  something it may *ask for* (the `/oauth2/authorize` upgrade,
  `server/utils/oauth/client-scope-upgrade.ts`); a user's consent row is not
  widened, so the consent page asks again for each new scope, and no existing
  approval includes `data:delete`. **Known limit:** consent is stored per scope
  name, so a tool added behind a scope the user already granted reaches the
  existing approval with no new prompt. That is why every deletion sits behind
  `data:delete` (a "Change" scope still has side effects: `update_chat`
  `memoryExcluded` removes extraction-only memory entries learned only from
  that chat, `revoke_chat_shares` removes share links, and edits replace old
  text), and why extensions of an existing scope must involve no deletion or
  spend, though overwrites are possible (so far `update_project` and
  `update_project_knowledge_item` under `projects:write`, and
  `list_shared_chats` and the share status under `chats:read`, whose share URL
  needs `chats:write` too). The Privacy Policy says this ("When a permission
  grows"). A future scope must keep the first rule: never extend a stored
  `oauth_consents` row without the user ticking the scope.
- **Gate integration for connected clients (required, built).** The MCP
  server must treat a user whose gate status is not `current` like the in-app
  routes do: read nothing and change nothing for a connected client until the
  user consents again. Every MCP write tool is gated like its in-app twin
  (chats, projects, project instructions, knowledge notes, files, memory
  entries and settings; the route list above), and a memory write over MCP runs the never-store and
  sensitive-topic gate. Reading is not left open for connected clients: for
  the user, reading stays open because it only shows their own data; for an
  app it is a disclosure to a third party.
- **History of approvals.** `oauth_consents` shows the current approval only.
  Whether revoking deletes the row or marks it decides whether the proof of an
  earlier approval survives. Follow the convention above: log every grant and
  revocation to Axiom under `attributes.legalConsent` (action `oauth-granted`
  or `oauth-revoked`, with client id and scopes), so the history is
  provable for as long as the Axiom retention lasts. Open until built.
- **Account deletion and restore.** `oauth_consents`, `oauth_access_tokens`
  and `oauth_refresh_tokens` reference `users` with no `ON DELETE`, so they are
  not in the cascade list in `CLAUDE.md`. The account-deletion path must remove
  them explicitly, or the Privacy Policy sentence "your approvals and tokens
  for connected AI apps" under "Deleting your account" is false. After a D1
  restore, revoked approvals and tokens come back like revoked sessions do
  (`docs/d1-restore-reconciliation.md`): wipe `oauth_access_tokens`,
  `oauth_refresh_tokens` and `oauth_consents` with the sessions.
- **Where the connected-app text lives.** Privacy Policy `#connected-ai-apps`
  (plus rows in the legal-basis, recipients, retention and deletion sections),
  Terms of Use `#connected-apps`, one cookie row in the Cookie Policy, DPIA
  3.11 and risk rows 28 to 37, Art. 30 row 10a. Edit them together.

## Notifying users of changes

Engineer-drafted, not lawyer-reviewed. A change to a legal page is announced to
users when it is material. Three signals exist, and they are independent:

| Signal | Source of truth | Means | Effect |
| --- | --- | --- | --- |
| Last updated date | git commit date of the page (and of the registries it renders), `config/legal-updated-at.ts` | Cosmetic: something was committed | Date shown on the page, nothing else |
| `CURRENT_CONSENT_VERSION` | `server/utils/legal/consent.ts` | The consent text changed in a way that needs a fresh agreement | Everyone re-confirms the consent gate (see "Consent records"), unchanged by this feature |
| `LEGAL_NOTICES` | `shared/utils/legal-notices.ts` | A material change, announced in advance | Email to every verified account that exists when the notice is published, an in-app banner and an entry in the public change history |

**Who decides materiality: the author of the change, forced by CI.**
`shared/utils/legal-document-revisions.ts` records, per document, the hash of
its current markdown body, a `classification` (`material` or `minor`), the
`noticeId` for a material one and a one-line `note`.
`tests/unit/content/legal-revisions.spec.ts` hashes every `content/legal/*.md`
with `scripts/legal-revision-hash.mjs` and fails when the hash differs from the
record, so no text change merges without a decision. It also fails when a
`material` record names a notice that is not in `LEGAL_NOTICES` or does not
list that document. The failure message prints the new hash.

**The hash covers only the markdown body.** The frontmatter (`title`,
`description`, `summary`, `updatedAt`) is excluded and line endings are
normalised, so a date change and the git-derived date never trigger the gate.
The lists generated from registries (`::account-email-list`,
`::legal-change-history`) are directives in the body, so growing
`shared/utils/account-emails.ts` or `LEGAL_NOTICES` never moves a hash and a new
account email needs no notice (the spec asserts the directives are present and
the generated text is not typed by hand). Known gap: a substantive edit made
only in a frontmatter `summary` or `description` is not seen by the gate;
mirror any such change in the body.

### Materiality checklist (WP260 rev.01 paras 29 to 31)

Material, so a `LEGAL_NOTICES` entry is required:

- a new purpose of processing;
- a new recipient, provider or processor, or a new transfer to a third country;
- a change of legal basis;
- a longer retention period;
- a change in which rights users have, or how to exercise them;
- a change of controller or contact;
- in the Terms: new obligations or restrictions on users, fees or
  monetisation, changes to liability, grounds for termination or suspension,
  or dispute rules.

Minor, so record the new hash as `minor` with a note:

- typos, grammar, formatting, rewording and clarifications that do not change
  what Besidka does;
- renamed UI paths in descriptions;
- describing an opt-in feature already covered by the existing purposes and
  recipients;
- generated content (the `::account-email-list` and `::legal-change-history`
  directives).

When unsure, treat it as material: an unneeded notice costs one email, a missed
one costs trust and may breach the duty below.

### How the email is delivered

The email half is sent by the `legal-notice-sweep` cron job
(`server/utils/legal/notice-sweep.ts`, `server/plugins/legal-notice-sweep.ts`),
which is off by default and on only in the production Worker. It mails every
verified account created before `publishedAt`, from `sendFrom` until
`effectiveAt`, 25 a tick and 300 a day at most, renders the email once per
notice per tick, and records each delivery in
`legal_notice_deliveries` (one row per user and notice; kept until the account
is deleted, as proof of notice; see `docs/legal/art30-record.md`, row 20).
`docs/email.md` ("Legal change notices") has the claim, retry and error-code
rules. Two consequences for whoever publishes a notice:

- The daily cap means the last recipient is mailed about `users / 300` days
  after `sendFrom`, and the notice period that user actually gets is shorter by
  that much. Check the verified-user count against the daily cap before
  choosing `sendFrom` and `effectiveAt`. The registry spec requires
  `effectiveAt` to be at least `sendFrom` plus 30 days plus a 3-day buffer
  (14 plus 3 with `shortNoticeReason`), so the cap must clear the user count in
  those 3 days, or the buffer must be widened by hand. A delivery that still
  lands inside the notice period (less than 30 days, or 14 with a reason,
  before `effectiveAt`) is counted as `lateDeliveries` in the sweep's wide event.
- An account created after `publishedAt` is not mailed: it signed up to the new
  text. That is why `publishedAt` must not come before the deploy that ships
  the new text (see "How to add a notice").
- After the send window closes, list the rows that did not end up `sent` (the
  SQL is in `docs/email.md`, "Legal change notices") and decide what to do with
  each: a `failed` row with `attempts = 3` is a user who was never told.

### Why, and how long

- **GDPR Art. 12 to 14 and WP260 rev.01 paras 29 to 31.** Changes to a privacy
  notice must be communicated, and material changes (a new purpose, recipient or
  transfer) must be actively notified in good time before they take effect,
  not only published on the page.
- **Polish Civil Code art. 384(1) (KC art. 384¹).** A change to a template
  contract in a continuing relationship, which is what the Terms are, binds
  the user only if they were told and could end the relationship by the
  stated date. That is why the Terms clause tells the user they can delete their
  account before the change takes effect. Not checked against commentary.
- **DSA Art. 14(2)** asks providers to inform users of significant changes to
  their terms. Besidka follows the DSA notice rules voluntarily (see the
  2026-10-28 review), so this is adopted by choice, not an obligation we
  concede.
- **30 days, 14 for law or security.** `effectiveAt` must be at least 30 days
  after `publishedAt`. With `shortNoticeReason` set (a change required by law or
  needed for security) 14 days is enough, and the reason is stated in the
  notice. The registry spec enforces both, and also `effectiveAt >= sendFrom +
  30 days + 3 days` (14 + 3 with a reason), because emails arrive from
  `sendFrom` and, with the daily cap, over a few days after it. A notice stays
  "active" (banner) until 14 days after it takes effect.
- **Whom the notice reaches.** The in-app notice and the page publish first
  (`publishedAt`); emails go out from `sendFrom`, to verified accounts that
  exist at `publishedAt`. An account that signs up later agrees to the new text
  and is not mailed. The three Changes clauses and the account-email list in the
  Privacy Policy say exactly this, in the same words.
- **Legal basis (decided 2026-10-30).** Mainly Art. 6(1)(b): the Terms are the
  contract, and a change to a template contract binds the user only once it was
  delivered (KC art. 384¹). Art. 6(1)(c) where Art. 13(3) or 14(4) requires
  telling the user before a new purpose. Art. 6(1)(f) for the rest, with the
  right to object (Art. 21). The Privacy Policy legal-basis row and
  `docs/legal/art30-record.md` row 20 carry the same wording.
- **No unsubscribe.** The email is a legal notice about the service, not
  marketing, like the security notices. The policies say so. Do not add a
  marketing-style opt-out, and keep the email free of promotion.

### How to add a notice

1. Edit the page(s) under `content/legal/`.
2. Run `pnpm run legal:hash` and `pnpm vitest run tests/unit/content/legal-revisions.spec.ts`.
   The spec tells you which document changed.
3. Decide with the checklist above. Minor: set the document's `hash` to the new
   value, `classification: 'minor'`, drop any `noticeId` and write a one-line
   `note`. Stop here.
4. Material: add an entry at the end of `LEGAL_NOTICES` in
   `shared/utils/legal-notices.ts` with a unique `id` (`YYYY-MM-name`),
   `documents`, `publishedAt` (when the in-app notice appears; it must be at
   or after the deploy that ships the new text, because anyone who signs up
   between the deploy and `publishedAt` accepted the old text and is not
   emailed), `sendFrom` (emails start no earlier, at or after `publishedAt`),
   `effectiveAt` (at least 30 days after `publishedAt`, and at least 30 days
   plus 3 days of buffer after `sendFrom`; 14 and 14 plus 3 with
   `shortNoticeReason`). Check the verified-user count against the daily cap
   before choosing the dates. Add `alreadyAvailable: true` when the features
   are live before `effectiveAt`. Then write 3 to 6
   plain-English `summary` bullets in the policy's first-person voice that say
   what changes and what it means for the user. Then set each affected
   document to the new hash, `classification: 'material'` and that `noticeId`.
5. The text goes live with the deploy, but the notice must be published
   (`publishedAt`) before `effectiveAt - 30 days`. Write the page so it is
   accurate from the day it ships and say in the notice when each change
   applies if that is later.
6. Raise `CURRENT_CONSENT_VERSION` separately, and only if the consent text
   itself changed (see "Consent records").

## How legal text reaches production

A repo edit to `content/legal/*.md` reaches the production `CONTENT_DB` with no
manual step. Every link of the chain is in the repo:

1. **Collection.** `content.config.ts` defines the `legal` collection with
   `source: 'legal/*.md'`.
2. **Storage.** `nuxt.config.ts` sets `content.database` to
   `{ type: 'd1', bindingName: 'CONTENT_DB' }`. `wrangler.jsonc` binds
   `CONTENT_DB` to `besidka-content` in `env.production`, and to
   `besidka-content-preview` in the local config and in
   `env.production.previews` (every PR preview shares that one database).
3. **Build.** `pnpm run build` makes Nuxt Content render each collection into a
   SQL dump with a checksum, bundled into the Worker (`#content/manifest`).
4. **Deploy.** `.github/workflows/production.yml` runs on every push to `main`.
   Its `paths-ignore` skips root `*.md`, `docs/**` and similar, but **not**
   `content/**`, so a commit that touches `content/legal/*.md` builds and
   deploys. A docs-only commit does not deploy.
5. **Import.** On the first query to a collection in each Worker isolate,
   `@nuxt/content` (`runtime/internal/database.server.js`,
   `checkAndImportDatabaseIntegrity`) compares the checksum stored in
   `CONTENT_DB` (`checksum_legal`) with the one in the new build. If they
   differ it deletes the rows that left the dump, runs the new statements, and
   drops and recreates the table only when the collection structure changed. No
   migration command is involved. There is no `routeRules` cache on
   `/privacy-policy`, `/terms-of-use` or `/cookie-policy` (only the `/privacy`
   and `/terms` redirects), so the new text is served as soon as the import
   finishes.

Consequences and hazards:

- **Text and gate ship together.** The legal text and the consent gate that
  refers to it are in the same build, so they go live in the same deploy. Do not
  split them across deploys.
- **Studio goes through git.** Studio at `/_studio` publishes by committing to
  `besidka/besidka@main` (`docs/landing-studio.md`), so it takes the same path
  and cannot bypass the repo. A Studio draft opened before a repo edit and
  published afterwards would commit Studio's copy of the file; how Studio
  resolves that against a newer commit is not documented in this repo, so treat
  it as an overwrite risk. Do not edit `content/legal/*.md` in the repo and in Studio at the same
  time. In dev, opening the editor rewrites the file into Studio's own
  serialization.
- **Previews share one content database.** `besidka-content-preview` is shared by
  all PR previews and the long-lived `main` preview, so concurrent PRs that
  carry different legal text swap the stored text back and forth, one checksum
  at a time. The text a preview shows is the text of whichever build ran the
  last import.
- **An old Worker version can re-import old text.** `docs/security-audit-2026-10.md`
  ("Content DB re-import") records that a superseded Worker version with a live
  URL can re-import its older content into `CONTENT_DB`. The risk is accepted
  and tied to the `preview_urls` decision. After a legal-text deploy, check the
  live pages, not only the green deploy.
- **Runbook line.** After the deploy that carries a legal-text change, open the
  three pages on `https://besidka.com`, and check the `Last updated` date, the
  privacy address and the anchors the app links to
  (`/privacy-policy#sensitive-information-in-your-chats`,
  `/privacy-policy#transfers-outside-the-eu`, `/privacy-policy#memory`). If old
  text is still served, request the page again (the import runs on the first
  query per isolate) and re-check. Do not edit `CONTENT_DB` by hand.

## Independent controller vs. processor classification

The recipients table classifies a party as an **independent controller**
whenever Besidka has no contract governing what that party does with the
data — true for AI providers, search providers, AI gateways and the TypeSafe
AI checks alike, since in every one of those categories the user
supplies their own key or account to the recipient directly. A party is a **processor** only when
Besidka itself holds a data-processing agreement with it, which today is
true solely for Cloudflare-as-host and Axiom. This is the same test applied
across all three "new recipient" categories in `privacy-policy.md`, not a
per-category judgment call.

TypeSafe AI is the one recipient whose own paperwork says something different,
so the wording is fixed here and must be the same in the Privacy Policy,
`docs/legal/dpia.md` (section 3.7a) and `docs/legal/art30-record.md` (row 11a,
section 6.1). Towards Besidka, TypeSafe AI, Inc. is an independent controller
and there is no contract between them. Its data processing agreement is its
contract with its own account holder, the user for the key they add, under
which it acts as that account holder's processor; for the transfer to the
United States it relies on the Standard Contractual Clauses (Decision (EU)
2021/914, Module 2, controller to processor) and the UK Addendum, and Besidka
is not a party to it. It is not certified under the EU-US Data Privacy
Framework. Nobody should describe it as Besidka's processor or as a joint
controller.

## Why no postal address is published

This is load-bearing. Do not "tidy" the identity block without reading it.

The identity block above deliberately omits a postal address. That is only
defensible while the service generates no revenue at all:

- Ustawa o świadczeniu usług drogą elektroniczną (UŚUDE) Art. 5(2) is the only
  provision that would force a natural person to publish `miejsce zamieszkania
  i adres`. It applies to a `usługodawca`, defined in Art. 2 pkt 6 as someone
  providing the service while conducting, even incidentally, `działalność
  zarobkową lub zawodową` — gainful, not merely `gospodarcza`. With structurally
  zero revenue the gain-orientation element fails, so UŚUDE Arts. 5 and 8 do not
  attach. Failing Art. 5 is fineable under Art. 23.
- GDPR Art. 13(1)(a) prescribes no form for contact details; WP29 WP260 rev.01
  lists a postal address only in an illustrative "preferably / e.g." list. A
  monitored email plus the country of establishment satisfies it, and naming the
  country is what identifies the competent authority for Art. 13(2)(d).
- DSA Arts. 11 and 12 both require reachability `by electronic means`; an email
  address satisfies both. Art. 12(2) preserves existing ECD duties, it does not
  import an address duty onto someone outside their scope.

Consequences of monetising in any form (ads, sponsorship, donations, a paid
tier, data monetisation):
1. The activity becomes `zarobkowa`, so UŚUDE Art. 5(2) attaches and a postal
   address MUST be published.
2. The operator may become a `przedsiębiorca` (KC Art. 43-1), which creates a
   `konsument` counterparty (KC Art. 22-1) and pulls in the abusive-clause
   regime (KC Art. 385-1 to 385-3) and UOKiK's jurisdiction. Directive
   2019/770's data-as-consideration route can reach the same result.
3. The same Art. 2 pkt 6 test now also decides whether the Polish DSA
   implementing act's fines can reach the operator (see "2026-10-28 compliance
   review: decisions").

So: before adding any monetisation, revisit this file, the Privacy Policy and
the Cookie Policy.

The ordered checklist for monetising (business form, virtual office address,
tax, VAT and merchant of record, consumer and subscription law, DMCA agent,
legal text, consent bump, and the repo files to change) is
`docs/legal/monetisation-readiness.md`. Owner decision 2026-10-28: nothing of
the kind is published for now.

## Status of the underlying research

The above rests on primary sources (Dz.U. 2024 poz. 1513 for UŚUDE; WP29 WP260
rev.01 for GDPR Art. 13; the verbatim text of DSA Arts. 11–12). Two honest gaps:
Polish doctrinal commentary on Art. 2 pkt 6 is paywalled and was not read, and no
case law was found in open sources on whether a free hobby site is a
`usługodawca`. The strongest part of the argument does not depend on either — UŚUDE
Art. 23 is a penal provision tried under *wykroczenia* procedure, so stretching
`zarobkowa` to reach a zero-revenue operator and fine them would be extensive
interpretation *in malam partem*.

The conclusion is also conditional on the operator having **no paid self-employed
activity**. Salaried employment does not count (the employer conducts that
activity, not the operator). Paid freelance or B2B side work would reopen it.

`.github/FUNDING.yml` was removed for this reason — it advertised Patreon, Ko-fi
and Buy Me a Coffee under the `besidka` name. Gain *orientation* is the test, not
gain received, so an open donation channel breaks the analysis even at zero
lifetime income.

## 2026-10-28 compliance review: decisions

Engineer-drafted, not lawyer-reviewed. The full record of the review (six
launch risks, extra findings, sources, owner follow-ups) is
`docs/legal/compliance-review-2026-10.md`. The three pages were edited the same
day and `updatedAt` is `2026-10-28`. No new purpose or recipient was added, so
`CURRENT_CONSENT_VERSION` and the consent modal are unchanged and nobody is
re-prompted.

- **Share defaults are OFF (privacy by default, GDPR Art. 25(2), EDPB
  Guidelines 4/2019 paras 56-58).** A new share starts with search indexing,
  files and generated images, message metadata, author name and avatar, and
  branching ("let others copy") all off. The link duration still starts at
  "never"; the user can pick an expiry. This is a UI default only
  (`ShareModal.client.vue`). Existing shares keep their saved settings. The
  SQL column defaults stay `DEFAULT true` on purpose: changing them rebuilds
  `chat_shares` on D1, and `DROP TABLE` there cascades to `chat_share_files`
  (see the migration warning in `CLAUDE.md`). They are harmless because the
  share route writes every flag explicitly. See "The visibility-flag
  migrations (closed)" in `docs/d1-restore-reconciliation.md`. Do not "fix"
  the SQL default without that plan.
- **Share author avatar goes through besidka.com.** When the author shows their
  avatar, `server/api/v1/shared/[slug]/avatar.get.ts` serves it as a
  same-origin proxy, so a viewer's browser no longer contacts Google or GitHub
  (no viewer IP or Referer reaches them) and the raw avatar URL is never sent
  to viewers.
- **Fonts and icons are self-hosted.** Nunito and Atkinson Hyperlegible Mono and
  the icons are served from besidka.com. The Iconify API fallback is disabled
  (`docs/nuxt-icon-collections.md`). The browser never contacts Google Fonts or
  the Iconify API. After the avatar proxy, the only third-party loads are
  Cloudflare Turnstile (auth pages, no consent, security) and Cloudflare Web
  Analytics (only after consent). The Cookie Policy's "two third-party scripts,
  both from Cloudflare" is accurate and must stay so.
- **Cloudflare is named as an independent controller for Turnstile signals.**
  Cloudflare's Turnstile Privacy Addendum says Cloudflare uses the signals for
  its own purposes as a controller on legitimate interests. The Privacy Policy
  now says so next to the (compulsory) addendum link. Keep both.
- **Age is confirmed at sign-up, not only in the app.** The email sign-up
  checkbox reads "I am 18 or over and agree to the Terms of Use and Privacy
  Policy", and a notice next to the Google and GitHub buttons on sign-up and
  sign-in says continuing confirms 18+ and accepts the Terms and Privacy
  Policy. The in-app gate still records `age_confirmed_at`; the sign-up
  confirmation is not stored separately. No date-of-birth field anywhere, on
  purpose: it would be new data and would not prove age (COPPA is an
  actual-knowledge standard, and a general-audience 18+ service is outside it).
- **Email list corrected.** The Privacy Policy said "exactly two kinds of
  email". The service sends: address verification, password reset, new-email
  confirmation, account-deletion confirmation, and security notices (password
  changed, sign-in method connected or disconnected, 2FA on or off, backup codes
  regenerated, account email changed, passkey added or removed). All are
  transactional or relationship messages, never marketing. The notices are
  listed with a legitimate-interests basis (Art. 6(1)(f)). A new email kind
  means editing that section, the legal-basis row and Art. 30 row 20.
- **DSA: stop self-labelling as an "online platform".** The Terms said "I host
  user content and treat myself as an online platform". It now says Besidka
  hosts content users choose to publish and voluntarily follows the DSA
  notice-and-action rules (Arts. 11, 12, 14, 16, 17, 18), with the existing
  email process, the Art. 16(2) report elements and statements of reasons. The
  sentence claiming micro-enterprise exemption was dropped from the public text
  and the analysis is kept here instead (over-claiming in user-facing text is a
  risk, under-claiming is not).
  - *Is Besidka an information society service at all?* Directive 2015/1535
    Art. 1(1)(b) covers services "normally provided for remuneration". A free,
    non-commercial service run by a private individual with no revenue has a
    strong but untested argument that it is not one (CJEU C-291/13 Papasavvas
    and C-484/14 Mc Fadden on the remuneration element). Untested means untested.
  - *The Polish act.* The implementing act is the ustawa of 4.9.2026 amending
    the ustawa o świadczeniu usług drogą elektroniczną (Dz.U. 2026 poz. 1296,
    in force about 6.11.2026). The President of UKE is the Digital Services
    Coordinator. Its fines attach to a `usługodawca`, and UŚUDE Art. 2 pkt 6
    defines that as someone acting in `działalność zarobkowa lub zawodowa`.
    This is the **same Art. 2 pkt 6 test as in "Why no postal address is
    published"**, so a non-gainful individual very likely falls outside the
    fining regime. Worst case for a zero-turnover provider is capped at EUR
    6,000 (art. 22zzo ust. 4). Not read: Polish commentary on the act, no case
    law yet.
  - *Even if the DSA applies.* A natural person is at most a micro enterprise,
    exempt from Arts. 15 and 19 to 28 except Art. 24(3).
  - Monetisation breaks all of this at once: the "no revenue" premise carries
    the postal-address conclusion, the DSA fining conclusion and the
    non-`przedsiębiorca` position. Revisit this file before adding any.
- **DMCA / copyright.** The Terms have a "Copyright complaints" section (after
  illegal-content reporting): notice elements from 17 U.S.C. §512(c)(3)(A),
  removal and notice to the user, and a way to say a removal was a mistake
  (reply to the statement of reasons or write to the contact address). The
  §512(g)(3) counter-notice procedure is not offered and no US safe harbour is
  claimed; the user's name and contact details go to the complainant only with
  the user's consent. The Terms also have a repeat-infringement rule (material
  repeatedly removed on copyright notices: sharing restricted, account
  suspended or terminated, a statement of reasons each time) and a false-notice
  warning. The Privacy Policy has a "Reports and notices about content"
  section, a legal-basis row (Art. 6(1)(c)/(f)) and a retention row: 12 months,
  24 months for the note on a copyright removal (compliance review, follow-ups).
  - **Decided 2026-10-28 (owner): no DMCA designated agent, no US safe harbour
    claimed; revisit only if a JDG is opened.** The §512(c)(2) safe harbour
    needs a registered designated agent.
    Registration is at dmca.copyright.gov through Login.gov, $6 per designation,
    renewed every 3 years. Under 37 CFR 201.38(b)(1)(i) the **service
    provider's own physical street address** must be on the public record (a
    P.O. box only under the (b)(1)(ii) exception, with a personal-safety waiver via
    poboxwaiver@copyright.gov),
    while the **agent's** address may be a P.O. box or a third-party agent.
    The owner will not publish a home address, so registering would break the
    no-postal-address position above. The copyright notice procedure in the
    Terms stays as published, written to be complete without agent details;
    nothing in the text names an agent or a registration. DSA Art. 6
    notice-and-takedown is the primary shield. Register when a business
    address exists (`docs/legal/monetisation-readiness.md` section 4.7), then
    add the agent to the Terms.
- **Owner decision 2026-10-28: no monetisation, donations or earning
  intentions are published.** Same reason as the DMCA decision: monetising
  would require a published address (UŚUDE Art. 5) and a business form, and
  the owner cannot open a JDG at present. What would have to happen first is
  in `docs/legal/monetisation-readiness.md`.
- **Owner decision 2026-10-28: existing shared chats keep their saved
  settings.** There is no bulk change to their indexing or other flags; the
  new OFF defaults apply to new shares only. Most existing shares were made
  by the owner (user id 1).
- **Cloudflare rate limit extended (2026-10-28).** The rate-limit rule "API
  flood limit" now also covers `/api/v1/shared/`, which includes the share
  avatar proxy (compliance review 2.2, follow-up 8).
- **Not changed.** The consent gate, `CURRENT_CONSENT_VERSION`, the consent
  modal, the cookie banner categories.

## Not legal advice

The whole legal package is engineer-drafted and has not been reviewed by a
lawyer: the three pages, the consent gate copy, the DPIA (`docs/legal/dpia.md`)
and the Art. 30 record (`docs/legal/art30-record.md`). They were drafted from
requirements analyses and primary-source reading, not by counsel. The items most
worth a Polish `radca prawny`'s eye are the address conclusion above, the
Art. 9 special-category position (including that refusing the consent blocks
sending), and the Art. 49(1)(a) transfer consent for repeated transfers to
China and Singapore. See `docs/legal-memory-sensitive-data.md`.
