# Compliance pre-check: Phase 4a Connectors (C-12, BES-311)

> Engineer-drafted, not lawyer-reviewed. Sources checked on 2026-11-07
> (primary pages) and 2026-11-08 (the EDPB, EUR-Lex, MCP tools-page and code
> checks added by this draft; each is marked below).
> This is the connectors section of the agentic-capabilities pre-check record.
> The shared gate and the WCAG 2.2 AA decision will live in
> `docs/legal/agentic-capabilities-precheck.md` (P0-14, BES-303, written in
> parallel and not merged yet). Until it merges, this file answers the
> track-specific questions of BES-311 and runs the gate in full below.

## Verdict

**GO WITH CHANGES**: connectors can be built, but only with a per-connector
Art. 49(1)(a) consent that names the server host and repeats the Art. 9(2)(a)
element, a disabled-on-create rule for MCP-added connectors, a GitHub preset
that is PAT-only in v1, and a changed fast path.

Separate verdicts for fast path C-11 (question 9):

- **Anthropic `mcp_servers`: NO-GO for v1.** Beta, not covered by ZDR, the
  connector token travels to Anthropic, and how Anthropic stores
  `authorization_token` is UNVERIFIED.
- **OpenAI Responses `type: "mcp"`: GO WITH CHANGES.** Off by default,
  per-connector opt-in, consent that names OpenAI as an extra recipient of the
  token and of the tool results, and approval and audit parity proven first.

## In plain words

- Connectors are legal to build. The remote server is an independent controller
  that the user picks, like an AI provider today. Besidka is the party that
  sends the data, so Besidka is the exporter and needs a transfer basis.
