---
title: How to get a Brave Search API key
description: Create a Brave Search API key and add it to Besidka for web search in chat. $5 of free credit every month.
provider: brave
keyUrl: https://api-dashboard.search.brave.com/app/keys
keyUrlLabel: Open Brave Search API keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-20'
summary: Activate the Search plan, create a key, and add web search to your chats.
video:
  src: /videos/key-guide-brave.mp4?v=3
  poster: /key-guides/brave.webp?v=3
  duration: PT43S
  uploadDate: '2026-10-26'
  alt: Screen recording of the Brave Search API dashboard. The API keys page with its monthly usage limit, the Add API key dialog with a name and the Search plan, the new key in the list, then the key pasted into Besidka. In a new chat the web search menu in the chat input is opened, Brave Search is chosen, and the answer is marked Searched with Brave.
  qualities:
    - src: /videos/key-guide-brave-1080.mp4?v=3
      size: 1080
    - src: /videos/key-guide-brave.mp4?v=3
      size: 720
    - src: /videos/key-guide-brave-360.mp4?v=3
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
      label: Turn on web search
    - time: "0:29"
      label: Switch to Brave Search
    - time: "0:33"
      label: Search the web
    - time: "0:39"
      label: Done
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
6. Start a new chat and click the globe icon in the chat input to open the **Web search** menu. **Model's built-in search** is the default, so choose **Brave Search** instead. **Off** turns web search off.
7. Ask a question that needs current information. The answer shows **Searched with Brave**.

**Costs.** Search costs $5 per 1,000 requests, and Brave gives $5 of free credit every month per plan. Using the free credit requires attribution to Brave. To cap spending, open the Usage limits page and set **Monthly usage limit** to $5.
