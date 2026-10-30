---
name: besidka-overview
description: Explains what Besidka is, an open-source bring-your-own-key AI chat app on Cloudflare Workers, which providers and features it supports, how memory and sharing work, and where its public documentation lives. Use when a user asks what Besidka is, whether it fits their needs, or how it differs from a subscription chat app.
---

# Besidka overview

Besidka (https://besidka.com) is an open-source AI chat application that runs on Cloudflare Workers. It is a bring-your-own-key (BYOK) app: the user pastes their own API keys from AI providers, each request goes from Besidka to the provider on that key, and the provider bills the user directly at its published API rates. Besidka itself is free to use and adds no markup. It is MIT-licensed and can be self-hosted on a Cloudflare account: https://github.com/besidka/besidka

## Providers

Direct providers, each with the user's own key:

- Anthropic (Claude)
- OpenAI (GPT)
- Google AI Studio (Gemini)
- xAI (Grok)
- DeepSeek
- Moonshot AI (Kimi)
- Qwen

Direct providers are the default routing path. Users can optionally add a gateway key (Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter) on the Gateways tab of the API Keys page. A gateway is always the user's explicit choice and is never used in place of a direct key.

## Features

- Model switching between messages in the same chat, across providers.
- Per-message cost breakdown: tokens used and what the message cost.
- Web search, built into some providers or through the user's own Brave Search or Exa key.
- Reasoning controls, image generation with supported models, and deep research on Google's deep research agent.
- Projects with their own files, notes and memory.
- Memory the user can read, edit, export and delete, plus optional search across past chats.
- Shareable read-only chat links that can be opened without an account.
- A file manager for uploaded and generated files.
- Installable as a PWA, with push notifications.
- Optional smart checks on a user-supplied TypeSafe AI key.

## Privacy and data handling

- API keys are encrypted before they are stored, are never sent back to the browser, and are decrypted on the server only to call the provider the key belongs to.
- Memory is something the user controls: nothing runs in the background on the user's key until they switch it on.
- The hosted version stores chats on Cloudflare, scoped to the signed-in account. Self-hosting keeps them in the operator's own Cloudflare account.

## Where to read more

- Bring your own key, cost and key storage: https://besidka.com/byok
- How memory works: https://besidka.com/memory
- Step-by-step guides for getting an API key from each provider: https://besidka.com/guides/gemini-api-key and the other pages listed in the `besidka-byok-setup` skill.
- Machine-readable index of the public pages: https://besidka.com/llms.txt
- Every public page is also available as markdown: append `.md` to its URL or send `Accept: text/markdown`.
- MCP server (Streamable HTTP): https://besidka.com/mcp. Its server card is https://besidka.com/.well-known/mcp/server-card.json. The public read-only tools need no authentication and are four: `list_models` (the model catalog with prices and capabilities), `list_providers` (the providers, gateways and web search services with their key dashboards), `get_key_guide` (the step-by-step API key guide for a provider) and `get_page` (a public page as markdown).

The same server also offers per-user tools. They need an OAuth 2.1 access token for a signed-in Besidka user: authorization code with PKCE (S256), after dynamic client registration. Without a token those tools answer `401` with a `WWW-Authenticate` header that points at https://besidka.com/.well-known/oauth-protected-resource/mcp, and the authorization server metadata is at https://besidka.com/.well-known/oauth-authorization-server. The user signs in and approves the request on a consent page. Scopes: `openid`, `profile`, `email`, `offline_access`, `chats:read`, `projects:read`, `memory:read`, `projects:write`, `memory:write`, `files:read`, `settings:read`, `chats:write`, `files:write`, `settings:write` and `data:delete` (permanent deletion, off unless the user ticks it). Ask only for what the task needs. Besidka does not let agents create accounts or register themselves: see https://besidka.com/auth.md.

Besidka's product documentation and blog are planned as separate sites with their own llms.txt files. They are not published yet, so do not cite them as existing pages.

## Limits of this skill

This skill describes the public site. Besidka has no public REST API. The application endpoints are authenticated and private to signed-in users, and an agent must not call them directly. To read or change a user's own data, an agent either uses the OAuth-protected MCP tools above with the user's consent, or guides the user through the steps in the application.
