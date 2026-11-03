# MCP marketplaces and directories

This doc tracks where the Besidka MCP server (`https://besidka.com/mcp`) is
listed, what each store needs, and what is left for the owner. The server
itself is described in `docs/mcp-server.md`; agent discovery and the WAF
runbook are in `docs/agent-readiness.md`.

Research date: 2026-11-03. Every requirement below comes from the store's own
docs on that date. Claims that came only from third-party reporting, or that
could not be checked, say so.

## Status

| Store | Status | Why |
| --- | --- | --- |
| Official MCP Registry | Repo side done; publish needs the owner (WAF step 1c, then one command) | Self-serve, no account, no review. Glama and others copy from it |
| Claude connector directory | Needs the owner | Any paid Claude plan can submit. DCR and mixed public/OAuth are accepted as they are |
| ChatGPT plugin directory | Repo side done; needs the owner | Individual ID verification, a demo video, a reviewer account and the domain token |
| Cursor Marketplace | Repo side done; needs the owner | Manual review; the plugin lives in `plugins/besidka/` |
| cursor.directory | Needs the owner | Community list, GitHub sign-in |
| Google Connected Apps (Gemini, AI Mode) | Needs the owner: join the waitlist | Preview with phased access; eligibility of individuals is not documented |
| Grok connectors | Does not fit | No submission path. Users add Besidka as a custom connector |
| Meta Muse | Does not fit | Business verification of an organisation |
| Microsoft 365 Copilot Agent Store | Does not fit | Partner Center needs a registered business; MCP certification needs static client credentials |
| Salesforce AgentExchange | Does not fit | Company partner program and agreements |
| AWS Marketplace, AI Agents and Tools | Does not fit | AWS says sole proprietors without a registered business cannot pass verification |
| Glama, PulseMCP, mcp.directory | Follow the official registry | Nothing to submit separately |

The four "does not fit" rows that need a registered business change only
when Besidka has one. `docs/legal/monetisation-readiness.md` covers that
decision (JDG, address); do not open a business just for a listing.

## Official MCP Registry

The registry at `registry.modelcontextprotocol.io` is the upstream list that
other directories copy. It is still labelled preview. There is no review
before publishing; moderation afterwards covers only illegal content,
malware, spam and servers that do not work.

### What is in the repo

| File | Purpose |
| --- | --- |
| `server.json` | The registry entry: `com.besidka/mcp`, schema `2025-12-11`, one `streamable-http` remote, icons, website, repository |
| `config/mcp-server.ts` | `MCP_REGISTRY_PUBLIC_KEY`, the public half of the signing key |
| `server/routes/.well-known/mcp-registry-auth.get.ts` | Serves `v=MCPv1; k=ed25519; p=<public key>` as `text/plain` |
| `tests/unit/config/mcp-registry-manifests.spec.ts` | Fails when `server.json` or the plugin manifests drift from `config/mcp-server.ts` |

The name `com.besidka/mcp` is reverse DNS, so the registry needs proof that
the publisher controls `besidka.com`. HTTP verification fetches
`https://besidka.com/.well-known/mcp-registry-auth` with `GET`, needs a 200,
does not follow redirects, reads at most 4096 bytes and gives up after 10
seconds. The requests come from Google Cloud addresses. HTTP verification
covers `com.besidka/*` only; a DNS TXT record would also cover subdomains,
which Besidka does not need.

The registry has no field for OAuth. Clients find it through the 401
challenge and the protected resource metadata, as described in
`docs/mcp-server.md`.

### Validation rules worth knowing

- `description` is 1 to 100 characters, a hard limit. `server.json` uses
  `MCP_SERVER_DESCRIPTION`, and the manifest test checks the length.
- `version` must be a fixed string (`latest` and ranges are rejected). Every
  name and version pair is published once and is immutable.
- A remote URL can belong to only one server name.
- Icons must be https, at most 255 characters, and png, jpeg, svg or webp.
- Only `_meta["io.modelcontextprotocol.registry/publisher-provided"]` is
  kept (4096 bytes); other `_meta` keys are dropped. `server.json` sends none.

### The signing key

The Ed25519 private key that matches `MCP_REGISTRY_PUBLIC_KEY` was generated
on 2026-11-03 and is not in the repo. It must stay out of the repo, PRs and
chats. The owner keeps it in their password manager or in
`~/.config/besidka/mcp-registry-ed25519.pem` with mode `600`. If it is lost,
generate a new pair, put the new public key in `MCP_REGISTRY_PUBLIC_KEY`,
deploy, and publish with the new key. Nothing else depends on it.

