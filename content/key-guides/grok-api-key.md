---
title: How to get an xAI (Grok) API key
description: Create an xAI API key for Grok and add it to Besidka. Prepaid credits, billed to you directly.
provider: xai
keyUrl: https://console.x.ai/team/default/api-keys?create=api-key
keyUrlLabel: Open xAI console keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: Add a small prepaid balance, create a key in the xAI console, and chat with Grok.
requirements:
  card: true
  cardNote: Yes, to buy prepaid credits.
  minimumTopUp: No general minimum is documented. Auto top-up starts at $5. Start with $5 (max $10).
  freeTier: None documented.
  sources:
    - label: xAI console billing
      url: https://docs.x.ai/console/billing
    - label: xAI billing FAQ
      url: https://docs.x.ai/console/faq/billing
---

1. Open the [xAI console keys page](https://console.x.ai/team/default/api-keys?create=api-key) and sign in.
2. Add prepaid credits under billing before you create a key. xAI rejects requests once the balance reaches zero. Start with $5 (max $10), and if you turn on auto top-up, keep its amount at $5.
3. Click **Create API key**.
4. Type a name such as `Besidka`. **Advanced settings** are optional. Click **Create API key**.
5. In **All set, here is your API key**, click **Copy API Key**, then **Done**.
6. In Besidka, go to **Profile**, **API Keys**, then the **xAI** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick a Grok model.

**Good to know.** xAI's billing FAQ says cards issued in India cannot be saved for billing.
