---
title: How to get a free Gemini API key in Google AI Studio
description: 'Get a free Gemini API key in Google AI Studio, no card needed. Free-tier limits, how Google uses free-tier prompts, and using the key in Besidka.'
provider: google
keyUrl: https://aistudio.google.com/api-keys
keyUrlLabel: Open Google AI Studio keys page
updatedAt: '2026-10-27'
checkedAt: '2026-10-20'
summary: The free tier needs no card. You can start chatting with Gemini in about a minute.
video:
  src: /videos/key-guide-google.mp4?v=3
  poster: /key-guides/google.webp?v=3
  duration: PT34S
  uploadDate: '2026-10-26'
  alt: Screen recording of Google AI Studio. The API Keys page, the Create a new key dialog, the API key details dialog with a masked key, then the key pasted into Besidka and a first answer from Gemini.
  qualities:
    - src: /videos/key-guide-google-1080.mp4?v=3
      size: 1080
    - src: /videos/key-guide-google.mp4?v=3
      size: 720
    - src: /videos/key-guide-google-360.mp4?v=3
      size: 360
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
    - label: Gemini API rate limits
      url: https://ai.google.dev/gemini-api/docs/rate-limits
faq:
  - question: 'Why does my Gemini API key not work?'
    answer: 'Every Gemini API key belongs to a Google Cloud project. The Gemini API rejects unrestricted standard keys, and since 7 May 2026 it also blocks unrestricted keys that have not been used for a long time. Since 28 May 2026, new keys created in Google AI Studio are authorization keys by default. If an older key stops working, create a new one on the Google AI Studio keys page.'
  - question: 'What are the Gemini API free tier limits?'
    answer: 'Limits apply to your Google Cloud project, not to each key. Google counts requests per minute, tokens per minute and requests per day, and daily quotas reset at midnight Pacific time. Google AI Studio shows the current limits for your project.'
  - question: 'Can I use a Gemini API key in a chat app?'
    answer: 'Yes. In Besidka, go to Profile, API Keys, open the Google AI Studio card, paste the key and click Save. Then start a new chat and pick any Gemini model. Google bills you directly, Besidka adds no markup, and every message shows what it cost.'
---

1. Open the [Google AI Studio keys page](https://aistudio.google.com/api-keys) and sign in with your Google account. On a new account, accept the terms first.
2. Click **Create API key**.
3. In **Create a new key**, type a name such as `Besidka`, pick a project under **Choose an imported project**, and click **Create key**.
4. In **API key details**, click **Copy key**. New keys start with `AQ.`.
5. In Besidka, go to **Profile**, **API Keys**, then the **Google AI Studio** card, paste the key into **API Key**, and click **Save**.
6. Start a new chat and pick a Gemini model.

**Privacy on the free tier.** Outside the EEA, Switzerland and the UK, Google may use free-tier prompts and responses to improve its products, and human reviewers may read them. Inside those regions, Google's terms apply its paid-tier data terms to all use, including the free quota. For private work, link a billing account in AI Studio. On the paid tier, Google does not use your prompts to improve its products.
