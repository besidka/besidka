---
title: How to get a Vercel AI Gateway API key
description: Create a Vercel AI Gateway API key with a monthly spend budget and add it to Besidka. One key for models from many providers.
provider: vercel
keyUrl: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys%3FshowCreateKeyModal%3Dtrue
keyUrlLabel: Open Vercel AI Gateway keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: One key for models from many providers, with a monthly spend budget you set yourself.
requirements:
  card: true
  cardNote: Yes. Vercel needs a payment method even for the free monthly credit.
  minimumTopUp: No minimum is published. Credits are prepaid and expire after one year.
  freeTier: Yes. A monthly free credit, which ends once you buy credits.
  sources:
    - label: AI Gateway getting started
      url: https://vercel.com/docs/ai-gateway/getting-started
    - label: AI Gateway pricing
      url: https://vercel.com/docs/ai-gateway/pricing
    - label: AI Gateway FAQ
      url: https://vercel.com/docs/ai-gateway/faq
---

1. Open the [Vercel AI Gateway keys page](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys%3FshowCreateKeyModal%3Dtrue), sign in, and pick your team if Vercel asks. Add a payment method when prompted.
2. Click **Create API Key**.
3. Type a **Key Name** such as `Besidka`. Open **Advanced Configuration**, turn on **Spend Budget**, enter `5` in **Monthly Budget ($)**, and set **Budget Refresh** to Monthly. Click **Create API Key**.
4. In **Save Your AI Gateway API Key**, click the copy icon, then **I've saved this key**. The key starts with `vck_`, and Vercel shows it only once.
5. In Besidka, go to **Profile**, **API Keys**, **Gateways**, then the **Vercel AI Gateway** card. Paste the key into **API Key** and click **Save**.
6. Start a new chat and pick a model from the Vercel list.

**When a gateway makes sense.** Use Vercel AI Gateway when you want one key and one balance for models from many providers. Vercel adds no fee on top of token prices. The spend budget does not count BYOK spend, so it only limits usage billed through Vercel. If you mostly use one provider, a direct key from that provider is simpler.
