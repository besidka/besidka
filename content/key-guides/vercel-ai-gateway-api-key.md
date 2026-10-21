---
title: How to get a Vercel AI Gateway API key
description: Create a Vercel AI Gateway API key with a monthly spend budget and add it to Besidka. One key for models from many providers.
provider: vercel
keyUrl: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys%3FshowCreateKeyModal%3Dtrue
keyUrlLabel: Open Vercel AI Gateway keys page
updatedAt: '2026-10-21'
checkedAt: '2026-10-20'
summary: One key for models from many providers, with a monthly spend budget you set yourself.
video:
  src: /videos/key-guide-vercel.mp4?v=2
  poster: /key-guides/vercel.webp?v=2
  duration: PT44S
  uploadDate: '2026-10-21'
  alt: Screen recording of Vercel AI Gateway. The API Keys page, the Create API Key dialog with a name and a $5 monthly budget, the new key shown once and masked, then the key pasted into Besidka. In a new chat the model picker opens, Vercel AI Gateway is picked in the Gateways bar, a model is chosen and a first answer follows.
  markers:
    - time: "0:00"
      label: Intro
    - time: "0:03"
      label: Open AI Gateway
    - time: "0:07"
      label: Set a $5 budget
    - time: "0:14"
      label: Copy your key
    - time: "0:19"
      label: Paste into Besidka
    - time: "0:26"
      label: Pick the gateway
    - time: "0:31"
      label: Choose a model
    - time: "0:36"
      label: First answer
    - time: "0:41"
      label: Done
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
6. Start a new chat and open the model picker. In the **Gateways** bar at the bottom, pick **Vercel AI Gateway**, then choose a model from the list.

**When a gateway makes sense.** Use Vercel AI Gateway when you want one key and one balance for models from many providers. Vercel adds no fee on top of token prices. The spend budget does not count BYOK spend, so it only limits usage billed through Vercel. If you mostly use one provider, a direct key from that provider is simpler.
