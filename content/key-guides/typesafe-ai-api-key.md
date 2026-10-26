---
title: How to get a TypeSafe AI API key
description: Create a TypeSafe AI API key and add it to Besidka. The key powers Jev, a decision model that answers yes/no questions for seven optional smart checks, such as memory checks and Auto web search. It adds no chat models.
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
  alt: Screen recording of the TypeSafe AI console. The API keys page, the Create API key dialog with a key name, the new key shown once and masked, then the key pasted into Besidka and saved (the recording shows the tab under its earlier name, Memory checks; it is now called Smart checks). The Memory page then shows Memory checks with TypeSafe AI Jev on.
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
    - label: TypeSafe AI decision models
      url: https://docs.typesafe.ai/concepts/system-one
    - label: TypeSafe AI models and pricing
      url: https://docs.typesafe.ai/models
    - label: TypeSafe AI legal documents
      url: https://docs.typesafe.ai/legal
    - label: TypeSafe AI privacy policy
      url: https://typesafe.ai/legal/privacy-policy
    - label: TypeSafe AI data processing agreement
      url: https://typesafe.ai/legal/data-processing
faq:
  - question: What is Jev?
    answer: Jev is a decision model made by TypeSafe AI. It reads a piece of text and answers short typed questions about it, such as "does this message need a web search?", with a probability between 0 and 1. It does not write text, so it cannot chat, summarize or write memory entries. Besidka pins the version it tested, jev-1.14.0, so a model update cannot change the checks before they are tested again.
  - question: How is Jev different from GPT, Claude or Gemini?
    answer: GPT, Claude and Gemini are language models. They write answers, and you pay for the words they read and write. Jev only returns yes/no probabilities, which makes each call fast and cheap. In Besidka's tests a typical check came back in about 170 to 200 ms (median), and TypeSafe AI lists $0.042 per million input tokens with free output. That suits small decisions around a chat, such as whether to search the web, and not the chat itself. Your conversations always run on the chat model you pick.
  - question: What is the TypeSafe AI key for in Besidka?
    answer: It powers Jev, a small decision model from TypeSafe AI that answers short yes/no questions. Besidka uses it for seven optional smart checks, each with its own toggle. They are a second opinion on whether a memory entry holds sensitive data, a pre-filter that skips memory generation when a chat holds nothing worth remembering, deciding whether a web search is needed, screening project files and search results for hidden instructions, ordering search results, a personal-data warning before you share a chat, and searching your past chats for models without tool calling, only while Search and reference chats is on. It does not answer your messages. Your chats keep running on the provider keys you added.
  - question: What does Auto web search do?
    answer: With a TypeSafe AI key, the web search menu in the chat input gets an Auto switch. Pick a search provider (the model's built-in search, Brave or Exa) and turn Auto on. For each message, Jev decides whether a web search is needed, and Besidka either searches with the provider you picked or answers without searching. A link, a domain or words such as "today" or "latest" always search, without asking Jev. If TypeSafe AI is slow or unavailable, Besidka searches as usual. Each answer shows a small note saying whether Auto searched the web. Auto sends your message and your last three turns, with never-stored data removed; a message that always searches is not sent at all. Switch it off in the menu, or turn off the Auto web search check under Profile, API Keys, Smart checks.
  - question: Do I need this key?
    answer: No. Besidka works fully without it. Without the key, the built-in memory checks still run on every save, web search runs whenever you turn it on, search results keep their original order, the share window still shows Besidka's own warnings for emails, phone numbers and similar identifiers, and models without tool calling do not look up your past chats before answering. With the key, Jev can block a memory entry the built-in checks let through, but it can never let through an entry they blocked. The other checks are helpers too. If TypeSafe AI is slow, unavailable or rate-limited, Besidka behaves as it does without the key, except that it then searches your past chats anyway.
  - question: What does it cost?
    answer: TypeSafe AI lists $0.042 per million input tokens, and output is free. A single check sends from a few hundred to a few thousand tokens, so it costs a fraction of a cent. In Besidka's tests, a web search or past-chat decision used about 420 to 550 input tokens, about $0.00002, and the largest memory pre-filter piece, about 8,700 tokens, cost about $0.0004. The memory pre-filter sends whole chats in chunks, so it uses the most. All of it is billed to your TypeSafe AI account, and TypeSafe AI's models page has the current price.
  - question: Where does my data go?
    answer: Only after you save a TypeSafe AI key, and only for the checks you leave on. Memory checks send the text of each memory entry about to be saved, after removing data that is never stored, plus a short excerpt of your text. The memory pre-filter sends chat text, with never-stored data removed, before memory is generated. Auto web search and past-chat retrieval send your message and the last three turns, never-stored data removed. A link, a domain or a word such as "today" is searched without sending anything. Screening sends project files and notes and Brave or Exa results. Results from a chat model's own built-in web search go straight to the model, so they cannot be screened. A project file added while TypeSafe AI is unavailable is checked again later, usually within the hour. Project files are screened on their extracted text, so a PDF with no text layer, such as a scan, is not screened, and the images on the pages of a PDF sent as a PDF are not screened either. Re-ranking sends the search query and short excerpts of the candidates. The share check sends the chat text you are about to share, with emails, phone numbers and card numbers removed. Entries Besidka's own checks already blocked are never sent. Besidka's logs keep only counts, scores, statuses and timing for these checks, never the text. TypeSafe AI hosts its service in the United States. Its privacy policy says it does not train models on your input, and its data processing agreement is its own contract with you as the account holder, not with Besidka, and covers transfers with the EU Standard Contractual Clauses and the UK Addendum.
  - question: How accurate is Jev?
    answer: In Besidka's tests on synthetic text, written and labelled by one person, the yes/no checks reached 94.6% to 100% precision and 100% recall at the chosen thresholds, on sets of 64 to 179 items in English, Ukrainian, Polish and Russian. A 100% there means no error on that set, not a measured error rate. With 54 positive examples, a real miss rate of up to about 7% would still fit. The tests were run from a developer's computer, not from Besidka's servers, and not on real chats or on text written to fool Jev. So memory checks can only add blocks, the thresholds lean toward searching, generating memory and flagging, and they will be re-tuned on real use. The section above has the numbers per check.
  - question: How do I switch the checks off or remove the key?
    answer: In Besidka, open the TypeSafe AI card under Profile, API Keys, Smart checks and delete the key. Every check stops right away. To keep the key and stop only some checks, switch off single checks in the TypeSafe AI checks section on the same tab. You can also revoke the key in the TypeSafe AI console.
---

1. Open the [TypeSafe AI keys page](https://console.typesafe.ai/keys) and sign in, or create an account.
2. Click **Create key**. In the **Create API key** dialog, type a **Key name** you will recognize, such as `Besidka guide demo`, and click **Create key**.
3. In **API key created**, click **Copy**. The key is shown only once, so copy it before you click **Done**.
4. In Besidka, go to **Profile**, **API Keys**, **Smart checks**, then the **TypeSafe AI** card. Paste the key into **API Key** and click **Save**. Besidka checks the key with TypeSafe AI before saving it, then shows **TypeSafe AI API key updated successfully**.
5. Open **Profile**, **Memory**. The **Extra memory checks** card now shows **Memory checks: TypeSafe AI Jev (on)**.

**What this key is not.** It does not add chat models and it does not answer your messages. It only answers short yes/no questions for the checks you leave on, so you will not see it in the model picker. Keep using your OpenAI, Anthropic, Google or other provider keys for conversations.

::key-guide-article
## What is the Jev model from TypeSafe AI?

Jev is a decision model from TypeSafe AI, a company in the United States. A decision model is not a chatbot. You give it some text and a few typed questions, and it returns a probability for each answer instead of writing a reply. Besidka asks it only yes/no questions, such as "does this message refer to an earlier conversation?", and compares the probability with a fixed threshold.

That makes Jev a different tool from GPT, Claude or Gemini:

- **It cannot write.** It cannot answer your messages, summarize a chat or write a memory entry, so it never replaces your chat model or your memory model.
- **It is fast.** In Besidka's tests, a check with a short message and a few earlier turns came back in about 170 to 200 ms (median), and in about 210 to 310 ms for 95% of calls. Requests of up to about 27,000 tokens still came back within about 320 ms for 95% of calls. Besidka still gives every call a hard time limit: 800 ms while you wait for an answer, 1.5 seconds in the share window and 2.5 seconds for background work.
- **It is cheap.** TypeSafe AI lists $0.042 per million input tokens, and output is free. A typical check costs about $0.00002. The whole test run behind this page, 1,006 calls, cost $0.21.

Besidka pins one version, `jev-1.14.0`. The thresholds were tuned on it, so a newer version is tested again before the pin moves.

## Why Besidka uses a decision model for smart checks

Some useful decisions in a chat app are too small to ask a chat model about and too fuzzy for a fixed rule. Does "and in Poland?" need a web search? Does a long coding chat hold anything worth remembering about you? Is this paragraph in a project file trying to give the model orders? A chat model could answer, but it would cost more and add seconds before your reply. A word list is free, but it misses everything it does not list.

Jev sits between the two. Besidka's own rules run first and stay in charge; Jev adds a second opinion where a yes/no answer saves you money, time or a mistake. Every one of these smart checks is optional, runs on your own TypeSafe AI key and has its own switch under **Profile**, **API Keys**, **Smart checks**.

## The seven smart checks

Each check below says what it does, what Besidka sends to TypeSafe AI, and what happens if TypeSafe AI is slow, unavailable or rate-limited. Never-stored values, such as card numbers, passwords and API keys, are removed from the text before every call.

### Memory checks

A second opinion before a memory entry is saved. Jev looks for sensitive information, such as health or political opinions, and data that is never stored, and for entries a model wrote it checks that the entry really comes from your text. It can only add blocks: it can refuse an entry Besidka's built-in checks allowed, never allow one they refused.

- **Sent:** the entry text and a short excerpt of the text it came from. Entries the built-in checks already refused are never sent.
- **If it fails:** the entry is saved on the built-in checks alone.

### Auto web search

With a search provider picked and **Auto** on in the chat input's web search menu, Jev decides for each message whether a web search is needed. A link, a domain or a word such as "today" or "latest" always searches without asking Jev. Each answer shows whether Auto searched. Skipping a search you do not need saves the search fee, and Brave and Exa charge a few dollars per 1,000 searches.

- **Sent:** your message and your last three turns, each cut to 4,000 characters.
- **If it fails:** Besidka searches, as it does without the key.

### Memory pre-filter

Before memory is generated from a chat, Jev checks whether the chat holds anything worth remembering about you. If it does not, the memory model is skipped, which saves a model call on your own key. It runs only for **Generate memory from chats**, **Build memory from past chats** and a project **Refresh**, never for **Update memory now** or **Import memory**.

- **Sent:** the chat text, in pieces of up to about 8,000 tokens. The chat is skipped only when every piece scores low.
- **If it fails:** memory is generated as usual.

This check sends the most text, because it reads whole chats. Switch it off on its own if that matters to you.

### Prompt-injection screening

A prompt injection is text written to give orders to an AI that reads it, hidden in a file or a web page. Jev screens project files and notes when you add or edit them, and Brave and Exa search results before the model reads them. A flagged file is marked "needs review" and stays out of your chats until you choose **Allow anyway**. A flagged search result is left out, and the model is told how many were withheld. Nothing is ever deleted.

- **Sent:** the extracted text of project files and notes, in chunks of about 2,000 tokens, and the title and snippet of each Brave or Exa result.
- **If it fails:** files are added anyway and checked again later, usually within the hour. Search results are used unscreened.
- **Not covered:** results of a chat model's own built-in web search, which go straight to the model, and anything a PDF holds outside its text layer, such as a scan.

### Search re-ranking

When the model searches your past chats or a project's files, Jev puts the most relevant results first. It only reorders what the search found and never adds a result. It can drop clearly irrelevant results, but only when enough relevant ones remain.

- **Sent:** the search query and up to 30 short excerpts of about 300 tokens each.
- **If it fails:** the original search order is kept.

### Share check

When you open the share window, Besidka checks the chat for personal data before you publish a public link. Its own detectors look for emails, phone numbers, card numbers and similar identifiers first; Jev then reads the rest for things like addresses, health details or a private person's name. It is a warning only and never blocks sharing.

- **Sent:** the chat text you are about to share, with emails and phone numbers also removed.
- **If it fails:** you see Besidka's own warnings and a "check before sharing" reminder.

### Past-chat retrieval

Models that cannot call tools cannot search your chat history themselves. For those models, and only while **Search and reference chats** is on, Jev decides whether your message refers to an earlier, separate conversation. If it does, Besidka searches your past chats in its own database and adds up to three short excerpts, and the reply links the chats it used. A phrase such as "last time" or "we discussed" starts the search without asking Jev.

- **Sent:** your message and your last three turns.
- **If it fails:** Besidka searches your past chats anyway, because missing a needed search costs more than one quick lookup. Without the key, or with the check off, there is no such search.

## Privacy: what leaves Besidka and where it goes

- **Only the checks you leave on.** Nothing goes to TypeSafe AI until you save a key, and a switched-off check sends nothing.
- **Redaction before every call.** Never-stored values are removed before any text leaves Besidka. The share check also removes emails and phone numbers.
- **No text in logs.** Besidka's logs keep counts, scores, statuses and timing for these checks, never the text.
- **Who receives it.** TypeSafe AI, Inc. hosts its service in the United States and is not certified under the EU–US Data Privacy Framework. Towards Besidka it is an independent controller, like the AI providers whose keys you add: Besidka has no contract with it about your data. Your own terms with TypeSafe AI apply. Its data processing agreement is made with you as its account holder and relies on the EU Standard Contractual Clauses and the UK Addendum. Its privacy policy says it does not train models on your input. It keeps data "as long as necessary", with no fixed period.
- **What it can contain.** The text can hold whatever your chats, projects and memory hold, including sensitive information. Your consent before your first message covers sending it to the providers whose keys you add, and TypeSafe AI is one of them.

The [Privacy Policy](/privacy-policy#typesafe-ai-checks) lists what each check sends.

## Why it is optional and BYOK

- **Your key, your account.** TypeSafe AI bills its own account, the one you create, at its own price. Besidka adds nothing on top and holds no TypeSafe AI key of its own.
- **Saving the key is the opt-in.** All seven checks are on once you save it. Each one has its own switch, and deleting the key stops all of them at once.
- **Nothing breaks without it.** Besidka works fully without a TypeSafe AI key. Every check except past-chat retrieval falls back to exactly what Besidka does without the key.

## How well it works: the eval, with caveats

Before shipping, every check was tested against `jev-1.14.0` with data sets written for the test, in English, Ukrainian, Polish and, for most checks, Russian. For the two checks that scored perfectly at first, a second, harder set was written and labelled before any of its results were seen.

| Check | Test set | Result at the shipped threshold |
| --- | --- | --- |
| Auto web search | 179 messages, 99 need a search | 99.0% precision, 100% recall; 1 needless search out of 80 |
| Memory pre-filter | 99 chats, 54 with a lasting fact about the user | 0 of 54 wrongly skipped; 44 of the 45 chats without one skipped |
| Prompt-injection screening | 104 snippets, 53 injections, 13 security articles that quote attacks | 94.6% precision, 100% recall; 1 of 13 articles flagged |
| Search re-ranking | 8 queries, 20 to 30 candidates each | Ranking quality (NDCG@5) 0.99, against 0.42 for keyword order |
| Share check | 64 chats, 32 with personal data | 100% precision, 100% recall |
| Past-chat retrieval | 80 messages, 39 refer to an earlier chat | 97.5% precision, 100% recall |
| Memory checks | 48 short texts, many with sensitive data | All 48 classified correctly; the built-in word rules alone got 39 |

Read these numbers with their limits:

- **Synthetic and small.** One person wrote and labelled every item, and each was run once. A 100% means no error on that set, not a measured error rate. With 54 positive examples, a real miss rate of up to about 7% would still fit.
- **Tuned on the same data.** The thresholds were picked on these sets, which flatters them. They are starting points and will be re-tuned on real use, from scores Besidka logs without any text.
- **Not tested yet.** Calls from Besidka's servers (the timings were measured from a developer's computer), real chat traffic, personal data hidden inside pasted code, and text written specifically to fool Jev. TypeSafe AI itself says adversarial text can move Jev's answers, and that languages other than English work less well.
- **Search re-ranking ships in a slightly different request shape** than the one tested, so its cut-off may need re-tuning.

## Built-in checks first, Jev second

Jev complements Besidka's built-in checks and never replaces them:

- **Memory.** The built-in check, fixed word and pattern rules in English, Ukrainian, Polish and Russian, runs on every way memory can be written, with or without a key. It decides what is never stored. Jev can only refuse more.
- **Injection.** Screening is an extra signal next to the defences that are always on: memory writes are locked after a web search or another tool result, and retrieved text is passed to the model as quoted data, never as instructions.
- **Failures.** A failed call never blocks you. Each check falls back to what Besidka does without the key.

For what memory is and how to edit it, see [How memory works](/memory). For the rest of the BYOK setup, see the [BYOK guide](/byok).
::