```bash
/opt/homebrew/opt/openssl@3/bin/openssl genpkey -algorithm Ed25519 -out mcp-registry-ed25519.pem
/opt/homebrew/opt/openssl@3/bin/openssl pkey -in mcp-registry-ed25519.pem -pubout -outform DER | tail -c 32 | base64
```

macOS LibreSSL has no Ed25519, so use Homebrew `openssl@3`.

### Publishing

Prerequisites: the PR with `server.json` is merged and deployed, and WAF
step 1c in `docs/agent-readiness.md` is applied, so that this prints
`200` and the `v=MCPv1` line:

```bash
curl -s -w '\n%{http_code}\n' https://besidka.com/.well-known/mcp-registry-auth
```

Then, from the repo root:

```bash
brew install mcp-publisher
```

```bash
mcp-publisher validate
```

```bash
mcp-publisher login http --domain besidka.com --private-key "$(/opt/homebrew/opt/openssl@3/bin/openssl pkey -in ~/.config/besidka/mcp-registry-ed25519.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')" && mcp-publisher publish
```

The login token lasts 5 minutes, so login and publish run together. The
login needs no account and no browser.
`mcp-publisher` takes the key only as a command-line argument, so the hex
key is briefly visible to other processes of the same user (`ps`). Run it on
the owner's own machine, and start the line with a space if the shell keeps
such lines out of its history (`HIST_IGNORE_SPACE` in zsh).

Check the entry:

```bash
curl -s 'https://registry.modelcontextprotocol.io/v0.1/servers/com.besidka%2Fmcp/versions/latest'
```

The answer has `server.name` `com.besidka/mcp` and
`_meta["io.modelcontextprotocol.registry/official"].status` `active`.

### When to publish again

Every change to `MCP_SERVER_VERSION`, `MCP_SERVER_DESCRIPTION` or the remote
URL needs a new registry version. Bump `MCP_SERVER_VERSION`, update
`server.json` (the manifest test fails until both agree), deploy, then run
the login and publish command again. Adding or changing tools does not need
a new registry version: the registry stores no tool list, and clients read
tools from the server.

### Downstream directories

- Glama says it ingests every server in the official registry.
- mcp.directory says part of its list comes from the official registry.
- PulseMCP says it picks up registry servers automatically. A fetch summary
  reported that new submissions are paused; its site blocked a direct check
  on 2026-11-03, so this is unverified.
- GitHub's MCP registry: GitHub said in October 2025 that downstream
  registries pick up updates from the official one, but inclusion still went
  through partnerships@github.com. No newer statement was found.
- No primary source links the VS Code gallery to the official registry.

Check Glama and mcp.directory a few days after publishing. Nothing needs to
be submitted to them.

## Listing content

Use this text for every store, with the store-specific changes noted in each
section. Do not mention price, "free" or providers' billing in ChatGPT
listings: its guidelines forbid any mention of pricing.

| Field | Value |
| --- | --- |
| Name | Besidka |
| One-liner (Claude, up to 200) | Read and organise your Besidka chats, projects, project knowledge, memory, files and settings from Claude. |
| Short description (ChatGPT, up to 30) | Chats, projects and memory |
| Server description (registry, up to 100) | Besidka models, providers and key guides, plus your chats, projects, files, memory and settings. |
| Category | Productivity (Claude: also Knowledge management, if offered) |
| Website | https://besidka.com |
| Privacy policy | https://besidka.com/privacy-policy |
| Terms of use | https://besidka.com/terms-of-use |
| Support | https://github.com/besidka/besidka/issues |
| Documentation | https://github.com/besidka/besidka/blob/main/docs/mcp-server.md |
| MCP URL | https://besidka.com/mcp |
| Icon | `plugins/besidka/assets/logo.png` (512x512 PNG), also https://besidka.com/web-app-manifest-512x512.png; SVG at https://besidka.com/favicon.svg |
| Authentication | OAuth 2.1, authorization code with PKCE S256, dynamic client registration; public tools need no sign-in |

Long description (Claude up to 2000, ChatGPT up to 4000):

> Work with your Besidka account from your assistant. Find and read your
> chats, organise them into projects, add notes and text to project
> knowledge, review and edit what Besidka remembers, save and read text
> files, and change your Besidka settings. Every action uses your own
> Besidka data after you sign in and approve each permission, and deleting
> anything needs a separate permission. Public tools, which need no sign-in,
> list the models and providers Besidka supports and link to step-by-step
> guides for getting a provider key.

