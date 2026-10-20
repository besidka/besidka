---
title: How to get an OpenRouter API key
description: Create an OpenRouter API key and add it to Besidka. One key and one balance for models from many providers.
provider: openrouter
keyUrl: https://openrouter.ai/settings/keys
keyUrlLabel: Open OpenRouter keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: One key for models from many providers. Free models work before you buy credits.
video:
  src: /videos/key-guide-openrouter.mp4
  poster: /key-guides/openrouter.webp
  duration: PT38S
  uploadDate: '2026-10-20'
  alt: Screen recording of OpenRouter. The API Keys page, the Create API Key dialog with a name, expiration and credit limit, the email verification step, the new key shown once and masked, then the key pasted into Besidka and a first answer.
  markers:
    - time: "0:00"
      label: "One key, many models"
    - time: "0:03"
      label: New Key
    - time: "0:07"
      label: Name and credit limit
    - time: "0:13"
      label: Email code
    - time: "0:16"
      label: Copy your key
    - time: "0:21"
      label: Paste into Besidka
    - time: "0:28"
      label: First answer
    - time: "0:34"
      label: Done
requirements:
  card: false
  cardNote: Only to buy credits. Free models work without a card.
  minimumTopUp: $5 per purchase, plus a 5.5% card fee ($0.80 minimum).
  freeTier: 'Yes. Free models: 50 requests a day, or 1,000 a day once you have bought $10 in credits.'
  sources:
    - label: OpenRouter API keys
      url: https://openrouter.ai/docs/api-reference/authentication
    - label: OpenRouter rate limits for free models
      url: https://openrouter.ai/docs/api-reference/limits
    - label: OpenRouter FAQ (fees and logging)
      url: https://openrouter.ai/docs/faq
    - label: OpenRouter pricing
      url: https://openrouter.ai/pricing
    - label: OpenRouter terms (minimum purchase)
      url: https://openrouter.ai/terms
---

1. Open the [OpenRouter keys page](https://openrouter.ai/settings/keys) and sign in.
2. Click **New Key**.
3. In **Create API Key**, type a **Name** such as `Besidka` and pick an **Expiration**. Under **Credit limit**, choose **Custom amount** and enter `5`, then click **Create**. The limit caps what this key can spend, and $5 lasts a long time for everyday chats.
4. If OpenRouter shows **Verification required**, enter the code from your email and click **Continue**.
5. Copy the key under **Your new key**. It starts with `sk-or-v1-`, and OpenRouter shows it only once.
6. In Besidka, go to **Profile**, **API Keys**, **Gateways**, then the **OpenRouter** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick a model from the OpenRouter list. The **Free** category shows models that cost nothing.

**When a gateway makes sense.** Use OpenRouter when you want one key and one balance for models from many providers. If you mostly use one provider, a direct key from that provider is simpler and skips the 5.5% credit fee. OpenRouter bills models at the provider's list price.
