---
title: How to get a TypeSafe AI API key
description: Create a TypeSafe AI API key and add it to Besidka. The key powers Jev, a small model that answers yes/no questions for Besidka's optional smart checks. It adds no chat models.
provider: typesafe
keyUrl: https://console.typesafe.ai/keys
keyUrlLabel: Open TypeSafe AI keys page
updatedAt: '2026-10-26'
checkedAt: '2026-10-26'
summary: A TypeSafe AI key adds optional smart checks to Besidka, such as memory checks. It adds no chat models, and chats keep using your own provider keys.
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
  freeTier: Not stated in the TypeSafe AI documentation. A check costs a fraction of a cent.
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
    answer: It powers Jev, a small decision model from TypeSafe AI that answers short yes/no questions. Besidka uses it for optional smart checks, each with its own toggle. They include a second opinion on whether a memory entry holds sensitive data, a pre-filter that skips memory generation when a chat holds nothing worth remembering, deciding whether a web search is needed, screening project files and search results for hidden instructions, ordering search results, a personal-data warning before you share a chat, and searching your past chats for models without tool calling. It does not answer your messages. Your chats keep running on the provider keys you added.
  - question: What does Auto web search do?
    answer: With a TypeSafe AI key, the web search menu in the chat input gets an Auto switch. Pick a search provider (the model's built-in search, Brave or Exa) and turn Auto on. For each message, Jev decides whether a web search is needed, and Besidka either searches with the provider you picked or answers without searching. A link, a domain or words such as "today" or "latest" always search, without asking Jev. If TypeSafe AI is slow or unavailable, Besidka searches as usual. Each answer shows a small note saying whether Auto searched the web. Auto sends your message and the last few turns, with never-stored data removed. Switch it off in the menu, or turn off the Auto web search check under Profile, API Keys, Smart checks.
  - question: Do I need this key?
    answer: No. Besidka works fully without it, and its own checks run on every memory save either way. With the key, Jev can block a memory entry those checks let through, but it can never let through an entry they blocked. Every other check is only a helper too. If TypeSafe AI is slow, unavailable or rate-limited, Besidka behaves as it does without the key.
  - question: What does it cost?
    answer: TypeSafe AI lists $0.042 per million input tokens, and output is free. A single check sends from a few hundred to a few thousand tokens, so it costs a fraction of a cent. The memory pre-filter sends whole chats in chunks, so it uses the most. All of it is billed to your TypeSafe AI account.
  - question: Where does my data go?
    answer: Only after you save a TypeSafe AI key, and only for the checks you leave on. Memory checks send the text of each memory entry about to be saved, after removing data that is never stored, plus a short excerpt of your text. The memory pre-filter sends chat text, with never-stored data removed, before memory is generated. Auto web search and past-chat retrieval send your message and the last few turns. Screening sends project files and notes and Brave or Exa results. Results from a chat model's own built-in web search go straight to the model, so they cannot be screened. Project files are screened on their extracted text, so a PDF with no text layer, such as a scan, is not screened, and the images on the pages of a PDF sent as a PDF are not screened either. Re-ranking sends the search query and short excerpts of the candidates. The share check sends the chat text you are about to share, with emails, phone numbers and card numbers removed. Entries Besidka's own checks already blocked are never sent. TypeSafe AI hosts its service in the United States. Its privacy policy says it does not train models on your input, and its data processing agreement covers transfers with the EU Standard Contractual Clauses and the UK Addendum.
  - question: How do I remove the key?
    answer: In Besidka, open the TypeSafe AI card under Profile, API Keys, Smart checks and delete the key. Every check stops right away. To keep the key and stop only some checks, switch off single checks in the TypeSafe AI checks section on the same tab. You can also revoke the key in the TypeSafe AI console.
---

1. Open the [TypeSafe AI keys page](https://console.typesafe.ai/keys) and sign in, or create an account.
2. Click **Create key**. In the **Create API key** dialog, type a **Key name** you will recognize, such as `Besidka guide demo`, and click **Create key**.
3. In **API key created**, click **Copy**. The key is shown only once, so copy it before you click **Done**.
4. In Besidka, go to **Profile**, **API Keys**, **Smart checks**, then the **TypeSafe AI** card. Paste the key into **API Key** and click **Save**. Besidka checks the key with TypeSafe AI before saving it, then shows **TypeSafe AI API key updated successfully**.
5. Open **Profile**, **Memory**. The **Extra memory checks** card now shows **Memory checks: TypeSafe AI Jev (on)**.

**What this key is not.** It does not add chat models and it does not answer your messages. It only answers short yes/no questions for the checks you leave on, so you will not see it in the model picker. Keep using your OpenAI, Anthropic, Google or other provider keys for conversations.