For Claude, which allows it, add one sentence: "Besidka is an open-source
chat app where you use your own provider API keys; the connector never reads
or returns those keys."

Example prompts:

1. List my five most recent Besidka chats.
2. Summarize my Besidka chat about the trip plan.
3. Add a note called Reviewer check to my Besidka project Demo.
4. What does Besidka remember about me?
5. Which Besidka models support reasoning?

### Tools and scopes

Four public tools need no token: `list_models`, `list_providers`,
`get_key_guide`, `get_page`. The 32 private tools need these scopes; the
consent page lets the user approve each scope separately.

| Scope | Tools |
| --- | --- |
| `chats:read` | `list_chats`, `get_chat`, `list_shared_chats` |
| `chats:write` | `update_chat`, `move_chats_to_project`, `revoke_chat_shares`, `branch_chat` |
| `projects:read` | `list_projects`, `get_project`, `read_project_knowledge_item` |
| `projects:write` | `create_project`, `update_project_instructions`, `add_project_note`, `add_project_text`, `update_project`, `update_project_knowledge_item` |
| `memory:read` | `list_memory` |
| `memory:write` | `add_memory`, `update_memory` |
| `files:read` | `list_files`, `read_file` |
| `files:write` | `create_file`, `rename_file` |
| `settings:read` | `get_settings` |
| `settings:write` | `update_settings` |
| `data:delete` | `delete_chats`, `delete_chat_message`, `delete_project`, `delete_project_knowledge_items`, `delete_files`, `delete_memory`, `reset_memory` |

Identity scopes: `openid`, `profile`, `email`, `offline_access`. Every tool
has a `title` and explicit `readOnlyHint`, `destructiveHint`,
`idempotentHint` and `openWorldHint` annotations, which the Claude and
ChatGPT reviews require. `delete_project` also needs `confirmName` and
`reset_memory` needs `confirm: true`.

What the connector does not do, useful for compliance questions: it sends no
chat messages and runs no model, so it spends nothing on the user's provider
keys; it never reads, returns or stores provider API keys; it does no
payments, no image, audio or video generation, and no ads. The full list is
"What MCP does not do (and why)" in `docs/mcp-server.md`.

### Reviewer test account

Claude, ChatGPT and Google all ask for a reviewer account with sample data.
Rules that apply to all three: no two-factor authentication, no email or SMS
codes, no magic links, no sign-up during review.

- Create a dedicated account, for example `reviewer@besidka.com`, with a
  password, and leave 2FA off.
- Seed it with a project named `Demo`, two or three chats (one about a trip
  plan, to match the example prompts), a few memory entries and one text file.
- Do not add provider keys to it. The connector does not need them.
- Sign-in has a Turnstile challenge. It is usually invisible, but a reviewer
  on an unusual network may see a check. Mention it in the reviewer notes.
- Give the credentials only in each store's private reviewer form, never in
  the repo or the plugin ZIP.
- `list_models` returns each model's price per million tokens, because that
  is what a user choosing a model needs. ChatGPT's no-pricing rule covers the
  listing text, not tool output, but say in the reviewer notes that these are
  the providers' public prices and Besidka charges nothing.

## Claude connector directory

- Submit: https://claude.ai/directory/manage, then Submit new, then MCP
  connector. Docs: https://claude.com/docs/connectors/building/submission,
  review criteria https://claude.com/docs/connectors/building/review-criteria,
  policy https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy.
- Who: anyone on a paid Claude plan (Pro, Max, Ultra, Team, Enterprise). No
  partner program, fee, business verification or postal address is
  documented. The form has a "Company" step; how it treats an individual is
  not documented, so enter "Besidka" and the website.
- Authentication: choose dynamic client registration (`oauth_dcr`) and the
  lazy option, "Required when the server asks". Besidka already answers 401
  only on private `tools/call` requests, which is what Claude expects.
  Redirect URIs need no allowlist change: Besidka's DCR accepts the
  client's own `redirect_uris` (`https://claude.ai/api/mcp/auth_callback`
  and the Claude Code loopback ones).
- Anthropic's servers call from `160.79.104.0/21`. The WAF and the `/mcp`
  rate limit are covered in `docs/agent-readiness.md`; claude.ai already
  connects in production.
