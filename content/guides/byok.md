---
title: "BYOK: use GPT, Claude and Gemini with your own API key"
description: What BYOK (bring your own key) means, how to use GPT, Claude, Gemini and other models with your own API key in Besidka, how cost works, and where keys are stored.
updatedAt: 2026-10-11
summary: BYOK means you paste an API key from an AI provider such as OpenAI, Anthropic or Google into Besidka. Your chats run on that key, the provider bills you directly at its published API rates, and Besidka charges nothing on top.
---

## What BYOK means

BYOK stands for "bring your own key". An AI provider such as OpenAI, Anthropic or Google gives you an API key: a secret string that lets an application call the provider's models on your account. A BYOK chat app is the interface; the key decides whose account the usage is billed to.

In Besidka that means:

- You chat with GPT, Claude, Gemini, Grok, DeepSeek, Kimi or Qwen models in one interface, using a key from the matching provider.
- Each message is billed by the provider to your own account, at the provider's published API rates.
- Besidka has no subscription, no seat fee and no markup on provider usage.

BYOK is an alternative to a flat monthly subscription such as ChatGPT Plus. A ChatGPT subscription and OpenAI API usage are two separate products with separate billing, so an API key is needed either way for a BYOK app, and a subscription is not.

## What you need

- A Besidka account, free, with email and password, Google or GitHub sign-in.
- An API key from at least one supported provider, with billing or prepaid credit set up on that provider's side. Most providers need a payment method before the API accepts requests.

## Step by step

### 1. Get an API key from a provider

Create a key in the provider's developer console. Treat it like a password: anyone who has it can spend on your account.

| Models | Provider | Where to create a key |
| --- | --- | --- |
| GPT | OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Claude | Anthropic | [platform.claude.com](https://platform.claude.com/settings/workspaces/default/keys) |
| Gemini | Google AI Studio | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| Grok | xAI | [console.x.ai](https://console.x.ai/team/default/api-keys) |
| DeepSeek | DeepSeek | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| Kimi | Moonshot AI | [platform.kimi.ai](https://platform.kimi.ai/console/api-keys) |
| Qwen | Alibaba Cloud Model Studio | the Model Studio console, API keys page |

You only need one provider to start. Add others later if you want to switch between them.

### 2. Add the key in Besidka

1. Sign in and open **Profile → API Keys**.
2. On the **Direct Providers** tab, paste the key into the card for that provider and save.
3. To replace a key, save a new one over it. To remove it, delete it from the same card.

Besidka stores one key per provider for each account.

### 3. Pick a model and chat

Open a new chat and choose a model from the model picker. Models from providers you have a key for are ready to use; the others are disabled until you add a key. You can switch models between messages in the same chat.

## How cost works

### You pay the provider directly

Every request goes from Besidka to the provider on your key, so the provider bills your account at its own published API rates: per input token, per output token and, where it applies, per generated image or per web search. Besidka adds no fee and no markup, and the hosted version at besidka.com is free to use. The provider's console is the source of truth for what you were charged; set any usage limits or budgets there.

### Per-message cost breakdown

Each assistant message has a menu showing the tokens it used and what it cost: the cost of that message, any web search cost, the running cost of the chat up to that message, and the chat total. For direct provider keys, costs are calculated from the token counts the provider reports and the model's published per-token prices, so treat them as a close guide and your provider's console as the final word. A figure starting with `~` is an estimate, for example a web search cost, or a gateway cost the gateway did not report back.

### Prompt caching

In a long chat, every new message resends the earlier conversation. Providers can cache that repeated part and bill cached input tokens at a fraction of the normal input price. Besidka turns this on where a provider needs it: Anthropic requires an explicit switch, which Besidka sets for you, and OpenAI gets a per-chat routing hint so repeated requests are more likely to hit the cache. Google, xAI, DeepSeek, Moonshot AI and Qwen cache repeated prompts on their own. The cost breakdown accounts for cached tokens.

### Other things that can cost money

- **Web search.** A model's built-in web search is billed by the provider. If you add your own Brave Search or Exa key, those searches are billed by Brave or Exa.
- **Image generation.** Billed by the provider at its published image prices.
- **Deep research.** Runs on Google's deep research agent with your Google key and is billed by Google.

## Where your keys are stored

- Before a key is written to the database it is encrypted with AES-256-GCM. The encryption key is derived from a server-side secret that is not stored in the database.
- After you save a key, it is never sent back to your browser. The API Keys page only shows whether a key is saved.
- The key is decrypted on the server only to make a request to that provider on your behalf.
- Deleting a key, or deleting your account, removes it from the database.

Any server-side BYOK app has to decrypt your key in order to call the provider with it, and Besidka is no exception. If you would rather not trust the hosted instance with your keys, [self-host Besidka](https://github.com/besidka/besidka) on your own Cloudflare account. It is open source under the MIT license, so you can also read exactly how keys are handled.

## Gateways: an optional routing layer

Instead of, or alongside, direct provider keys, you can connect your own account with an AI gateway: Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter. Add the gateway key on the **Gateways** tab of **Profile → API Keys**, and the models that gateway offers your account appear in the model picker as gateway models.

- Gateways are always your choice. Direct provider keys are the default and are never routed through a gateway.
- When you use a gateway model, the gateway bills you at its own rates, which can differ from the provider's direct prices.
- A gateway is useful when you already have an account there, or want one key for many providers.

## Get started

[Create a free account](/signup), add one API key, and send your first message. For the rest of the product, see the [home page](/).
