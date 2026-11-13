# Connectors design (Phase 4a)

Status: **design, 2026-11-08.** Not built. This document is the source of
truth for the connectors track: C-2 (BES-235) to C-11 (BES-261) implement it,
and C-1 (BES-233) wrote it. Where a ticket body and this document disagree,
this document wins; section 13 lists every ticket that has to change. The
legal reasoning behind the consent, preset and fast-path rules is in the
compliance pre-check `docs/legal/prechecks/connectors.md` (C-12, BES-311,
PR #738). The roadmap and the feature-flag rules are in
`docs/agentic-capabilities-roadmap.md` and `docs/feature-flags.md` (both land
with P0-1, PR #732).

## Contents

1. [Overview and glossary](#1-overview-and-glossary)
2. [Decisions](#2-decisions)
3. [Threat model](#3-threat-model)
4. [Outbound URL rules (SSRF)](#4-outbound-url-rules-ssrf)
5. [Adding and connecting a connector](#5-adding-and-connecting-a-connector)
6. [Per-send lifecycle](#6-per-send-lifecycle)
7. [Approvals](#7-approvals)
8. [Data model](#8-data-model)
9. [Limits](#9-limits)
10. [UI placement](#10-ui-placement)
11. [MCP exposure](#11-mcp-exposure)
12. [Provider-native path (C-11)](#12-provider-native-path-c-11)
13. [Ticket changes](#13-ticket-changes)
14. [SDK verification](#14-sdk-verification)
15. [Host portability](#15-host-portability)
16. [Vendor policy re-check](#16-vendor-policy-re-check)
17. [Rejected alternatives](#17-rejected-alternatives)
18. [Revisit criteria](#18-revisit-criteria)
19. [Open questions](#19-open-questions)

## 1. Overview and glossary

A **connector** is a remote MCP server that a user adds so that models in
their chats can call its tools: GitHub, Notion, Linear, Atlassian, or any
Streamable HTTP MCP server the user names. Besidka's Worker is the MCP
**client**: it signs in to the server on the user's behalf, lists its tools,
offers them to the model, and runs the calls the user approves.

| Term | Meaning |
| --- | --- |
| Connector | Outbound: Besidka calls a remote MCP server for the user. Profile tab **Connectors** (`/profile/connectors`, icon `lucide:cable`). |
| Connected app | Inbound: an app (Claude, ChatGPT, Cursor) calls Besidka's own `/mcp` server. Profile tab **Connected apps** (`/profile/connected-apps`, icon `lucide:plug`). Unrelated to connectors except that both are OAuth. Each page has one line that links the other. |
| Preset | A curated catalog entry in `config/connectors-catalog.ts` (GitHub, Notion, Linear, Atlassian). A convenience, not a partnership: text name, URL, auth kinds, notice. |
| Registry entry | A row mirrored from the official MCP Registry (`https://registry.modelcontextprotocol.io`) into D1, searchable only by signed-in users. "Not reviewed by Besidka". |
| Origin | Scheme, host and port of the connector's server URL. The consent is bound to it. |
| Issuer | The OAuth authorization server (`iss`, RFC 9207) that issued the connector's tokens. Credentials are keyed by connector and issuer. |
| Tool definition hash | SHA-256 over a tool's name, title, description, input schema and annotations. The per-tool baseline that approvals and drift checks use (section 8). |
| Fingerprint | The output of `fingerprintTools` from `ai` (name to digest over description, input schema and title; annotations are **not** included). Used as one input of the definition hash. |
| Drift | A tool whose definition hash differs from the stored baseline, or a tool that appeared since the last review. Drifted tools are hidden from the model until the user reviews them. |
| Rug pull | A server that changes a tool's description or schema after the user approved it, to steer the model. Drift detection is the defence. |
| Approval | A per-call user decision in the chat (Allow once, Allow in this chat, Always allow, Deny). Section 7. |
| Connector consent | The per-connector GDPR consent (Art. 49(1)(a) transfer and Art. 9(2)(a) sensitive data) given on the connect screen, bound to the origin. |

What a connector is not: it is not a marketplace (Besidka offers four text
presets and a local registry search, nothing else), it is not stdio (only on
self-host, through a proxy, see section 15), and it never receives a Besidka
token.

Feature flags (registered by C-2 in the P0-3 registry at stage `internal`,
`default: false`, `allowRoles: ['admin']`):

| Flag | Gates | `spend` |
| --- | --- | --- |
| `connectors` | Page, tab, Search row, routes, "+" menu section, send wiring | `none` (the remote server bills the user directly, Besidka's provider spend is the normal send) |
| `connectors.oauth` | OAuth sign-in for connectors (header and no-auth connectors work without it) | `none` |
| `connectors.registry` | Registry search tab and `GET /api/v1/connectors/registry` | `none` |
| `connectors.native` | OpenAI-run MCP calls (section 12), Labs opt-in | `foreground`, so `optIn: 'required'` |

## 2. Decisions

Every decision below is binding for C-2 to C-11. A decision marked **(pre-check)**
comes from `docs/legal/prechecks/connectors.md`; one marked **(this doc)**
resolves a disagreement between tickets and is listed in section 13.

1. **No marketplace.** Four presets plus a cached, local-only search of the
   official MCP Registry. Nothing is ever added automatically.
2. **Transport: Streamable HTTP only** on Besidka's hosted instances. Legacy
   HTTP+SSE only when `@ai-sdk/mcp` falls back to it for an old server that the
   user added by URL; registry entries that offer only SSE are skipped. stdio
   only on self-host through a proxy.
3. **OAuth client: CIMD first, DCR fallback, never pre-registered.** PKCE S256
   mandatory, RFC 8707 `resource` = canonical server URL, RFC 9207 `iss`
   checked, RFC 9728 protected-resource discovery. No Besidka-held client
   secret for any preset.
4. **GitHub preset is PAT-only in v1 (pre-check).** The user pastes a
   fine-grained personal access token like any BYOK key. No GitHub OAuth App.
5. **Per-connector consent before any authenticated request (pre-check).** One
   screen, one explicit tick with two named parts (transfer to an unknown
   country, Art. 49(1)(a); sensitive data sent to and stored from this server,
   Art. 9(2)(a)), bound to the origin, versioned by `CONNECTOR_CONSENT_VERSION`.
   Asked again when the origin, the issuer or the consent version changes.
   Error code `CONNECTOR_CONSENT_REQUIRED`, handled like
   `TRANSFER_CONSENT_REQUIRED` (`shared/utils/legal-consent.ts`). The sign-up
   consent and `CURRENT_CONSENT_VERSION` are unchanged.
6. **Adding makes no network request (pre-check, this doc).** `POST
   /api/v1/connectors` and MCP `add_connector` only validate the URL
   syntactically (section 4) and store a disabled row with
   `status='needs-auth'`. Discovery, probing and sign-in happen when the user
   presses **Connect** in the app.
7. **Enabling happens only in the app.** MCP may add connectors (disabled),
   list them, reduce tool permissions and delete them. Reason: enabling opens a
   new data channel to a new recipient, which needs the consent screen; an
   injected agent must not be able to switch it on.
8. **Every tool starts at "ask" (pre-check).** A server's `readOnlyHint` is a
   hint that labels the tool and offers a bulk shortcut; it never skips an
   approval on its own. Only the user's choice in the app ("Always allow")
   does, and that choice is bound to the tool definition hash.
9. **Approval ends the send.** When a call needs approval, the stream ends with
   a pending approval card. The user's answer starts a continuation send. No
   stream is held open waiting for a human (section 7).
10. **New MCP scopes `connectors:read` and `connectors:write`.** Reusing
    `settings:*` was rejected: consent is stored by scope name, so new tools
    under an old scope would silently reach existing grants.
11. **Connector deletes use `connectors:write`, not `data:delete` (pre-check).**
    Deleting a connector removes credentials and settings, not user content,
    and it reduces exposure, like `revoke_chat_shares` on `chats:write`. Skills
    are user content and stay on `data:delete` (`docs/skills.md`).
12. **Context panel data comes from message parts (this doc).** "Used →
    Connectors" is built from the persisted `dynamic-tool` parts, as the P0-13
    contract requires. The audit table is security data and is not read by the
    panel.
13. **The provider-native path is OpenAI-only and off (coordinator decision,
    2026-11-08).** Anthropic `mcp_servers` is not built in v1. OpenAI
    `type: "mcp"` ships only behind `connectors.native`, per-connector opt-in,
    and only after the C-11 spike proves audit parity (section 12).
14. **No new nav pill slots.** Profile tab, Search popup row, "+" menu section,
    context panel "Used" section.
15. **No logos or third-party images (pre-check).** Presets, cards and registry
    rows show text and a generated initial avatar. No favicons, no registry
    `icons`, no hotlinking.
16. **Results are data, never instructions.** Every connector result is wrapped
    and framed as untrusted, engages the memory write lock and never feeds
    memory extraction, chat search or shares.

## 3. Threat model

Assets: the user's third-party accounts (reachable through stored tokens), the
user's chat content (sent as tool arguments), Besidka's infrastructure (the
Worker's network position), and the integrity of what the model reads.

| # | Threat | Attacker | Mitigation | Ticket |
| --- | --- | --- | --- | --- |
| T1 | SSRF to cloud metadata, private ranges or loopback through the server URL, PRM, AS metadata, authorization, token, registration or revocation endpoint | Malicious user, malicious server returning crafted metadata | `parseSafeOutboundUrl` on every outbound URL (section 4): https only, IP literals rejected, special names rejected, ports 443/8443; `classifyIp` for vetted range checks; `safeFetch` with per-hop re-validation | C-3 |
| T2 | DNS rebinding: a public name that resolves to a private address at fetch time | Malicious user or server | `global_fetch_strictly_public` compatibility flag (workerd refuses private destinations at connect time) plus per-hop validation. Workers cannot pin DNS or read the resolved IP, so the app-level check cannot stop a name like `127.0.0.1.nip.io`; only the flag does. Stated limit, tested (section 4.4) | C-3 |
| T3 | Env or template interpolation in a user URL or header (LibreChat CVE-2026-32625: `${VAR}` from `process.env` interpolated into a user MCP URL leaked secrets) | Malicious user | Never interpolate anything into user-supplied URLs or headers. Registry entries with `{var}` or `${...}` in the URL are skipped. Header names validated by regex, values stored encrypted and sent verbatim | C-3, C-8 |
| T4 | Token theft at rest | Database or backup leak | Access, refresh and header values encrypted with `useEncryptText` (`server/utils/encryption.ts`, `NUXT_ENCRYPTION_KEY`); full server URL encrypted (paths and queries can carry secrets); never logged, never returned by any API or MCP tool | C-2, C-4 |
| T5 | Confused deputy and token passthrough: Besidka's own session or MCP token sent to a remote server, or one server's token sent to another | Malicious server | Credentials keyed per user × connector × issuer; a connector sends only tokens issued by its own authorization server (MCP authorization spec); RFC 8707 `resource` binds the token audience; `Authorization` stripped on any origin change; Besidka session cookies and `/mcp` tokens never leave the Worker | C-4 |
| T6 | Spoofed host lookalike (`notlon.so`, `mcp.linear.app.evil.com`, IDN homograph) presented as a known service | Phishing link, malicious registry entry | The consent screen and every card show the punycode host in plain text; presets match by exact URL only, so a typed host never inherits preset trust; registry rows labelled "Not reviewed by Besidka"; no logos that could lend credibility | C-7, C-8 |
| T7 | Tool rug pull: a tool's description or schema changes after approval to steer the model | Malicious or compromised server | Per-tool definition hash (section 8) computed on every `tools/list`; changed or added tools hidden until reviewed in the drift dialog; "Always allow" is bound to the hash and falls away on change; annotations are part of the hash because `fingerprintTools` omits them | C-2, C-5, C-6, C-7 |
| T8 | Prompt injection through tool results | Content in a third-party system (an issue body, a Notion page) | Results wrapped as `<untrusted_tool_result connector="<slug>" tool="<name>">` with a system rule that the content is data; `UntrustedContentGuard` (`server/utils/ai/tool-loop.ts`) set after any connector result; write calls after untrusted content always ask (section 7); memory write lock extended; results never reach memory extraction or chat search. TypeSafe AI screening is **not** applied to connector results in v1 (pre-check Q13: private third-party data needs its own consent) | C-5, C-6 |
| T9 | Cross-connector exfiltration: a result from connector A makes the model send A's data to connector B | Injected content | Any call to a connector other than the ones whose results the send has already read asks, read-only or not, "always" or not (section 7, rule F2) | C-6 |
| T10 | Exfiltration through write tools of the same connector | Injected content | Write tools ask after untrusted content even when set to "Always allow" (rule F1); the approval card shows the real arguments | C-6 |
| T11 | Credential theft through a stolen Besidka session | Session thief | Connecting, enabling, "Always allow" and the consent are app-only actions behind the session; MCP can only reduce; audit rows survive connector deletion for 90 days, so a thief cannot erase the trail; the breach runbook gains a connector-credential containment row (C-10) | C-4, C-9, C-10 |
| T12 | CIMD tampering: a changed `redirect_uris` in Besidka's Client ID Metadata Document captures authorization codes | Attacker with deploy access, or a host-header trick | Document built from configuration only (section 5.3), never from the request except an allowlisted preview host; one exact `redirect_uri`; no secrets in it; `client_id` never changed as a fix (remote caches hold it for hours); breach runbook row | C-4, C-10 |
| T13 | Token bloat and denial of service: huge tool lists, descriptions or results exhaust the context window, CPU or memory | Malicious server | Limits in section 9: 5 connectors and 40 tools per send, 16 KiB of descriptions, 1 KiB per description, 8 KiB per input schema, 64 KiB per result, 1 MiB raw response cap, 60 s per call, 12 calls per turn | C-5 |
| T14 | Slow server holds the generation lease | Malicious or slow server | Per-call timeout 60 s (`TOOL_LOOP_TOOL_TIMEOUT_MS`) keeps the 120 s generation lease heartbeating; connect timeout 10 s; at most 3 parallel connects | C-5 |
| T15 | Encryption-key loss or rotation | Operator | Rotating `NUXT_ENCRYPTION_KEY` without re-encryption makes every stored connector credential undecryptable. Procedure: wipe `connector_credentials`, set every connector to `needs-auth`, users reconnect. Self-hosters must back up the key | C-4 |
| T16 | D1 restore revives revoked credentials or deleted connectors | Operator restore | `docs/d1-restore-reconciliation.md` entry: after a restore, delete all `connector_credentials` rows and set connectors to `needs-auth`; replay connector deletions from Axiom `attributes.connectors` | C-2 |
| T17 | MCP-added malicious connector | Injected agent with `connectors:write` | Created disabled, no credentials, no network call; the card says "Added by <client>, not by you in the app"; at most 5 disabled MCP-added connectors per user | C-9 |
| T18 | Third parties' data in results stored and shared | n/a (compliance) | Results stored only in the chat; tool parts stripped from shares (`filterPublicParts` drops `dynamic-tool`), branches and later model context; the share dialog warns when the chat used a connector | C-5 |
| T19 | Registry personal data (GitHub usernames in names) | n/a (compliance) | Store only name, title, description (300 chars), remotes and status; erasure list; never on public pages | C-8 |

## 4. Outbound URL rules (SSRF)

### 4.1 Validator

`server/utils/net/safe-url.ts` (C-3) exports
`parseSafeOutboundUrl(input, options?) → { ok: true, url } | { ok: false, reason }`
and `classifyIp(address)`. Steps, in order:

1. Trim. Reject length over 2,048 characters, control characters and inner
   whitespace (`length`, `characters`).
2. Parse with WHATWG `new URL()`. Failure: `invalid`.
3. Scheme must be `https:` (`scheme`). Local development may allow
   `http://localhost` only behind `import.meta.dev` and a runtime flag; never on
   a deployed Worker.
4. No userinfo (`credentials`).
5. Lowercase the hostname and strip one trailing dot. IDN hosts are already
   punycode after parsing.
6. Reject any IP literal (`ip-literal`): IPv4 after URL normalisation (so
   `0x7f.0.0.1`, `0177.0.0.1`, `2130706433` and `127.1` all arrive as
   `127.0.0.1` and are rejected) and every bracketed IPv6. Users give a
   hostname.
7. Reject special names (`special-name`): `localhost`, `*.localhost`, `local`,
   `*.local`, `*.internal`, `*.home.arpa`, `metadata.google.internal`, and a
   single-label host (no dot).
8. Port: default 443 or explicit 443 or 8443, else `port`.
9. Strip the fragment and return the URL.

`classifyIp` uses a vetted parser (add `ipaddr.js` as a direct dependency,
pinned; no hand-rolled regexes) and blocks `unspecified`, `loopback`,
`private`, `linkLocal`, `uniqueLocal` (fc00::/7), `carrierGradeNat`
(100.64/10), `multicast`, `broadcast`, `reserved`, and the inner address of
IPv4-mapped, 6to4 and Teredo IPv6. Step 6 already rejects every literal, so
`classifyIp` is defence in depth for any future path that sees an address.

### 4.2 Fetch wrapper

`server/utils/net/safe-fetch.ts` (C-3) exports
`safeFetch(input, init & { purpose, timeoutMs?, maxResponseBytes?, maxRedirects? })`
and `createSafeFetch(purpose)` (a `typeof fetch` for the `@ai-sdk/mcp`
transport `fetch` option and the OAuth `fetchFn`). For every request and every
redirect hop it runs `parseSafeOutboundUrl`, uses `redirect: 'manual'` (workerd
throws on `redirect: 'error'`, see `server/utils/providers/deepseek-web-search.ts`),
never forwards cookies, streams the body through a byte counter, and logs host,
purpose and status only (`attributes.net`). A rejection throws evlog
`createError({ status: 400, message: 'This address is not allowed' })`.

Redirects follow a two-tier rule **(this doc)**:

| Purpose | Used for | Redirects | Timeout | Body cap | User-Agent |
| --- | --- | --- | --- | --- | --- |
| `mcp` | MCP transport calls to the connector's server URL | Same-origin only, at most 3 hops. A redirect to another origin stops with `CONNECTOR_ORIGIN_CHANGED`: the user edits the URL, which asks for consent again | 60 s per call, 10 s per connect | 1 MiB raw | `Besidka-Connectors/<version>` |
| `oauth` | PRM, AS metadata, registration, token, revocation | At most 3 hops, each re-validated; `Authorization` and request body dropped on origin change; 303 becomes GET | 10 s | 256 KiB | `Besidka-Connectors/<version>` |
| `registry` | `registry.modelcontextprotocol.io` | At most 3 validated hops | 30 s | 2 MiB per page | `Besidka-Connectors/<version>` |
| `skills-github` | Exactly `api.github.com` (ref to commit SHA, update checks) and `codeload.github.com/<owner>/<repo>/zip/<sha>`, through the narrow fetcher of `docs/skills.md` section 3.1 until C-3 lands | No redirect followed (`redirect: 'manual'`) | 30 s | 25 MiB | `Besidka-Skills/<version>` (GitHub answers 403 without a UA) |
| `skills-url` | A raw `SKILL.md` URL | At most 3 validated hops | 10 s | 256 KiB | `Besidka-Skills/<version>` |

The OAuth authorization server usually lives on another origin than the MCP
server. That is not a redirect: it is discovered from the PRM document, and the
consent screen names the issuer host when it differs from the server host
(section 5.2).

### 4.3 Header rules

Header name `^[A-Za-z0-9-]{1,64}$`, value at most 4,096 bytes with no CR or
LF. Rejected names: `Host`, `Cookie`, `Content-Length`, `Transfer-Encoding`,
`Connection`, `Mcp-Session-Id`, `Mcp-Protocol-Version`. Values are stored
encrypted and sent verbatim, never templated.

### 4.4 Test vectors

The C-3 specs (`tests/unit/server/utils/net/safe-url.spec.ts`,
`safe-fetch.spec.ts`) assert these results after URL normalisation.

Rejected:

| Input | Reason |
| --- | --- |
| `http://example.com` | `scheme` |
| `file:///etc/passwd`, `javascript:alert(1)` | `scheme` |
| `https://127.0.0.1`, `https://0x7f.0.0.1`, `https://0177.0.0.1`, `https://2130706433`, `https://127.1`, `https://0.0.0.0` | `ip-literal` |
| `https://[::1]`, `https://[::ffff:127.0.0.1]`, `https://[::ffff:7f00:1]`, `https://[fe80::1]`, `https://[fc00::1]`, `https://[fd12::1]` | `ip-literal` |
| `https://169.254.169.254/latest/meta-data`, `https://100.64.0.1`, `https://224.0.0.1`, `https://255.255.255.255`, `https://10.0.0.1`, `https://172.16.0.1`, `https://192.168.1.1` | `ip-literal` |
| `https://localhost`, `https://foo.localhost`, `https://printer.local`, `https://metadata.google.internal`, `https://intranet` | `special-name` |
| `https://user:pass@example.com` | `credentials` |
| `https://example.com:22`, `https://example.com:8080` | `port` |
| A 3,000-character URL; a URL containing `\n` | `length`, `characters` |

Accepted:

| Input | Result |
| --- | --- |
| `https://mcp.notion.com/mcp` | unchanged |
| `https://mcp.linear.app/mcp` | unchanged |
| `https://api.githubcopilot.com/mcp/` | unchanged |
| `https://EXAMPLE.com./path#frag` | `https://example.com/path` |
| `https://bücher.example/mcp` | `https://xn--bcher-kva.example/mcp` |
| `https://example.com:8443/mcp` | unchanged |

`safeFetch` cases: a 302 to `https://169.254.169.254` is rejected; a fourth
hop is rejected; a cross-origin hop for purpose `oauth` drops `Authorization`;
a cross-origin hop for purpose `mcp` stops with `CONNECTOR_ORIGIN_CHANGED`; a
body over the cap aborts; a timeout aborts. One test documents that
`https://127.0.0.1.nip.io` passes `parseSafeOutboundUrl` and is stopped only by
`global_fetch_strictly_public` (checked on the preview, not in unit tests).

`global_fetch_strictly_public` goes into `compatibility_flags` at the top level
and under `env.production` in `wrangler.jsonc`. It affects every outbound
fetch, so C-3 regression-checks DeepSeek web search, the shared-chat avatar
route, Brave, Exa, provider SDKs, push, email and image generation on the PR
preview.

## 5. Adding and connecting a connector

### 5.1 Add (no network)

`POST /api/v1/connectors` `{ url, title?, presetId? }` (app) and MCP
`add_connector` `{ url, title?, presetId? }` both:

1. Run `parseSafeOutboundUrl`. A preset id must match a catalog entry, and its
   URL replaces the input.
2. Derive the slug (section 8.1).
3. Insert a row with `enabled=false`, `status='needs-auth'`, `auth_type=null`,
   no consent, `created_via` (`app`, `preset`, `registry` or `mcp`; any row
   added over MCP is `mcp`, even with a `presetId`) and, for MCP,
   `created_by_client_id`.
4. Make no request to the URL.

### 5.2 Connect (in the app only)

The card's **Connect** button runs this flow. All requests go through
`safeFetch`.

1. **Discover** (`POST /api/v1/connectors/[id]/connect/discover`). Send one
   unauthenticated MCP request (`server/discover`, the SDK's stateless probe)
   with purpose `mcp`. No token, no chat data.
   - 401 with `WWW-Authenticate: Bearer resource_metadata="…"`: fetch the PRM
     (RFC 9728; fallback `/.well-known/oauth-protected-resource` on the server
     origin), pick the authorization server, fetch its metadata (RFC 8414,
     then OIDC discovery), and require `S256` in
     `code_challenge_methods_supported`. Result: `authType='oauth'`, issuer.
   - 401 or 403 without PRM: `authType='header'` (the user supplies a header).
   - 200: `authType='none'`.
   - A redirect to another origin: stop, `CONNECTOR_ORIGIN_CHANGED`.
   - The response returns the server host, the issuer host when it differs, the
     auth kind and, for presets, the preset `notice`.
2. **Consent** (dialog, `POST /api/v1/connectors/[id]/consent`). The dialog
   names the host (and the issuer host when different) in plain text and shows
   the text from the pre-check, question 2: the server may be outside the EEA
   with no adequacy decision; Besidka has no contract with it and offers no
   safeguard; the server keeps, uses and shares what it receives under its
   own terms; what is sent (the arguments the AI writes into each call, which
   can include anything from the chat, and the access token); results come
   back and are stored in the chat; the consent can be withdrawn. It adds the
   third-party-data advice (pre-check question 3): results can hold other
   people's data, which the user's consent does not cover. One real checkbox
   with a visible label covers the two named parts (transfer, Art. 49(1)(a);
   sensitive data sent to and stored from this server, Art. 9(2)(a)). Saving
   writes `consent_origin`, `consent_issuer`, `consent_version`,
   `consented_at` and logs `attributes.legalConsent` action
   `connector-granted` with the host. Refusal keeps the connector
   disconnected. The gate consent (sign-up consent) must be current too, as
   for MCP private tools. Accessibility (WCAG 2.2 AA, pre-check gate item 7):
   focus moves into the dialog and back, the warning is not carried by colour
   alone, the host is plain text, targets are at least 24 px, and the
   connection status after the callback is announced (`aria-live`). Consents
   are listed and withdrawable per connector on the Connectors page and in
   Profile → Security → Privacy & consent, next to the existing consents.
3. **Authenticate.**
   - OAuth (`POST /api/v1/connectors/[id]/oauth/start`, needs
     `connectors.oauth`): register (section 5.3), generate a 32-byte `state`
     and the PKCE verifier, store `connectors:oauth:<state>` in KV for 600 s
     (`{ userId, connectorId, codeVerifier, issuer, resource, requestedScope,
     createdAt }`), return `{ authorizationUrl }`. The browser goes there with
     `window.location.assign` (full-page redirect, not a popup).
   - Header (`POST /api/v1/connectors/[id]/credentials`
     `{ headerName, headerValue }`): validated per section 4.3. GitHub preset:
     header `Authorization`, value `Bearer <PAT>`; the screen suggests a
     fine-grained PAT with the fewest permissions.
   - None: nothing to store.
4. **Callback** (`GET /api/v1/connectors/oauth/callback?code&state&iss`): load
   and delete the KV state (single use); the session user must equal the state
   user; if the AS advertises `authorization_response_iss_parameter_supported`,
   `iss` must equal the stored issuer; exchange the code with the verifier and
   `resource`; compare granted and requested `scope` and store the granted one
   (a narrower grant sets a `degraded` note shown on the card); save
   credentials; redirect to `/profile/connectors?connected=<id>` or
   `?error=<code>`.
5. **First authenticated request.** The server gate checks consent, then lists
   tools (`tools/list`), stores a definition hash per tool, and opens the tool
   review. `status='ready'`.
6. **Enable** (`PATCH /api/v1/connectors/[id]` `{ enabled: true }`, app only,
   requires `status='ready'` and current consent). The first enable shows the
   tool review: descriptions, the server's read-only labels, and per-tool
   toggles. Nothing is enabled for chats until the user turns the connector on
   in a chat's "+" menu.

Disconnect (`POST /api/v1/connectors/[id]/disconnect`): RFC 7009 revocation
if the AS advertises `revocation_endpoint` (best effort), delete the
credentials row, `enabled=false`, `status='needs-auth'`. Consent stays.
Delete withdraws consent (`connector-withdrawn` log row) and removes the
connector, its credentials and its settings; audit rows stay until their 90
days end. Account deletion revokes every connector's tokens best effort
(through `safeFetch`, purpose `oauth`), then `purgeUserData` deletes all
connector rows, including the audit rows.

### 5.3 Client registration (CIMD, DCR)

Besidka publishes one Client ID Metadata Document per host at
**`/connectors/client-metadata.json`** (pre-check; not under `/.well-known/`,
which the production WAF allowlists path by path, and outside `/api/`, `/mcp`,
`/raw/` and the Free-plan rate-limit rule). Route
`server/routes/connectors/client-metadata.json.get.ts`.

```json
{
  "client_id": "https://besidka.com/connectors/client-metadata.json",
  "client_name": "Besidka",
  "client_uri": "https://besidka.com/",
  "logo_uri": "https://besidka.com/<logo path chosen in C-4>",
  "policy_uri": "https://besidka.com/privacy-policy",
  "tos_uri": "https://besidka.com/terms-of-use",
  "redirect_uris": ["https://besidka.com/api/v1/connectors/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

No `contacts`, no secrets. `logo_uri` is Besidka's own first-party logo under
`public/`, which the no-third-party-images rule does not touch.
`Cache-Control: public, max-age=3600`. Treat the production `client_id` as
permanent: changing it makes Besidka a new client at every authorization
server and breaks admin allowlists (Notion Enterprise, Atlassian).

**Preview and host rule (this doc).** CIMD `redirect_uris` are exact strings,
and Cloudflare Previews give every PR its own host
(`pr-<n>-besidka.chernenko.workers.dev`) while `NUXT_PUBLIC_BASE_URL` on
previews is the shared `https://preview-besidka.chernenko.workers.dev`. So the
document's origin is chosen like this:

- When `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` is unset (production): always
  `NUXT_PUBLIC_BASE_URL`. The request `Host` header is ignored.
- When it is set (previews): the request host if it matches that allowlist,
  else `NUXT_PUBLIC_BASE_URL`.

This keeps the pre-check's rule (never derived from untrusted input: the
allowlist is operator configuration) and makes each PR preview a valid client
with its own callback. The OAuth start route uses the same origin for
`client_id` and `redirect_uri`, so a flow started on `pr-12` ends on `pr-12`.
C-4 confirms that production leaves `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` unset.

Registration order at OAuth start:

1. AS metadata has `client_id_metadata_document_supported: true`: use the CIMD
   URL as `client_id` (no registration request).
2. Else, AS metadata has `registration_endpoint`: DCR (RFC 7591) with the same
   metadata, store the result in `connector_credentials.clientRegistration`
   (`registrationKind: 'dcr'`). DCR is deprecated in MCP 2026-07-28 and is
   removed after summer 2027; keep it as the fallback until then.
3. Else: error "This server needs a pre-registered client. Besidka does not
   support that; use an API key if the server offers one."

An AS that rejects a preview host's CIMD falls back to DCR on that host.

Which path each preset accepts (C-4 fills the "Verified" column on the PR
preview):

| Preset | URL | Auth in v1 | Expected registration | Verified (C-4) |
| --- | --- | --- | --- | --- |
| GitHub | `https://api.githubcopilot.com/mcp/` | Header (PAT) only | n/a (no DCR, no CIMD) | to record in the C-4 PR |
| Notion | `https://mcp.notion.com/mcp` | OAuth | CIMD, DCR live | to record in the C-4 PR |
| Linear | `https://mcp.linear.app/mcp` | OAuth or header (API key) | CIMD, DCR live | to record in the C-4 PR |
| Atlassian | `https://mcp.atlassian.com/v2/mcp` | OAuth or header (API token, admin-controlled) | CIMD, DCR on v2; the customer admin must allow `besidka.com` | to record in the C-4 PR |

### 5.4 Tokens and refresh

`getValidAccessToken({ connectorId })` (C-4, `server/utils/connectors/credentials.ts`)
refreshes when `expiresAt - now < 60 s` or after a 401. Refresh lock: KV
`connectors:refresh:<connectorId>`, TTL 30 s, put then re-read; a loser waits
500 ms up to 3 times and re-reads D1. The D1 write is compare-and-set on
`updatedAt`, so a rotated refresh token (Notion rotates on every use) is never
overwritten by a stale one. `invalid_grant` on refresh is terminal: delete the
credentials, `status='needs-auth'`. Routes are rate-limited like
`enforceKeysRateLimit` (10 per minute per user).

## 6. Per-send lifecycle

C-5 wires connectors into `server/api/v1/chats/[slug]/index.post.ts` after the
knowledge tools, only when `toolCallingAllowed` and the `connectors` flag are
true. When tool calling is off for the message (image generation, forced tool
choice), the message gets a one-line notice part: "Connectors are off for this
message".

1. **Select.** Optional body field
   `connectorIds: z.array(z.string().max(64)).max(5).optional()` (a new field;
   `chatToolSchema` is not widened). The server verifies ownership,
   `enabled`, `status='ready'` and current consent, and stores the choice in
   `connector_chat_settings`. An omitted field means the stored per-chat state.
2. **Gate.** For each selected connector: connector consent current, gate
   consent current, else `CONNECTOR_CONSENT_REQUIRED` with
   `data.connectorId` and the send does not start.
3. **Connect.** Capture `useKV()` and `useDb()` before any fan-out. At most 3
   connectors in parallel (the 6-connection Workers limit also covers KV and
   R2). `getValidAccessToken`, then
   `createMCPClient({ transport: { type: 'http', url, headers, fetch: createSafeFetch('mcp') } })`.
   Connect timeout 10 s; a connector that fails is skipped with a notice and
   its `lastError` is updated.
4. **List tools.** KV cache `connectors:tools:<connectorId>:<credentialGeneration>`
   (the credential row's `updatedAt`, so a reconnect invalidates it). TTL is
   the server's `ttlMs` clamped to 60 s to 3,600 s, default 600 s. A
   `cacheScope` other than shared is already per user, because the key holds
   the connector id.
5. **Filter.** Compute each tool's definition hash. Drop tools that are
   disabled by the user, unreviewed (no baseline row) or drifted (hash
   differs); a drifted or new tool sets `status='drifted'` with a count, and
   the card asks for review. Truncate each description to 1,024 bytes, skip a
   tool whose input schema exceeds 8 KiB, and stop adding at 40 tools or
   16 KiB of descriptions across all connectors, preferring tools the server
   marks read-only and tools the user set to "Always allow".
6. **Name.** `mcp__<slug>__<tool>`, characters outside `[a-zA-Z0-9_-]`
   replaced by `_`. When the result is over 64 characters, the tool part is cut
   and suffixed with `_` and the first 6 hex characters of SHA-256 of the
   remote name. A map from exposed name to (connector, remote name) is kept for
   the send; a collision after this step skips the later tool and logs it.
7. **Wrap `execute`.** Each call:
   - runs the approval decision (section 7); a call that needs approval is
     never executed in this send;
   - times out at `TOOL_LOOP_TOOL_TIMEOUT_MS` (60 s);
   - converts the result to text (joins `content[].text`, describes non-text
     content, no images in v1), truncates to 64 KiB with a notice;
   - wraps it as `<untrusted_tool_result connector="<slug>" tool="<name>">…</untrusted_tool_result>`;
   - sets `guard.untrustedResultSeen = true` and records the connector id in
     the send's set of read sources (rule F2);
   - writes one `connector_tool_calls` audit row.
8. **Loop budget.** Every connector tool is marked with `withFollowUpTurn()`.
   `resolveToolLoop` gains `connectorSteps` (4 steps) next to
   `chatSearchSteps` and `knowledgeSteps`, and the send stops calling
   connector tools after 12 calls in one turn.
9. **Close.** Close every client in the `streamText` `onEnd`, in a `finally`,
   and on error or abort. Closing is idempotent. `attributes.connectors.closed`.
10. **Persist.** Calls persist as AI SDK `dynamic-tool` parts with the exposed
    name and the truncated output, so `maxPersistedAssistantPartsBytes`
    (1.5 MB) is not reached by connector output alone. Places that special-case
    `tool-generate_image` get the equivalent handling (`app/composables/chat.ts`,
    `server/utils/chats/persist-user-message.ts`,
    `shared/utils/message-metadata.ts`).
11. **Later sends.** `sanitizeMessagesForModelContext`
    (`server/utils/files/assistant-files.ts`) drops tool parts, so results are
    not replayed into later turns (the exception for a pending approval is at
    the end of section 7.2). `filterPublicParts` (`server/utils/chats/share-public-parts.ts`)
    and `stripToolPartsFromBranchedMessage` (`server/utils/chats/branch.ts`)
    already drop `dynamic-tool` parts; C-5 adds a spec with a `dynamic-tool`
    part to both, so an `ai` upgrade that changes `isToolUIPart` is caught.

Rendering: tool steps in `ChatReasoning` with the connector's display name,
the tool name and a `badge badge-soft` "Untrusted output"; arguments
collapsed. The display name comes from the user's connector list at render
time; a deleted connector shows its slug. Never the URL, headers or tokens.

Share dialog: when the chat used a connector, it warns that answers may repeat
data from it, next to the existing personal-data check.

## 7. Approvals

### 7.1 Decision order

For every call, `toolApproval` (AI SDK, on `streamText`) returns
`'not-applicable'` or `'user-approval'` with a reason, in this order:

1. **F1, write after untrusted content.** The tool is not marked read-only by
   the server, and `guard.untrustedResultSeen` is true: ask. Today
   `prepareStep` sets the guard after any non-memory tool result
   (`isUntrustedToolResultPart` in `server/utils/ai/tool-loop.ts`), so an
   earlier connector result, web search result, knowledge read or skill
   activation in the send all count. Connector and skill tools also set it in
   their `execute`, so the rule does not depend on `prepareStep` alone.
   "Always allow" does not apply. This is also what `docs/skills.md`
   requires while a skill is active.
2. **F2, cross-connector call.** The send has already read a result from at
   least one connector, and this call goes to a connector that is not among
   them: ask, whether the tool is read-only or not.
3. **Always (tool).** `connector_tool_settings.approval='always'` and its
   `approvedDefinitionHash` equals the current hash: run.
4. **Always (this chat).** `connector_chat_settings.alwaysAllowTools` maps the
   tool to the current hash: run.
5. **Ask.**

The server's `readOnlyHint` only matters in F1 (a read-only tool is not
subject to F1) and in the UI (badge, bulk shortcut). `destructiveHint: false`
is never trusted. A hash change clears both "always" entries for that tool.

### 7.2 Approval ends the send

When the model calls a tool that needs approval:

1. The stream emits the `tool-approval-request` and ends. No remote call
   happens.
2. The assistant message is persisted with the tool part in state
   `approval-requested`.
3. The exact arguments go to KV `connectors:approval:<approvalId>` for 24 h.
   They are never taken from the client later.
4. An audit row is written with `outcome='pending'`.
5. Approval ids are HMAC-signed with `experimental_toolApprovalSecret`. The
   secret is derived, not a new environment variable:
   `HKDF-SHA-256(NUXT_ENCRYPTION_KEY, info='besidka/tool-approval/v1')`.

The user's answer is a continuation send: the send route accepts
`toolApprovalResponses: z.array(z.object({ approvalId: z.string().max(200), approved: z.boolean(), remember: z.enum(['once', 'chat', 'always']).default('once'), reason: z.string().max(500).optional() })).max(10)`
with empty user text. The server checks that the session user owns the chat
and the pending approval, loads the arguments from KV, re-runs the section 7.1
decision against the current hash (a tool that drifted since the request is
refused), executes or denies, and appends the result to the **same**
assistant message. `remember='chat'` writes `alwaysAllowTools`;
`remember='always'` writes `connector_tool_settings.approval='always'` with
the current hash. A denial returns "The user declined this action" and the
model continues. Expired arguments give 409 "This approval expired" with the
fix "Ask again". Rate limit: 30 approval responses per minute per user.

Why the send ends instead of waiting: a client disconnect kills the Worker
invocation (`docs/chats/stuck-generation-guard.md`), the generation lease is
120 s, and a human may answer minutes later. A held stream would leave a
stuck "generating" chat. Cost: the continuation re-sends the context, one
extra model turn per approval.

`sanitizeMessagesForModelContext` gets one exception: the last assistant
message keeps its parts when it holds an `approval-responded` part, so the
continuation sees the call it answered. Earlier tool parts stay stripped.

If the C-6 spike finds that AI SDK v7 continuation does not resume this way,
the fallback is to execute the approved call server-side and append a
synthetic tool result before the continuation turn.

### 7.3 Approval UI

`app/components/Chat/ToolApproval.vue`, inline in the assistant bubble:

- Header: "<Connector> wants to run <tool>", a `badge badge-soft badge-warning`
  "Changes data" unless the server marks the tool read-only, and the reason
  (for example "This chat already read data from Notion").
- The real arguments as pretty JSON in a `<pre>` (max height, scroll), with
  URLs and e-mail addresses highlighted. Never the model's own description of
  the call.
- Buttons: `btn btn-primary` **Allow once**; **Allow in this chat**; a
  dropdown item **Always allow this tool** with the confirmation "Besidka will
  run this tool without asking in every chat, until the server changes it"
  (hidden when F1 or F2 caused the request, since "always" would not apply);
  `btn btn-ghost` **Deny**.
- "View details" opens the P0-11 `UiSidePanel`: full arguments, the tool
  description, the connector host, earlier decisions.
- States: pending, sending, approved or denied (one line with time), expired
  (muted, "Ask again" re-sends the last user message).
- A pending approval shows a chip above the composer: "1 action waiting for
  approval". The composer stays enabled.
- Keyboard and screen reader: focusable card, Enter on the focused card means
  Allow once, Esc collapses, arguments readable as text, 24 px minimum
  targets, status announced (WCAG 2.2 AA, pre-check gate item 7).
- Below `md`: buttons full width, details in the bottom-sheet variant of
  `UiSidePanel` (`docs/chats/ios-keyboard.md`).
- Shared pages never render approval cards (spec).

Revocation: the connector card's tool list sets a tool back to "Ask every
time" (`POST /api/v1/connectors/[id]/tools/settings`), and the chat context
panel offers "Reset approvals in this chat"
(`POST /api/v1/chats/[slug]/connector-approvals/reset`). There is one route
for tool approval settings, not two.

### 7.4 Audit log

Table `connector_tool_calls` (section 8). One row per call: user, connector id
and host (plain columns, no foreign key to the connector, so rows outlive a
deleted connector), chat public id, tool name, approval mode, outcome,
duration, result bytes and `argsHmac`. `argsHmac` is HMAC-SHA-256 of the
canonical JSON arguments with the key
`HKDF-SHA-256(NUXT_ENCRYPTION_KEY, info='besidka/connector-audit-args/v1')`;
a plain hash would be reversible for short arguments. Never arguments, results,
URLs with query strings, headers or tokens. Retention 90 days, pruned hourly
in batches of 500 by the C-8 hourly plugin. Rows go with the account
(`purgeUserData`) and are not deleted with the connector. Axiom gets counts,
ids, tool name, outcome and duration under `attributes.connectors` (scalars
only, `docs/axiom-map-fields.md`).

### 7.5 Context panel

The P0-13 registry gains a `connectors` section in the **Used** group,
collected from persisted `dynamic-tool` parts whose name starts with `mcp__`:
connector display name, tool name, call count, last outcome and approval mode.
It links "Manage connectors" (`/profile/connectors?connector=<id>`). On
shared chats the section is empty because tool parts are already stripped.

## 8. Data model

All in `server/db/schemas/connectors.ts`, exported from `server/db/schema.ts`.
One migration in C-2 with only `CREATE TABLE` and `CREATE INDEX` (grep the
generated SQL for `DROP TABLE` before applying). Defaults in application code
(`$defaultFn`), never SQL `DEFAULT`. **No foreign key to `users` and no
cascade to `chats` on any table (this doc):** `purgeUserData`
(`server/utils/account/purge-user-data.ts`) deletes every row explicitly, and
a spec fails when a table with a `user_id` column is not covered. This follows
the programme-wide planning decision "no `users` columns or FKs"
(`docs/agentic-capabilities-roadmap.md`, the precedent of `research_jobs` and
the P0-2 feature tables) and meets the purpose of the pre-check's audit-table
row (rows go with the account and are not deleted with the connector;
question 7 allows "cascade or explicit purge"). The pre-check's question 12
and C-2 row also ask for a cascade FK and a `CLAUDE.md` cascade-list entry;
this document overrides that, because a cascade only adds blast radius to a
future `users` rebuild and gives nothing explicit purge does not. With no
cascade, the `CLAUDE.md` list does not change. Per-chat rows store the chat
public id as text and are deleted by the chat-deletion cleanup.

### 8.1 `connectors`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `user_id` | integer, not null | |
| `slug` | text | `^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$` (1 to 16), unique per user, fixed after create. Presets use the preset id (`github`, `notion`, `linear`, `atlassian`). Other hosts use the second-to-last label (`mcp.example.com` gives `example`), or the third-to-last when the second-to-last has 3 characters or fewer and another label exists (`mcp.example.co.uk` gives `example`), cut to 16. On collision `-2`, `-3` |
| `title` | text | user-editable, at most 80 characters |
| `origin` | text | `https://host[:port]`, plain, for display and consent |
| `url_encrypted` | text | full canonical URL, encrypted (paths and queries can carry secrets) |
| `transport` | text | `streamable-http` or `sse` (TypeScript enum) |
| `auth_type` | text, null | `none`, `oauth` or `header`; null until discovery |
| `status` | text | `needs-auth`, `ready`, `drifted`, `error`. Not `disabled`: `enabled` is the only switch |
| `enabled` | integer (bool) | false on create; set only in the app |
| `preset_id` | text, null | |
| `created_via` | text | `app`, `preset`, `registry`, `mcp` |
| `created_by_client_id` | text, null | the OAuth client id for MCP-created rows; the card resolves the client name |
| `consent_origin` | text, null | origin the consent was given for |
| `consent_issuer` | text, null | issuer host shown on the consent screen |
| `consent_version` | text, null | `CONNECTOR_CONSENT_VERSION` |
| `consented_at` | timestamp, null | |
| `consent_withdrawn_at` | timestamp, null | |
| `native_opt_in_at` | timestamp, null | OpenAI-run calls opt-in (section 12) |
| `last_error` | json, null | code and safe message; includes the scope `degraded` note |
| `last_connected_at` | timestamp, null | |
| `created_at`, `updated_at` | timestamps | |

Indexes: unique (`user_id`, `slug`); (`user_id`, `updated_at`).

### 8.2 `connector_credentials`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `connector_id` | text | no foreign key |
| `user_id` | integer | |
| `issuer` | text | AS issuer; empty string for header auth |
| `client_registration` | text, encrypted, null | `{ client_id, registrationKind: 'cimd' \| 'dcr', client_secret? }` |
| `access_token` | text, encrypted, null | |
| `refresh_token` | text, encrypted, null | |
| `header_name` | text, null | |
| `header_value` | text, encrypted, null | |
| `scope` | text, null | granted scope |
| `expires_at` | timestamp, null | |
| `created_at`, `updated_at` | timestamps | `updated_at` is the compare-and-set token and the tool-cache generation |

Unique (`connector_id`, `issuer`).

### 8.3 `connector_tool_settings`

One row per reviewed tool. The rows are the drift baseline (there is no
connector-level fingerprint column).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `connector_id` | text | |
| `user_id` | integer | |
| `tool_name` | text | remote name |
| `definition_hash` | text | SHA-256 hex over `{ name, title, description, inputSchema, annotations }` as canonical JSON; computed from the `fingerprintTools` digest plus the canonical annotations |
| `server_read_only` | integer (bool) | the server's `readOnlyHint` at review time, for labels and F1 |
| `enabled` | integer (bool) | |
| `approval` | text | `ask` or `always` |
| `approved_definition_hash` | text, null | hash the "always" was given for |
| `created_at`, `updated_at` | timestamps | |

Unique (`connector_id`, `tool_name`).

### 8.4 `connector_chat_settings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `user_id` | integer | |
| `chat_public_id` | text | |
| `connector_id` | text | |
| `enabled` | integer (bool) | |
| `always_allow_tools` | json | `Record<toolName, definitionHash>` ("Allow in this chat") |
| `created_at`, `updated_at` | timestamps | |

Unique (`chat_public_id`, `connector_id`); index (`user_id`). Reused by
Phase 6 routines.

### 8.5 `connector_tool_calls` (audit)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer, autoincrement | |
| `user_id` | integer | |
| `connector_id` | text | plain, no foreign key |
| `connector_host` | text | plain |
| `chat_public_id` | text, null | |
| `tool_name` | text | remote name |
| `args_hmac` | text | section 7.4 |
| `result_bytes` | integer | |
| `outcome` | text | `ok`, `error`, `denied`, `timeout`, `pending` |
| `approval` | text | `not-applicable`, `once`, `chat`, `always`, `denied` |
| `path` | text | `worker` or `native` |
| `duration_ms` | integer | |
| `created_at` | timestamp | |

Indexes: (`user_id`, `created_at`); (`created_at`) for the sweep. A pending
row is updated in place when the approval is answered.

### 8.6 `mcp_registry_servers`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | registry name plus version |
| `name` | text | sync key |
| `title` | text, null | |
| `description` | text | at most 300 characters |
| `remote_url` | text | the first `streamable-http` remote that passes `parseSafeOutboundUrl` |
| `remote_type` | text | `streamable-http` |
| `header_names` | json | names only, never values |
| `status` | text | registry status |
| `registry_updated_at` | timestamp | |
| `synced_at` | timestamp | mark-and-sweep marker |

Index (`name`). Not stored (pre-check Q6): `repository`, `websiteUrl`,
`icons`, `_meta` publisher fields, `packages`. Not user data, so no
`user_id`.

### 8.7 KV keys

| Key | TTL | Content |
| --- | --- | --- |
| `connectors:oauth:<state>` | 600 s | OAuth state and PKCE verifier, deleted on read |
| `connectors:refresh:<connectorId>` | 30 s | refresh lock |
| `connectors:tools:<connectorId>:<generation>` | `ttlMs` clamped 60 to 3,600 s, default 600 s | `tools/list` result |
| `connectors:approval:<approvalId>` | 24 h | exact pending call arguments |
| `connectors:registry:updated-since` | none | sync cursor |
| `connectors:registry:full-pass` | none | id of the last completed full pass |
| `connectors:registry:erasures` | none | SHA-256 of registry names whose maintainers asked for removal |

### 8.8 Catalog

`config/connectors-catalog.ts`, `CONNECTOR_PRESETS` (`as const`):

| id | Title | URL | `auth` | `notice` |
| --- | --- | --- | --- | --- |
| `github` | GitHub | `https://api.githubcopilot.com/mcp/` | `['header']` | "Use a fine-grained personal access token with the fewest permissions you need." |
| `notion` | Notion | `https://mcp.notion.com/mcp` | `['oauth']` | "If your workspace limits MCP clients, ask the admin to approve Besidka." |
| `linear` | Linear | `https://mcp.linear.app/mcp` | `['oauth', 'header']` | none |
| `atlassian` | Atlassian | `https://mcp.atlassian.com/v2/mcp` | `['oauth', 'header']` | "Your Atlassian admin must allow besidka.com (or enable API tokens). Some tools use Rovo credits from your organisation." |

Text names only, no icons. The catalog footer reads "Names belong to their
owners. Besidka is not affiliated with them." No referral or affiliate
parameters, no interpolation. `scripts/check-connector-presets.mjs` (C-2)
probes each URL in a scheduled CI job and only warns. No Google Workspace MCP
preset while those servers are in Developer Preview (G-11). The C-4 OAuth
client code is reusable by Phase 4b (the BYO Google client path, G-7), but
that path follows Phase 4b's own rules and pre-check (G-11) and never appears
in this catalog.

## 9. Limits

These are constants in `shared/utils/connectors-policy.ts` (C-2 creates the
file; C-3, C-4, C-5, C-6 and C-8 import from it).

| Constant | Value | Used by |
| --- | --- | --- |
| `CONNECTOR_URL_MAX_LENGTH` | 2,048 characters | C-3 |
| `CONNECTOR_ALLOWED_PORTS` | 443, 8443 | C-3 |
| `CONNECTOR_HEADER_VALUE_MAX_BYTES` | 4,096 | C-4 |
| `CONNECTORS_PER_USER` | 20 | C-4, C-9 |
| `CONNECTORS_MCP_DISABLED_MAX` | 5 disabled MCP-added connectors per user | C-9 |
| `CONNECTORS_PER_SEND` | 5 | C-5 |
| `CONNECTOR_TOOLS_PER_REQUEST` | 40 | C-5 |
| `CONNECTOR_TOOL_DESCRIPTIONS_MAX_BYTES` | 16,384 per request | C-5 |
| `CONNECTOR_TOOL_DESCRIPTION_MAX_BYTES` | 1,024 per tool (truncated) | C-5 |
| `CONNECTOR_TOOL_SCHEMA_MAX_BYTES` | 8,192 per tool (tool skipped) | C-5 |
| `CONNECTOR_TOOL_NAME_MAX_LENGTH` | 64 (exposed name) | C-5 |
| `CONNECTOR_SLUG_MAX_LENGTH` | 16 | C-2 |
| `CONNECTOR_RESULT_MAX_BYTES` | 65,536 text after conversion | C-5 |
| `CONNECTOR_RESPONSE_MAX_BYTES` | 1,048,576 raw per MCP response | C-3, C-5 |
| `CONNECTOR_CALL_TIMEOUT_MS` | 60,000 (= `TOOL_LOOP_TOOL_TIMEOUT_MS`) | C-5 |
| `CONNECTOR_CONNECT_TIMEOUT_MS` | 10,000 | C-5 |
| `CONNECTOR_PARALLEL_CONNECTS` | 3 | C-5 |
| `CONNECTOR_STEPS_PER_TURN` | 4 | C-5 |
| `CONNECTOR_CALLS_PER_TURN` | 12 | C-5 |
| `CONNECTOR_CALLS_PER_MINUTE` | 60 per user, all connectors | C-5 |
| `CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR` | 30 per user per connector | C-5 |
| `SAFE_FETCH_OAUTH_MAX_BYTES` | 262,144 | C-3, C-4 |
| `SAFE_FETCH_REGISTRY_MAX_BYTES` | 2,097,152 per page | C-3, C-8 |
| Skills purposes (`skills-github`, `skills-url`) | caps in `docs/skills.md` section 9 (`SKILL_MAX_GITHUB_ARCHIVE_BYTES`, `SKILL_MAX_RAW_URL_BYTES`). `skills-github` uses the narrow allowlisted fetcher (`docs/skills.md` section 3.1) until C-3 lands, and then may move to `safeFetch`. `skills-url` waits for C-3 (S-2U) | S-2G, S-2U, C-3 |
| `CONNECTOR_TOOLS_CACHE_TTL` | default 600 s, clamp 60 to 3,600 s | C-5 |
| `CONNECTOR_OAUTH_STATE_TTL` | 600 s | C-4 |
| `CONNECTOR_REFRESH_LOCK_TTL` | 30 s | C-4 |
| `CONNECTOR_REFRESH_SKEW` | 60 s | C-4 |
| `CONNECTOR_ROUTES_PER_MINUTE` | 10 per user (mutating routes) | C-4 |
| `CONNECTOR_APPROVAL_TTL` | 24 h | C-6 |
| `CONNECTOR_APPROVALS_PER_MINUTE` | 30 per user | C-6 |
| `CONNECTOR_APPROVALS_PER_SEND` | 10 responses | C-6 |
| `CONNECTOR_AUDIT_RETENTION_DAYS` | 90 | C-8 |
| `CONNECTOR_AUDIT_PRUNE_BATCH` | 500 | C-8 |
| `CONNECTOR_DRIFT_DIFF_LINES` | 200 (then "Show all") | C-7 |
| `SAFE_FETCH_DEFAULT_TIMEOUT_MS` | 10,000 | C-3 |
| `SAFE_FETCH_DEFAULT_MAX_BYTES` | 2,097,152 | C-3 |
| `SAFE_FETCH_MAX_REDIRECTS` | 3 | C-3 |
| `REGISTRY_SYNC_CRON` | `0 * * * *` (the existing hourly trigger) | C-8 |
| `REGISTRY_PAGE_SIZE` | 100 | C-8 |
| `REGISTRY_PAGES_PER_RUN` | 20 | C-8 |
| `REGISTRY_FETCH_TIMEOUT_MS` | 30,000 | C-8 |
| `REGISTRY_DESCRIPTION_MAX_CHARS` | 300 | C-8 |
| `REGISTRY_FULL_PASS_HOURS` | 24 | C-8 |
| `REGISTRY_SEARCH_PAGE_SIZE` | 20 | C-8 |
| `REGISTRY_SEARCHES_PER_MINUTE` | 30 per user | C-8 |
| `CONNECTOR_MCP_DELETE_BATCH` | 20 ids per `delete_connectors` call | C-9 |
| `CONNECTOR_MCP_TOOLS_BATCH` | 100 tools per `update_connector_tools` call | C-9 |
| `CONNECTOR_MCP_LIST_LIMIT` | 50 per `list_connectors` page | C-9 |

Workers ceilings that bound these choices: 6 simultaneous outbound
connections per invocation (KV and R2 count), 10,000 subrequests per
invocation on Workers Paid, CPU time excludes I/O wait.

Registry mirror cadence: hourly incremental sync by `updated_since`
(`GET /v0.1/servers?limit=100&version=latest&updated_since=<iso>&cursor=<c>`),
upserts through `db.batch()` of single-row inserts, `status='deleted'` rows
removed, erasure-list names skipped. Once every 24 hours the run resets the
cursor for a full pass and stamps `synced_at`; when the pass completes, rows
whose `synced_at` predates it are deleted (the registry is in preview and
"data resets may occur"). A failure keeps the cursor and never throws out of
the scheduled handler.

## 10. UI placement

No new nav pill slots (roadmap decision).

| Place | What | Ticket |
| --- | --- | --- |
| Profile tab | `{ to: '/profile/connectors', label: 'Connectors', icon: 'lucide:cable' }` in `app/layouts/profile.vue`, after Connected apps (and after Labs from P0-7), shown only when `useFeature('connectors')` | C-7 |
| Search popup | Settings row `search-option-connectors`, same icon and label, flag-gated, id added to `tests/unit/components/Search/Modal.spec.ts` | C-7 |
| User dropdown | Nothing (`Sidebar/AuthCta.vue` stays Security and API Keys, plus the chat-page rows from P0-13) | C-7 |
| "+" menu | Section "Connectors" in `app/components/ChatInput/ToolsMenu/Content.vue`: one `ToggleRow` per enabled, ready connector (title, status dot, enabled tool count), revealed only when the user has at least one enabled connector and the model can call tools; `ActionRow` "Manage connectors"; tile "N connectors" from `buildChatInputTiles` (`docs/chats/chat-input-tools-menu.md`) | C-5 |
| Chat bubble | Tool steps in `ChatReasoning`, approval cards (`Chat/ToolApproval.vue`), "Run by OpenAI" badge on native calls | C-5, C-6, C-11 |
| Context panel | "Used → Connectors" (section 7.5) | C-5 |
| Labs | `connectors.native` opt-in row | C-11 |

The Connectors page (`app/pages/profile/connectors.vue`, components in
`app/components/Profile/Connectors/`) has: a header with one explainer line
("Let models use tools from services you choose. Each server sees only what
the model sends it.") and a link to Connected apps; "Add connector"; the
preset list as text tiles with a generated initial avatar; the add dialog
(`modal modal-bottom sm:modal-middle js-connector-add-modal`, tabs Presets ·
URL · Search registry); connector cards with host, status badge, "Added by
<client>, not by you in the app" for MCP-created rows, the consent state with
"Withdraw", enable toggle, Connect / Reconnect / Disconnect / Rename / Delete;
the tool list with "Read-only (as reported by the server)" or "Changes data"
badges, toggles, the approval select (Ask every time / Always allow, with a
confirmation for tools not marked read-only), the bulk action "Allow read-only
tools without asking" (an explicit user choice, never a default), and the
counter "12 of 40 tools used per message"; the drift dialog (added, changed
with old and new description and schema, removed; "Accept changes" stores new
baselines, "Keep disabled"). Registry results carry "From the Official MCP
Registry. Not reviewed by Besidka." and render as plain text (no `v-html`).

Tab-row width: Connectors and Skills make 8 profile tabs with Labs. CLAUDE.md
only guarantees that a sixth tab fits at 768 to 1024 px. C-7 checks the row at
768, 1024 and 1440 px; if it does not fit, the fallback is one "Integrations"
tab with Connectors and Skills as sub-tabs (open question 3).

## 11. MCP exposure

New scopes in `shared/utils/mcp-oauth-scopes.ts`: `connectors:read` (read
class) and `connectors:write` (write class, unticked by default, shown apart).
Consent labels in `app/components/OAuth/ScopeLabel.vue`:

- `connectors:read`: "See your connectors: names and addresses, never their keys"
- `connectors:write`: "Add, change and remove connectors. New ones start switched off; you switch them on in Besidka"

| Tool | Scope | Annotations | Input | Output |
| --- | --- | --- | --- | --- |
| `list_connectors` | `connectors:read` | `readOnlyHint` | `{ cursor?, limit? ≤ 50 }` | `[{ id, title, host, status, enabled, toolCount, enabledToolCount, drifted, createdVia, updatedAt }]` |
| `get_connector` | `connectors:read` | `readOnlyHint` | `{ id }` | the above plus `tools: [{ name, description (≤ 300), enabled, approval, serverReadOnly }]`, `usage: { callsLast30d }` |
| `add_connector` | `connectors:write` | none | `{ url, title? ≤ 80, presetId? }` | `{ id, status: 'needs-auth', enabled: false, manageUrl }` |
| `update_connector_tools` | `connectors:write` | none | `{ id, tools: [{ name, enabled?: false, approval?: 'ask' }] ≤ 100 }` | the updated tool list |
| `delete_connectors` | `connectors:write` | `destructiveHint` | `{ ids ≤ 20, confirm: z.literal(true) }` | `{ deleted, notFound }` |

Rules:

- `add_connector` takes no credentials and no `enabled`, makes no network call,
  records `createdByClientId`, and counts against
  `CONNECTORS_MCP_DISABLED_MAX`. Its description ends: "The connector is
  created switched off; the user must connect and enable it in Besidka at
  <manageUrl>. Requires signing in (connectors:write)."
- `update_connector_tools` only reduces: it can disable a tool or set it to
  `ask`. It cannot enable a tool, set `always`, or enable the connector.
- `delete_connectors` revokes credentials (best effort) and deletes; audit rows
  stay. It is in `DESTRUCTIVE_TOOLS` (`tests/unit/server/utils/mcp/tool-scopes.spec.ts`).
- No tool returns the URL path or query, headers, tokens, client registrations
  or call arguments. A snapshot test checks that no secret field appears.
- The feature gate runs inside the handler (generic "unavailable"); never the
  toolkit per-tool `enabled` guard.
- Bookkeeping: `MCP_PRIVATE_TOOL_SCOPES`, `ScopePicker.vue`, the connected-apps
  permission editor, the Privacy Policy scope list, the tool count in
  `docs/mcp-server.md` (32 private tools today, 37 after C-9, plus whatever
  merged first), `pnpm run mcp:surface`, a major `MCP_SERVER_VERSION` bump in
  the four files, `pnpm run mcp:version-guard`. The version number and the
  order against P0-8, P0-13, A-8 and S-6 are set at merge time; C-9 and S-6
  ideally ship in one major release. Existing grants do not gain the scopes;
  claude.ai does not step up, so users reconnect.

Additions to "What MCP does not do (and why)" in `docs/mcp-server.md`
(written by C-9, including a "Connectors" note under item 4, "settings that
change the data recipient"): no enabling a connector, no OAuth start or credential entry,
no consent, no "Always allow" and no approval answers, no enabling tools. Why:
each opens a data channel or skips a human decision. **Revisit when** the app
has a confirm-in-app pending state for these actions that an agent cannot
complete.

## 12. Provider-native path (C-11)

Coordinator decision of 2026-11-08, from pre-check question 9:

- **Anthropic `mcp_servers` (beta): not built in v1.** Not covered by ZDR,
  the connector token travels to Anthropic, and how Anthropic stores
  `authorization_token` is undocumented. The `nativeMcp` flag in
  `providers/anthropic.ts` is not added.
- **OpenAI Responses `type: "mcp"`: off by default, opt-in.** Labs flag
  `connectors.native` (`spend: 'foreground'`, `optIn: 'required'`) plus a
  per-connector opt-in with its own consent text that names OpenAI as an extra
  recipient of the token and the tool results, the ZDR and residency notes,
  that the remote server is contacted from OpenAI's infrastructure (IP
  allowlists change), and the current `store` behaviour (30-day retention when
  `store=true`). Stored as `connectors.native_opt_in_at`.

When the native path applies to a tool (all must hold):

1. Direct OpenAI model with the user's OpenAI key; never a gateway, never a
   direct key routed through a gateway.
2. The connector has `status='ready'`, current consent and the native opt-in.
3. The tool is marked read-only by the server **and** set by the user to
   "Always allow" with a matching hash. These are exactly the calls that
   section 7 would run without a card when no forced rule applies.
4. No forced rule can arise in the send: no other connector, no skill and no
   Besidka-side tool that sets the untrusted guard (web search, knowledge) is
   active in the send. Otherwise every tool stays on the Worker path.
5. The chat has no earlier connector result that was flagged; after one, the
   chat stays on the Worker path.

The token is re-sent with each request from the credential store and never
persisted anywhere else by Besidka. The path is never offered for a chat model
whose provider needs a transfer consent the user has not given (DeepSeek,
Moonshot AI, Qwen, gateway-routed vendors); rule 1 already limits it to direct
OpenAI models, and the check stays explicit in `planConnectorExecution` so a
later provider cannot slip in.

`openai.tools.mcp({ serverLabel: slug, serverUrl, authorization, allowedTools: { toolNames }, requireApproval: 'never' })`
under key `mcp__<slug>`; header-auth connectors pass `headers`; OpenAI
`connectorId` is never used. `requireApproval: 'never'` is acceptable only
because rule 3 limits the path to calls that would not ask anyway.

What is lost: pre-model wrapping and truncation of the result, per-call
timeout control, and the cross-connector rule inside a provider step. Gate for
shipping: the C-11 spike must show that every native call can be written to
`connector_tool_calls` (`path='native'`) from the response's MCP output items
with tool name, argument HMAC, size and outcome; without that audit parity the
path stays off. Rendering: `badge badge-soft` "Run by OpenAI".

## 13. Ticket changes

Decisions in this document that change a ticket's text. The coordinator
applies them; implementation follows this document.

Dependencies across stacks: C-3 must be on `main` before S-2 (skills import
uses `safeFetch`); the C-6 approval flow must be on `main` before S-3 relies
on forced approvals and before S-5's per-chat script confirmation; the
context-panel sections need P0-13; the `requireFeature` and Labs wiring need
P0-3, P0-4 and P0-7.

| Ticket | Change |
| --- | --- |
| C-2 BES-235 | `url` becomes `origin` (plain) plus `url_encrypted`; `status` drops `disabled`; `auth_type` nullable until discovery; `slug` max 16 with the section 8.1 derivation (preset id for presets); registers all four flags (including `connectors.native`, `spend: 'foreground'`); `CONNECTORS_PER_USER` 20 and the other new constants of section 9; `addedVia` becomes `created_by_client_id`; consent columns include `consent_issuer`; add `native_opt_in_at`; drop `toolFingerprint` (baseline is `connector_tool_settings.definition_hash`); add `server_read_only`, `approved_definition_hash`; `always_allow_tools` is `Record<tool, hash>`; audit `args_hmac` (HKDF key), `path`, `outcome` gains `pending`; **no FK to `users` on any table, including the audit table** (explicit purge plus a coverage spec), so no `CLAUDE.md` cascade-list change; registry table drops `websiteUrl`, stores `header_names`, `registry_updated_at`, `synced_at`; GitHub preset `auth: ['header']`; catalog has no `icon`; create `shared/utils/connectors-policy.ts` with section 9 |
| C-3 BES-237 | Two-tier redirect rule by purpose (section 4.2): `mcp` same-origin only, others validated hops; per-purpose UA, timeouts and caps (adds `skills-github`, `skills-url`); single-label hosts and ports other than 443/8443 rejected; header rules (section 4.3) |
| C-4 BES-239 | No probe at add; header value cap 4,096 bytes and the extended rejected-header list (section 4.3); consent dialog content, accessibility and the Security → Privacy & consent listing (section 5.2); account deletion revokes best effort before the purge; new connect flow with `connect/discover`, then consent, then auth (section 5.2); CIMD path `/connectors/client-metadata.json` with the preview host rule (section 5.3), route `server/routes/connectors/client-metadata.json.get.ts`, spec path moves accordingly; `invalid_grant` terminal; CIMD through `clientInformation()` (section 14) |
| C-5 BES-241 | Tools cache key `connectors:tools:<connectorId>:<credentialGeneration>`; per-connector call limit 30 per minute besides 60 per user; definition hash includes annotations; tool-name truncation with hash suffix instead of skipping; description 1 KiB and schema 8 KiB per-tool caps; 12 calls per turn; raw response cap 1 MiB; context panel from message parts, not the audit table; no TypeSafe screening of connector results in v1 |
| C-6 BES-244 | "Always allow" confirmation text gains ", until the server changes it" and the option is hidden when F1 or F2 caused the card; decision order of section 7.1 (F1, F2 before any "always"); every tool defaults to ask, `readOnlyHint` never skips a card; "always" bound to the definition hash; approval secret from HKDF (no new env var); one approval-settings route (C-7's) plus the per-chat reset route; audit pending row updated in place |
| C-7 BES-249 | No logos or favicons: text tiles and generated initial avatars; consent dialog and withdraw; bulk "Allow read-only tools without asking" is an explicit action; registry label "From the Official MCP Registry. Not reviewed by Besidka."; Connect button flow of section 5.2 |
| C-8 BES-252 | Store only the section 8.6 columns; daily full pass with mark-and-sweep; erasure list in KV; no `websiteUrl` in search results |
| C-9 BES-256 | `get_connector` tool field `readOnly` is named `serverReadOnly`; `delete_connectors` under `connectors:write` (not `data:delete`), write limiter; `update_connector_tools` only reduces (no enabling tools); `add_connector` returns `needs-auth` only, no network call; labels as in section 11 |
| C-10 BES-257 | The consent step is decided (section 2, item 5); audit HMAC and 90-day retention as in section 7.4; breach-runbook rows from pre-check question 12 (connector credentials risk row, containment row with revocation, CIMD integrity, stolen-session connector cleanup; no GitHub client-secret row, since GitHub is PAT-only) |
| C-12 pre-check (PR #738) | Its C-2 row and question 12 ask for a cascade FK to `users` and a `CLAUDE.md` cascade-list entry; this document uses explicit purge with no FK instead (section 8), which question 7 allows. Coordinator to confirm |
| C-11 BES-261 | OpenAI only; applicability rules of section 12; audit-parity gate; no Anthropic wiring or `nativeMcp` flag in `providers/anthropic.ts` |
| P0-1 #732 | The planned-scopes table in `docs/mcp-server.md` lists `list_connections` under `connectors:read` and says deletes of new resources go under `data:delete`; for connectors the tools are `list_connectors`, `get_connector`, and `delete_connectors` is on `connectors:write` (pre-check Q11) |

## 14. SDK verification

Checked on 2026-11-08 against the published `@ai-sdk/mcp@2.0.93` (latest
dist-tag; tarball read into a scratch folder, not installed) and the installed
`ai@7.0.153`.

Verified in `@ai-sdk/mcp@2.0.93` (`dist/index.d.ts`):

- `createMCPClient({ transport, protocolVersionDiscovery?, initializationOptions?, maxRetries?, clientName?, capabilities? })`.
  `transport` is `{ type: 'http' | 'sse', url, headers?, authProvider?, redirect?: 'follow' | 'error', fetch?, ... }`
  or a custom `MCPTransport`. `redirect` defaults to `'error'`.
- The client has `tools()`, `listTools()`, `callTool()`, `toolsFromDefinitions()`,
  `listResources()`, `readResource()`, `close()`, `serverInfo`, `instructions`.
  Stateless discovery: `protocolVersionDiscovery` defaults to true and probes
  `server/discover` before falling back to `initialize`.
- `OAuthClientProvider` members: `tokens`, `saveTokens`,
  `redirectToAuthorization`, `saveCodeVerifier`, `codeVerifier`,
  `addClientAuthentication?`, `invalidateCredentials?(scope, { tokens })`
  (compare-and-delete by token generation), `redirectUrl`, `clientMetadata`,
  `clientInformation`, `isClientInformationDynamicallyRegistered?`,
  `saveClientInformation?`, `authorizationServerInformation?`,
  `saveAuthorizationServerInformation?`, `validateAuthorizationServerURL?`,
  `state?`, `saveState?`, `storedState?`, `validateResourceURL?`.
- `auth(provider, { serverUrl, authorizationCode?, callbackState?, callbackIssuer?, scope?, resourceMetadataUrl?, fetchFn? })`
  returns `'AUTHORIZED' | 'REDIRECT'`. It checks `callbackIssuer` against the
  expected issuer (RFC 9207), refuses an AS without `S256`, binds client
  credentials to an issuer (`AuthorizationServerMismatchError`), sends
  `resource`, and runs DCR through `registerClient` when `clientInformation()`
  returns nothing.
- The AS metadata schema parses `client_id_metadata_document_supported`, but
  `OAuthClientProvider` has **no** `clientMetadataUrl` member and the client
  does not choose CIMD on its own.
- OAuth endpoints are checked by an internal URL guard
  (`assertSafeOAuthEndpoint`) and credential POSTs use `redirect: 'error'`.
- `MCPClientOAuthError`, `AuthorizationServerMismatchError`,
  `UnauthorizedError`, `fingerprintMCPAppResource`, `detectMCPAppResourceDrift`
  and the MCP Apps helpers (`MCP_APP_MIME_TYPE`, `readMCPAppResource`) exist.

Verified in `ai@7.0.153`: `fingerprintTools(tools)` (digests description,
resolved input schema and title, not annotations) and
`detectToolDrift(current, baseline) → { added, removed, changed }`;
`streamText` options `toolApproval` (per-tool or function returning
`'not-applicable' | 'user-approval' | 'approved' | 'denied'`) and
`experimental_toolApprovalSecret`.

Design consequences:

1. **CIMD** is done by the provider: when C-4's own discovery sees
   `client_id_metadata_document_supported`, `clientInformation()` returns
   `{ client_id: '<origin>/connectors/client-metadata.json' }` with the issuer
   set and no secret, so the SDK treats it as a pre-registered public client
   and skips DCR. Otherwise it returns nothing and the SDK runs DCR.
2. **Redirect option.** The transport only knows `follow` and `error`, and
   workerd throws on `redirect: 'error'`. Every SDK request therefore goes
   through `createSafeFetch`, which ignores the caller's `redirect` value and
   applies `redirect: 'manual'` with the section 4.2 rule (a 3xx where the SDK
   asked for `error` is surfaced as an error, which keeps the SDK's intent).
3. **SSRF seams**: `validateAuthorizationServerURL` and `validateResourceURL`
   call `parseSafeOutboundUrl`; the SDK's own endpoint guard is defence in
   depth, not a replacement.
4. **Refresh races**: `invalidateCredentials('tokens', { tokens })` must
   compare-and-delete by the token generation (`updated_at`).
5. **Drift**: the definition hash adds annotations to the `fingerprintTools`
   digest, because a server could flip `readOnlyHint` without changing the
   description.

Unverified (C-4 and C-6 settle them in their first commits):

- That a `fetch` override with `redirect: 'manual'` works for every SDK path in
  workerd, including the internal credential POSTs.
- That `@ai-sdk/mcp@2.0.93` peers cleanly with the installed `ai@7.0.153` and
  `zod` (it depends on `@ai-sdk/provider@4.0.37` and
  `@ai-sdk/provider-utils@5.0.76`; it also pulls `cross-spawn` for stdio, which
  must not end up in the Worker bundle).
- Whether the SDK honours `ttlMs` and `cacheScope` from `tools/list`, or C-5
  must read them from `listTools()` itself.
- AI SDK v7 approval continuation semantics (section 7.2 fallback).
- OpenAI `requireApproval` and MCP output items as they arrive through
  `@ai-sdk/openai` (section 12 gate).

## 15. Host portability

| Concern | Cloudflare (hosted Besidka) | Self-host on a VPS, Node or Vercel |
| --- | --- | --- |
| Private-range egress block | `global_fetch_strictly_public` | Required replacement: an egress proxy or firewall that refuses private, loopback, link-local, ULA and metadata addresses after DNS resolution (for example a forward proxy with an IP denylist), and all connector traffic forced through it. Without it, DNS rebinding reaches the host's network |
| DNS pinning | Not possible | Possible on Node (custom `lookup` that validates the resolved IP); recommended in addition to the proxy |
| KV (state, locks, caches) | Workers KV | Any key-value store with TTL (Redis, unstorage driver); locks must stay best effort with compare-and-set in the database |
| D1 | D1 | SQLite or libSQL with the same migrations |
| Encryption key | `NUXT_ENCRYPTION_KEY` secret | Same; back it up. Losing it means every connector must be reconnected |
| CIMD host | `NUXT_PUBLIC_BASE_URL` | Each self-hosted instance publishes its own document from its own base URL, so it is a different OAuth client everywhere |
| stdio servers | Not supported | Only through a local stdio-to-Streamable-HTTP proxy that the operator runs; never spawn processes from the app |

## 16. Vendor policy re-check

The pre-check rests on vendor MCP documentation and brand pages, not on their
terms of service. Before `connectors` leaves stage `internal`, the C-7 author
re-reads each source, records the date here, and re-opens the pre-check if a
term forbids third-party MCP clients or the preset text.

| Vendor | Sources | Pre-check read | Re-check before launch |
| --- | --- | --- | --- |
| GitHub | `github/github-mcp-server` `docs/host-integration.md`, `docs/policies-and-governance.md`; github.com/logos; GitHub Terms of Service and Acceptable Use Policies (not read) | 2026-11-07 | Date to record at launch; also test a fine-grained PAT against the remote server |
| Notion | developers.notion.com MCP client guide and security page; notion.com/help/notion-mcp; trademark guidelines; Notion terms (not read) | 2026-11-07 | Date to record at launch |
| Linear | linear.app/docs/mcp; linear.app/brand; Linear terms (not read) | 2026-11-07 | Date to record at launch; check for a workspace client allowlist |
| Atlassian | support.atlassian.com remote MCP server pages (OAuth 2.1, domains, API tokens, usage limits); atlassian.com/legal/trademark; Atlassian Cloud Terms (not read) | 2026-11-07 | Date to record at launch; confirm the v2 URL and the API-token default |
| MCP Registry | registry terms of service (effective 2025-09-02), aggregators page | 2026-11-07 | Date to record at launch |
| OpenAI (native path only) | Remote MCP guide, data controls | 2026-11-07 | Before `connectors.native` leaves `internal` |

## 17. Rejected alternatives

| Alternative | Why not |
| --- | --- |
| Cloudflare Agents SDK `MCPClientManager` | Durable Object lock-in, state outside D1, no self-host path |
| A connector marketplace or sponsored catalog | Curation and liability Besidka cannot carry; monetisation guard; four presets plus registry search cover discovery |
| Reusing `settings:*` scopes | Consent is stored by scope name, so the new tools would silently reach existing grants |
| Probing the server when it is added | The pre-check requires no request at add time; it also lets an MCP client make Besidka contact arbitrary hosts |
| Holding the stream open for approvals | Client disconnect kills the invocation and the lease is 120 s (section 7.2) |
| Trusting `readOnlyHint` to skip approvals | Annotations are untrusted (MCP spec); the pre-check requires user choice |
| GitHub OAuth App | A Besidka-held client secret and org approval friction; PAT works today |
| Anthropic native MCP | Not ZDR, token handling undocumented (section 12) |
| Slack | No DCR; only directory or internal apps can connect |
| Microsoft 365 | No verified public remote MCP server for third-party clients |
| Google Workspace MCP preset | Developer Preview, membership required (G-11); Drive goes through Phase 4b |
| TypeSafe AI screening of connector results | Private third-party data to another processor needs its own consent and DPIA row |
| Cascade foreign keys to `users` | Every cascade is a blast-radius multiplier on a `users` rebuild (CLAUDE.md); explicit purge with a coverage spec does the same job |
| Storing the server URL in plain text | Paths and queries of many MCP URLs carry secrets |

## 18. Revisit criteria

- **Anthropic native MCP**: Anthropic documents how `authorization_token` is
  stored and logged and makes the MCP connector ZDR-eligible.
- **DCR fallback**: remove after the MCP spec drops DCR (after summer 2027) and
  all four presets accept CIMD.
- **GitHub OAuth**: GitHub supports CIMD or DCR, or the owner accepts a GitHub
  App with its secret and a breach-runbook row.
- **TypeSafe screening of connector results**: a consent text, a DPIA row and a
  per-user toggle exist.
- **"Always allow" after untrusted content (F1)**: a per-tool argument policy
  (for example an allowlist of target repositories) makes some writes safe to
  run unattended.
- **More than 40 tools or 5 connectors**: measurements on Cyrillic chats show
  the description budget has room, or tool search (deferred tool loading) is
  added.
- **MCP Apps (`ui://` resources)**: when the Phase 1 artifact runtime ships,
  render them through it.
- **Scheduled use (Phase 6)**: routines reuse `connector_chat_settings`; any
  unattended call still follows section 7, so routines only call tools set to
  "Always allow" with no forced rule.

## 19. Open questions

| # | Question | Owner | Default until answered |
| --- | --- | --- | --- |
| 1 | Accept the consent residual (country unknown, ongoing transfers under Art. 49(1)(a)) | Owner | Accept and disclose (pre-check owner item 1) |
| 2 | Audit retention 90 days, kept after connector delete | Owner | 90 days, kept |
| 3 | Eight profile tabs at 768 to 1024 px, or one "Integrations" tab | Owner, after C-7 measures | Separate tabs if they fit |
| 4 | Keep Atlassian as a text-only preset with the notice | Owner | Keep |
| 5 | When to publish the connectors legal notice (not before 2026-12-18 while `2026-11-legal-notices` is shown) | Owner, C-10 | After 2026-12-18 |
| 6 | Whether OpenAI native requests should send `store: false` | C-11 spike, then owner | Path stays off |
| 7 | Whether CIMD on preview hosts is accepted by Notion and Linear | C-4 | DCR fallback on previews |
| 8 | Whether the GitHub remote server accepts fine-grained PATs | C-4 | Suggest fine-grained, fall back to classic with the fewest scopes |
