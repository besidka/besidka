---
title: How to get a Qwen API key
description: Create a Qwen API key on QwenCloud and add it to Besidka. Pay as you go with a free quota for new models. Identity verification may be required.
provider: qwen
keyUrl: https://home.qwencloud.com/api-keys
keyUrlLabel: Open QwenCloud keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: Add payment details, create a key on QwenCloud, and chat with Qwen models. QwenCloud may ask you to verify your identity first.
video:
  src: /videos/key-guide-qwen.mp4?v=2
  poster: /key-guides/qwen.webp?v=2
  duration: PT33S
  uploadDate: '2026-10-26'
  alt: Recording of QwenCloud and Besidka. The API Keys page with Create API key, the identity verification notice, the remaining key creation steps shown as text rather than a recording, then the key pasted into Besidka and a first answer from Qwen.
  qualities:
    - src: /videos/key-guide-qwen-1080.mp4?v=2
      size: 1080
    - src: /videos/key-guide-qwen.mp4?v=2
      size: 720
    - src: /videos/key-guide-qwen-360.mp4?v=2
      size: 360
  markers:
    - time: "0:00"
      label: Get a Qwen key
    - time: "0:03"
      label: Create API key
    - time: "0:07"
      label: Verify identity
    - time: "0:12"
      label: Generate Key
    - time: "0:16"
      label: Paste into Besidka
    - time: "0:23"
      label: First answer
    - time: "0:29"
      label: Done
requirements:
  card: true
  cardNote: Yes. Payment details are required to unlock the free quota.
  minimumTopUp: No minimum is documented. The account is pay as you go.
  freeTier: Yes. About 1M tokens per model, valid 90 days from activation, for real-time inference only.
  sources:
    - label: QwenCloud API keys
      url: https://docs.qwencloud.com/developer-guides/administration/api-keys
    - label: QwenCloud free quota
      url: https://docs.qwencloud.com/resources/free-quota
    - label: Alibaba Cloud Model Studio free quota
      url: https://www.alibabacloud.com/help/en/model-studio/new-free-quota.md
---

1. Open the [QwenCloud keys page](https://home.qwencloud.com/api-keys) and sign in. Use the international region the console defaults to (Singapore). Keys are tied to a region.
2. Add your payment details. QwenCloud requires them to unlock the free quota. The account is pay as you go and no minimum top-up is documented, so if you add funds, start with $5.
3. On **API Keys**, click **Create API key**.
4. QwenCloud may ask for identity verification (KYC) before your first key. If you see a **Security Notice**, follow the **KYC verification** link. Key creation unlocks after approval.
5. Add a description such as `Besidka` and click **Generate Key**.
6. Copy the key. QwenCloud shows it only once. A workspace can hold up to 20 keys.
7. In Besidka, go to **Profile**, **API Keys**, then the **Qwen** card. Paste the key into **API Key** and click **Save**.
8. Start a new chat and pick a Qwen model.

**Good to know.** The free quota is about 1M tokens per model and expires 90 days after activation. **Free Quota Only** mode is off by default, so calls past the quota are billed. Turn it on if you want to stay free.
