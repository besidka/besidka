# Connectors design (Phase 4a)

Status: **design, 2026-11-08; C-2 to C-5 built** (see the "As built"
sections 5.5 and 6.1). This document is the source of
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
| Rug pull | A server that changes a tool's description or schema after the user approved it, to steer the model. Drift detection is the defense. |
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

`connectors` and `connectors.oauth` are `available: true` since C-4, still at
stage `internal`: an unavailable flag evaluates to off with `NOT_AVAILABLE`
whatever the role or grant, so testers and previews could not reach the C-4
routes. Stage `internal` keeps both admin- and grant-only. `connectors.registry`
and `connectors.native` stay unavailable until their tickets ship.

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
   a pending approval in the reasoning step. The user's answer starts a
   continuation send. No
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
    `icons`, no hotlinking. Amended 2026-11-15 (BES-395): reasoning steps show
    a connector icon, but only through the Besidka route of section 7.10, never
    as a remote image; presets, cards and registry rows stay text only.
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
| T2 | DNS rebinding: a public name that resolves to a private address at fetch time | Malicious user or server | **No complete mitigation on Workers** (section 4.5). Per-hop validation of every URL, https only, no IP literals, no special names, ports 443 and 8443, the response-size and time caps, and purpose-tagged logs of host and status. Workers cannot pin DNS or read the resolved IP, so the app-level check cannot stop a name like `127.0.0.1.nip.io`. Cloudflare documents no guarantee that `fetch()` refuses a hostname that resolves to a private address, and `global_fetch_strictly_public` is not that guarantee (it only changes how requests to the Worker's own zone are routed). Stated limit, tested (section 4.4) | C-3 |
| T3 | Env or template interpolation in a user URL or header (LibreChat CVE-2026-32625: `${VAR}` from `process.env` interpolated into a user MCP URL leaked secrets) | Malicious user | Never interpolate anything into user-supplied URLs or headers. Registry entries with `{var}` or `${...}` in the URL are skipped. Header names validated by regex, values stored encrypted and sent verbatim | C-3, C-8 |
| T4 | Token theft at rest | Database or backup leak | Access, refresh and header values encrypted with `useEncryptText` (`server/utils/encryption.ts`, `NUXT_ENCRYPTION_KEY`); full server URL encrypted (paths and queries can carry secrets); never logged, never returned by any API or MCP tool | C-2, C-4 |
| T5 | Confused deputy and token passthrough: Besidka's own session or MCP token sent to a remote server, or one server's token sent to another | Malicious server | Credentials keyed per user × connector × issuer; a connector sends only tokens issued by its own authorization server (MCP authorization spec); RFC 8707 `resource` binds the token audience; `Authorization` stripped on any origin change; Besidka session cookies and `/mcp` tokens never leave the Worker | C-4 |
| T6 | Spoofed host lookalike (`notlon.so`, `mcp.linear.app.evil.com`, IDN homograph) presented as a known service | Phishing link, malicious registry entry | The consent screen and every card show the punycode host in plain text; presets match by exact URL only, so a typed host never inherits preset trust; registry rows labeled "Not reviewed by Besidka"; no logos that could lend credibility | C-7, C-8 |
| T7 | Tool rug pull: a tool's description or schema changes after approval to steer the model | Malicious or compromised server | Per-tool definition hash (section 8) computed on every `tools/list`; changed or added tools hidden until reviewed in the drift dialog; "Always allow" is bound to the hash and falls away on change; annotations are part of the hash because `fingerprintTools` omits them | C-2, C-5, C-6, C-7 |
| T8 | Prompt injection through tool results | Content in a third-party system (an issue body, a Notion page) | Results wrapped as `<untrusted_tool_result connector="<slug>" tool="<name>">` with a system rule that the content is data; `UntrustedContentGuard` (`server/utils/ai/tool-loop.ts`) set after any connector result; write calls after untrusted content always ask (section 7); memory write lock extended; results never reach memory extraction or chat search. TypeSafe AI screening is **not** applied to connector results in v1 (pre-check Q13: private third-party data needs its own consent) | C-5, C-6 |
| T9 | Cross-connector exfiltration: a result from connector A makes the model send A's data to connector B | Injected content | Any call to a connector other than the ones whose results the send has already read asks, read-only or not, "always" or not (section 7, rule F2) | C-6 |
| T10 | Exfiltration through write tools of the same connector | Injected content | Write tools ask after untrusted content even when set to "Always allow" (rule F1); the approval step shows the real arguments | C-6 |
| T11 | Credential theft through a stolen Besidka session | Session thief | Connecting, enabling, "Always allow" and the consent are app-only actions behind the session; MCP can only reduce; audit rows survive connector deletion for 90 days, so a thief cannot erase the trail; the breach runbook gains a connector-credential containment row (C-10) | C-4, C-9, C-10 |
| T12 | CIMD tampering: a changed `redirect_uris` in Besidka's Client ID Metadata Document captures authorization codes | Attacker with deploy access, or a host-header trick | Document built from configuration only (section 5.3), never from the request except an allowlisted preview host; one exact `redirect_uri`; no secrets in it; `client_id` never changed as a fix (remote caches hold it for hours); breach runbook row | C-4, C-10 |
| T13 | Token bloat and denial of service: huge tool lists, descriptions or results exhaust the context window, CPU or memory | Malicious server | Limits in section 9: 5 connectors and 40 tools per send, 32 KiB of descriptions plus input schemas, 1 KiB per description, 8 KiB per input schema, 8 s to connect and list, 2 SSE connectors, 64 KiB per result, 1 MiB raw response cap, 60 s per call, 12 calls per turn | C-5 |
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
6. Reject any IP literal (`ip-literal`): IPv4 after URL normalization (so
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
`classifyIp` is defense in depth for any future path that sees an address.

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
| `skills-github` | Exactly `github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack` (ref to commit SHA, update checks), and `codeload.github.com/<owner>/<repo>/zip/<sha>` (never `api.github.com`), through the narrow fetcher of `docs/skills.md` section 3.1 until C-3 lands. `githubFetch` returns `{ status, bytes }` (404 and 401 passed to the caller), not a `Response`, so the later `safeFetch` swap needs a small adapter | No redirect followed (`redirect: 'manual'`, any 3xx is an error); the older `github.com/.../archive` hop is gone | 30 s per call, body read included, inside one 60 s request deadline | 15 MiB (API answers 2 MiB) | `Besidka-Skills/<version>` (GitHub answers 403 without a UA) |
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
`safe-fetch.spec.ts`) assert these results after URL normalization.

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
`https://127.0.0.1.nip.io` passes `parseSafeOutboundUrl`: the app-level guard
cannot see the address a name resolves to (section 4.5).

### 4.5 What Workers can and cannot do (C-3, 2026-11-14)

This section replaces the earlier plan to add the `global_fetch_strictly_public`
compatibility flag as the DNS-rebinding defense. The flag is **not added** in
C-3.

- **What the flag does.** Cloudflare's compatibility-flags page says that with
  `global_fetch_strictly_public` the global `fetch()` "will strictly route
  requests as if they were made on the public Internet": a request to the
  Worker's own zone loops back through Cloudflare's front door instead of going
  straight to the zone's origin server. That is a routing change for the
  Worker's own zone. No Cloudflare document read for C-3 says it blocks
  private, loopback or link-local destinations, or hostnames that resolve to
  them.
- **What Workers do not let us do.** A Worker cannot pin a DNS resolution,
  cannot read the address a hostname resolved to, and cannot pass a resolved
  address to `fetch()`. So no code in the Worker can check the destination
  address of a request it is about to make, and `classifyIp` has nothing to
  classify for a DNS name.
- **What Cloudflare documents about private addresses.** Workers `fetch()` is
  documented to take URLs, not IP addresses, for subrequests (known issues),
  and private networks are reachable only through explicit bindings (Workers
  VPC, Tunnel). Cloudflare documents no promise that a public DNS name
  pointing to a private address is refused. Treat it as unverified.
- **What this means.** A name such as `127.0.0.1.nip.io`, `localtest.me` or
  `10.0.0.1.sslip.io` passes `parseSafeOutboundUrl` and `safeFetch`. The
  guard stops everything that is visible in the URL, and nothing that is only
  visible in DNS. The residual risk is a request to whatever the Workers
  network allows for such a name.
- **Mitigations that stay in place.** https only (a private service rarely
  has a valid certificate for a name the attacker controls, and the TLS
  handshake fails otherwise), no IP literals in any form, no special names or
  single-label hosts, ports 443 and 8443 only, every redirect hop re-validated
  with the `mcp` purpose never leaving its origin, a response-size cap and one
  deadline that covers the body, no credential header across origins, no
  cookies, results treated as untrusted data (section 3, T8), and logs of
  host, purpose and status for every outbound call (`attributes.net`).
- **Self-host.** Unchanged (section 15): an egress proxy or firewall with an IP
  denylist applied after DNS resolution is required, and on Node a custom DNS
  `lookup` is recommended as well.
- **Revisit.** Reopen this when Cloudflare documents a private-destination
  guarantee for Workers `fetch()` (and under which flag), or when a verified
  preview test shows that a name resolving to a private address is refused. Do
  that test on a preview with a hostname you control that resolves to
  `127.0.0.1` and to an RFC 1918 address, and record the result here.

Other C-3 choices that differ from or add to the text above:

- `parseSafeOutboundUrl` also rejects the suffixes `.localdomain`, `.lan`,
  `.home`, `.corp` and `.intranet`, and takes `{ allowPath: false }`, which
  rejects a path or a query (reason `path`).
- `classifyIp` allows only global unicast (IPv6 inside `2000::/3`), so a range
  the parser learns later is refused by default. IPv4-mapped addresses are
  judged by the inner IPv4 address; 6to4, Teredo, NAT64 and the other
  transition ranges are refused whole.
- A hop to another origin keeps only `Accept`, `Accept-Language` and
  `Content-Language`, drops the body and becomes a GET, so a connector's own
  header name (`X-Api-Key`) never crosses origins, not only `Authorization`.
  `Cookie` and `Host` are never forwarded, on any hop.
- One deadline covers every hop and the whole body; the timer is cleared when
  the body ends or is canceled. A response above the cap is cut as it streams,
  and a `Content-Length` over the cap is refused before reading.
- `parseSafeOutboundUrl` also rejects Besidka's own hosts (reason `own-host`):
  the hosts the app trusts for sign-in (`NUXT_PUBLIC_BASE_URL` and
  `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS`, read through the same pattern rules in
  `server/utils/auth-hosts.ts`), the artifacts origin, `besidka.com` with
  `www` and one-label subdomains, and `*.chernenko.workers.dev`, so a
  connector cannot make the Worker call itself or a sibling Worker.
- `safeFetch` itself strips every name in `CONNECTOR_REJECTED_HEADER_NAMES`
  (`Host`, `Cookie`, `Content-Length`, `Transfer-Encoding`, `Connection`,
  `Mcp-Session-Id`, `Mcp-Protocol-Version`) on every hop, not only the routes
  that validate user input. The `mcp` purpose keeps the last two, because they
  are the MCP transport's own headers.
- A network failure is rethrown without the raw exception: no `cause`, only
  the error class and a plain error code (`TypeError ECONNREFUSED`) in `why`,
  because a runtime error message can carry the URL and its query.
- The local-development `http://localhost` allowance is not built.
- `skills-github` and `skills-url` have policies (30 s and 15 MiB, 10 s and
  256 KiB) but nothing uses them yet: `githubFetch` keeps its own transport
  (it returns `{ status, bytes }` and passes 401 and 404 through), and only
  its URL check gained `parseSafeOutboundUrl`. That check now also refuses an
  address with an embedded newline or tab, which the URL parser used to strip
  silently.

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
   focus moves into the dialog and back, the warning is not carried by color
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

### 5.5 As built (C-4, 2026-11-14)

Choices that differ from or add to sections 5.1 to 5.4 and 14:

- **No `@ai-sdk/mcp` and no `OAuthClientProvider` in C-4.** The OAuth client
  is Besidka's own code over `safeFetch` (`server/utils/connectors/oauth-*.ts`),
  so every outbound URL passes the section 4 rules and no SDK path can pick
  its own `redirect` or skip CIMD. The contract C-5 uses is
  `getValidAccessToken({ userId, connectorId, rejectedToken? })` in
  `credentials.ts`. C-5 adds `@ai-sdk/mcp`, sends
  `Authorization: Bearer <token>` (or wraps the function in a small provider
  whose `tokens()` calls it and whose `invalidateCredentials` passes the
  rejected token), uses `createSafeFetch('mcp')` as the transport `fetch`, and
  settles the section 14 "Unverified" items.
- **Routes:** `POST /api/v1/connectors`, `POST [id]/connect/discover`,
  `POST [id]/consent`, `POST [id]/consent/withdraw`, `POST [id]/oauth/start`,
  `GET oauth/callback`, `POST [id]/credentials`, `POST [id]/disconnect`,
  `PATCH [id]`, `POST delete/bulk`. No list route: C-7 adds the one its page
  needs. Every write route first runs a CSRF guard, before any KV or D1
  work: `Sec-Fetch-Site`, when sent, must be `same-origin` (a sibling
  subdomain's `same-site` is refused), and `Origin` must be present and equal
  the app's public origin for the request. The write routes then share one
  rate-limit bucket (10 per minute per user) and cap bodies at 8 KiB. That
  limiter is a KV read-then-write, not atomic, so concurrent requests can
  slip a few over the limit; it fails closed (429 with `Retry-After: 60`)
  when KV cannot count.
- **The callback never spends that bucket** and never answers 429. A
  malformed `state` is refused before any KV read; failed callbacks count
  against a separate budget of 20 per 10 minutes per client IP (stored as a
  SHA-256, failures only, failing open when KV errors). Over the budget, or on
  any error, it redirects to `/profile/connectors?error=<code>`.
- **Consent gate (server side only).** `CONNECTOR_CONSENT_VERSION` is
  `2026-11-a` in `shared/utils/connectors-policy.ts`. The consent route
  stores the origin, the issuer host the dialog showed, the version and the
  time, and needs a current sign-up consent. `oauth/start`, `credentials` and
  enabling refuse with `CONNECTOR_CONSENT_REQUIRED` when the consent is
  missing, withdrawn, for an older version, for another origin, or (OAuth)
  for another issuer host than a fresh discovery finds. The wording and its
  text-hash spec (like `CURRENT_CONSENT_TEXT_SHA256`) belong to the C-7
  dialog; bump the version when the wording changes what users agree to.
- **Discovery probe** is a JSON-RPC `initialize` (the stateless
  `server/discover` probe is the SDK's, added in C-5). A 2xx sets
  `auth_type='none'` and `status='ready'`. The PRM `resource` is required
  (RFC 9728) and must cover the connector URL by the SDK rule (same origin,
  path prefix on a segment boundary); it is the RFC 8707 resource sent.
- **CIMD only with `iss`.** The public CIMD `client_id` is used only with an
  issuer that advertises both `client_id_metadata_document_supported` and
  `authorization_response_iss_parameter_supported`, and a CIMD callback
  without `iss` is refused. Anyone can start a flow with a public client id,
  so without `iss` an authorization-server mix-up would go unnoticed; an
  issuer without RFC 9207 support gets DCR, whose client id is private to
  that issuer.
- **Pinned endpoints.** The encrypted `client_registration` JSON also holds
  the token and revocation endpoints, the resource, the redirect URI and the
  token-endpoint auth method of the sign-in, so a refresh or revocation never
  rediscovers metadata. A DCR registration is reused only for the same issuer
  and redirect URI, so each preview host registers its own client. Saving a
  sign-in or a header replaces every credentials row of the connector.
- **Refresh.** The compare-and-set token is the stored access-token
  ciphertext (`generation`), not `updated_at`, whose one-second resolution
  cannot tell two writes apart. The KV lock entry lives 60 s (the KV minimum)
  and carries its own 30 s expiry. Calls that share a request-scoped
  `inFlight` map share one refresh; nothing is cached module-wide. A caller
  that loses the lock and still sees the lock held after its three waits
  answers `CONNECTOR_REFRESH_FAILED` (retryable) instead of sending the same
  refresh token again, which a rotating issuer treats as reuse; when KV itself
  fails, the refresh runs at once without a lock. `invalid_grant` re-reads
  first and deletes only if no other writer stored newer tokens.
- **Discovery never downgrades a connected connector:** it writes `auth_type`
  only while no credentials are stored. The callback re-checks the consent
  for the issuer. When the new sign-in comes from another issuer or client,
  the stored tokens are revoked before the code exchange; a re-authorization
  with the same issuer and client revokes nothing, because an authorization
  server that revokes per grant would kill the tokens it just issued.
- **Status after sign-in.** The callback sets `status='ready'` (the ticket's
  rule). C-5 may set `drifted` or `error` after its first `tools/list`.
- **The OAuth state** in KV is encrypted (it holds the PKCE verifier and, for
  a confidential DCR client, its secret) and refused after 600 s even when KV
  still returns it. KV has no atomic read-and-delete, so the authorization
  server's single-use code is the backstop against a cross-location replay.
- **Logs.** evlog logs the callback path without its query
  (`server/plugins/evlog-request-observability.ts`), and its wide events carry
  connector id, host, step and fixed codes only. That claim covers evlog
  only: Cloudflare Workers observability records the full request URL of the
  callback, code and state included. The exposure is bounded (the code is
  single use, short-lived and bound to the PKCE verifier, which never leaves
  the Worker; the state is single use), but treat Workers logs as holding
  them.
- **Revocation** also runs before a bulk delete and before an account purge,
  never throwing. The credentials are read first; then at most four
  connectors are revoked at a time (each sends its refresh-token and
  access-token revocations one after the other, so at most four connections,
  under the Workers limit of six), with no binding resolved inside the
  fan-out. One 10 s deadline covers the batch: when it fires, in-flight
  requests are canceled, no new one starts, and the rows are deleted
  unrevoked.
- **CIMD rejected on a preview host.** The client cannot see that rejection
  (it happens in the browser at the authorization server), so there is no
  automatic switch to DCR. If Notion or Linear refuse a preview CIMD, record
  it in the section 5.3 table and decide then.
- **Production check.** `NUXT_AUTH_ADDITIONAL_ALLOWED_HOSTS` is set only in the
  `previews` block of `wrangler.jsonc`; production has none, so the CIMD
  there always uses `NUXT_PUBLIC_BASE_URL`.

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
   Connect timeout 10 s, and one 8 s deadline for the connect and list phase of
   the whole send; a connector that fails or runs past the deadline is skipped
   with a notice and its `lastError` is updated. At most two connectors that
   use the legacy SSE transport join a send; the rest are skipped with a
   notice.
4. **List tools.** KV cache `connectors:tools:<connectorId>:<credentialGeneration>`
   (the credential row's `updatedAt`, so a reconnect invalidates it). TTL is
   the server's `ttlMs` clamped to 60 s to 3,600 s, default 600 s. A
   `cacheScope` other than shared is already per user, because the key holds
   the connector id.
5. **Filter.** Compute each tool's definition hash. Drop tools that are
   disabled by the user, unreviewed (no baseline row) or drifted (hash
   differs); a drifted or new tool sets `status='drifted'` with a count, and
   the connector card asks for review. Truncate each description to 1,024 bytes, skip a
   tool whose input schema exceeds 8 KiB, and stop adding at 40 tools or
   32 KiB of descriptions plus input schemas across all connectors,
   preferring tools the server marks read-only and tools the user set to
   "Always allow".
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

### 6.1 As built (C-5, 2026-11-14)

Choices that differ from or add to section 6, 10 and 14:

- **`@ai-sdk/mcp` 2.0.93, pinned.** `createMCPClient` takes `transport.fetch`,
  and Besidka passes a wrapper over `createSafeFetch('mcp')`, so every
  transport request (initialize, list, call, session `DELETE`) passes the
  section 4 rules. The SDK's own `redirect` value is ignored by `safeFetch`.
  A streamable-HTTP server's long-lived `GET` event stream is answered by the
  wrapper with a local 405 and never leaves the Worker: Besidka supports no
  server-initiated message, and one open connection per connector would eat
  the Workers limit of six. The legacy `sse` transport keeps its one stream,
  with a 540 s session deadline and an 8 MiB cap. The package's main entry
  imports neither `cross-spawn` nor `node:child_process` (stdio is the
  separate `@ai-sdk/mcp/mcp-stdio` export, which nothing imports), so the
  Worker bundle gets no process spawning. The SDK reads `ttlMs` from
  `tools/list`: its result schema is a loose object, so the field survives
  and `getConnectorTools` uses it (clamped, default 600 s). Not verified in
  workerd: the transport against a real server on the preview.
- **Baseline by first listing.** The C-7 tool review does not exist yet, so a
  connector with no `connector_tool_settings` rows gets its baseline from its
  first listing (every tool `enabled`, `approval='ask'`): trust on first use,
  after the user turned the connector on in a chat. The baseline write always
  includes a marker row with the reserved `tool_name` `''` (empty string), so
  a first listing with no usable tools (the server returns `[]`, or
  normalization drops every tool) still counts as taken: a tool that appears
  later is `added`, hidden, and flips the connector to `drifted`, instead of
  being baselined as enabled. `normalizeToolDefinitions` skips tools without a
  name, so no real tool can collide with the marker, and no schema change or
  migration is involved. `listConnectorToolSettings` never returns the marker
  (it is not a tool, so it is in no count, picker or summary);
  `readConnectorToolBaseline` returns `isBaselined` (any row, marker or tool)
  next to the real settings; the connector delete and the account purge remove
  it with the other rows. Rows written before the marker existed are a
  baseline by their tool rows alone. From then on a tool that
  is new or whose hash changed is hidden and flips the connector to
  `drifted`; a connector whose listing matches the baseline again returns to
  `ready`. Until C-7 adds "Accept changes", a drifted tool stays hidden.
  `drifted` connectors are still selectable in a chat; their other tools run.
- **The definition hash covers what the model sees.** The description is cut
  to 1 KiB before hashing, and a tool with a schema over 8 KiB is skipped
  before it is hashed, so neither can show up later as drift. The hash is
  SHA-256 over the `fingerprintTools` digest plus the canonical annotations.
- **Tool list cache** is `connectors:tools:<connectorId>:<generation>` where
  the generation is the credentials row's `updated_at` in milliseconds
  (`none` without credentials). It holds the normalized definitions, not the
  raw `tools/list`. A send whose list comes from KV does not connect at
  all; the connection opens on the first tool call.
- **Read-only runs, everything else is refused (until C-6).** This layer
  applies the ticket rule, not decision 8 of section 2: a tool the server
  marks `readOnlyHint` and does not also mark `destructiveHint` runs without
  an approval (`isDefinitionAutoRunnable`; the stored `server_read_only`
  still records the `readOnlyHint` alone), and any other tool answers "This
  tool needs your approval; approvals arrive in the next update." with
  `outcome='denied'`, `approval='denied'` and no remote call. **Replaced in
  C-6 L4** (section 7.6): a tool that is not auto-runnable now pauses the
  send with a real approval request. The refusal sentences stay in
  `shared/utils/connectors-parts.ts` only so stored C-5 messages still read
  as denials.
- **F2 stopgap: the first connector called owns the send.** Until C-6 has
  approvals, a call to a connector other than the first one this send called
  is refused with "This tool belongs to a different connector than the one
  already used in this message, so it cannot run without your approval;
  approvals arrive in the next update." (`outcome='denied'`, no remote
  call, shown as denied in the step). The mark is set when a call starts, with
  no `await` before it, so two parallel calls to different connectors let
  only the first one run. This is stricter than section 7.1, which asks only
  after a result was read. **Replaced in C-6 L4** by the policy's rule 3
  (`cross-source`), section 7.6.
- **Limit refusals have their own outcome.** The per-send call cap and the
  per-minute rate limit also answer with a plain sentence (audited as
  `denied`). The message part classifier (`getConnectorToolCall`) reads them
  as `limited`, so the step title says "Skipped <connector> · <tool>: limit
  reached" and the context panel shows "Limit reached" instead of "Used" and
  "Done". The sentences live in `shared/utils/connectors-parts.ts`.
- **No TypeSafe screening of results.** Section 3 (T8) and section 17 say
  so; the C-5 brief asked for screening when a TypeSafe key exists, and this
  layer follows the document, because private third-party data to another
  processor needs its own consent.
- **Results.** The call's text is redacted of this connector's token or
  header value, cut to 64 KiB, and framed with the frame tag neutralized
  inside it (`<untrusted_tool_result` becomes `‹untrusted_tool_result`).
  A refused call answers with a sentence Besidka wrote. A call that fails or
  times out throws an error whose message is a sentence Besidka wrote (never
  upstream text), so the AI SDK ends the part in the `output-error` state: the
  model sees the sentence and the step shows "Failed". A result the server
  flagged `isError` is not a failure of the call: it stays framed untrusted
  output. Persisted `dynamic-tool` parts are redacted and capped again by
  `redactConnectorToolPartsForPersistence`, and an error text is replaced by a
  fixed sentence.
- **Limits.** 12 calls per send, 60 a minute per user and 30 a minute per
  user and connector (KV, fail closed), 60 s per call, 10 s per connect, at
  most three connectors prepared at once and at most three tool calls running
  at once (a step with six parallel calls queues, so the Workers limit of six
  connections holds). Connector tools count toward the 40
  tools of the request together with the send's other tools, and the
  descriptions plus serialized input schemas of the exposed tools count
  toward one budget of 32 KiB (a tool that does not fit is dropped, in the
  same order every time, with the same notice). A connector
  past the fifth, or one that is off or not connected, is left out with a
  notice. `connectorIds` accepts up to 20 ids (not 5), so the sixth is
  reported instead of failing validation.
- **Audit.** One `connector_tool_calls` row per call with the HKDF-keyed HMAC
  of the canonical arguments (`besidka/connector-audit-args/v1`), the result
  size, the outcome, the duration and the connector host. The write never
  fails a call.
- **Cleanup.** Every client closes in the `streamText` `onEnd`, `onError` and
  `onAbort`, and in the `finally` of the stream; closing is idempotent and
  logs `attributes.connectors.closed`. A close waits at most 2 s per client.
- **Answer guarantee.** Connector tools are not in `answerGuaranteeToolNames`
  (their results are framed text, not search results the continuation can
  quote). A loop that still ends on a connector call, which an Anthropic
  model can do on the forced last step, persists the empty-answer notice
  like the other tool families: `isFollowUpToolPart` matches `dynamic-tool`
  parts by name, and persistence gets the connector names as follow-up tools.
- **Share dialog.** `GET /api/v1/chats/[slug]/share` returns `usedConnector`
  (any answer with a connector call or the marker below), and the dialog
  shows "Replies may repeat data from a connected service" next to the memory
  note.
- **Branches keep a marker, not the calls.** Branching strips the connector
  call parts, so `stripToolPartsFromBranchedMessage` appends one slim
  `data-connectors-notice` part with `data: { lines: [], usedConnector: true }`
  to an assistant message that had a call (or already had the marker). It
  renders nothing, never reaches a public share (`filterPublicParts` drops the
  notice type), the model context (the sanitizer keeps only text) or the
  search index, and it keeps both the share warning (`chatUsedConnector`) and
  the memory extraction skip (`isMemoryExtractionRecallMessage`) working on
  the branch. A visitor's branch of a public share never gets it, because the
  shared parts are already filtered.
- **Timeouts and cleanup (2026-11-15 audit).** `listTools` gets the send's
  abort signal and an 8 s timeout, and every connector's connect and list is
  raced against one shared 8 s deadline, so a server that stalls costs the
  send at most 8 s and is skipped with the usual notice; the cached tool list
  is read before the deadline is checked, and a connector still queued behind
  the 3-at-once limit when the deadline fires is skipped with its own notice
  and is never marked unreachable. Anything that throws
  after a client opened (settings, baseline, tool building) closes the opened
  clients before it rethrows. Clients close in parallel under one shared 2 s
  deadline instead of one after another. An OAuth connector with no issuer on
  file still asserts the base consent.
- **Known gaps, left for C-6 (2026-11-15 audit).**
  - H2: a connector result can still steer the model into the artifact and
    document write tools, which run without an approval and are outside the
    F1 and F2 stopgaps above. Closing it needs the C-6 approval path (F1
    covers every non-read-only tool after untrusted content), so it is
    recorded here and not patched in C-5. **Closed in C-6 L4** (section 7.6).
  - `ai` must be bumped to 7.0.173 or newer before C-6 builds on
    `toolApproval`: that release fixes the approval replay security issue, and
    the repo locks 7.0.153 today (`^7.0.153` in `package.json`).
- **Routes added.** `GET /api/v1/connectors` (safe summaries, for the picker;
  C-7 extends it), `GET` and `PUT /api/v1/chats/[slug]/connectors` (the
  per-chat choice, at most five on; the `PUT` has its own bucket of 60 a
  minute instead of the 10 of the connector routes, so picker toggles are not
  throttled). The send body field `connectorIds`
  replaces the stored choice when present and leaves it alone when absent.
- **Memory.** An assistant turn that called a connector tool is skipped by
  memory extraction like a turn that recalled memory, because its text quotes
  a third party's data. Connector parts never reach shares, branches, later
  model context or the chat search index (specs).
- **Not wired to the notice.** `data-connectors-notice` is written to the
  client stream only, so it is not persisted (like the knowledge notice).

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
is never trusted: it never skips the prompt, and a tool marked that way asks
exactly like a tool with no hint. A hash change clears both "always" entries
for that tool.

The policy module (`server/utils/tool-approval/policy.ts`) adds these rules
after the L3 audit (2026-11-15):

- **Fail closed.** An unknown permission mode, family or access, an empty
  tool name or a `destructiveHint` that is not a boolean is denied with
  `invalid-input`, on a first call and on replay.
- **`destructiveHint` is required** on the descriptor, so the code that
  builds it has to decide. A connector tool takes it from
  `connectorDestructiveHint(annotations)`: true only when the server
  declares `destructiveHint: true` (changed in the grants layer, section
  7.9). Such a tool goes to always-ask (Allow once only) and no "always" or
  chat grant can lift it. A tool that is not read-only and not marked
  destructive, `destructiveHint: false` included, is a plain write: it asks
  with reason `default` and offers all four answers.
- **Grants carry their identity.** A connector grant matches only on the
  same connector id, tool name and definition hash; a Besidka grant on the
  same tool name and registry hash.
- **Replay compares more.** The pending record stores `access`, and a
  replay is denied (`definition-drifted`) when the tool name or access
  differs from the live descriptor, besides the family, connector and hash.
- **Besidka reads ignore Besidka taint (BES-394 L9).** Rule 4 asks before a
  Besidka tool after untrusted content, but a Besidka read does not count
  the taint of earlier Besidka results (`isTaintedForBesidka`), so an Always
  allow or chat-granted read runs after another Besidka read. Web,
  knowledge, file, skill, connector and shared-branch taint still make it
  ask, and a Besidka write asks after any taint. Egress stays covered: the
  provider's web search, and the Brave and Exa searches Besidka runs itself
  (withheld from later steps and refused at execute time, also on Anthropic
  routes), stop after a connector or Besidka read, and a connector call
  after it asks `cross-source`.
- **Memory writes count every taint.** Native memory writes (`memory_write`,
  `memory_forget`) ask after any taint kind, web included; native artifact
  and document writes still count only connector and skill taint.
- **State fails loudly.** Recording an unknown taint kind or an invalid read
  source throws. Past 64 read sources the set collapses to one `overflow`
  value that makes every connector call ask `cross-source`. A state that
  fails to deserialize is a hard refusal for a continuation, never a fresh
  state.

### 7.2 Approval ends the send

When the model calls a tool that needs approval:

1. The stream emits the `tool-approval-request` and ends. The gated call
   makes no remote call; a call in the same step that needs no approval does
   run in this request (section 14.1).
2. The assistant message is persisted with the tool part in state
   `approval-requested`.
3. The exact arguments go to KV `tool-approval:<approvalId>` for 24 h.
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

The C-6 spike (section 14.1) confirmed that AI SDK v7 continuation resumes
this way, so the fallback of executing the approved call server-side with a
synthetic tool result is not needed. It also corrected step 1: calls in the
same step that need no approval do run in the first request.

### 7.3 Approval UI

The approval lives in the reasoning step of the call (`ChatReasoning`), not
in a separate card (C-6 plan, L6 builds it):

- Header: "<Connector> wants to run <tool>", a `badge badge-soft badge-warning`
  "Changes data" unless the server marks the tool read-only, and the reason
  (for example "This chat already read data from Notion").
- The real arguments as pretty JSON in a `<pre>` (max height, scroll), with
  URLs and e-mail addresses highlighted. Never the model's own description of
  the call.
- Buttons: `btn btn-primary` **Allow once**; **Allow in this chat**; a
  dropdown item **Always allow this tool** with the confirmation "Besidka will
  run this tool without asking in every chat, until the server changes it"
  (hidden when F1 or F2 caused the request, since "always" would not apply;
  the always-ask tier offers only Allow once and Deny);
  `btn btn-ghost` **Deny**.
- "View details" opens the P0-11 `UiSidePanel`: full arguments, the tool
  description, the connector host, earlier decisions.
- States: pending, sending, approved or denied (one line with time), expired
  (muted, "Ask again" re-sends the last user message).
- A pending approval shows a chip above the composer: "1 action waiting for
  approval". The composer stays enabled.
- Keyboard and screen reader: focusable step, Enter on the focused step means
  Allow once, Esc collapses, arguments readable as text, 24 px minimum
  targets, status announced (WCAG 2.2 AA, pre-check gate item 7).
- Below `md`: buttons full width, details in the bottom-sheet variant of
  `UiSidePanel` (`docs/chats/ios-keyboard.md`).
- Shared pages never render approval steps (spec).

Revocation: the connector card's tool list sets a tool back to "Ask every
time" (`POST /api/v1/connectors/[id]/tools/settings`, C-7), and the chat
context panel offers "Reset approvals in this chat"
(`POST /api/v1/chats/[slug]/tool-approvals/reset`, built in section 7.9 with
a per-tool remove for "always").

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
It links "Manage connectors" (`/profile/connectors`; C-7 adds the `?connector=<id>` deep link). On
shared chats the section is empty because tool parts are already stripped.

### 7.6 As built: the request side (C-6 L4, 2026-11-15)

The send route asks before it runs; the continuation that answers (L5) and
the buttons (L6) come later. Where this differs from sections 7.1 to 7.4:

- **Behind the `tool-approvals` flag.** The send evaluates the flag once on
  the server (`resolveSendFeatures`, never from the request body). Off, the
  send behaves exactly as before C-6: no `toolApproval` and no secret, the
  C-5 refusal sentences and the F2 stopgap in `getConnectorTools` (no
  `isCallCleared`), the old connector instructions, the memory lock refusing
  inside the tool with the old "Saving to memory is unavailable" prompt
  line, no KV records, no pending audit rows, and artifact and document
  writes unchanged. Everything below applies with the flag on. Only the
  expiry of stored waiting calls and the persistence helpers (which only
  touch approval parts) run in both states.

- **One policy for every tool.** `server/utils/tool-approval/send.ts` builds
  one entry per tool the model can call, keyed by the name the model sees
  (and the SDK signs): `mcp__<slug>__<tool>` for connectors, the SDK name for
  native tools. `streamText` gets one generic `toolApproval` function and
  `experimental_toolApprovalSecret` (`useToolApprovalSecret()`), but only
  when some tool could ask (anything other than a native read), so sends
  with only lookups keep their call arguments exactly as before. Native
  memory, artifact and document tools are writes; lookups are reads. Only
  the artifact and document writes carry `onlyConnectorOrSkillTaint` (they
  ask only after connector or skill output); memory writes and any native
  tool the classifier does not know count every taint kind (fail closed).
  Provider-executed calls of the web search, grounding and URL context
  family run without a decision and taint the send; any other
  provider-executed tool (code execution, web fetch) goes through the
  policy as a write. The lookups that read the user's own data
  (`search_chats`, `read_chat`, the memory reads, the project knowledge
  reads, and knowledge or past-chat excerpts already in the prompt) record
  the `besidka` read source, so a later connector call asks `cross-source`
  (audit M1).
- **Taint is recorded at decision time.** The SDK decides every call of a
  step, in stream order, before any of them runs (section 14.1), so a call
  that may run records its taint and read source when it is decided: a
  connector read next to an artifact write in the same step makes the write
  ask. This over-asks on purpose: a call in the same step cannot have seen
  the read's result, but the stricter rule matches the C-5 stopgap and keeps
  the turn record complete for the continuation. A memory write next to
  `search_chats` in one step therefore asks too. Before the first step the send records what it already holds, with
  the memory write lock's triggers: requested web search (`web`), project
  knowledge text and past-chat excerpts (`knowledge`), the artifact context
  block (`file`), active skill text (`skill`), and a chat branched from a
  public share (`shared-branch`, new). Plain attachments added no taint
  here; since the grants audit (section 7.9) a file the user attached to
  the message adds `file` (the memory write lock is unchanged and still
  ignores them). The memory lock itself is unchanged and
  stays the second line in `memory_write`. With the flag on, a call the user
  approved supersedes that lock (`isApprovedByUser` on `getMemoryTools`,
  filled by the continuation through `markApprovedByUser`); the never-store
  and sensitive-topic gate still runs on every approved write. The project
  knowledge block then says that saving to memory needs the user's approval
  in this turn (`withMemoryApprovalNotice`) instead of "unavailable".
- **Read-only connector tools still run (deviation).** The L3 policy has no
  rule that lets a connector read run without a grant, so a tool the server
  marks `readOnlyHint` and not `destructiveHint` gets a grant from the send,
  bound to its connector id, exposed name and definition hash. That keeps
  the C-5 behavior until the C-7 tool review sets real grants; F2 (rule 3)
  still asks for it after another source was read. The grant holds only
  while the send is untainted, or when the server also marks the tool
  `openWorldHint: false`; otherwise the call asks `untrusted-output`
  (audit M2). This includes the connector's own earlier result, so a second
  open-world read in one send asks. A tool marked both read-only and
  destructive counts as destructive.
- **Connector writes landed in `always-ask` (superseded by section 7.9).**
  `connectorDestructiveHint` was true for every tool that was not marked
  read-only, so a connector write offered only Allow once. Since the grants
  layer only `destructiveHint: true` is always-ask and plain writes ask with
  `default`. The summary names the exposed tool name,
  never text the remote server chose, and the audit row keeps the remote
  name with control and bidirectional characters removed (audit L1).
- **What the SDK may not hold.** A tool with no entry is denied
  (`missing-tool`). A call that would need approval is denied (`over-cap`)
  when its input is over the 64 KiB KV cap or when it is the eleventh in one
  request, so a pause never holds a call Besidka cannot store. A call that
  may run is never held to that cap (a 600 KB artifact still reaches its own
  size check).
- **The C-5 refusals are gone.** A connector call that needs approval is a
  real `tool-approval-request`; F2 and taint are the policy reasons
  `cross-source` and `untrusted-output`. `execute` still refuses any call the
  policy did not clear ("This tool call was not approved, so it did not
  run."), as a second line behind the SDK. A clearance is bound to the tool
  call id, the exposed name and the canonical input, and is used up by the
  first `execute`; the artifact, document and unclassified native writes
  get the same check through `guardNativeWrites` (audit L2).
- **The pause.** The stream collector strips the signature from the
  `tool-approval-request` chunk (the client and D1 never see it) and writes a
  `data-tool-approval` part right after it: approval id, tool call id, tool
  name, reason, a server-written summary ("Linear wants to run create_issue",
  "Besidka wants to create an artifact") and the remember options the policy
  allows. The answer guarantee runs no search-answer continuation for a
  paused send, and persistence adds no empty-answer notice. Once the reply is
  stored, the route writes per approval the pending record (`input`,
  `signature`, `toolCallId`, family, access, connector id, hash, reason,
  `rememberOptions`, summary, `auditCallId`, a snapshot of model, gateway,
  reasoning, tool names and connector ids), then the turn record (pending ids
  and the serialized state with `rounds` 1 and the step count) and the
  per-chat index. A connector call also gets a `connector_tool_calls` row
  with `outcome='pending'` and `approval='pending'` (both columns are plain
  `text`, the enum lives only in `shared/utils/connectors-policy.ts`, so the
  new value needs no migration), whose id goes into the pending record for
  L5 to settle. When the pending record cannot be stored after its audit
  row was written, the row is settled right away as `outcome='error'`,
  `approval='denied'` (audit L4). A record that fails is logged and the
  continuation will answer that the approval expired. `rememberOptions` and
  `auditCallId` are new fields on the L3 pending schema.
- **Persistence.** An assistant message whose only content is a waiting call
  persists (`hasMeaningfulAssistantParts` on the server, and
  `hasMeaningfulPersistedAssistantParts` on the client, count it), so it
  shows neither the empty-answer notice nor Regenerate. Artifact and
  document calls that wait keep only kind or format, title and approval id
  (the exact input is in KV). Connector parts keep their redacted input.
  The #263 replay rebuilds the waiting call (`tool-input-available`, then the
  unsigned `tool-approval-request`) and the data part.
- **Branches and shares** drop the waiting tool part and `data-tool-approval`,
  and leave out a message that held nothing else. A waiting connector call
  is not connector usage, so it adds no branch marker and no share warning.
- **Expiry.** A new user message in a chat whose stored messages hold a
  waiting call deletes every key the per-chat index lists, after the #263
  replay and the generation-in-progress checks, so a disconnect retry never
  expires its own approval. The history sanitizer already drops the
  abandoned approval-only reply from later model context.
- **Rendering until L6.** The waiting call shows as a reasoning step titled
  "Waiting for approval: <connector> · <tool>" (connectors) or "Waiting for
  approval: <tool>" (native). A waiting artifact call renders nothing yet.
- **What L5 must enforce (audit L3).** The pending records are keyed by
  approval id and outlive the turn for up to 24 hours unless a new user
  message expires them; expiry is best effort (a failed delete or an id the
  per-chat index lost leaves a stale record until its TTL). So the
  continuation must accept an answer only when the approved call belongs to
  the chat's last message and that message is the assistant message the
  record names, besides checking user, chat and the turn's pending ids.
- **Accepted residuals for v1 (audit L5).** Taint does not carry across
  sends: a later message starts from a fresh state, and earlier turns reach
  the model only as text, so content a connector or web page returned in an
  earlier turn and quoted in an answer is not taint. Plain user attachments
  added no taint either (changed in section 7.9: they now add `file`). The
  cross-send residual is accepted for v1 and revisited with C-7.
- **Merge order.** With the flag on, this layer turns cases that used to run
  or be refused (a memory write after web search, an artifact write in a
  send with an active skill or after connector output, any connector write)
  into a pause nobody can answer until L5 and L6 ship, so the flag stays off
  outside internal testing until then.

### 7.7 As built: the continuation (C-6 L5, 2026-11-15)

The request that answers a pause (`server/utils/tool-approval/continuation.ts`
and the resume branch of `server/api/v1/chats/[slug]/index.post.ts`). There
are no buttons yet (L6); the client can already answer through
`answerToolApproval` on `useChat` (`app/composables/tool-approvals.ts`).
Where this differs from sections 7.2 and 7.6:

- **Request shape.** The send route accepts either today's
  `{ messages: [user] }` body or
  `{ approval: { messageId, responses: [{ approvalId, approved, remember, reason? }] } }`
  (1 to 10 responses, each approval id once, `reason` at most 500
  characters). Model, gateway, reasoning and connectors come from the
  pending record snapshot, the tools from the stored user message of the
  turn (image generation dropped, code execution kept without re-uploading
  files), never from the body. The Exa search level falls back to the
  default and auto web search is skipped.
- **Order of checks, before anything runs.** Chat owner (404), the
  `tool-approvals` flag (404 when off), 30 answers a minute per user
  (`tool-approval-rate:<userId>`, 429; a KV error fails closed with 503), the
  message (not in the chat: 404; not the last message or not an assistant
  message: 409 `TOOL_APPROVAL_STALE`), claims that already exist for the
  answered ids (read before any KV record, see below), the generation lease
  of the message, the turn record (missing: 409 `TOOL_APPROVAL_EXPIRED`,
  another owner: 404, unreadable state: 409, never a fresh state), the
  answered ids against the turn's pending ids (anything but an exact match:
  400) and every pending record (missing: 409 expired; another user, chat,
  message, or a tool call id and tool name the stored message does not
  hold in `approval-requested`: 404).
- **Duplicates.** Claims are looked up first, scoped to the user, because a
  double submit arrives after the first request deleted the pending
  records. While the message's generation lease is held, or a claim is
  inside its lease, the answer is the generation guard's
  `data-generation-pending` (claims turn done before the follow-up model
  turn streams, so the lease is checked first); a lapsed claim with no
  result, or done claims whose stored reply still waits for approval, is
  409 `TOOL_APPROVAL_INTERRUPTED` ("Interrupted. Ask again"), and the call
  never runs again; otherwise done claims replay the stored reply: the outcome of each
  answered call, then only the parts stored after them, never the whole
  message (the client still holds it). Claims are taken in sorted id order
  after the tool set is built and every check that can refuse without
  running a tool has passed, right after the generation lease of the
  message is put and just before the stream starts, so of two racers the
  one that loses the first id holds nothing and answers as pending (it
  leaves the lease to the winner). Each approved claim gets a `touchClaim`
  heartbeat from that moment until its call's result is fully produced
  (for a tool that streams its output, until the stream is consumed).
- **Re-check.** Every approved call is decided again with
  `resolveReplayApproval` against the live tool set, on a copy of the state
  that counts each earlier approved connector call of the same answer. A
  missing tool, a drift, Blocked, invalid input or a spent cap becomes a
  denial with a Besidka-written reason before `streamText`, so the SDK never
  meets a missing tool. A connector tool whose definition changed is hidden
  by the C-5 drift check, so today it reads as missing ("This tool is no
  longer available"). A user denial carries the user's note with control,
  bidirectional, other format (zero-width, word joiner) and tag characters
  removed. The permission mode the replay check uses comes from
  `resolveReplayPermissionMode(family, toolName, besidkaModes)`: the stored
  Besidka tool permission for a `besidka` call (BES-394 L8,
  `docs/besidka-tools.md`, so a tool the user set to Blocked after approving
  is denied on resume), and `ask` for a connector tool, whose Blocked state is
  the C-5 tool setting that hides the tool from the live set.
- **Rounds cap.** The turn's `rounds` counter holds the pauses recorded so
  far (1 after the first pause). Exactly five rounds can be answered: the
  replay check denies only when `rounds > 5`, and the send denies a call
  that would open a sixth pause (`over-cap`) instead of asking a question
  nobody could answer. `TOOL_APPROVAL_ROUNDS_PER_TURN` is the single limit
  both checks read.
- **Connector calls per turn.** The send's `toolApproval` now denies a
  connector call once the turn spent 12 connector calls, and
  `getConnectorTools` starts its per-send counter from the turn's count
  (`callsUsedThisTurn`), so the limit holds across rounds.
- **Remember.** The choice is clamped to the options the request offered.
  "In this chat" writes the exposed name and hash to
  `connector_chat_settings.alwaysAllowTools`, "always" sets the existing
  `connector_tool_settings` row to `always` with the approved hash. Since
  section 7.9 a plain connector write offers both, and the send and the
  replay read them back. Native writes never offer more than once.
- **Messages.** The history is sanitized as for any send. The paused
  message is rebuilt twice: for the model, each answered call takes its
  exact input from KV and, when approved, its signature (the stored input is
  redacted), and only finished tool calls, text, reasoning and step
  boundaries stay; text and reasoning keep their stored provider metadata
  (Anthropic thinking signatures, Gemini thought signatures) in their
  original order, and each answered call gets the provider metadata of its
  call (`callProviderMetadata`, for example a Gemini thought signature)
  back from the pending record, which stores it since L5 because the stored
  artifact and document copies drop it; for D1 and `readUIMessageStream`,
  the stored parts with
  the answered calls in `approval-responded` and nothing added. Resume mode
  skips the user-turn add-ons (knowledge excerpts, past-chat excerpts, skill
  invocation, auto web search, Anthropic container uploads, image
  generation, a forced `toolChoice`) and the stream prelude parts the
  message already holds. `assertEndsWithApprovalResponse()` turns a prompt
  that does not end on the answers into a 409 before any model call.
- **Running.** Claimed answers are settled first: pending records deleted,
  denied claims done and their audit rows settled as denied. Each approved
  call is marked with `markApprovedByUser`, bound to its tool name and
  canonical input: the SDK replay, the `execute` clearance and the memory
  lock (lifted for that call only, the never-store gate still runs) accept
  only the same name and input, so a later call reusing the id is decided
  like a new call, and the approval is used up once the call settles. Its
  `execute` is wrapped: once the result is fully produced the claim is
  marked done (failed when it threw) and its heartbeat stops, before the
  next model turn. The output itself is not stored anywhere new
  (`tool-approval:result:<approvalId>` is no longer written). A connector call settles its
  `pending` audit row (`approval` = the remember value) instead of writing a
  second row. The SDK's replay of an approved call records its taint, read
  source and connector count without a new decision.
- **Persistence.** The reply resumes into the same message id
  (`originalMessages` ends on the stored message) and is written with an
  update by public id; an update whose parts would be fewer than the stored
  ones is refused. Usage adds up (`sumMessageUsages`): tokens and costs sum,
  the knowledge and auto web search fields keep the first request's values,
  and the client's finish metadata shows the sum too. The generation lease
  is keyed on the assistant public id. A continuation that pauses again
  writes new pending records and a turn record with `rounds` plus one; one
  that ends deletes the turn record.
- **Provider-executed tools (spike 9, section 14.1).** They can never wait
  for approval: the provider runs the call inside its own response, so the
  result arrives right after the request chunk. `toolApproval` therefore
  never asks for a provider-executed call (L4 asked for code execution after
  taint and wrote pending records for a call that had already run).
  Instead, a provider-executed tool that is not a read (code execution, any
  unclassified provider tool) is left out of the send before the first step
  when the policy would ask, and out of later steps through `prepareStep`
  (`withProviderToolEgressGuard`). Provider code execution is exempt from
  this withholding for every taint kind, because the Anthropic, OpenAI and
  Gemini code sandboxes have no network egress and so cannot carry data
  out (grants audit, section 7.9); web fetch and any unclassified provider
  tool are still left out. The same guard withholds the provider's own web search,
  grounding and URL context once a tool call of the turn has read a
  connector or the user's Besidka data (a connector result, `search_chats`,
  `read_chat`, the memory and project knowledge reads; rule 4 of the plan),
  for the rest of the request and on its continuations. The state keeps
  those reads apart (`toolReadSources`, optional in older turn records):
  knowledge and past-chat excerpts preset into the prompt still count for
  F2 (`readSources`) but never withhold the web search the user turned on,
  and web taint alone does not either.
  On Anthropic routes the declarations stay mid-loop (the API rejects tool
  history without them) and a resumed message that already called the tool
  keeps it: there a provider-executed call after taint, web search
  included, still runs within that request (known gap).
- **Client.** `answerToolApproval` records the remember choice and calls
  the SDK's `addToolApprovalResponse`; `sendAutomaticallyWhen` sends the
  answers once every waiting call of the reply is answered. The SDK runs
  that check after every finished response too, so the composable keeps the
  ids whose answers went through and sends each answer once: a pending
  signal or a replay that leaves the answers in place does not loop. Answers
  count as sent only after a successful response; after a 409, a 429 or a
  network error they (and their remember choices) can be sent again. L6
  decides what the user sees then.
- **Known gaps for L6 and later.**
  - The duplicate replay omits reasoning parts and anything the stored copy
    no longer holds as a tool part (an artifact call rewritten to its
    reference); a reload shows them.
  - On Anthropic routes a provider-executed tool keeps its declaration
    mid-loop after taint, so Anthropic code execution can still run after
    untrusted content. Its sandbox has no network access, so the exposure is
    what the code prints back into the conversation.
  - A continuation that fails after its update can leave
    `approval-responded` parts in D1; a resend of the same answers then
    reads as interrupted ("Interrupted. Ask again").
  - A killed continuation loses its usage: `onEnd` never fires (section
    14.1 bullet 6), and the tool may already have run.
  - With the flag on and code execution withheld, the code execution
    session, its instruction line and its stream wrapper are still set up.
  - Provider metadata is restored from D1 and KV but only checked against
    mock models; a real Anthropic-with-thinking or Gemini resume is not
    verified yet.
  - The Besidka permission modes (Blocked, Allow) are not read yet, so
    replay uses `ask` and Blocked is not reachable from the route.

### 7.8 As built: the approval UI (C-6 L6, 2026-11-15)

The buttons for the pauses of 7.6 and 7.7. Where this differs from 7.3:

- **Where.** `Chat/Reasoning/ApprovalStep.vue` is a step in the
  `ChatReasoning` chain, built from the tool part and the
  `data-tool-approval` part with the same tool call id
  (`app/utils/tool-approval-step.ts`). Only behind the `tool-approvals`
  flag (client `useFeature`) and only where the chat page provides the
  controller (`TOOL_APPROVAL_CONTROLLER_KEY` from `useChat`): with the flag
  off, and on pages without a chat (shared pages), the step keeps the L4
  "Waiting for approval:" title. A new waiting call opens the reasoning
  block even with auto-hide on; a later collapse by the user sticks.
- **Copy.** The title is "<Connector> wants to run <tool>" (the connector's
  display name, else its slug) or a plain description for native writes
  ("Save to memory", "Forget a memory", "Create an artifact", "Update an
  artifact", "Create a document"). Everything is rendered as text. The
  server summary is shown only when it says more than the title; today's
  summaries all restate it, so none shows. One reason line per policy
  reason: `untrusted-output` names the last connector that answered in the
  message, or "the web" after a web source, or "outside Besidka";
  `cross-source` "Because it would use a different connector";
  `always-ask` "Changes or deletes data"; `default` "Runs only after you
  allow it". There is no "Changes data" badge.
- **Arguments.** The stored input as pretty JSON in a collapsed `<pre>`,
  marked "Shown shortened" when it holds `[redacted]`, was cut at 4,000
  characters, or is an artifact or document write (the stored copy keeps
  only kind or format and title). URLs and e-mail addresses are not
  highlighted.
- **Buttons.** `btn-sm`, stacked full width below `md`: Allow once
  (`btn-primary`), Allow in this chat and Always allow (`btn-soft`) only
  when the call's `rememberOptions` holds them, Deny (`btn-ghost`). The
  client builds no matrix of its own. Always allow asks for an inline
  confirmation first (section 7.9). Enter on the focused step
  (not on a button inside it, not repeated, not during IME composition)
  means Allow once, only when Allow once is offered; Esc collapses the
  arguments. "View details" opens `UiSidePanel` (bottom sheet below `md`)
  with the title, reason, exposed tool name and the full arguments; it has
  no buttons.
- **Several calls.** Each step has its own buttons. An answered step shows
  "You allowed this" or "You denied this" with a Change link that takes
  the local answer back; the last waiting step shows "1 of 2 answered".
  The SDK sends once every call is answered (7.7).
- **States** (`resolveApprovalStepState`): pending; answered; sending
  (buttons disabled, "Sending your answer…", the step bullet spins); denied
  (one line "Denied · 14:05"); approved (the regular connector, memory or
  tool step plus a line "Allowed · 14:05"); expired (a call on an earlier
  message, or a 409 `TOOL_APPROVAL_EXPIRED` or `TOOL_APPROVAL_STALE`);
  interrupted (a 409 `TOOL_APPROVAL_INTERRUPTED`, a stopped request, or an
  answered call found after a reload that this tab never sent). The time
  shows only when the answer was given in this tab; nothing stores it.
- **Ask again (deviation).** Regenerate cannot ask again: it re-sends the
  same user message id, and the send route's #263 guard replays the stored
  approval-only reply. Ask again therefore puts the original prompt back
  into the composer (`chat-input:prefill`, skipped when the draft already
  ends with it) and says "Your message is back in the box. Send it to try
  again." Sending it is a new user message, which expires the old records.
- **Errors.** A request that answered approvals is settled by
  `finishToolApprovalRequest` in `useChat`, before the generic error path,
  so no error card is appended to the paused reply and Regenerate does not
  show: a 409 marks its calls expired or interrupted (read from the body's
  `data.code` through `parseError`); a 429, a 503 or any other error puts
  the calls back to `approval-requested` (`revertToolApprovalResponses`)
  and shows a toast with the error's message and `why`, so the buttons come
  back. An error after the calls already settled falls through to the
  generic handling.
- **Pending signal and dropped connections.** A `data-generation-pending`
  answer or a transport interruption resends the same answers after the
  generation retry delay (4 seconds, at most 150 times) through the SDK's
  `sendMessage()`, instead of the old `regenerate()` that would replay the
  stored reply; the auto-send is held meanwhile so it does not loop. The
  server's claims make a resend wait, replay only the parts stored after
  the answered calls into the same message, or report the run
  interrupted; it never runs a call twice.
- **Chip.** `ChatInput/ToolApprovalChip.vue` sits in flow above the
  composer, inside its fixed container, so it lifts with the keyboard and
  counts toward the composer height: "1 action waiting for approval"
  (pluralized). It takes no space when nothing waits. While the composer is
  collapsed on scroll, the chip is what the peek shows. A click expands the reasoning
  block, scrolls the first waiting step to the center and focuses it.
  Its polite live region stays mounted while the flag is on and says
  "Action waiting for approval"; nothing moves focus when an approval
  arrives. The focused step draws a plain `focus:` outline, because focus
  moved by script after a mouse click does not match `:focus-visible`.
- **Tests.** `tests/unit/utils/tool-approval-step.spec.ts`,
  `tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts`,
  `tests/unit/components/Chat/Reasoning.approvals.spec.ts`,
  `tests/unit/components/ChatInput/ToolApprovalChip.spec.ts`,
  `tests/unit/composables/chat.tool-approvals.spec.ts` and the helpers in
  `tests/unit/composables/tool-approvals.spec.ts`. The e2e spec
  `tests/e2e/chat/tool-approval.spec.ts` uses the dev test chat scenarios
  `tool-approval` (one connector call) and `tool-approvals` (a connector
  call and a memory write after a web source) and answers the POST with
  `page.route`, because the e2e harness has no MCP or connector mocks
  (the mock MCP server is an integration-test helper).
- **Not verified.** The iOS keyboard and PWA layout of the chip, a real
  continuation against a live connector, and screen reader output were not
  checked. The approval state survives no reload: after a reload, an
  answered but unsent call reads as interrupted.

### 7.9 As built: remembered approvals (C-6 grants layer, 2026-11-15)

The owner report on BES-244: the step never offered "Always allow", because
the L3 audit put every connector write in the always-ask tier and nothing
read the stored grants. Where this changes sections 7.1 to 7.8:

- **Tiers.** `connectorDestructiveHint` is true only for an explicit
  `destructiveHint: true`. The buttons follow the reason:

  | Reason | Buttons |
  |---|---|
  | `untrusted-output`, `cross-source` | Allow once, Deny |
  | `always-ask` (server `destructiveHint: true`; Besidka delete and instructions tools) | Allow once, Deny |
  | `default` (a plain connector write) | Allow once, Allow in this chat, Always allow, Deny |

  `readOnlyHint: true` stays the only signal that lets a connector tool run
  without asking.
- **Read path.** With the `tool-approvals` flag on, `getConnectorTools`
  reads this chat's `connector_chat_settings` once per send and puts two
  grants on every connector entry (`SendToolEntry.userGrants`): "always"
  from the tool's `connector_tool_settings` row when `approval='always'`,
  with its `approvedDefinitionHash`, and "in this chat" from
  `alwaysAllowTools[<exposed name>]`. Each grant carries the hash it was
  given for, bound to the connector id and the exposed name, so a tool whose
  reviewed definition changed asks again. These are exactly the two values
  `applyRememberGrants` writes. The continuation goes through the same
  `getConnectorTools`, so a later call in a resumed turn reads them too.
  Flag off, nothing is read.
- **What a grant never lifts.** Rules 2, 3 and 5 run before the grant rules,
  so a grant never skips a prompt caused by untrusted output, a source
  switch or the always-ask tier. Every connector call, a granted write
  included, records `connector` taint and its read source, so a grant only
  skips the prompt for a connector write made before anything untrusted ran
  in that send; a second write in the same send asks Allow once / Deny.
  User grants on a read-only tool count only while the auto-run grant
  would (an untainted send, or `openWorldHint: false`).
- **Forged answers.** `decideContinuation` clamps the remember choice to the
  options the pending record stored, so a `chat` or `always` answer to a
  once-only request is stored as `once`.
- **Confirmation.** Always allow opens an inline confirmation inside the
  step (no modal): "Always allow <tool> from <Connector>? Besidka will run
  it without asking in every chat until the tool changes. You can remove
  this in the chat panel." Focus moves to its Always allow button; Cancel or
  Esc closes it and returns focus to the step. Enter on the step still means
  Allow once.
- **Context panel.** An owned chat with the flag on shows an Approvals
  section under the context groups (`Chat/ContextPanelApprovals.vue`,
  `useChatToolApprovalGrants()`): every "in this chat" grant of this chat
  and every "always" grant of the connectors the chat has on, by connector
  title and remote tool name, never hashes. A grant whose stored hash no
  longer matches the reviewed definition is not listed. "Reset approvals in
  this chat" clears every chat grant; "Remove" sets one always grant back to
  ask. The list reloads when the panel opens and after each finished send.
- **Routes** (`server/api/v1/chats/[slug]/tool-approvals/`):
  `GET index` lists the grants; `POST reset` sets `alwaysAllowTools` to `{}`
  in this chat's `connector_chat_settings` and `besidka_chat_settings` rows
  and keeps each connector switched on or off; `POST revoke`
  (`{ connectorId, toolName }`, the remote tool name) sets
  `approval='ask'` and `approvedDefinitionHash=null` and keeps the reviewed
  hash. The POSTs run the same-origin guard and the connector write limit
  (10 a minute); all three answer 404 when the flag is off or the chat is
  not the user's. No migration: the tables are the C-6 L3 ones.
- **Not built.** No Besidka-family tool exists yet (BES-394 L8), so nothing
  reads `besidka_chat_settings` grants; reset already clears them.
- **Audit follow-up (2026-11-15).** The security audit of #912 found these,
  fixed in the same PR:
  - *Attachments taint the send (H1).* A file the user attached to the
    current message records `file` taint (`presetApprovalTaint`,
    `holdsUserAttachments`), so no grant runs a tool in a send that holds a
    document. Because the taint counts for every rule, a send with an
    attachment also asks for memory writes (Allow once / Deny) and asks
    `untrusted-output` for open-world connector reads. Provider code
    execution stays available, because its sandbox has no network egress
    (section 7.7), so "analyze this CSV" keeps working.
  - *Cross-send residual, accepted (H1).* Taint does not carry across
    sends, so a grant runs its tool in a later message even when an earlier
    message read untrusted content that is still in the history. This is
    the Claude-like behavior the owner asked for; no per-chat taint flag is
    stored. The Always allow confirmation and the "Allow in this chat"
    tooltip say so in plain words.
  - *Visible runs (M1).* A call that ran under a grant gets a
    `data-tool-grant` part (`toolCallId`, `toolName`, `scope`), written
    after its output. The reasoning step shows "Ran without asking (Always
    allowed)" or "(Allowed in this chat)" with Manage, which opens the chat
    panel. Shares and branches drop the part; the history sanitizer keeps
    only text.
  - *Name heuristic (M2).* A connector tool whose remote name or title
    contains delete, remove, revoke, destroy, drop, purge, invite, share,
    transfer or publish (`hasAlwaysAskToolName`: split on non-letters and
    camelCase, whole words, any case) is always-ask whatever its
    annotations say, also when it claims `readOnlyHint: true`. The panel
    does not list a grant on such a tool. The confirmation adds that what
    the tool does is declared by the service itself.
  - *Revoke (L1).* The connector id is decoded and looked up among the
    user's connectors before the update, so an id that does not decode or
    is someone else's answers 404, never 500. The request log gets the
    outcome and the connector id only.
  - *URL change (L2).* Not applicable: no route edits a connector's URL
    (`PATCH /api/v1/connectors/[id]` takes `enabled` and `title` only), so a
    new URL is a new connector with its own baseline and no grants.
  - *Same connector (item 6).* No exemption for a call to the connector
    that produced the untrusted content: its own earlier output can carry
    instructions just as well, so a granted write after any connector read
    in the send still asks Allow once / Deny.
- **Memory tool text.** With the flag on, the `memory_write` and
  `memory_forget` descriptions say a call after untrusted content needs the
  user's approval in this turn and that the model should still call it when
  the user asked (`buildMemoryWriteDescriptions`). The live check had shown
  reasoning models skipping the tool because the old text said it was
  refused. Flag off, the text is unchanged.

### 7.10 As built: step icons (BES-395, 2026-11-15)

Every reasoning step starts with a small decorative icon; the title keeps the
meaning. The one registry is `app/utils/reasoning-step-icons.ts`
(`resolveReasoningStepSource`): it maps a tool name to an icon descriptor and
a label, and `Chat/Reasoning/StepIcon.vue` draws it (`aria-hidden`, empty
`alt`). Only the four pinned icon collections are used
(`docs/nuxt-icon-collections.md`).

- **Built-in sources.** Search shows the brand of the vendor that ran it:
  Brave and Exa by tool name, and for the native `web_search_preview` tool the
  vendor in `usage.searchProvider` (Google, Anthropic, OpenAI, xAI, DeepSeek).
  While the usage is not saved yet (streaming) or the route is a gateway, the
  icon is a globe. Documents show their file type and name the format
  ("Created DOCX"); while the input still streams there is no `format`, so the
  generic title stays. Skills use `lucide:sparkles`, memory the memory icon,
  chat and project knowledge their own icons, and the future `besidka__*` tools
  the Besidka mark. Artifacts and code execution have icons in the registry,
  but those tools are excluded from the step list today, so only an approval
  step for them shows one.
- **Connector icon, in this order.** (1) An icon the server declares in its
  `initialize` result (`serverInfo.icons`, MCP 2025-06 and later; the
  `@ai-sdk/mcp` schema is loose, so the field survives). It is read on the
  tool-list cache miss in `send-tools.ts` and kept as sources in KV. Only a
  `data:` image or a URL on the server's own origin is fetched; dark-theme
  icons are skipped (the tile is light). (2) `/favicon.ico` of the server's
  host. (3) A letter avatar, drawn by the client when the route answers 404.
  Registry icons are not read: `mcp_registry_servers` has no icons column and
  nothing syncs it yet.
- **Fetch and storage.** `server/utils/connectors/icon.ts`, through
  `safeFetch` with the new `favicon` purpose (redirects stay on the server's
  origin, as for `mcp`; 32 KiB, 5 s). The answer must be a success and a
  raster image by its magic bytes (PNG, JPEG, GIF, WebP, ICO) whose own header
  declares at most 512 by 512 pixels (an ICO with an entry pointing outside the
  file is refused too). SVG is refused: it is served from the app's own origin
  and can carry script. The bytes live in KV under `connectors:icon:<id>` for
  7 days; a miss is kept for a day, so a server without an icon is not asked on
  every render. A changed set of declared sources drops the kept icon. Deleting a connector
  (`delete/bulk` is the only delete path), disconnecting it, withdrawing its
  consent and an account purge (`purgeUserConnectors`, best effort, one KV
  delete at a time) remove the keys. No route changes a connector's URL or
  origin (a new URL is a new connector), so there is nothing to clear there. A
  short in-flight marker, `connectors:icon-lock:<connectorId>` (60 s, best
  effort because KV is eventually consistent), makes concurrent cold requests
  answer a 5 s 404 instead of all fetching.
- **Route.** `GET /api/v1/connectors/[id]/icon`: session, `connectors` flag,
  the connector must be the user's (404 otherwise), have current consent and
  be `ready` or `drifted`, so nothing is fetched for a connector the user has
  not connected. A loose per-user bucket allows 120 requests a minute. Headers: `cache-control: private, max-age=86400` (3600 for a
  404), `x-content-type-options: nosniff`, `content-security-policy:
  default-src 'none'; sandbox`, `cross-origin-resource-policy: same-origin`,
  and `content-type` from the sniffed type.
- **Never remote.** The chat loads the image only from this route
  (`referrerpolicy="no-referrer"`), so a connector cannot see the viewer's
  address. Shared pages pass `is-shared` to `ChatReasoning`, which forces the
  generic plug icon and never requests the route (tool parts are also stripped
  from shares, so there is nothing to show).
- **Known limit.** Measured on 2026-11-15: only 2 of 11 well-known MCP hosts
  serve `/favicon.ico` (Sentry, Vercel); Notion, Linear, Stripe, Atlassian and
  others answer 404, so most connectors show the letter unless the server
  declares icons. Options if that is not enough: read the HTML `<link rel=icon>`
  of the host, or the registry `icons` once the registry is synced.
- **Dev check.** `GET /chats/test?scenario=reasoning-icons` renders one reply
  with every kind of icon (connector slugs `sentry`, `vercel`, `linear`).

## 8. Data model

All in `server/db/schemas/connectors.ts`, exported from `server/db/schema.ts`.
One migration in C-2 with only `CREATE TABLE` and `CREATE INDEX` (grep the
generated SQL for `DROP TABLE` before applying). Defaults in application code
(`$defaultFn`), never SQL `DEFAULT`. **No foreign key to `users` and no
cascade to `chats` on any table (this doc):** `purgeUserData`
(`server/utils/account/purge-user-data.ts`) deletes every row explicitly, and
a spec fails when a table with a `user_id` column is not covered. This follows
the program-wide planning decision "no `users` columns or FKs"
(`docs/agentic-capabilities-roadmap.md`, the precedent of `research_jobs` and
the P0-2 feature tables) and meets the purpose of the pre-check's audit-table
row (rows go with the account and are not deleted with the connector;
question 7 allows "cascade or explicit purge"). The pre-check's question 12
and C-2 row also ask for a cascade FK and a `CLAUDE.md` cascade-list entry;
this document overrides that, because a cascade only adds blast radius to a
future `users` rebuild and gives nothing explicit purge does not. With no
cascade, the `CLAUDE.md` list does not change. Per-chat rows store the chat
public id and are deleted by the chat-deletion cleanup.

**Id columns (C-2 deviation from this table, 2026-11-14).** `connector_id` and
`chat_public_id` are stored as `publicId()`, an integer-backed column that
encodes to the public id in TypeScript, not as `text`. This is the precedent
of the merged skills tables (`skill_chat_settings.chat_public_id`,
`skill_files.skill_id`) and of `research_jobs.chat_id`. It keeps
`connector_id` comparable to `connectors.id` in SQL (SQLite compares an
`INTEGER` and a `TEXT` column with different affinity), and it does not tie
the stored value to the Hashids salt. The column type cannot change later
without a table rebuild, so it is decided here.

`connectors.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, so an id is never
reused after a delete: the audit rows in `connector_tool_calls`, which outlive
a deleted connector, and any log line can never name a different connector
later. Drizzle's custom `publicId()` type does not support `autoIncrement`
(drizzle-orm issue 818, noted in `server/utils/schema.ts`), so the column is a
plain integer in the schema and `server/utils/connectors/store.ts` encodes it
to the public id on the way out (`encodePublicId`) and decodes it on the way in
(`decodePublicId`). Every other table stores the same integer in a
`publicId()` column.

### 8.1 `connectors`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer, autoincrement | exposed as a public id by the store |
| `user_id` | integer, not null | |
| `slug` | text | `^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$` (1 to 16), unique per user, fixed after create. Presets use the preset id (`github`, `notion`, `linear`, `atlassian`). Other hosts use the second-to-last label (`mcp.example.com` gives `example`), or the third-to-last when the second-to-last has 3 characters or fewer and another label exists (`mcp.example.co.uk` gives `example`), cut to 16. On collision `-2`, `-3` |
| `title` | text | user-editable, at most 80 characters |
| `origin` | text | `https://host[:port]`, plain, for display and consent. Derived from the URL inside `createConnector`, never taken from the caller |
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
| `last_error` | json, null | a fixed code plus a short fixed message, and the scope `degraded` note. **Never upstream text**: no response body, no remote error message, no URL (a URL can carry a secret, and upstream text is attacker-controlled and shown on the card). Map every failure to a code and a message Besidka wrote |
| `last_connected_at` | timestamp, null | |
| `created_at`, `updated_at` | timestamps | |

Indexes: unique (`user_id`, `slug`); (`user_id`, `updated_at`).

The store (`server/utils/connectors/store.ts`) enforces the rules a route
must not be trusted with: `createConnector` inserts and enforces
`CONNECTORS_PER_USER` in one batch (the row is deleted again in the same
batch when it would be over the cap), `updateConnector` writes only a
whitelist of columns, and every write to a child table (`saveConnectorCredentials`,
`upsertConnectorToolSettings`, `upsertConnectorChatSettings`) first checks that
the connector belongs to the user and never rewrites `user_id` on conflict.

### 8.2 `connector_credentials`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `connector_id` | publicId | no foreign key |
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
connector-level fingerprint column). A reserved row with `tool_name` `''`
(empty string, never a real tool) marks "a baseline was taken" for a
connector whose first listing was empty; readers skip it (section 6.1).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | publicId | |
| `connector_id` | publicId | |
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
| `chat_public_id` | publicId | |
| `connector_id` | publicId | |
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
| `connector_id` | publicId | plain, no foreign key |
| `connector_host` | text | plain |
| `chat_public_id` | publicId, null | |
| `tool_name` | text | remote name |
| `args_hmac` | text | section 7.4 |
| `result_bytes` | integer | |
| `outcome` | text | `ok`, `error`, `denied`, `timeout`, `pending` |
| `approval` | text | `not-applicable`, `pending`, `once`, `chat`, `always`, `denied` |
| `path` | text | `worker` or `native` |
| `duration_ms` | integer | |
| `created_at` | timestamp | |

Indexes: (`user_id`, `created_at`); (`created_at`) for the sweep. A pending
row is updated in place when the approval is answered.

`chat_public_id` deliberately outlives the chat: chat delete cleanup removes
`connector_chat_settings` rows but leaves the audit rows, so the trail of what
ran in a deleted chat stays for the 90-day retention and a stolen session
cannot erase it by deleting chats. The audit rows hold no chat content, only
the id.

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
| `connectors:icon:<connectorId>` | 7 days (a miss: 1 day) | the connector's icon image with its type in the metadata, or a miss marker (section 7.10) |
| `connectors:icon-lock:<connectorId>` | 60 s | in-flight marker of a cold icon fetch |
| `connectors:icon-sources:<connectorId>` | 7 days | the icon sources the server declared in `initialize`; a change drops the icon key |
| `tool-approval:<approvalId>` | 24 h | exact pending call arguments and signature (section 7.6, shared with native tools) |
| `tool-approval:turn:<messagePublicId>` | 24 h | pending approval ids and the serialized approval state of the paused turn |
| `tool-approval:chat:<chatPublicId>` | 24 h | per-chat index of the keys above, used by chat delete and by expiry |
| `tool-approval-rate:<userId>` | 120 s | approval answers in the current one-minute window (section 7.7) |
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
| `atlassian` | Atlassian | `https://mcp.atlassian.com/v2/mcp` | `['oauth', 'header']` | "Your Atlassian admin must allow besidka.com (or enable API tokens). Some tools use Rovo credits from your organization." |

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
| `CONNECTOR_TOOL_DEFINITIONS_MAX_BYTES` | 32,768 per request: each tool counts its description bytes plus its serialized input schema bytes | C-5 |
| `CONNECTOR_TOOL_DESCRIPTION_MAX_BYTES` | 1,024 per tool (truncated) | C-5 |
| `CONNECTOR_TOOL_SCHEMA_MAX_BYTES` | 8,192 per tool (tool skipped) | C-5 |
| `CONNECTOR_TOOL_NAME_MAX_LENGTH` | 64 (exposed name) | C-5 |
| `CONNECTOR_SLUG_MAX_LENGTH` | 16 | C-2 |
| `CONNECTOR_RESULT_MAX_BYTES` | 65,536 text after conversion | C-5 |
| `CONNECTOR_RESPONSE_MAX_BYTES` | 1,048,576 raw per MCP response | C-3, C-5 |
| `CONNECTOR_CALL_TIMEOUT_MS` | 60,000 (= `TOOL_LOOP_TOOL_TIMEOUT_MS`) | C-5 |
| `CONNECTOR_CONNECT_TIMEOUT_MS` | 10,000 | C-5 |
| `CONNECTOR_PARALLEL_CONNECTS` | 3 | C-5 |
| `CONNECTOR_LIST_TIMEOUT_MS` | 8,000 per `tools/list` request | C-5 |
| `CONNECTOR_PREPARE_DEADLINE_MS` | 8,000 for the connect and list phase of all connectors in one send | C-5 |
| `CONNECTOR_SSE_PER_SEND` | 2 connectors on the legacy SSE transport | C-5 |
| `CONNECTOR_STEPS_PER_TURN` | 4 | C-5 |
| `CONNECTOR_CALLS_PER_TURN` | 12 | C-5 |
| `CONNECTOR_CALLS_PER_MINUTE` | 60 per user, all connectors | C-5 |
| `CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR` | 30 per user per connector | C-5 |
| `CONNECTOR_ICON_MAX_BYTES` | 32,768 per icon (the `favicon` safe-fetch purpose cap) | BES-395 |
| `CONNECTOR_ICON_TIMEOUT_MS` | 5,000 per icon request | BES-395 |
| `CONNECTOR_ICON_TTL_SECONDS` | 7 days; a miss `CONNECTOR_ICON_MISS_TTL_SECONDS`, 1 day | BES-395 |
| `CONNECTOR_ICON_MAX_DECLARED` | 4 declared icons kept per server | BES-395 |
| `CONNECTOR_ICON_SOURCE_MAX_LENGTH` | 65,536 characters per declared source | BES-395 |
| `CONNECTOR_ICON_CACHE_SECONDS` | 86,400 browser cache of the icon route | BES-395 |
| `CONNECTOR_ICON_MAX_DIMENSION` | 512 pixels, width and height | BES-395 |
| `CONNECTOR_ICON_ROUTES_PER_MINUTE` | 120 per user on the icon route | BES-395 |
| `CONNECTOR_ICON_LOCK_TTL_SECONDS` | 60 | BES-395 |
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
| "+" menu | One row "Connectors" in the Add section of `app/components/ChatInput/ToolsMenu/Content.vue` that opens `ChatInput/ConnectorPicker.client.vue` (a toggle per enabled, ready or drifted connector, at most five on, a "Manage connectors" link); never an inline list (owner rule). Shown only when the `connectors` flag is on, the user has a selectable connector and the model can call tools. Tile "N connectors" from `buildChatInputTiles` (`docs/chats/chat-input-tools-menu.md`) | C-5 |
| Chat bubble | Tool steps in `ChatReasoning`, the approval inside the call's reasoning step, "Run by OpenAI" badge on native calls | C-5, C-6, C-11 |
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
  allowlists change), and the current `store` behavior (30-day retention when
  `store=true`). Stored as `connectors.native_opt_in_at`.

