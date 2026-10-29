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

Besidka's product documentation and blog are planned as separate sites with their own llms.txt files. They are not published yet, so do not cite them as existing pages.

## Limits of this skill

This skill describes the public site. It does not expose an API: the application endpoints are authenticated and private to signed-in users. To act on a user's behalf an agent should guide the user through the steps in the application rather than calling private endpoints.