- Review: an automated scan, then a Community listing by default; some
  connectors get a human review, and Anthropic may promote popular ones to
  Verified. No timeline is published. Contact: mcp-review@anthropic.com.
- Compliance step, seven acknowledgments. Besidka's answers: it follows the
  directory guidelines; it calls only its own first-party API; it moves no
  money; it generates no images, audio or video through the connector; tool
  descriptions contain no instructions to the model; it collects no Claude
  conversation data beyond the tool arguments; public documentation is at
  the documentation URL above.

## ChatGPT plugin directory

- Docs: https://developers.openai.com/plugins/deploy/submission and the
  guidelines at https://developers.openai.com/apps-sdk/app-submission-guidelines.
  Submit at https://platform.openai.com, Plugins, Upload new or existing
  plugin.
- Who: a verified individual or organisation. Individual verification needs
  a government ID and possibly a selfie, with no company and no address
  (https://help.openai.com/en/articles/10910291-api-organization-verification).
  Business verification needs a registered address, so use the individual
  path. No fee is stated.
- Package: `plugins/besidka/` holds `plugin.json` (Agent Plugins format with
  the `com.openai` extension: listing text, test cases, release notes) and
  `mcp.json`. Build the ZIP as described in `plugins/besidka/README.md`.
  Before zipping, add `demo_recording_url` under
  `extensions["com.openai"].review` once the demo video exists. Do not
  commit the URL if the video should stay private.
- Domain verification: OpenAI shows a token that must be served as plain text
  at `https://besidka.com/.well-known/openai-apps-challenge`. The route reads
  it from the Worker secret `NUXT_OPENAI_APPS_CHALLENGE` and answers 404
  while it is empty. The token is public by design (like the IndexNow key in
  `docs/seo.md`); a secret is used only so it is not committed. Set it with
  `pnpm wrangler secret put NUXT_OPENAI_APPS_CHALLENGE --env production`,
  and make sure WAF step 1c is applied.
- OAuth: DCR is accepted. Besidka's authorization server advertises
  `authorization_response_iss_parameter_supported: true` (RFC 9207), so
  ChatGPT uses the stable redirect URI
  `https://chatgpt.com/connector_platform_oauth_redirect`; no allowlist change
  is needed. ChatGPT sends `resource=https://besidka.com/mcp` and expects the
  token audience to match. That binding has not been tested against
  ChatGPT; check it on the first Connect in the portal.
- Review inputs: five positive and three negative test cases (already in
  `plugin.json`), a demo video URL, release notes (in `plugin.json`), the
  reviewer account. No timeline is published. After approval the owner
  clicks Publish. OpenAI rescans the server daily; new tools stay hidden
  until approved.

## Cursor

- Marketplace: apply at https://cursor.com/marketplace/publish (sign-in
  required). Every plugin is reviewed by hand, plugins must be open source,
  and Cursor says it currently works with "a small group of trusted
  partners", so an individual may wait. Forum replies from Cursor staff in
  July and October 2026 disagree on whether the form or cursor.directory is
  the current intake; the docs still point at the form.
- Repo side: `.cursor-plugin/marketplace.json` at the repo root lists one
  plugin, `plugins/besidka/`. It carries both manifests: the Cursor Plugin
  manifest `.cursor-plugin/plugin.json` (what a marketplace entry resolves
  to) and the Agent Plugins `plugin.json`, plus `mcp.json`, the logo and the
  README. Submit the repository URL
  `https://github.com/besidka/besidka`.
- cursor.directory: submit at https://cursor.directory/plugins/new with a
  GitHub sign-in. It is a community list; staff said review takes up to two
  weeks.
- OAuth: Cursor uses DCR with its fixed redirect URIs
  (`https://www.cursor.com/agents/mcp/oauth/callback` and
  `http://localhost:8787/callback`). Besidka accepts them without changes.
- Without any listing, users add Besidka with the `mcp.json` entry in
  `plugins/besidka/README.md`.

## Google Connected Apps (Gemini and AI Mode)

- Docs: https://developers.google.com/connected-apps and
  https://developers.google.com/connected-apps/mcp. Apply through the
  preview interest form at https://connected.google.com/console/help/?apply.
  Google's launch post (2026-10-28) says access opens in phases.
  TechCrunch, not Google, says the preview is for US developers on a
  waitlist.
- Who: not documented. The prerequisites only ask for a Connected Console
  developer account and acceptance of the Connected Apps Terms of Service.
  The policy requires disclosing identity, ownership, purpose and country of
  origin. No postal address is mentioned.
