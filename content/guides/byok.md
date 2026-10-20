---
title: "BYOK: use GPT, Claude and Gemini with your own API key"
description: "How to use GPT, Claude and Gemini with your own API key in Besidka, a BYOK AI chat app: a free Gemini API key without a card, adding keys, cost and key storage."
updatedAt: 2026-10-20
summary: 'Besidka is a BYOK AI chat app: you paste an API key from an AI provider such as OpenAI, Anthropic or Google into Besidka. Your chats run on that key, the provider bills you directly at its published API rates, and Besidka charges nothing on top. A free Gemini key from Google AI Studio needs no card.'
---

## What BYOK means

BYOK stands for "bring your own key". An AI provider such as OpenAI, Anthropic or Google gives you an API key: a secret string that lets an application call the provider's models on your account. A BYOK chat app is the interface; the key decides whose account the usage is billed to.

In Besidka that means:

- You chat with GPT, Claude, Gemini, Grok, DeepSeek, Kimi or Qwen models in one interface, using a key from the matching provider.
- Each message is billed by the provider to your own account, at the provider's published API rates.
- Besidka has no subscription, no seat fee and no markup on provider usage.

BYOK is an alternative to a flat monthly subscription such as ChatGPT Go or ChatGPT Plus. With a subscription you pay a fixed fee whatever you use. With your own key you pay for each message and can see its price.

## Using ChatGPT with your own API key

The ChatGPT app itself does not accept an API key. A ChatGPT subscription and OpenAI API billing are two separate products with separate accounts and billing, so paying for one gives you nothing on the other.

What does work: an OpenAI API key lets a BYOK app such as Besidka call the same GPT models that ChatGPT uses, and OpenAI bills you per use. You pay for credit in advance in the OpenAI developer console. As of 2026-10-20 the minimum purchase is $5 ([OpenAI help](https://help.openai.com/en/articles/8264778)), and there is no standing free credit.

What does not carry over: features that belong to the ChatGPT app, such as its voice mode and its own apps. Besidka has its own chat features, listed on the [home page](/).

To start, create a key on the [OpenAI API keys page](https://platform.openai.com/api-keys) and follow the steps below.

## What you need

- A Besidka account, free, with email and password, Google or GitHub sign-in.
- An API key from at least one supported provider. Most providers need a payment method or prepaid credit on their side before the API accepts requests. The exception is Google AI Studio, which gives you a Gemini API key on a free tier without a card.

## How to get a free Gemini API key without a card

Google AI Studio is the easiest way to get a first key. You need a Google account. You do not need a card or a billing account.

1. Open the [Google AI Studio API keys page](https://aistudio.google.com/apikey).
2. Sign in with a Google account and accept the terms if asked.
3. Create a key, or copy the one AI Studio created for you after you accepted the terms.
4. In Besidka, open **Profile → API Keys** and find the **Google AI Studio** card. Paste the key and save.
5. Open a new chat and pick a Gemini model.

**Free tier caveat.** On the free tier, Google may use your prompts and responses to improve its products. Do not send anything sensitive on the free tier. Moving to the paid tier, which needs a billing account (new accounts start on prepaid credit), stops that, because Google does not use paid-tier content to improve its products. The free tier also has rate limits, so heavy use will hit them.

Checked 2026-10-20 against Google's [billing](https://ai.google.dev/gemini-api/docs/billing), [terms](https://ai.google.dev/gemini-api/terms) and [pricing](https://ai.google.dev/gemini-api/docs/pricing) pages. Those terms can change, so read them before you rely on them.

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
| Qwen | Qwen Cloud | [home.qwencloud.com/api-keys](https://home.qwencloud.com/api-keys) |

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
- OpenRouter also offers some free models, with IDs ending in `:free`. As of 2026-10-20 they are limited to 50 requests a day if you have bought less than $10 of credit and 1,000 a day with $10 or more, at 20 requests a minute ([OpenRouter limits](https://openrouter.ai/docs/api-reference/limits)). OpenRouter charges a 5.5% fee when you buy credit ([pricing](https://openrouter.ai/pricing)).

## Get started

[Create a free account](/signup), add one API key, and send your first message. For the rest of the product, see the [home page](/).