When the native path applies to a tool (all must hold):

1. Direct OpenAI model with the user's OpenAI key; never a gateway, never a
   direct key routed through a gateway.
2. The connector has `status='ready'`, current consent and the native opt-in.
3. The tool is marked read-only by the server **and** set by the user to
   "Always allow" with a matching hash. These are exactly the calls that
   section 7 would run without an approval when no forced rule applies.
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
| C-6 BES-244 | "Always allow" confirmation text gains ", until the server changes it" and the option is hidden when F1 or F2 caused the card; decision order of section 7.1 (F1, F2 before any "always"); every tool defaults to ask, `readOnlyHint` never skips an approval; "always" bound to the definition hash; approval secret from HKDF (no new env var); one approval-settings route (C-7's) plus the per-chat reset route; audit pending row updated in place |
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
   call `parseSafeOutboundUrl`; the SDK's own endpoint guard is defense in
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
  `zod`: settled in C-5 (installed, no peer warning, typecheck clean; it
  brings `@ai-sdk/provider@4.0.37` and `@ai-sdk/provider-utils@5.0.76` next
  to the 4.0.34 and 5.0.68 of `ai`). Its main entry has no `cross-spawn`
  import.
- Whether the SDK honors `ttlMs` and `cacheScope` from `tools/list`: settled
  in C-5. The result schema is loose, so `ttlMs` is on the `listTools()`
  result and `getConnectorTools` reads it; `cacheScope` is not needed (the
  cache key already holds the connector id and the credentials generation).
- AI SDK v7 approval continuation semantics: settled in C-6 L2 on
  `ai@7.0.173` (section 14.1); the section 7.2 fallback is not needed.
- OpenAI `requireApproval` and MCP output items as they arrive through
  `@ai-sdk/openai` (section 12 gate).

### 14.1 Approval spike findings (C-6 L2, `ai@7.0.173`)

Source: `tests/integration/api/tool-approval-spike.spec.ts`. It drives plain
`streamText` with `MockLanguageModelV4`, `convertToModelMessages` and
`toUIMessageStream`, independent of the Besidka route, and asserts what the SDK
does. Each bullet is an observed fact, then the consequence for L3 to L5.
Clauses tagged "(source)" were read in `node_modules/ai/dist/index.js` and are
not asserted by a test.

1. **A pending approval ends the send.** UI chunks, in order: `start`,
   `start-step`, `tool-input-available`, `tool-approval-request`, `finish-step`,
   `finish`. The finish reason is `tool-calls`, the same value as a normal
   tool-calling step, so it cannot identify a pause. The loop stops (one model
   call even with `stopWhen: isStepCount(5)`), the tool does not run, and
   `onEnd` reports one step whose content is `tool-call` then
   `tool-approval-request`, with that step's usage. The `start` chunk carries no
   `messageId` when `originalMessages` is not passed (observed). On the
   continuation, with `originalMessages` ending on the answered assistant
   message, it carries that message's id (bullet 2).
   Consequence: L4 detects the pause from the last step's content, never from
   the finish reason, and the empty-answer logic must count an approval request
   as content.
2. **Continuation order.** With the part in `approval-responded` (approved),
   the approved tool runs before any model call (zero model calls at execute
   time), then the model is called exactly once. Chunks: `start` (with the
   original assistant `messageId`), `tool-output-available` (no `start-step`
   before it), `start-step`, text chunks, `finish-step`, `finish`. `onEnd`
   covers only the continuation: one step, and usage of that model call only.
   Reducing the chunks with `readUIMessageStream({ message })` puts the output
   on the existing tool part (`output-available`) and appends a `step-start` and
   the text, so L5 persists by updating the stored assistant message, not by
   inserting a new one.
   Denied: no execution, a `tool-output-denied` chunk, and the model receives
   `{ type: 'execution-denied', reason }` as the tool result. Consequence: L5
   adds the first request's usage to the continuation's, and per-send caps
   (steps, calls, cost) restart per request, so they live in KV.
3. **Parallel calls.** The SDK decides every call in the step, in stream order,
   when its `tool-call` chunk arrives and starts executing only after the model
   call ends, so all calls of a step are decided before any runs (a policy
   function is called once per call and never sees its siblings; a taint set at
   decision time should therefore be visible to later decisions in the same
   step, inferred from the sequential order the test records, not asserted
   separately). A call that
   needs no approval runs in the first request, after the
   `tool-approval-request` chunk, and the step still finishes `tool-calls`.
   This corrects section 7.2 step 1 ("no remote call happens"): a read-only
   connector call in the same step as a gated write does reach the remote
   server before the user answers. The continuation does not re-run it: the
   tool message holds its stored result next to the approval response, only
   the approved call executes, and the model sees both results. Two gated calls
   with only one answered: the answered call executes (`tool-output-available`)
   and then the stream errors with `AI_MissingToolResultsError` for the
   unanswered one, with no model call. Consequence: the continuation must carry
   a response for every pending approval of the message, as the plan requires
   (a partial answer runs one call and then fails the send). L4
   audits and taints auto-run calls in the first request, and the UI must show
   them as done while the other call waits.
4. **Worker kill.** Canceling the stream right after `tool-output-available`
   leaves one execution, no `onEnd` and no `onAbort`. Resending the identical
   continuation executes the tool a second time. Consequence: the D1 claim (one
   `INSERT ... ON CONFLICT DO NOTHING` per approval id before the SDK sees the
   response) is required for at-most-once, and cost or usage capture is lost
   for a killed continuation.
5. **Missing, renamed or re-decided tools on continuation.** A tool absent from
   `tools` (removed or renamed) is not denied: the stream is `start`, `error`
   (`AI_MissingToolResultsError`), with no model call and no execution. If the
   policy returns `denied` on replay, the SDK re-checks it: `tool-output-denied`,
   the model sees `execution-denied` with the policy's reason, nothing runs. If
   it returns `user-approval` (or nothing) on replay, the approved response
   still executes; there is no second prompt. Consequence: L5 writes its own
   denial for a missing, blocked or drifted tool before calling `streamText`,
   and expresses "refuse" as `denied`, never as `user-approval`.
6. **A message after the trailing tool message.** Approvals are collected only
   from the last model message. A user message appended after an answered
   approval (through the UI messages or the model messages) does not run the
   tool and is not silently ignored: the SDK raises `AI_MissingToolResultsError` before any model call
   (`start`, `error`). Adding text to an earlier user turn is harmless.
   The one silent path is a pending, unanswered approval followed by a new
   user message: `convertToModelMessages` drops the `approval-requested` part,
   so the model messages are just the two user messages, the tool never runs
   and the send proceeds normally. It keeps `approval-responded` parts.
   Consequence: `appendTextToLastUserTurn`, `appendAnthropicContainerUploads`
   and similar helpers must be skipped in resume mode, and
   `assertEndsWithApprovalResponse()` stays as the guard that returns a clean
   409 instead of a stream error.
7. **Signing.** With `experimental_toolApprovalSecret` the signature is on the
   `tool-approval-request` chunk, on the UI part as `approval.signature`, and
   on the model message `tool-approval-request`. It is an HMAC over approval
   id, tool call id, tool name and the canonical input digest (source): not over
   the user, chat or message. An untampered continuation passes. A changed input, a
   changed approval id, a wrong secret or a missing signature each raise
   `AI_InvalidToolApprovalSignatureError` ("invalid signature" or "missing
   signature") before any model call or execution. A response id that matches
   no request raises `AI_InvalidToolApprovalError`. Both surface as stream
   `error` chunks, not as HTTP statuses. Without a secret, a tampered but
   schema-valid input executes as sent. A denied response skips the signature
   check (nothing runs). Consequence: the secret is mandatory, owner and chat
   binding stay a KV lookup, and L5 validates ids and ownership before
   streaming so these errors never reach the client.
8. **Tool weight.** 46 of the 49 `server/mcp/tools/*.ts` definitions load under
   the test stubs (the three public tools need `defineCachedFunction` and are
   not planned for chat). Serialized as name, description and JSON Schema
   (`asSchema(z.object(shape))`), the planned chat set is 29,228 bytes (about
   7,300 tokens at 4 bytes per token): 8,641 read (11 tools), 8,538 write (8)
   and 12,049 ask-every-time (13). With descriptions capped at 300 characters
   it is 26,680 bytes; the schemas alone are 16,221. The first 16 tools in plan
   order (11 read plus 5 write) are 14,555 bytes. All 46 loadable tools are
   47,680 bytes. The plan lists 32 names (11, 8 and 13), not the 31 it counts.
   Consequence: the built-in tool budget in L9 is real; at 32 tools it takes
   about 29 KB of context on every send, so the "at most 16 built-in tools"
   rule and the per-chat "Besidka" opt-in are not optional.

9. **Provider-executed calls cannot wait.** A provider tool (Anthropic
   code execution) whose call the policy answers with `user-approval` still
   runs: the provider sends its result in the same response, right after the
   `tool-approval-request` chunk (`start`, `start-step`,
   `tool-input-available`, `tool-approval-request`, `tool-output-available`,
   text, `finish-step`, `finish`), the finish reason is `stop`, the part ends
   `output-available` and no `approval-requested` part remains. On a
   continuation the SDK also skips local execution of approved
   provider-executed calls (source). Consequence: never ask for a
   provider-executed call; leave the tool out of the step instead (section
   7.7).

## 15. Host portability

| Concern | Cloudflare (hosted Besidka) | Self-host on a VPS, Node or Vercel |
| --- | --- | --- |
| Private-range egress block | None documented (section 4.5) | Required: an egress proxy or firewall that refuses private, loopback, link-local, ULA and metadata addresses after DNS resolution (for example a forward proxy with an IP denylist), and all connector traffic forced through it. Without it, DNS rebinding reaches the host's network |
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
| A connector marketplace or sponsored catalog | Curation and liability Besidka cannot carry; monetization guard; four presets plus registry search cover discovery |
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