- Fit: the private tools fit the Productivity category ("notes and knowledge
  bases"). Google says signed-out generic information does not qualify, so
  the four public tools will not count. There is no AI chat category.
- Technical: Streamable HTTP, OAuth with PKCE and DCR (recommended), Google's
  redirect URIs under `oauth-redirect.googleusercontent.com` (Besidka's DCR
  takes them as registered). Domain verification serves a JSON token at
  `/.well-known/google-connected-apps`, which needs a new route and a WAF
  entry once Google sends the token. Assets: 512 px icon, a description under
  30 words, at least three capabilities and three example prompts, a test
  account.

## Stores that do not fit

### Grok connectors

xAI documents built-in connectors, a catalog of pre-configured OAuth
connectors and custom MCP servers (https://docs.x.ai/grok/connectors). No
catalog submission process exists and nothing says the official registry
feeds it. The "644 connectors" figure is in no official source. Users add
Besidka themselves: grok.com/connectors, New Connector, Custom, URL
`https://besidka.com/mcp`, then sign in. The Grok Build plugin marketplace
(https://github.com/xai-org/plugin-marketplace) takes PRs, but it serves
the Grok Build CLI, not grok.com.

### Meta Muse

Meta has a connector platform at https://platform.muse.ai. Its guidelines
(section 5.2) require business information and evidence "to verify your
organization and your authority to submit the connector", plus a work email
sign-in. That does not fit an individual without a registered business who
does not publish an address. The count of 63 connectors is third-party
reporting only.

### Microsoft 365 Copilot Agent Store

Partner Center enrollment needs a registered legal business name and number
and business verification
(https://learn.microsoft.com/en-us/partner-center/account-settings/create-account).
The MCP certification intake (updated 2026-11-02) does not support DCR and
needs a static client id and secret
(https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-certification).
Besidka could issue a static client, but the business requirement blocks it
first.

### Salesforce AgentExchange

Salesforce announced an "ISV MCP Tool Action" listing type in April 2026, but
listing goes through the partner program: the Partner Community, a
partner agreement, business and technology approval and a company security
program
(https://developer.salesforce.com/docs/platform/isvforce/guide/appexchange-partner-join.html).
A free listing waives only the security review fee. Nothing documents a path
for an individual.

### AWS Marketplace, AI Agents and Tools

The product type fits ("MCP Server" under API-based AI agents, $0 allowed),
but AWS states that sole proprietors and freelancers without a registered
business cannot pass business verification
(https://docs.aws.amazon.com/partner-central/latest/getting-started/verification-process.html).
Free listings go through the same step.

## Owner checklist

In this order:

1. Merge the PR that adds `server.json`, the two `.well-known` routes and the
   plugin, and wait for the production deploy.
2. Apply WAF step 1c in `docs/agent-readiness.md` (two exact paths), then run
   its check commands.
3. Store the registry private key, handed over outside the repo on
   2026-11-03, at `~/.config/besidka/mcp-registry-ed25519.pem` (mode `600`)
   and in the password manager. If it is gone, make a new pair as described
   in [The signing key](#the-signing-key) first.
4. Publish to the official MCP Registry with the commands in
   [Publishing](#publishing) and check the entry.
5. Create the reviewer account described in
   [Reviewer test account](#reviewer-test-account).
6. Record a short demo video (connect, sign in, approve scopes, run two read
   tools and one write tool).
7. Claude: submit at https://claude.ai/directory/manage with the
   [Listing content](#listing-content) and the answers in
   [Claude connector directory](#claude-connector-directory).
8. ChatGPT: verify as an individual at https://platform.openai.com
   (organization settings), set `NUXT_OPENAI_APPS_CHALLENGE` to the token
   OpenAI shows, add `demo_recording_url`, build the ZIP, upload, connect,
   enter the reviewer account and submit.
9. Cursor: apply at https://cursor.com/marketplace/publish with the
   repository URL, and submit at https://cursor.directory/plugins/new.
10. Google: fill the interest form at
    https://connected.google.com/console/help/?apply. When access comes, ask
    for the `/.well-known/google-connected-apps` route.
11. A few days after step 4, check that Besidka shows up on Glama and
    mcp.directory.

Skip Grok, Meta Muse, Microsoft 365, Salesforce and AWS until the reason in
[Stores that do not fit](#stores-that-do-not-fit) changes.
