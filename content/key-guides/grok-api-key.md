---
title: How to get an xAI (Grok) API key
description: Create an xAI API key for Grok and add it to Besidka. Prepaid credits, billed to you directly.
provider: xai
keyUrl: https://console.x.ai/team/default/api-keys?create=api-key
keyUrlLabel: Open xAI console keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: Add a small prepaid balance, create a key in the xAI console, and chat with Grok.
video:
  src: /videos/key-guide-xai.mp4?v=2
  poster: /key-guides/xai.webp?v=2
  duration: PT34S
  uploadDate: '2026-10-26'
  alt: Screen recording of the xAI console. The API Keys page, the Create API key dialog with a name, the new key shown once, then the key pasted into Besidka and a first answer from Grok.
  qualities:
    - src: /videos/key-guide-xai-1080.mp4?v=2
      size: 1080
    - src: /videos/key-guide-xai.mp4?v=2
      size: 720
    - src: /videos/key-guide-xai-360.mp4?v=2
      size: 360
  markers:
    - time: "0:00"
      label: Intro
    - time: "0:03"
      label: Create key
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
  card: true
  cardNote: Yes, to buy prepaid credits.
  minimumTopUp: No general minimum is documented. Auto top-up starts at $5. Start with $5.
  freeTier: None documented.
  sources:
    - label: xAI console billing
      url: https://docs.x.ai/console/billing
    - label: xAI billing FAQ
      url: https://docs.x.ai/console/faq/billing
---

1. Open the [xAI console keys page](https://console.x.ai/team/default/api-keys?create=api-key) and sign in.
2. Add prepaid credits under billing before you create a key. xAI rejects requests once the balance reaches zero. Start with $5, and if you turn on auto top-up, keep its amount at $5.
3. Click **Create API key**.
4. Type a name such as `Besidka`. **Advanced settings** are optional. Click **Create API key**.
5. In **All set, here is your API key**, click **Copy API Key**, then **Done**.
6. In Besidka, go to **Profile**, **API Keys**, then the **xAI** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick a Grok model.

**Good to know.** xAI's billing FAQ says cards issued in India cannot be saved for billing.
