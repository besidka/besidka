---
title: How to get a Kimi (Moonshot AI) API key
description: Create a Kimi API key on the Moonshot AI platform and add it to Besidka. Prepaid recharge from $1.
provider: moonshotai
keyUrl: https://platform.kimi.ai/console/api-keys
keyUrlLabel: Open Kimi platform keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: Recharge a small balance, create a key on the Kimi platform, and chat with Kimi models.
video:
  src: /videos/key-guide-moonshotai.mp4?v=3
  poster: /key-guides/moonshotai.webp?v=3
  duration: PT34S
  uploadDate: '2026-10-26'
  alt: Screen recording of the Kimi platform. The API Keys page, the Create API Key dialog with a name and a project, the new key shown once and masked, then the key pasted into Besidka and a first answer from Kimi.
  qualities:
    - src: /videos/key-guide-moonshotai-1080.mp4?v=3
      size: 1080
    - src: /videos/key-guide-moonshotai.mp4?v=3
      size: 720
    - src: /videos/key-guide-moonshotai-360.mp4?v=3
      size: 360
  markers:
    - time: "0:00"
      label: Get a Kimi key
    - time: "0:03"
      label: Create API Key
    - time: "0:07"
      label: Name and project
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
  cardNote: Check the Recharge page for the payment methods available to you. Individuals can pay with WeChat Pay or Alipay.
  minimumTopUp: $1 per recharge. Start with $5.
  freeTier: 'No free tier. A $5 voucher is added once your total recharge reaches $5.'
  sources:
    - label: Kimi platform limits and recharge
      url: https://platform.kimi.ai/docs/pricing/limits.md
    - label: Kimi account and payments
      url: https://platform.kimi.ai/docs/guide/account-and-payments.md
---

1. Open the [Kimi platform keys page](https://platform.kimi.ai/console/api-keys) and sign in.
2. Recharge before you create a key. Check the Recharge page for the payment methods you can use. The minimum is $1, so recharge $5. Once your total recharge reaches $5, you get a $5 voucher, and a total of $10 unlocks Tier 1.
3. Back on the keys page, click **Create API Key**.
4. In **Enter API Key name**, type a name such as `Besidka`. Leave **Project** on the default and click **OK**.
5. In **Your API Key**, click the copy icon, then **OK**. The platform shows the key only once.
6. In Besidka, go to **Profile**, **API Keys**, then the **Moonshot AI** card. Paste the key into **API Key** and click **Save**. Besidka then asks you to confirm that your messages to Moonshot AI are processed outside the EU, so tick **I explicitly consent** and select **Add key**.
7. Start a new chat and pick a Kimi model.

**Good to know.** Keys are tied to a region. Create the key on platform.kimi.ai, the international platform, because a key from another Moonshot platform will not work with it.
