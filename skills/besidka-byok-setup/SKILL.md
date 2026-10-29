---
name: besidka-byok-setup
description: Walks a user through getting an AI provider API key and adding it to Besidka at Profile, API Keys, with links to the per-provider guides and notes on cost, the free Gemini route and key storage. Use when a user wants to start chatting in Besidka, asks how to get an OpenAI, Anthropic, Gemini, Grok, DeepSeek, Kimi or Qwen key, or asks how bring-your-own-key billing works.
---

# Set up a provider key in Besidka

Besidka is a bring-your-own-key chat app. The user needs one API key from one provider to start. The provider bills the user directly at its published API rates, and Besidka adds no fee or markup.

## Steps

1. Pick a provider and create an API key in that provider's developer console using the guide below. Treat the key like a password. Most providers need a payment method or prepaid credit first.
2. Sign in to Besidka (https://besidka.com/signin, or https://besidka.com/signup for a free account).
3. Open Profile, then API Keys. On the Direct Providers tab, paste the key into the card for that provider and click Save.
4. Open a new chat and pick a model from that provider in the model picker. Models whose provider has no key stay disabled until a key is added.

Besidka stores one key per provider per account. To replace a key, save a new one over it. To remove it, delete it from the same card.

## Cheapest way to start

A Gemini API key from Google AI Studio has a free tier and needs a Google account but no card or billing account: https://besidka.com/guides/gemini-api-key. Outside the EEA, Switzerland and the UK, Google may use free-tier prompts to improve its products, so the user should not send sensitive content on the free tier. The free tier has rate limits.

## Provider guides

Each guide has the exact console steps, what it costs to start and what to know about data handling.

| Model family | Provider | Guide |
| --- | --- | --- |
| Claude | Anthropic | https://besidka.com/guides/claude-api-key |
| GPT | OpenAI | https://besidka.com/guides/openai-api-key |
| Gemini | Google AI Studio | https://besidka.com/guides/gemini-api-key |
| Grok | xAI | https://besidka.com/guides/grok-api-key |
| DeepSeek | DeepSeek | https://besidka.com/guides/deepseek-api-key |
| Kimi | Moonshot AI | https://besidka.com/guides/kimi-api-key |
| Qwen | Qwen | https://besidka.com/guides/qwen-api-key |

DeepSeek, Moonshot AI and Qwen process messages outside the EU. After saving one of those keys, Besidka asks the user to confirm with an explicit consent checkbox before it adds the key.

## Optional extra keys

These are not needed to chat.

| Purpose | Where in Besidka | Guide |
| --- | --- | --- |
| Web search through Brave Search | Profile, API Keys, Search Providers | https://besidka.com/guides/brave-search-api-key |
| Web search through Exa | Profile, API Keys, Search Providers | https://besidka.com/guides/exa-api-key |
| OpenRouter gateway | Profile, API Keys, Gateways | https://besidka.com/guides/openrouter-api-key |
| Vercel AI Gateway | Profile, API Keys, Gateways | https://besidka.com/guides/vercel-ai-gateway-api-key |
| Cloudflare AI Gateway | Profile, API Keys, Gateways | https://besidka.com/guides/cloudflare-workers-ai-api-key |
| TypeSafe AI smart checks | Profile, API Keys, Smart checks | https://besidka.com/guides/typesafe-ai-api-key |

Gateways are always optional and user-selected. A direct provider key is never routed through a gateway.

## Cost and key storage

- Cost: the provider bills per input and output token, and where it applies per generated image or web search. Each assistant message shows the tokens it used and what it cost. The provider's console is the source of truth for what was charged, and spend limits are set there.
- Storage: a key is encrypted with AES-256-GCM before it is written to the database, is never sent back to the browser after saving, and is decrypted on the server only to call the provider on the user's behalf. Self-hosting on the user's own Cloudflare account is the option for users who prefer not to trust the hosted instance with a key.

Full explanation of cost, caching and key storage: https://besidka.com/byok
