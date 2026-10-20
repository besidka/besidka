---
title: How to get an OpenAI API key
description: Create an OpenAI API key and add it to Besidka. Prepaid credits from $5, billed to you directly.
provider: openai
keyUrl: https://platform.openai.com/api-keys
keyUrlLabel: Open OpenAI keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: Buy $5 of credits, create a secret key, and chat with GPT models on your own bill.
requirements:
  card: true
  cardNote: Yes, to buy prepaid credits.
  minimumTopUp: $5 per purchase. Buy $5 (max $10).
  freeTier: No dependable free tier. Plan on buying credits.
  sources:
    - label: OpenAI prepaid billing
      url: https://help.openai.com/en/articles/8264644
    - label: OpenAI rate limits and usage tiers
      url: https://developers.openai.com/api/docs/guides/rate-limits
    - label: OpenAI Organization verification
      url: https://help.openai.com/en/articles/10910291
    - label: OpenAI data controls
      url: https://developers.openai.com/api/docs/guides/your-data
---

1. Open the [OpenAI API keys page](https://platform.openai.com/api-keys) and sign in.
2. Add credits under **Billing**. The minimum purchase is $5, so buy $5 (max $10). OpenAI turns auto-reload on by default, so turn it off or set it to $5 to keep spending small.
3. Back on the keys page, click **Create new secret key**.
4. Leave **Owned by** on **You**, type a **Name** such as `Besidka`, and pick a **Project**. Choose an **Expiration** from 1 day to 30 days, or Never. Leave **Permissions** on **All**, then click **Create secret key**.
5. In **Save your key**, click **Copy**, then **Done**. OpenAI shows the key only once.
6. In Besidka, go to **Profile**, **API Keys**, then the **OpenAI** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick an OpenAI model.

**Good to know.** Some OpenAI models need Organization verification with a government ID. If a model is unavailable on your key, check that first. By default, OpenAI does not train its models on API data.
