---
title: How to get a Google AI Studio (Gemini) API key
description: Create a free Gemini API key in Google AI Studio and add it to Besidka. No card needed for the free tier.
provider: google
keyUrl: https://aistudio.google.com/api-keys
keyUrlLabel: Open Google AI Studio keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: The free tier needs no card. You can start chatting with Gemini in about a minute.
video:
  src: /videos/key-guide-google.mp4
  poster: /key-guides/google.webp
  duration: PT34S
  uploadDate: '2026-10-20'
  alt: Screen recording of Google AI Studio. The API Keys page, the Create a new key dialog, the API key details dialog with a masked key, then the key pasted into Besidka and a first answer from Gemini.
  markers:
    - time: "0:00"
      label: Get a free Gemini key
    - time: "0:03"
      label: Create API key
    - time: "0:07"
      label: Name the key
    - time: "0:12"
      label: Copy your key
    - time: "0:17"
      label: Paste into Besidka
    - time: "0:24"
      label: First answer
    - time: "0:30"
      label: Done
requirements:
  card: false
  cardNote: Not for the free tier. No billing account needed.
  minimumTopUp: None on the free tier. The paid tier uses prepaid credits from $5.
  freeTier: Yes. Most Gemini Flash and Flash-Lite models, with daily rate limits.
  sources:
    - label: Gemini API keys
      url: https://ai.google.dev/gemini-api/docs/api-key
    - label: Gemini API billing
      url: https://ai.google.dev/gemini-api/docs/billing
    - label: Gemini API pricing
      url: https://ai.google.dev/gemini-api/docs/pricing
    - label: Gemini API terms (How Google Uses Your Data)
      url: https://ai.google.dev/gemini-api/terms
---

1. Open the [Google AI Studio keys page](https://aistudio.google.com/api-keys) and sign in with your Google account. On a new account, accept the terms first.
2. Click **Create API key**.
3. In **Create a new key**, type a name such as `Besidka`, pick a project under **Choose an imported project**, and click **Create key**.
4. In **API key details**, click **Copy key**. New keys start with `AQ.`.
5. In Besidka, go to **Profile**, **API Keys**, then the **Google AI Studio** card, paste the key into **API Key**, and click **Save**.
6. Start a new chat and pick a Gemini model.

**Privacy on the free tier.** Google may use free-tier prompts and responses to improve its products, and human reviewers may read them. For private work, link a billing account in AI Studio. On the paid tier, Google does not use your prompts to improve its products.
