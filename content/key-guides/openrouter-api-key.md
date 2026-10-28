---
title: How to get an OpenRouter API key
description: Create an OpenRouter API key and add it to Besidka. One key and one balance for models from many providers.
provider: openrouter
keyUrl: https://openrouter.ai/settings/keys
keyUrlLabel: Open OpenRouter keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: One key for models from many providers. Free models work before you buy credits.
video:
  src: /videos/key-guide-openrouter.mp4?v=4
  poster: /key-guides/openrouter.webp?v=4
  duration: PT45S
  uploadDate: '2026-10-26'
  alt: Screen recording of OpenRouter. The API Keys page, the Create API Key dialog with a name, expiration and credit limit, the new key shown once and masked, then the key pasted into Besidka. In a new chat the model picker opens, OpenRouter is picked in the Gateways bar, a model is chosen and a first answer follows.
  qualities:
    - src: /videos/key-guide-openrouter-1080.mp4?v=4
      size: 1080
    - src: /videos/key-guide-openrouter.mp4?v=4
      size: 720
    - src: /videos/key-guide-openrouter-360.mp4?v=4
      size: 360
  markers:
    - time: "0:00"
      label: Intro
    - time: "0:03"
      label: Open OpenRouter
    - time: "0:07"
      label: Set a credit limit
    - time: "0:14"
      label: Copy your key
    - time: "0:19"
      label: Paste into Besidka
    - time: "0:26"
      label: Pick the gateway
    - time: "0:30"
      label: Choose a model
    - time: "0:36"
      label: First answer
    - time: "0:41"
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
4. If OpenRouter shows **Verification required**, enter the code from your email and click **Continue**. Not everyone sees this step.
5. Copy the key under **Your new key**. It starts with `sk-or-v1-`, and OpenRouter shows it only once.
6. In Besidka, go to **Profile**, **API Keys**, **Gateways**, then the **OpenRouter** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and open the model picker. In the **Gateways** bar at the bottom, pick **OpenRouter**, then choose a model from the list. The **Free** category shows models that cost nothing.

**When a gateway makes sense.** Use OpenRouter when you want one key and one balance for models from many providers. If you mostly use one provider, a direct key from that provider is simpler and skips the 5.5% credit fee. OpenRouter bills models at the provider's list price.