- The only transfer basis Besidka can rely on today is explicit consent
  (Art. 49(1)(a)), asked once per connector, before Besidka sends anything to
  that host. The contract basis (Art. 49(1)(b)) fails the EDPB test: connector
  traffic is not "occasional". The idea that the transfer is the user's own act
  was tested and does not hold for outbound calls (see "The user's-own-act
  alternative").
- The consent screen (full spec in question 2) names the host, says it may be
  outside the EEA with no safeguard from Besidka, and repeats the
  sensitive-data consent. The sign-up consent does not cover connectors. The
  consent is stored per connector and asked again if the host changes.
- Besidka cannot name the server's country. That stays a stated weakness of the
  consent, the same residual the DPIA already carries for connected apps.
- Presets: all four are allowed by the vendors' own MCP docs. Show them as text,
  not logos. GitHub is PAT-only in v1 (no Besidka-held client secret). Atlassian
  stays only with a visible note (admin must allow `besidka.com` or enable API
  tokens; Rovo credits).
- `add_connector` over MCP is only acceptable because the connector is created
  disabled and switching it on happens in the app, after the consent screen.
- Fast path C-11: Anthropic stays off. OpenAI is possible later, off by default.
- Needs the owner: accept the consent residual, confirm the GitHub and Atlassian
  choices, confirm 90 days for the audit log, and schedule a 30-day legal
  notice (new purpose, new recipient category, new Terms duties).

## Track-specific questions

| # | Question | Source | Finding | Verdict | Required design change | Ticket to change |
|---|---|---|---|---|---|---|
| 1 | Role of a user-chosen remote server, and of Besidka for the transmission | `docs/legal.md` "Independent controller vs. processor classification"; EDPB 07/2020 paras 12, 30, 80, 82 (research, accessed 2026-11-07); CJEU C-40/17 para 76 (accessed 2026-11-08); `docs/legal/dpia.md` section 6 item 8 | The remote server is an independent controller: Besidka has no data processing agreement with it, and the user brings the account, as for AI providers and search providers. Besidka decides which request carries which fields and sends it from its Worker, so Besidka is a controller for the transmission. In Fashion ID the Court treated the site operator as controller for "the collection and disclosure by transmission" of data to a third party (para 76, under the old Directive 95/46) but not for what the recipient did next. Joint controllership for the sending step is an untested risk the DPIA already accepts for providers (section 6 item 8). EDPB 07/2020 gives both sides of it. For: para 67 says an entity's choice "to use for its own purposes a tool or other system developed by another entity" will likely amount to a joint decision on the means (its gloss on Fashion ID). Against: para 68 says shared infrastructure does not always make joint controllers, in particular where processing is separable, and "a mere commercial benefit" is not a purpose, and the travel agency, airline and hotel example (para 68) treats three parties that each use the data for their own purposes as three separate controllers. Besidka's position is the second one: the server uses what it receives for its own purposes, Besidka has no purpose in common with it and earns nothing from it. The user is usually outside the GDPR for personal use (Art. 2(2)(c)), but Recital 18 still applies the GDPR to whoever "provide[s] the means" for that processing, which is Besidka. Two directions of flow: model-written tool arguments go out, tool results come back and are stored in the chat. | go | Say in the Privacy Policy, DPIA and Art. 30 record that (a) the server is an independent controller, (b) Besidka is controller for the transmission and for storing what comes back, and (c) tool results can hold third parties' data, for which Art. 14(5)(b) applies. Never describe the server as Besidka's processor or joint controller. | C-10 BES-257 |
| 2 | Transfers to servers in unknown third countries. Basis: consent at connect time, or another basis | GDPR Art. 44, 49 (EUR-Lex, accessed 2026-11-08); EDPB 05/2021 paras 9, 16, 18, fn 15, Examples 1 and 4 (accessed 2026-11-07); EDPB 2/2018 pp. 4, 5, 7, 8 (accessed 2026-11-08); `docs/legal-memory-sensitive-data.md` section 3; `docs/legal/art30-record.md` row 10a and section 6.1; DPIA section 6 items 4 and 12 | **Besidka is treated as the exporter.** EDPB 05/2021 para 18 says the second transfer criterion is not met when there is no exporter, "such as when data are disclosed directly by the data subject to the recipient". Besidka's Worker initiates every call and sends chat-derived data, so the data subject does not disclose it directly (tested in "The user's-own-act alternative" below). That is also the existing Art. 30 position for provider sends. **No Art. 45 or 46 tool:** the country is unknown and Besidka has no contract with the server, so no adequacy decision or SCC can be named. **Art. 49(1)(b) fails the EDPB 2/2018 test.** It is limited by necessity ("a close and substantial connection between the data transfer and the purposes of the contract", p. 8) and by "occasional": a transfer "within a stable relationship between the data exporter and a certain data importer" is "systematic and repeated" (p. 4). Per-call connector traffic to one chosen server is that, and a connector is an optional feature, not something the free service needs to perform. Art. 49(1)(c) needs a contract between Besidka and the server, which does not exist. **Art. 49(1)(a) is the only basis Besidka can rely on today.** It needs consent that is explicit, specific "for the particular data transfer or set of transfers" (p. 7) and informed of the risks of having no adequacy decision and no safeguard (p. 7). Three stated weaknesses, recorded as residual risk and disclosed, as for DeepSeek, Moonshot AI and Qwen (DPIA item 4) and connected apps (item 12): (i) p. 8 says the notice should name "all countries" and Besidka cannot, so the screen says plainly that the country is unknown; (ii) p. 8 says consent "might prove not to be a feasible long term solution" for transfers, p. 5 says even the derogations with no "occasional" limit must not "contradict the very nature of the derogations as being exceptions", and connector traffic is ongoing; (iii) p. 7 allows consent before a transfer only if "the circumstances of the transfer do not change", and the arguments of a later call are not known at connect time. Mitigation for (iii): the approval prompt (C-6) shows the real arguments of each call before it runs, unless the user chose "always" for that tool, and the consent is asked again when the host changes. | go with changes | **Per-connector transfer consent, bound to the host.** Screen text names the host (and the OAuth issuer host when it differs) and says: it may be outside the EEA with no adequacy decision; Besidka has no contract and offers no safeguard; the server keeps, uses and shares what it receives under its own terms; what is sent (the arguments the AI writes into each call, which can include anything from the chat, and the access token); results come back and are stored in the chat; the consent is withdrawable. Record per connector: origin (scheme, host, port), consent text version (a new `CONNECTOR_CONSENT_VERSION` with its own text hash and spec, like `CURRENT_CONSENT_TEXT_SHA256`), `consentedAt`, `withdrawnAt`. Store as columns on the new connector row, not as JSON on `user_settings`. Log `attributes.legalConsent` actions `connector-granted` and `connector-withdrawn` with host. **Ask again** when the origin changes, when a redirect leads to another origin (C-3 must not follow redirects silently), when the OAuth issuer changes, and when the consent text version changes. Server-side gate before the first request that carries the token or chat-derived data (enable, tool call, fast path), error code `CONNECTOR_CONSENT_REQUIRED` with `data.connectorId`, handled like `TRANSFER_CONSENT_REQUIRED`. Refusal keeps the connector disabled. Deleting the connector withdraws; disabling it does not. After a deletion the connector row and its consent columns are gone, so the only proof of the consent is the Axiom `attributes.legalConsent` row, with the same retention caveat that `docs/legal.md` "Consent records" states for the existing consents. List and withdraw per connector in Profile → Security → Privacy & consent and on the Connectors page. This screen is the one consent screen; rows 3 and 9 and C-7 refer to it. | C-4 BES-239, C-7 BES-249, C-5 BES-241, C-2 BES-235 |
| 3 | Sensitive data: does the chat consent gate cover connectors? | `app/components/Legal/ConsentModal.client.vue` (the `data-consent-text` spans); Privacy Policy `#connected-ai-apps` "Why I may, and what your approval means"; `docs/legal.md` "Consent records"; DPIA section 3.8 | **No.** The sensitive-data box covers sending to "the AI providers, AI gateways and search providers whose keys I add". A connector is neither a provider nor a key. The Privacy Policy already uses the same answer for inbound apps: the gate consent "does not cover apps you connect", so the approval screen takes its own Art. 9(2)(a) consent, recorded with the approval, and the gate consent must still be current. The consent covers the user's own data only; third parties' sensitive data in tool results cannot be consented to by the user (Privacy Policy "Sensitive information in your chats", advice list). | go with changes | The connect-time consent is one screen with one explicit tick that has two named parts: the Art. 49(1)(a) transfer and the Art. 9(2)(a) sensitive-data consent for what is sent to this server and stored from its results. Do not change the sign-up consent text (see Shared gate item 3). A connector cannot be enabled or called while the gate consent is missing, outdated or withdrawn (same rule as MCP private tools). Add the third-party-data advice to the screen. | C-4 BES-239, C-7 BES-249, C-5 BES-241 |
| 4 | Preset terms: GitHub, Notion, Linear, Atlassian; names and logos | Research file `connectors.md` section 1 (accessed 2026-11-07); see the preset table below | All four vendors' own MCP docs allow third-party clients. None forbids a catalog entry. Vendor terms of service and acceptable-use policies were **not reviewed** (UNVERIFIED for all four): the verdict rests on the MCP docs and brand pages, which are not contracts. No preset is removed. Logos: only GitHub and Atlassian have a logo clause that fits; Notion gates logos by approval; Linear has no integration carve-out. | go with changes | Catalog shows **text names only** for all four in v1, plus one line "Names belong to their owners. Besidka is not affiliated with them." GitHub: **PAT-only in v1** (see the preset table). Atlassian: text-only entry with a required `notice` field shown on the connect screen, or drop it if C-2 cannot carry that field. Catalog URLs are constants, no affiliate or referral parameters, no env or template interpolation. Atlassian entry uses the v2 URL. Re-check all four vendors' policies immediately before launch (dated check in the C-1 doc). Any logo later: self-hosted under `public/`, never hotlinked (`compliance-review-2026-10.md` section 2.2). | C-2 BES-235, C-7 BES-249, C-1 BES-233 |
| 5 | CIMD document: required and optional fields, URLs, no postal address, WAF | IETF draft-ietf-oauth-client-id-metadata-document-03 sections 3, 4, 4.1, 4.4, 4.5, 6.2, 10.9; MCP spec 2026-07-28 client-registration (research, accessed 2026-11-07); `docs/agent-readiness.md` WAF runbook | The IETF draft requires only `client_id` (a stable https URL with a path, equal to the document's own URL). The MCP spec is stricter: "client_id, client_name, redirect_uris". `client_uri`, `logo_uri`, `policy_uri`, `tos_uri` and `contacts` are optional. No contact or postal address is needed and the draft and RFC 7591 define no postal field. The document must not hold secrets and "MUST NOT derive the contents ... from untrusted external input" (section 4.5). Remote authorization servers cache it by HTTP cache headers and may show only the hostname for unreviewed clients. | go with changes | Publish one document (proposed paths; final choice in C-4): `client_id` = `https://besidka.com/connectors/client-metadata.json`; `client_name` = `Besidka`; `redirect_uris` = `["https://besidka.com/api/v1/connectors/oauth/callback"]` (one exact URI); `client_uri` = `https://besidka.com/`; `policy_uri` = `https://besidka.com/privacy-policy`; `tos_uri` = `https://besidka.com/terms-of-use`; `logo_uri` = a Besidka logo file under `public/` on `besidka.com` (path chosen in C-4); `grant_types` `["authorization_code","refresh_token"]`, `response_types` `["code"]`, `token_endpoint_auth_method` `"none"`. **Omit `contacts`** (optional, may be shown to users, no benefit). Build the document from the configured base URL (`NUXT_PUBLIC_BASE_URL`), never from the request Host header, so preview and self-hosted instances publish their own. Send a stable `Cache-Control`. **Do not put it under `/.well-known/`**: the WAF clause "URL attackers" blocks every `.well-known` path not on the allowlist, so a path there needs the runbook step in `docs/agent-readiness.md`. Keep the path out of `/api/`, `/mcp` and `/raw/` and out of the single Free-plan rate-limit rule, so a remote authorization server's fetch is not throttled. After deploy, fetch it from outside with `curl` and a non-browser user agent. Treat the `client_id` URL as permanent: changing it makes Besidka a new client at every remote server and invalidates admin allow-lists (Notion Enterprise, Atlassian). | C-4 BES-239 |
| 6 | Registry mirror: third-party personal data, minimisation, Art. 14(5)(b), licence | MCP Registry terms of service (effective 2025-09-02), aggregators page, schema 2025-12-11 (research, accessed 2026-11-07); GDPR Art. 5(1)(c), 6(1)(f), 14(5)(b) (EUR-Lex, accessed 2026-11-08) | The terms (clause 10) say registry data "is intended to be public, and will be dedicated to the public domain under CC0 1.0 Universal" by its publishers, which settles copyright only, not data protection. The aggregators page says aggregators "are expected to scrape data on a regular but infrequent basis (e.g., once per hour)". The registry is in preview and "data resets may occur". An entry has no maintainer contact field, but `name` (`io.github.<user>/<server>`) and `repository` carry GitHub usernames, which the terms themselves call personal data, and a description can contain names. The publishers' waiver does not bind Besidka's own GDPR duties (research reading, not legal advice). Art. 14(5)(b) lifts the notice duty for disproportionate effort, but only with "appropriate measures", which includes making the information public. | go with changes | Store only: `name` (sync key), `title` or display name, `description` cut to 300 characters, `remotes` (type, URL, header names, no values), and the registry `status`. Do **not** store `repository`, `websiteUrl`, `icons`, `_meta` publisher fields, `packages`. Replace the whole mirror on each sync (incremental by `updated_since`, hourly), and drop `deleted` entries. Never hotlink registry `icons` or show `websiteUrl` as an auto-loaded asset. Keep an erasure list: a person's request removes their rows and the sync skips them. Show "This data comes from the Official MCP Registry. Not reviewed by Besidka." (the first sentence is the example the terms allow, clause 6; "Official MCP Registry" must not imply affiliation). Basis: Art. 6(1)(f), with a short balancing note in the DPIA. Publish one paragraph in the Privacy Policy as the Art. 14(5)(b) measure. Never serve registry data on public pages (C-13 landing must not render it). | C-8 BES-252, C-10 BES-257 |
| 7 | Tool-call audit log: purpose, retention, content | GDPR Art. 5(1)(c), (e), 32; `docs/legal/dpia.md` section 3.9; Privacy Policy "How long I keep things" (Brave query retention of 90 days is the in-policy precedent); MCP tools spec 2026-07-28 security section ("Log tool usage for audit purposes", accessed 2026-11-08) | Purposes: security and abuse investigation (Art. 6(1)(f)) and the user's own history of what ran in their account (Art. 6(1)(b)). No regulator figure exists for a retention period, so the choice is an owner decision. 90 days covers the window in which an injection or credential incident is usually noticed, matches the 90-day Brave query retention the Privacy Policy already quotes, and is long enough for a user-facing history. A plain hash of arguments can be reversed by guessing short arguments, so a plain hash is not "no content". Even an HMAC is pseudonymous, not anonymous: it stays personal data and the Art. 30 row says so. | go with changes | Table in D1 (so it is deletable with the account), not only Axiom. Fields: user id, connector id, tool name, approval mode and who approved, outcome, duration, result size in bytes, `argsHmac` (HMAC-SHA-256 with a key derived from a server secret, domain-separated from `NUXT_ENCRYPTION_KEY`), time. Never arguments, results, URLs with query strings, headers or tokens. Axiom wide events carry counts, ids, tool name, outcome and duration only, under `attributes.connectors` (scalars only, see `docs/axiom-map-fields.md`). Retention **90 days** by an hourly sweep. Rows go with the account (cascade or explicit purge in `server/utils/account/purge-user-data.ts`). Deleting a connector does **not** delete its audit rows before the 90 days end, because a stolen session could otherwise erase its own trail. The Privacy Policy retention table says so. | C-2 BES-235, C-5 BES-241, C-10 BES-257 |
| 8 | Liability and approvals: actions on third-party services are the user's | `content/legal/terms-of-use.md` "Connected apps", "You need your own API key", "Liability", "Other people's data"; MCP tools spec 2026-07-28 (accessed 2026-11-08) | The Terms already say that for inbound apps. The same wording extends cleanly. A promise that "Besidka executes only what the user approved" is only true if the classification of a call as read or write cannot be set by the server. The MCP spec says clients "MUST consider tool annotations to be untrusted unless they come from trusted servers", and asks for "a human in the loop with the ability to deny tool invocations" and that clients "Show tool inputs to the user before calling the server, to avoid malicious or accidental data exfiltration" (both SHOULD). Liability limits must keep the existing carve-outs (intent, gross negligence, personal injury, mandatory law). | go with changes | New Terms section "Connectors" (draft clauses in the C-10 input list). Design rule for C-6: a server's `readOnlyHint` is never enough to skip approval; a tool with no user choice defaults to "ask"; the approval prompt shows the real arguments of the pending call, not the model's description; "always" is bound to the tool's name, description and schema hash and falls away when that changes; approvals are never granted by a tool result, by the model or over MCP. Besidka's own bug that runs an unapproved call stays Besidka's liability under the normal carve-outs. | C-6 BES-244, C-10 BES-257 |
| 9 | Provider-native fast path (C-11) | Anthropic MCP connector page and API data retention page; OpenAI MCP guide (research, accessed 2026-11-07); ticket decision "never pass Besidka tokens to a remote server or one server's token to another" | **Conflict with the ticket's own rule:** both fast paths hand the connector's token and the remote tool results to a model provider that then contacts the server itself, so the provider, not Besidka, becomes the sender. The only way to square this with "no tokens to another party" is an explicit opt-in that names the provider as an extra recipient of the token and of the results. **Anthropic:** beta header only, "The MCP connector is not covered by ZDR arrangements", exchanged data (tool definitions and results) "retained according to Anthropic's standard data retention policy", and the page does not say how `authorization_token` is stored or logged (UNVERIFIED). A user whose own org has ZDR would lose it silently on this path. That cannot be squared today. **OpenAI:** "does not store the value you provide in the authorization field", "compatible with Zero Data Retention", but the server is third party and, with `store=true` (no `store: false` found in `server/`, `shared/` or `providers/` on 2026-11-08), outputs are logged for 30 days. OpenAI also asks for approval by default, which must map onto Besidka's own approval and audit design or Besidka loses the audit log and the "executes only what you approved" promise. | **Anthropic: no-go. OpenAI: go with changes** | Anthropic path stays unbuilt in v1; revisit only when Anthropic documents token handling and ZDR eligibility, or the user's connector choice can be made explicit with those facts. OpenAI path: off by default; per connector opt-in; separate consent text naming OpenAI as an extra recipient of the token and tool results, ZDR and residency notes, and that the remote server is contacted from OpenAI's infrastructure (the user's server IP allow-lists change); available only after the connector consent (question 2) exists; Besidka's approval and audit log must be reproducible for provider-run calls (acceptance criterion) or the path stays off; token re-sent per request, never persisted by Besidka outside the credential store; disclose that default 30-day retention of `store=true`. Not offered when the chat model's provider is DeepSeek, Moonshot AI, Qwen or a gateway-routed China, Singapore, Malaysia or Indonesia vendor without the existing transfer consent. **EEA users and Art. 13, 28:** no EEA-specific switch is needed or reliable. The path is off by default, opt-in per connector, and the consent names OpenAI, so EEA users choose it knowingly. OpenAI acts under the user's own account (an independent controller towards Besidka, as in Art. 30 row 4), so Besidka signs no Art. 28 contract with it; the Art. 13 duty is met by naming OpenAI as a recipient in the consent text and the Privacy Policy table. | C-11 BES-261, C-10 BES-257 |
| 10 | Shared chats: tool parts and context panel | `server/utils/chats/share-public-parts.ts`; `server/api/v1/shared/[slug]/index.get.ts`; `server/utils/chats/share-pii-check.ts`; `node_modules/ai` 7.0.153 (`isToolUIPart`, checked 2026-11-08) | **Confirmed.** `filterPublicParts` drops every part for which `isToolUIPart` is true, and in the installed `ai` 7.0.153 that function matches both `tool-*` and `dynamic-tool` (the type MCP tools arrive as). The shared view and the share personal-data check both read through it. The same exclusion is already in `server/utils/chats/branch.ts`, in chat search text (`extractMessageSearchText`, text parts only), in the MCP `get_chat` tool ("tool output [is] left out"), and in the provider history sanitizer (whitelist, drops `tool-*`). Gaps: (a) assistant text and reasoning parts stay public and can repeat connector data; (b) the share route returns `message.tools` when "show metadata" is on, and `tools` is a closed `ModelTool[]` list today, so how a connector use is shown there is open; (c) a version bump of `ai` could change the predicate. | go | Add a unit test with a `dynamic-tool` part to the share and branch specs (guards a dependency change). Share dialog: when the chat used a connector, add a warning that the answer may repeat data from it, in the same place as the personal-data check. Anything shown in the share metadata or the chat context panel for connectors is the connector's display name only, never the URL, arguments, headers or results. | C-5 BES-241, C-7 BES-249 |
| 11 | Besidka's own MCP server: scopes `connectors:read` and `connectors:write`, disabled-on-create, labels | `docs/mcp-server.md` (scopes, "Consent is the effective scope", "What MCP does not do (and why)" item 4); `docs/legal/dpia.md` section 3.11 | Item 4 excludes "settings that change the data recipient" from MCP because they need the consent flows of the app. A connector is exactly a new data recipient, so `add_connector` is admissible only because the connector is created disabled and enabling (with the consent screen) happens in the app. Deleting a connector removes credentials, not user content, and it reduces exposure like `revoke_chat_shares` (which sits on `chats:write`), so `connectors:write` fits, not `data:delete`. `update_connector_tools` could widen exposure (tool enablement, "always allow"), so it must only reduce, as `update_project` does with `memoryAutoUpdate`. | go with changes | `add_connector`: URL and name only; **no credentials, no `enabled` input**; validates syntax and the C-3 host rules but makes **no network call** to the URL; stores `addedVia` (the client id); the app shows "added by <client>, not by you in the app" and the host on the enable screen; per-user cap on disabled MCP-added connectors. `list_connectors` and `get_connector`: id, display name, host (origin only), enabled, tool names and approval modes, last-used; never URL path or query, headers or tokens. `update_connector_tools`: can only disable a tool or set it to "ask". `delete_connectors`: `connectors:write`, capped batch, `destructiveHint: true`, does not remove audit rows. Consent labels: `connectors:read` "See your connectors: names and addresses, never their keys"; `connectors:write` "Add, change and remove connectors. New ones start switched off; you switch them on in Besidka" (write scope, unticked by default, shown apart). Update the three places in step (`shared/utils/mcp-oauth-scopes.ts`, `tool-scopes.ts`, `ScopeLabel.vue`), tool count 32 to 37, `MCP_SERVER_VERSION` major bump, `pnpm run mcp:surface`, and add a "Connectors" entry to the item 4 note in `docs/mcp-server.md`. Existing approvals do not gain the scopes without a new approval. | C-9 BES-256, C-10 BES-257 |
| 12 | Breach runbook: new secrets, containment, rotation | `docs/legal/breach-runbook.md` sections 2.2, 2.5, 3 (risk table); `docs/d1-restore-reconciliation.md`; `server/utils/account/purge-user-data.ts` | New secret category: connector credentials (OAuth access and refresh tokens, header values, PATs, DCR registration data) are encrypted with the `keys` path, so a leak of `NUXT_ENCRYPTION_KEY` plus the table exposes access to third-party data and write capability, a higher harm than a model key (which "spends money"). A GitHub OAuth App client secret would be a Besidka-held credential, whose leak is impersonation of Besidka at GitHub. The CIMD document holds no secret, but a changed `redirect_uris` could capture authorization codes. Rotation: the runbook says no re-encryption job exists. Revoked rows come back after a D1 restore. The `oauth_*` precedent (DPIA risk row 35): tables without cascade block the user delete. | go with changes | Add to the runbook: (1) a risk-table row for connector credentials (tell users to revoke at each remote service; the email lists where, per preset); (2) a containment row: delete the user's connector credential rows, call the authorization server's revocation endpoint where it advertises one (best effort through the C-3 wrapper), then notify users; (3) a row for the GitHub client secret, only if the OAuth path exists (reset the secret, revoke the app's tokens); (4) CIMD integrity: redeploy, remember remote caches last for hours, never change `client_id` as a fix; (5) stolen session: also delete the user's connector grants, like the `oauth_*` rows. **Rotation of `NUXT_ENCRYPTION_KEY`:** for connector credentials the documented procedure is wipe and re-authorise (no job needed); the `keys` re-encryption job stays open. After a D1 restore, wipe connector credential rows and require re-authorisation (add to `docs/d1-restore-reconciliation.md`). New tables: FK to `users` with cascade (new tables are safe) and update the `CLAUDE.md` list of cascade children; account deletion revokes best effort, then purges explicitly. Refresh rotation (Notion "Treat invalid_grant as terminal") needs an atomic write of the new refresh token. | C-2 BES-235, C-4 BES-239, C-10 BES-257 |
| 13 | Prompt injection and exfiltration through tool results: DPIA measures | `server/utils/search/injection-screening.ts`; DPIA risk rows 6, 23, 24, 31; MCP tools spec 2026-07-28 security section (accessed 2026-11-08); `docs/chats/model-switch-context.md` | `injection-screening.ts` screens only Brave and Exa results, and only when the user has a TypeSafe AI key and the toggle on (`resolveExternalSearchScreener` returns `null` otherwise), so it cannot be a baseline measure. DPIA row 23 treats the screened web text as public. Connector results are private third-party content, so sending them to TypeSafe AI is a new, different flow. Other measures exist and carry over: results are text only into later turns (the sanitizer drops tool parts), memory extraction reads user messages only, external markdown images are blocked at render, the memory write lock after a non-memory tool result (row 6). | go with changes | Measures, each with its ticket: (1) wrap every connector result as data, never instructions, as knowledge is wrapped (C-5); (2) extend the memory write lock to connector results, and test that tool results never feed memory extraction or past-chat retrieval (C-5); (3) approvals show real arguments, per tool, annotations untrusted, "always" bound to a tool schema hash (C-6); (4) drift: store a hash of each tool's name, description and schema at approval, disable the tool when it changes until re-approved (hash column C-2, enforcement C-5 and C-6); (5) any write call after a read from a different connector in the same turn needs approval (cross-connector exfiltration) (C-6); (6) result size cap, call-count cap per turn, timeout, per-connector rate limit (C-5); (7) SSRF-safe fetch with manual redirects, private-range blocks, no env or template interpolation in URLs or headers (LibreChat CVE-2026-32625, as named in the ticket, not checked here) (C-3); (8) no Besidka session or MCP token ever sent to a remote server, and only tokens issued by that server's own authorization server (MCP authorization page: clients "MUST NOT send tokens to the MCP server other than ones issued by the MCP server's authorization server") (C-4); (9) **do not send connector results to TypeSafe AI screening in v1.** If wanted later it needs its own consent wording, a DPIA row and a toggle, because the data is private. | C-5 BES-241, C-6 BES-244, C-3 BES-237, C-4 BES-239, C-2 BES-235 |

### The user's-own-act alternative (question 2)

The ticket asks the reviewer to test the argument that the transfer is the
user's own act, so no Chapter V basis is needed. It does not hold for outbound
connectors. Checked against EDPB 05/2021 (accessed 2026-11-07):

- Para 18 is an example ("such as when data are disclosed directly by the data
  subject to the recipient"), not a list of every case. Footnote 15 explains it:
  a data subject disclosing "his/her own personal data cannot be considered an
  'exporter'". The data must pass from the subject to the recipient with no
  controller or processor in between.
- Footnote 15 ends: "personal data disclosed via cookies are not considered as
  being disclosed directly by the data subject, but rather as a transmission by
  the operator of the website that the data subject is visiting." Besidka's
  Worker is that operator here.
- Example 4: an EEA travel agency collects a user's data and sends it to a hotel
  in a third country, a separate controller the user chose. The agency "carries
  out a transfer" and Chapter V applies. A user choosing the recipient did not
  move the exporter role to the user.
- Even if the user were the controller (a work account), a processor that sends
  data on its controller's instruction is itself an exporter (05/2021, text
  after Example 5: "the processor acts as a data exporter on behalf of the
  controller"). Besidka is the sender either way.
- Where the argument has force is the inbound case (DPIA item 12), where the
  client, not Besidka, makes the call. The Privacy Policy for connected apps
  already hedges: the approval is consent "in case the law treats it as a
  transfer by me".

Outcome: treat Besidka as the exporter and ask for the Art. 49(1)(a) consent.
The consent costs little if the user's-own-act reading were right, and it is
needed if it is wrong, so it covers both. No source found says the user's choice
of recipient shifts the exporter role.

### Preset terms (question 4)

| Preset | Third-party clients | OAuth path for Besidka | Brand rule (source) | Verdict |
|---|---|---|---|---|
| GitHub (`https://api.githubcopilot.com/mcp`) | Allowed: "you may also supply any valid access token. For example, you may supply a pre-generated Personal Access Token (PAT)" (github-mcp-server `docs/host-integration.md`, last updated 2026-10-28). Third-party hosts are "not governed by GitHub's Copilot policies" (`docs/policies-and-governance.md`, 2025-07-18). Terms of Service and AUP: UNVERIFIED | No DCR ("NOT supported"), no CIMD. An OAuth path means Besidka registers its own GitHub OAuth App or GitHub App and holds a client secret; org "OAuth App access policies" may need owner approval | github.com/logos (no date shown): "Show integration" is allowed, "Secondary placement ... less prominently than your own" product name, and "Do not use the GitHub name or any GitHub logo in a way that suggests" endorsement | **Go, PAT-only in v1.** The user pastes a PAT, like any BYOK key; no new Besidka-held secret. The screen suggests a fine-grained PAT with the fewest scopes (Besidka's minimisation advice; GitHub's MCP docs read do not say whether the remote server accepts fine-grained tokens, so test before launch). An organisation's PAT policies can still restrict the token: PAT-only avoids the OAuth App approval step, not every organisation control (`docs/policies-and-governance.md`). OAuth is a later owner decision. Text name only. |
| Notion (`https://mcp.notion.com/mcp`) | Allowed: Notion publishes "Build an MCP client for Notion" (developers.notion.com guide: "Connect your app or AI assistant to Notion MCP with OAuth 2.0, PKCE"), which is its own invitation to third-party clients. The help page line "Any AI app that supports the Model Context Protocol can connect to Notion" is from a WebFetch summary only, re-check the live wording. Enterprise workspaces can restrict clients: "Limiting which clients members can connect needs the Enterprise plan" (developers.notion.com/guides/mcp/security.md; Settings, Notion MCP, Manage workspace clients) | CIMD and DCR both live. Refresh tokens rotate on every use | Trademark page (last edited 2023-08-04): "works with" wording allowed; logos only "for which you are approved". Marks not allowed in app or domain names | **Go, text-only.** Connect screen note: if your workspace restricts MCP clients, ask the admin to approve Besidka. |
| Linear (`https://mcp.linear.app/mcp`) | Documented for "Claude, Cursor, and other clients"; no allow-list documented (UNVERIFIED that none exists); Terms and AUP not reviewed | CIMD and DCR both live | linear.app/brand (no date shown): "Do not ... display these graphics in a way that implies a relationship, affiliation, or endorsement", no integration carve-out | **Go, text-only.** No logo. |
| Atlassian (`https://mcp.atlassian.com/v2/mcp`) | "Atlassian MCP supports any app with MCP support", but OAuth 2.1 uses a redirect-domain allow-list; the supported list is of "Atlassian AI partners" and `besidka.com` is not on it. Each customer org admin must add the domain (Atlassian Administration, Connectors, Atlassian MCP server, Add domain). API-token auth does not use the allow-list, but it "is only available if enabled by your organization admin" and Atlassian recommends it only for non-interactive use, so it is an admin-controlled fallback, not a user option (the page also speaks of an admin having "disabled" it, so the default is unclear: UNVERIFIED). Atlassian Cloud Terms: UNVERIFIED | CIMD and DCR on v2 (live probe 2026-11-07). Search tools use Rovo credits of the customer org ("1-10 Rovo credits per call"); writes and single-item lookups are free | atlassian.com/legal/trademark: logo allowed to show "designed for and compatible with" if unmodified and not combined with your own mark; other use needs written approval | **Go with changes, text-only, required `notice`:** "Your Atlassian admin must allow besidka.com (or enable API tokens). Some tools use Rovo credits from your organisation." Drop the preset if C-2 cannot show the notice. Use the v2 URL (Atlassian moves v1 users to v2 tools from 2027-03-01). |

Monetisation: a preset is a convenience, not a partnership. Nothing here earns
money; no referral or affiliate parameters, no sponsored order in the catalog or
the registry search.

## Shared gate

| Gate item | Finding | Action |
|---|---|---|
| 1. GDPR (Art. 30, DPIA, Art. 6 basis, Art. 9, Art. 49 transfers) | Art. 30: new activities 10b (connectors) and 10c (registry mirror), new third-country recipient row, row 12 gains the connector consent record. DPIA: new section 3.12, flow rows, risk rows 38 on, residual items 16 on. Art. 6: sending tool arguments and storing results is the user's request, Art. 6(1)(b), as for connected apps (the Art. 6(1)(b) reading is "optional feature" and open in DPIA item 13; the consent screen is built to the Art. 7 standard anyway). The registry mirror: Art. 6(1)(f). Audit log: Art. 6(1)(f) and (b). Art. 9: own consent per connector, user's own data only. Art. 49(1)(a): question 2. Art. 14(5)(b) for third parties in tool results and in the registry. | C-10 writes the records from the input list below. |
| 2. Public documents (Privacy Policy, Terms, Cookie Policy) | Privacy Policy: new "Connectors" section, new recipient row, Transfers paragraph, legal-basis rows, retention rows, a sentence in "Sensitive information in your chats" that connectors have their own consent, the registry Art. 14(5)(b) paragraph. Terms: new "Connectors" section plus edits in "You need your own API key", "Sensitive information", "Other people's data", "Liability". Cookie Policy: no change (no new cookie or browser storage planned; if C-7 stores any UI state, check). | Input list below. |
| 3. Notification mechanics (WP260 materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION`) | **Material.** A new purpose (calling third-party tools), a new recipient category (any remote MCP server the user names, in unknown countries), a new transfer, and new duties in the Terms (`docs/legal.md` materiality checklist). Needs a `LEGAL_NOTICES` entry with at least 30 days between `publishedAt` and `effectiveAt`. Note `2026-11-legal-notices` stays active until 14 days after 2026-12-04 and `docs/legal.md` records that two concurrent notices make banner dismissal last-write-wins, so do not publish the connectors notice before 2026-12-18 or accept that limitation. **`CURRENT_CONSENT_VERSION` unchanged** (`2026-11-a`): the two sign-up consent boxes keep their wording, so `CURRENT_CONSENT_TEXT_SHA256` stays. The connect-time consent is a separate record with its own version, the same pattern as the connected-apps approval (Art. 30 review log 2026-10-29: "Consent version unchanged"). Revisit only if the sign-up box wording is ever extended to name connectors (that would re-prompt everyone). | C-10 adds the notice; `pnpm run legal:hash` and the legal-revisions spec. |
| 4. `compliance-review-2026-10.md` items | Age gate: no change (connectors sit behind the gate: 18+ Terms). IP leaks section 2.2: the remote server sees Cloudflare's Worker IP, not the user's; the OAuth redirect is the user's own browser visiting a site they chose. New leak risk is logos and registry icons from third-party hosts: self-host or show none. DSA section 3.1: nothing in a connector is hosted for the public; the registry mirror is shown only to the signed-in user; nothing changes. AI Act section 3.2: tool results are not generated media and no connector-specific Art. 50 duty was found; whether Art. 50(2) marking reaches model text written into third-party services is covered by section 3.2 and is not changed here (UNVERIFIED). TCO section 3.3: no change. Breach runbook: question 12. | Image rule to C-2 and C-7; rest as above. |
| 5. Third-party terms and licences | Preset vendor docs and brand pages: question 4 (vendor ToS and AUP UNVERIFIED). Registry: CC0 for registry data, ToS effective 2025-09-02, preview status, branding rule. MCP spec: no licence issue found for implementing it. Anthropic and OpenAI MCP fast paths: question 9. Remote servers' own terms bind the user, not Besidka. | Re-check dated before launch (C-1). |
| 6. Monetisation guard | Presets are not partnerships: no referral parameters, no paid placement, no claim of partnership, "not affiliated" line. Atlassian's allow-list is a partner list; Besidka is not on it and must not imply it. No change to `docs/legal/monetisation-readiness.md`. | Rule into C-2 catalog acceptance criteria. |
| 7. Accessibility (WCAG 2.2 AA target from P0-14) | Connect-consent screen: real checkbox with a visible label, focus moved into the dialog and back, warning not shown by colour alone, host in plain text, buttons at least 24 px (2.5.8), status of the connection announced (4.1.3). Use a full-page redirect for OAuth, not a popup. Remote authorization pages are outside Besidka's control. Approval prompt (C-6): keyboard operable, arguments readable by screen readers. | Add to C-4, C-6, C-7 acceptance criteria. |

## Ticket changes (for the coordinator)

| Plan key | BES id | Change, written as an acceptance-criteria edit |
|---|---|---|
| C-1 | BES-233 | Add: `docs/connectors.md` records this pre-check's decisions (transfer consent model, preset list, fast-path verdict) and a dated vendor-policy re-check before launch. Threat model includes: spoofed host lookalikes, rug-pull tool changes, cross-connector exfiltration, credential theft, CIMD tampering. |
| C-2 | BES-235 | Add: connector row columns for consent (`consentOrigin`, `consentVersion`, `consentedAt`, `consentWithdrawnAt`), `addedVia`, per-tool schema hash; credentials encrypted, URL query strings and header values treated as secrets (encrypted, never logged or returned); audit table with `argsHmac`, 90-day sweep, cascade FK to `users` only, and connector id and host stored as plain columns (no FK to the connector row, so rows outlive a deleted connector); update `CLAUDE.md` cascade-child list and `docs/d1-restore-reconciliation.md`; migration contains only `CREATE TABLE`/`CREATE INDEX`. Catalog: text names only, a `notice` field, no logos, no referral parameters, Atlassian v2 URL, GitHub PAT-only. |
| C-3 | BES-237 | Add: redirects are never followed silently (a redirect to another origin requires new consent); URL checks run at add time without a request; no env or template interpolation in URLs or headers. |
| C-4 | BES-239 | Add: CIMD document at `/connectors/client-metadata.json` (not under `/.well-known/`), fields as in question 5, no `contacts`, built from `NUXT_PUBLIC_BASE_URL`; consent screen and `CONNECTOR_CONSENT_VERSION` with a text-hash spec; `CONNECTOR_CONSENT_REQUIRED` error; wipe-and-reauthorise procedure for key rotation; atomic refresh-token write; no Besidka token ever sent to a remote server. |
| C-5 | BES-241 | Add: connector results wrapped as data; memory write lock extended; results never feed extraction or retrieval (tests); result, call and time caps; `dynamic-tool` test for shares and branch; share dialog warning; connector metadata is display name only; consent and gate-consent checks before every call. |
| C-6 | BES-244 | Add: annotations untrusted, default "ask"; approval shows real arguments; "always" bound to schema hash; cross-connector write needs approval; keyboard and screen-reader operable. |
| C-7 | BES-249 | Add: consent screen (question 2) with host and issuer host; withdraw per connector; "added by <client>" notice for MCP-added connectors; registry results labelled "Not reviewed by Besidka"; WCAG items; no third-party images. |
| C-8 | BES-252 | Add: store only name, title, description (300 chars), remotes and status; no repository, websiteUrl, icons, `_meta`; replace on each sync; drop `deleted`; erasure list; hourly with `updated_since`. |
| C-9 | BES-256 | Add: scopes and tool rules from question 11 (no credentials, no `enabled`, no network call on add, only-reduce for `update_connector_tools`, `connectors:write` for delete, labels), `MCP_SERVER_VERSION` major bump, surface snapshot, `docs/mcp-server.md` item 4 note. |
| C-10 | BES-257 | Input list below; EDPB 2/2018 is now readable (see Unverified). |
| C-11 | BES-261 | Add: Anthropic path not built in v1; OpenAI path off by default with per-connector opt-in consent naming OpenAI, approval and audit parity shown, `store` setting disclosed, not offered for chat models that need an unconsented transfer consent. |
| C-13 | BES-312 | Add: landing copy must not show vendor logos or registry data and must not imply partnerships. |

## Input list for C-10 (BES-257)

- **Art. 30 rows.**
  - New row 10b "Connectors (user-chosen remote MCP servers)": purpose, tool
    calls the user approved to third-party services; basis Art. 6(1)(b) at the
    user's request per connector, Art. 9(2)(a) per connector, Art. 49(1)(a) for
    the transfer; data subjects: users and third parties named in arguments and
    results; data: encrypted credentials, connector settings, consent record,
    audit log (no arguments, no results; HMAC only), results stored in the chat;
    recipients: independent controller chosen by the user, country unknown,
    Cloudflare (processor); retention: credentials and settings until deleted or
    account deleted, audit 90 days, results with the chat.
  - New row 10c "Registry mirror": maintainers' usernames, Art. 6(1)(f),
    Art. 14(5)(b), replaced hourly, erasure list.
  - Row 12 (consent receipts): add the per-connector record.
  - Section 6.1: new row "Remote MCP server the user connects (row 10b)":
    country unknown, no safeguard offered, Art. 49(1)(a), Besidka is the
    exporter, reference EDPB 2/2018 and 05/2021, counsel question open.
  - Row 15 (logging): `attributes.connectors` counts and ids only.
- **DPIA rows.** New section 3.12 (purpose, flow, data, status `planned`).
  Data-flow table: Worker to remote server (tool arguments, token); remote
  server to Worker (results, stored in the chat); results on to the chat's
  provider under the existing provider consent. Risk rows 38 on: (1) injection
  and exfiltration through results (question 13 measures); (2) transfer to an
  unknown country, consent weaknesses (country unknown, ongoing transfers,
  arguments of later calls not known at connect time);
  (3) third parties' sensitive data in results, not covered by the user's
  consent; (4) credential theft; (5) lookalike or malicious server (host shown,
  "not reviewed", no preset trust transfer to typed hosts); (6) tool drift; (7)
  SSRF; (8) registry personal data; (9) audit log retention; (10) MCP-added
  connectors (disabled, no credentials); (11) fast path token exposure; (12)
  consent fatigue. Residual items 16 on: Chapter V for connectors (Besidka is
  the clearer exporter than for inbound apps; counsel question); the Fashion ID
  joint-controller risk for the transmission (same weakness as item 8);
  consent for ongoing transfers (EDPB 2/2018 p. 8); injection screening not
  applied to connector results in v1. Section 7 consultation question: is a
  per-connector Art. 49(1)(a) consent acceptable for ongoing transfers to
  unknown countries.
- **Privacy Policy paragraphs.** (1) "Connectors": what they are, that the AI
  writes the arguments sent to the server, that the server is an independent
  controller whose terms apply, where it is run (unknown), the consent screen
  and withdrawal. (2) Recipients table row "A connector server you add and the
  company behind it". (3) Transfers paragraph: Besidka's server sends the call,
  so this is a transfer by Besidka; no adequacy decision or safeguard can be
  named; explicit consent per connector (Art. 49(1)(a)); say the question is
  not fully settled, as for connected apps. (4) Legal-basis rows: send and
  store (Art. 6(1)(b)); sensitive data (Art. 9(2)(a), own consent, the user's
  own data only); transfer (Art. 49(1)(a)); audit log (Art. 6(1)(f)); registry
  (Art. 6(1)(f)). (5) Retention rows: credentials, settings and consent columns (deleted
  with the connector or the account; the proof of consent afterwards is the
  Axiom consent log only), audit log 90 days and not
  deleted early on connector delete, registry mirror replaced hourly. (6)
  Registry paragraph (Art. 14(5)(b) measure): what is taken, from where, how to
  ask for removal. (7) "Sensitive information in your chats": a sentence that
  connectors have a separate consent. (8) The tool results may contain other
  people's data; the user's consent does not cover it.
- **Terms of Use paragraphs.** New "Connectors" section: (1) you choose the
  server and answer for the account and credentials you give it; you need the
  right to use them, and a work account may need your employer's permission;
  (2) what a connector does in a third-party service with a call you approved is
  your action, under that service's terms; (3) Besidka runs only the calls you
  approve in the app, and a connector added by another app starts switched off;
  (4) Besidka does not check, endorse or control any server, preset or registry
  entry and is not responsible for what a server does with data; (5) no
  guarantee, a server or preset can stop working; (6) disconnect any time, which
  does not undo what a server already received; (7) names are owners' marks, no
  affiliation. Edits: "You need your own API key" (applies to connector
  credentials), "Sensitive information" (a sentence), "Other people's data"
  (results), "Liability" (add the remote server's use of data and what a
  connector does in your accounts to the not-liable list, keeping every
  mandatory-law carve-out already there).
- **AI Act / DSA records.** None new. Record "no connector-specific Art. 50 or
  DSA duty found" in the section 3.1 and 3.2 notes of the compliance review.
- **Materiality, `LEGAL_NOTICES`, `CURRENT_CONSENT_VERSION` expectation.**
  Both documents `material`, one new notice (suggested id `2026-12-connectors`),
  30 days, summary bullets: new feature, what is sent where, the consent per
  connector, the 90-day log, the registry mirror. Check the verified-user count
  against the daily email cap before choosing `sendFrom`. `CURRENT_CONSENT_VERSION`
  and `CURRENT_CONSENT_TEXT_SHA256` unchanged; `CONNECTOR_CONSENT_VERSION` is new
  and owned by C-4.

## Owner items

1. **Accept the consent residual (question 2).** Per-connector Art. 49(1)(a)
   consent cannot name the country and EDPB 2/2018 doubts consent for ongoing
   transfers. Options: (a) accept and disclose, as for DeepSeek, Moonshot AI,
   Qwen and connected apps (recommended); (b) presets only in v1 (smaller
   residual, but loses "bring your own server", the ticket's core decision);
   (c) block connectors for EEA users (cuts the feature). Counsel question stays
   open either way.
2. **GitHub preset.** PAT-only in v1 (recommended) or register a Besidka OAuth
   App or GitHub App (adds a client secret, org approval friction, a breach
   runbook row).
3. **Atlassian.** Keep as a text-only preset with the notice (recommended) or
   drop it.
4. **Audit log 90 days, kept after connector delete (question 7).** Confirm, or
   choose 12 months or delete-with-connector.
5. **Vendor contacts (optional).** Logos are not needed. If wanted later, Notion
   needs written approval (team@makenotion.com, from its trademark page).
6. **Anthropic token handling (optional).** Ask Anthropic support how
   `authorization_token` is stored and logged and whether the MCP connector can
   be ZDR-eligible. Until answered, the Anthropic fast path stays off.
7. **Notice scheduling.** Do not publish the connectors notice while
   `2026-11-legal-notices` is still shown (until 2026-12-18), or accept the
   last-write-wins dismissal limit.
8. **WAF check after C-4 deploys.** Confirm the CIMD path is reachable by a
   non-browser client (recommended path is outside `.well-known`, so no rule
   change). If `.well-known` is chosen instead, extend the rule per
   `docs/agent-readiness.md`.

## Sources

| Source | URL | Page date | Accessed |
|---|---|---|---|
| GitHub MCP server host integration, policies | https://github.com/github/github-mcp-server (docs/host-integration.md, docs/policies-and-governance.md) | 2026-10-28 and 2025-07-18 | 2026-11-07 |
| GitHub logos policy | https://github.com/logos | no date shown | 2026-11-07 |
| Notion MCP docs, help, trademark page | https://developers.notion.com/guides/mcp/build-mcp-client.md; https://developers.notion.com/guides/mcp/security.md; https://www.notion.com/help/notion-mcp; https://notion.notion.site/Notion-Trademark-Usage-Guidelines-9826313c686a4f6e9d8a48347162714b | no date shown; trademark page last edited 2023-08-04 | 2026-11-07 |
| Linear MCP docs and brand | https://linear.app/docs/mcp; https://linear.app/brand | no date shown | 2026-11-07 |
| Atlassian remote MCP server, OAuth 2.1, domains, usage limits, trademark | https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/; .../configure-oauth-2-1/; .../authentication-and-authorization/ (API-token availability); https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/; .../available-atlassian-mcp-server-domains/; .../understand-atlassian-mcp-server/ (supported domains are "a list of Atlassian AI partners"); https://support.atlassian.com/organization-administration/docs/usage-limits-in-atlassian-intelligence/; https://www.atlassian.com/legal/trademark | no date shown | 2026-11-07 |
| OAuth Client ID Metadata Document, draft -03 | https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-03.txt | 2026-11-02 | 2026-11-07 |
| MCP spec 2026-07-28: client registration, authorization | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration.md | version 2026-07-28 | 2026-11-07 |
| MCP spec 2026-07-28: tools (annotations, human in the loop, show tool inputs, audit logging) | https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md | version 2026-07-28 | 2026-11-08 |
| MCP Registry terms, aggregators, schema | https://modelcontextprotocol.io/registry/terms-of-service.md; https://modelcontextprotocol.io/registry/registry-aggregators.md; https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | terms effective 2025-09-02 | 2026-11-07 |
| Anthropic MCP connector; API data retention | https://platform.claude.com/docs/en/agents-and-tools/mcp-connector; https://platform.claude.com/docs/en/manage-claude/api-and-data-retention | no date shown | 2026-11-07 |
| OpenAI remote MCP guide | https://developers.openai.com/api/docs/guides/tools-connectors-mcp.md | no date shown | 2026-11-07 |
| EDPB Guidelines 05/2021 v2.0 (paras 9, 15, 16, 18, fn 15, Examples 1 and 4) | https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf | adopted 2023-02-14 | 2026-11-07 |
| EDPB Guidelines 07/2020 v2.1 (paras 12, 30, 67, 68 and travel-agency example, 80, 82) | https://www.edpb.europa.eu/system/files/2023-10/edpb_guidelines_202007_controllerprocessor_final_en.pdf | adopted 2021-07-07 | 2026-11-07 |
| EDPB Guidelines 2/2018 on Art. 49 derogations (pp. 4, 5, 7, 8) | https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_2_2018_derogations_en.pdf | adopted 2018-05-25 | 2026-11-08 |
| GDPR (Art. 14(5)(b), Art. 49(1), Recital 18) | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 | consolidated text | 2026-11-08 |
| CJEU C-40/17 Fashion ID (para 76; decided under Directive 95/46) | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0040 | judgment 2019-07-29 | 2026-11-08 |
| Repo (read from the working tree at commit b06caa48) | `docs/legal.md`, `docs/legal-memory-sensitive-data.md`, `docs/mcp-server.md`, `docs/agent-readiness.md`, `docs/legal/dpia.md`, `docs/legal/art30-record.md`, `docs/legal/breach-runbook.md`, `docs/legal/compliance-review-2026-10.md`, `docs/chats/model-switch-context.md`, `content/legal/privacy-policy.md`, `content/legal/terms-of-use.md`, `server/utils/chats/share-public-parts.ts`, `server/utils/chats/branch.ts`, `server/utils/search/injection-screening.ts`, `server/utils/search/text.ts`, `server/mcp/tools/get-chat.ts`, `node_modules/ai` 7.0.153 | n/a | 2026-11-08 |

## Unverified

- GitHub Terms of Service and Acceptable Use Policies, Linear Terms and AUP,
  Atlassian Cloud Terms and partner agreement, Notion terms: not reviewed for
  third-party MCP clients. The verdicts rest on each vendor's MCP docs. Settle by
  reading each vendor's terms before launch.
- Notion Brand Guidelines (JS-only page) and the two quotes from
  notion.com/help/notion-mcp (WebFetch summary only). Settle by reading the live
  pages in a browser.
- Whether the GitHub remote MCP server accepts fine-grained PATs (its docs say
  "any valid access token" and show a PAT). Settle by a test call.
- Whether Atlassian API-token access is on or off by default for an
  organisation (its pages say both "only available if enabled" and "disabled").
  Settle by Atlassian admin docs or a test organisation.
- Whether Linear has a workspace-level client allow-list. Settle by Linear docs
  or a test workspace.
- How Anthropic stores or logs `authorization_token`. Settle by Anthropic
  support or documentation.
- Whether OpenAI's approval-request flow can be mapped onto Besidka's approval
  and audit design for provider-run calls. Settle in the C-11 spike.
- Numeric rate limits on registry.modelcontextprotocol.io (none documented).
- Whether the Art. 15 and Art. 20 data export includes tool parts. Settle by
  reading the export code in C-5.
- Whether GitHub's OAuth device flow (listed in its authorization server
  metadata) works with the GitHub MCP server without a client secret. Not
  tested; relevant only if an OAuth path is wanted later.
- RFC 7009 token revocation support per remote authorization server (the ticket
  assumes "where offered"; each preset's metadata was not checked for a
  `revocation_endpoint`).
- Whether Art. 50(2) marking applies to model text written into third-party
  services (compliance review section 3.2 covers images only).
- Legal conclusions throughout (exporter role, Art. 49(1)(a) for ongoing
  transfers, Fashion ID by analogy, Art. 6(1)(b) for an optional feature): not
  lawyer-reviewed. EDPB 2/2018 was readable on 2026-11-08, which the DPIA and
  `docs/legal-memory-sensitive-data.md` say they could not do on 2026-10-26;
  C-10 should replace those "could not be re-read" notes with the pages cited
  above (pp. 4, 7, 8).
