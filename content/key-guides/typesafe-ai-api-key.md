---
title: How to get a TypeSafe AI API key
description: Create a TypeSafe AI API key and add it to Besidka. The key powers Jev, the model that double-checks memory entries. It is never used for chat.
provider: typesafe
keyUrl: https://console.typesafe.ai/keys
keyUrlLabel: Open TypeSafe AI keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-26'
summary: A TypeSafe AI key is only for memory checks in Besidka. Chats keep using your own provider keys.
video:
  src: /videos/key-guide-typesafe.mp4
  poster: /key-guides/typesafe.webp
  duration: PT34S
  uploadDate: '2026-10-26'
  alt: Screen recording of the TypeSafe AI console. The API keys page, the Create API key dialog with a key name, the new key shown once and masked, then the key pasted into Besidka under Memory checks and saved. The Memory page then shows Memory checks with TypeSafe AI Jev on.
  qualities:
    - src: /videos/key-guide-typesafe-1080.mp4
      size: 1080
    - src: /videos/key-guide-typesafe.mp4
      size: 720
    - src: /videos/key-guide-typesafe-360.mp4
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
      label: Memory checks on
    - time: "0:30"
      label: Done
requirements:
  card: false
  cardNote: Not stated in the TypeSafe AI documentation. Check the console when you sign up.
  freeTier: Not stated in the TypeSafe AI documentation. A memory check costs a fraction of a cent.
  sources:
    - label: TypeSafe AI quick start
      url: https://docs.typesafe.ai/introduction/quickstart
    - label: TypeSafe AI models and pricing
      url: https://docs.typesafe.ai/models
    - label: TypeSafe AI legal documents
      url: https://docs.typesafe.ai/legal
    - label: TypeSafe AI privacy policy
      url: https://typesafe.ai/legal/privacy-policy
    - label: TypeSafe AI data processing agreement
      url: https://typesafe.ai/legal/data-processing
faq:
  - question: What is the TypeSafe AI key for in Besidka?
    answer: It powers Jev, a decision model from TypeSafe AI. Besidka uses it only for memory checks, a second opinion on whether a memory entry holds sensitive data and whether it really comes from what you wrote. It is never used to answer your chats. Your chats keep running on the provider keys you added.
  - question: Do I need this key?
    answer: No. Memory works without it. Besidka's own checks run on every memory save either way. With the key, Jev can block an entry those checks let through, but it can never let through an entry they blocked. If TypeSafe AI is slow or unavailable, memory saves continue on Besidka's own checks.
  - question: What does it cost?
    answer: TypeSafe AI lists $0.042 per million input tokens, and output is free. A memory check sends a few thousand tokens, so it costs a fraction of a cent. It is billed to your TypeSafe AI account.
  - question: Where does my data go?
    answer: Only after you save a TypeSafe AI key, Besidka sends TypeSafe AI the text of each memory entry it is about to save, after removing data that is never stored, plus a short excerpt of your text so Jev can confirm the entry comes from it. Entries Besidka's own checks already blocked are never sent. TypeSafe AI hosts its service in the United States. Its privacy policy says it does not train models on your input, and its data processing agreement covers transfers with the EU Standard Contractual Clauses and the UK Addendum.
  - question: How do I remove the key?
    answer: In Besidka, open the TypeSafe AI card under Memory checks and delete the key. Memory checks stop right away. You can also revoke the key in the TypeSafe AI console.
---

1. Open the [TypeSafe AI keys page](https://console.typesafe.ai/keys) and sign in, or create an account.
2. Click **Create key**. In the **Create API key** dialog, type a **Key name** you will recognize, such as `Besidka guide demo`, and click **Create key**.
3. In **API key created**, click **Copy**. The key is shown only once, so copy it before you click **Done**.
4. In Besidka, go to **Profile**, **API Keys**, **Memory checks**, then the **TypeSafe AI** card. Paste the key into **API Key** and click **Save**. Besidka checks the key with TypeSafe AI before saving it, then shows **TypeSafe AI API key updated successfully**.
5. Open **Profile**, **Memory**. The **Extra memory checks** card now shows **Memory checks: TypeSafe AI Jev (on)**.

**What this key is not.** It does not add chat models. Jev answers short structured questions, not chat messages, so you will not see it in the model picker. Keep using your OpenAI, Anthropic, Google or other provider keys for conversations.
