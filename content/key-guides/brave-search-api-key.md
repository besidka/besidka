---
title: How to get a Brave Search API key
description: Create a Brave Search API key and add it to Besidka for web search in chat. $5 of free credit every month.
provider: brave
keyUrl: https://api-dashboard.search.brave.com/app/keys
keyUrlLabel: Open Brave Search API keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: Activate the Search plan, create a key, and add web search to your chats.
requirements:
  card: true
  cardNote: Yes. Activating a plan needs a card, even for the free credit.
  minimumTopUp: None published. Credits are prepaid with no subscription.
  freeTier: Yes. $5 of free credit every month per plan, with attribution required.
  sources:
    - label: Brave Search API authentication
      url: https://api-dashboard.search.brave.com/documentation/guides/authentication
    - label: Brave Search API pricing
      url: https://brave.com/search/api/
    - label: Brave Search API free credit
      url: https://brave.com/blog/most-powerful-search-api-for-ai/
---

1. Open the [Brave Search API keys page](https://api-dashboard.search.brave.com/app/keys) and sign in.
2. If you have no plan yet, open **Available plans** and activate the Search plan. Brave asks for a card at this step.
3. Back on the keys page, click **Add API key**. Type an **API Key Name** such as `Besidka`, keep **Plan** on Search, and click **Add**.
4. The new key appears in the list, masked. Click the copy icon next to it.
5. In Besidka, go to **Profile**, **API Keys**, **Search Providers**, then the **Brave Search** card. Paste the key into **API Key** and click **Save**.
6. Start a new chat, turn on web search, and pick Brave.

**Costs.** Search costs $5 per 1,000 requests, and Brave gives $5 of free credit every month per plan. Using the free credit requires attribution to Brave. To cap spending, open the Usage limits page and set **Monthly usage limit** to $5 (max $10).
