---
title: How to get a Cloudflare Workers AI API key and Account ID
description: Create a Cloudflare Workers AI API token and find your Account ID, then add both to Besidka. A free daily allowance is included.
provider: cloudflare
keyUrl: https://dash.cloudflare.com/?to=/:account/ai/workers-ai/api-quick-start
keyUrlLabel: Open Cloudflare Workers AI page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: Besidka needs two values from Cloudflare, an Account ID and an API token. Both come from the Workers AI page.
video:
  src: /videos/key-guide-cloudflare.mp4?v=3
  poster: /key-guides/cloudflare.webp?v=3
  duration: PT45S
  uploadDate: '2026-10-26'
  alt: Screen recording of the Cloudflare dashboard. Workers AI, the REST API page, the Create a Workers AI API Token drawer, the new token shown once and masked and the Account ID copied, then the Account ID, gateway ID and token pasted into Besidka. In a new chat the model picker opens, Cloudflare AI Gateway is picked in the Gateways bar, a model is chosen and a first answer follows.
  qualities:
    - src: /videos/key-guide-cloudflare-1080.mp4?v=3
      size: 1080
    - src: /videos/key-guide-cloudflare.mp4?v=3
      size: 720
    - src: /videos/key-guide-cloudflare-360.mp4?v=3
      size: 360
  markers:
    - time: "0:00"
      label: Get a Cloudflare token
    - time: "0:03"
      label: Open Workers AI
    - time: "0:07"
      label: Create a token
    - time: "0:10"
      label: Name the token
    - time: "0:15"
      label: Copy token and Account ID
    - time: "0:22"
      label: Paste into Besidka
    - time: "0:28"
      label: Pick the gateway
    - time: "0:32"
      label: Choose a model
    - time: "0:37"
      label: First answer
    - time: "0:41"
      label: Done
requirements:
  card: false
  cardNote: Not for the free daily allowance. Usage beyond it needs the Workers Paid plan.
  minimumTopUp: None. Paid usage is billed per 1,000 Neurons above the free allowance.
  freeTier: Yes. 10,000 Neurons per day on both Workers Free and Workers Paid.
  sources:
    - label: Workers AI pricing
      url: https://developers.cloudflare.com/workers-ai/platform/pricing/
    - label: AI Gateway get started
      url: https://developers.cloudflare.com/ai-gateway/get-started/
    - label: AI Gateway pricing
      url: https://developers.cloudflare.com/ai-gateway/reference/pricing/
---

1. Open the [Cloudflare Workers AI page](https://dash.cloudflare.com/?to=/:account/ai/workers-ai/api-quick-start) and sign in. If the link does not land there, open **AI**, then **Workers AI**, then **REST API**.
2. Copy your **Account ID** from this page.
3. Click **Create a Workers AI API Token**. In the side panel, keep the prefilled name or type `Besidka`, and leave the Workers AI Read and Edit permissions as they are. Click **Create API Token**.
4. Click **Copy API Token**, then **Finish**. Cloudflare shows the token only once.
5. In Besidka, go to **Profile**, **API Keys**, **Gateways**, then the **Cloudflare AI Gateway** card. Paste the Account ID into **Account ID**, type `default` in **Gateway ID**, and paste the token into **API Key**, then click **Save**. Leaving Gateway ID empty also uses the default gateway.
6. Start a new chat and open the model picker. In the **Gateways** bar at the bottom, pick **Cloudflare AI Gateway**, then choose a model from the list.

**Costs.** Workers AI includes 10,000 Neurons per day at no charge on both the Free and Paid plans. Above that, Workers Paid bills $0.011 per 1,000 Neurons. AI Gateway's core features are free, and Cloudflare adds no fee on top of inference prices.

**When a gateway makes sense.** Use Cloudflare when you want open-weight models hosted by Cloudflare and a single Cloudflare bill. If you mostly use one provider, a direct key from that provider is simpler.
