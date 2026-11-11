---
title: "Privacy Policy"
description: "How Besidka handles your data — what is stored, who receives it, how long it is kept, and the rights you have under the GDPR."
updatedAt: 2026-10-30
summary: "Besidka stores your account, chats, projects, files, settings and your encrypted API keys on Cloudflare infrastructure. When you send a message, it goes to the AI provider whose key you supplied, or through the AI gateway you chose, and if you turn on Brave or Exa web search for a message, the search query your model writes from it goes to that search provider as well. The assistant can also look up your earlier chats and send short excerpts of them to the provider of the chat you are in, and memory, if you use it, can be written by an AI model on one of your own keys. If you add a TypeSafe AI key, TypeSafe AI in the United States can also answer short yes/no questions about your text for optional checks, such as memory entries, whether a web search is needed, files and search results screened for hidden instructions, and chats you are about to share, and each check has its own off switch. Each provider is a separate company with its own privacy terms, and some of them are outside the EU, in the United States, China or Singapore. Because you can type anything, your chats may contain sensitive information such as health details or beliefs; I ask for your explicit consent to store it and send it where you tell me to, and I never use it for anything else. If you use a free Google Gemini key outside the EEA, Switzerland and the UK, Google may use your content to improve its products and human reviewers may read it. I never train any model on your data, I never sell it, and there are no ads. If you arrive through a campaign link, I keep the campaign tags from that link (source, medium, campaign and content) with your account, and no cookie or device storage is used for it. You can also connect an AI app of your choice to your account so that it can read, and only if you allow it, change or delete, the parts of your account you approve; that app and its maker are separate companies with their own privacy terms, and you can remove some of its permissions or disconnect it at any time. From 19 December 2026 some experimental features may reach a share of accounts first, chosen at random from the account number and not from anything about you; I record which experimental features your account can use and keep a 12-month log of changes to that access, and you can object to gradual rollouts and version tests. Public share links are off by default, and when you create one every extra on it (search indexing, files, your name and avatar) starts off, but anyone who has the link can read the chat. Artifacts, the pages, components, diagrams and documents the assistant or a connected app makes for you, are stored with every version until you delete them; deleting a chat keeps them. You can publish an artifact by a link that anyone who has it can open and that search engines never index. If its author allows it, signed-in visitors can save their progress in it and let it ask an AI model on their own key after they confirm the request, but only once they have given a consent that names these features; the author never sees saved progress in Besidka, although the artifact's own code does. Documents the assistant makes for you (PDF, Word, PowerPoint and Excel files) are stored with the outline they were built from and deleted together with the file. If you turn on \"Run code\" for a message, the files you attach to it go to the sandbox of your own Anthropic, OpenAI or Google account for that turn; I delete what I upload there afterwards, but the provider may keep some of it for up to 30 days. If someone sends me a report about content or a copyright notice, by email or with the report form on an artifact, I process it as described in the policy. You can delete your account and all its data from your settings at any time."
---

## What this policy covers

This policy applies to the hosted service at **besidka.com** only.

Besidka is open-source software. If you run your own copy of it, **you** are the data controller for that deployment. I have no access to it, and this policy does not apply to it. Under the EU AI Act you would also be the provider or deployer of that system, not me.

## Who is responsible for your data

The controller of your personal data is **Serhii Chernenko**, an individual resident in Poland (European Union).

Besidka is a personal, non-commercial project. It is **not a registered business** — there is no company, no sole proprietorship and no VAT registration behind it.

- Name: **Serhii Chernenko**
- Email: **:privacy-email-link{}**
- Location: **Poland (European Union)**

I tell you the country because it decides which supervisory authority is competent for you to complain to — see [Complaining](#complaining).

Besidka does not process personal data on the scale that requires a data protection officer, so none has been appointed. Write to the address above and you reach the controller directly, not a bot.

## How Besidka works, in one paragraph

Besidka is a free AI chat app. You bring your own API key from an AI provider (Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen), and you pay that provider directly for the usage. Instead of a provider key, you can route a chat through your own account with an AI gateway (Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter), and you pay that gateway directly. You can also add your own Brave Search or Exa API key to use as a web search tool, and you pay that search provider directly. If you want the optional [TypeSafe AI checks](#typesafe-ai-checks), you add your own TypeSafe AI key and TypeSafe AI bills you directly for them. If you want an AI app of your choice to reach your chats, projects or memory, you can [connect it](#connected-ai-apps) and approve exactly what it may do. **There is no payment relationship between you and me at all** — no subscription, no ads, no donations, no payment processor, and therefore no billing or card data anywhere in this policy. What I store is what is needed to run the chat app for you.

## What I store

Everything below lives in a Cloudflare D1 database, except files, which live in Cloudflare R2 object storage.

### Account and sign-in

- Your name, email address, whether your email is verified, and your avatar URL
- Your sessions, **including the IP address and browser User-Agent** recorded when the session was created
- Your linked Google or GitHub account, if you sign in that way, and which sign-in method you used last
- A hash of your password, if you sign in with a password. I never store the password itself.

### Your content

- Your chats and messages. The full message content is stored, including text, attachments references and model output.
- Your projects, including the project name, its instructions, its memory entries and its knowledge (see [Memory](#memory))
- Metadata about your files (name, size, type, storage key, expiry). The file itself is stored in Cloudflare R2.
- Your settings, such as your file retention period, your default reasoning effort and whether reasoning is shown expanded, whether the sidebar is pinned, your favourite models, whether links in deep research reports open without a warning, whether you were asked about push notifications and what you answered, which notices about changes to these pages you dismissed in the app, and which TypeSafe AI checks you left on (all of them are on until you switch one off)
- Deep research jobs, including the request and the resulting report
- Your documents: the PDF, Word, PowerPoint and Excel files the assistant or a connected app made for you, the outline each was built from, and a short record about each (see [Documents](#documents)). The outline and the file are stored in Cloudflare R2
- Your artifacts: the pages, components, diagrams and documents the assistant or a connected app made for you, every version of each, and short records about them (see [Artifacts](#artifacts)). The content is stored in Cloudflare R2
- Your memory entries and memory settings (see [Memory](#memory))
- A record of the legal change notices I sent you: which notice, when, whether it was delivered, and an error code if it failed (see [Email I send you](#email-i-send-you))
- Your consent record: when you accepted the Terms of Use and confirmed that you are 18 or over, when you gave your consent to store sensitive information and when you withdrew it, if you did, and which version of the text you agreed to (see [Sensitive information in your chats](#sensitive-information-in-your-chats)). If you consent to sending your messages to DeepSeek, Moonshot AI, Qwen, one of the other vendors listed there, or through a router or preset model, I also keep when you gave that consent and when you withdrew it (see [Transfers outside the EU](#transfers-outside-the-eu))

### Your API keys

Your provider API keys are stored **encrypted**. That column uses AES-256-GCM with a key derived using PBKDF2-SHA512 (5000 iterations), with a random salt and a random initialisation vector for every stored value.

The same applies to the keys you add for an AI gateway, a search provider or TypeSafe AI. A Cloudflare AI Gateway credential is stored as one encrypted value that holds your Cloudflare account ID, and the gateway name if you set one, together with the token, so those identifiers are encrypted at rest as well.

This is the only field encrypted in this way. Please do not read it as a claim that the whole database is encrypted at the application level.

### Campaign attribution

If you reach Besidka through a link that carries campaign tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) and you then create an account, I store those values with your account, in a separate table in the same D1 database. I store them once, as they were in the link you clicked, after a strict clean-up: only short values made of lowercase letters, digits, dots, hyphens and underscores are kept, and anything else is discarded. If your link had no campaign tags, nothing is stored. This is a first-touch record. It is never updated.

If your account is created after this feature started (accounts that already existed are not tracked), I also record, once per account and with or without a campaign link, whether you reached three early milestones: your account was created, you saved your first AI provider or gateway key, and you sent your first chat message that got a complete answer. A failed or interrupted answer does not count. That record holds your user id, the milestone name, the provider involved and a timestamp. It tells me whether a campaign led to real use, and it keeps each milestone from being counted twice.

The campaign tags travel in the web address and in the page's memory only. I do not set a cookie or write to your browser storage for this. See the [Cookie Policy](/cookie-policy).

### Connected AI apps

- The records that let an AI app you connected reach your account: your approval of that app and the permissions you gave it, the access and refresh tokens issued to it, and the details the app gave when it registered itself. What each one holds is under [Connected AI apps](#connected-ai-apps).

### Experimental feature records

- Which experimental features your account may use, where I set it by hand: a role I gave your account (such as tester), a feature I turned on or off for your account, with an optional end date, the version of the feature I chose for it and a short note of why, and the account id of whoever made the change
- Which experimental features that use your API keys you switched on or off on the Labs page, and when, and whether you objected to gradual rollouts and version tests
- A log of the changes made to feature access
- What each of these holds is under [Experimental features](#experimental-features)

### Sharing and notifications

- Share records, if you publish a chat with a share link, including the switches you chose for it (see [Public chat sharing](#public-chat-sharing))
- Artifact link records, if you publish an artifact with a link, including its expiry and switches (see [Public artifact links](#public-artifact-links))
- Progress saved by artifacts you open as a visitor, if the artifact's author allowed it and you are signed in (see [Saved progress in artifacts](#saved-progress-in-artifacts))
- Push notification subscriptions, if you turn push notifications on. A subscription contains the endpoint URL issued by your browser's push service and the public keys needed to encrypt a message to your browser.

### Operational logs

I record structured logs of requests and errors so I can keep the service working. What goes into those logs is described under [Operational logging](#operational-logging).

## Why I am allowed to process your data

| What I do | Legal basis |
| --- | --- |
| Create your account, sign you in, keep you signed in | Contract — GDPR Art. 6(1)(b) |
| Store your chats, messages, projects, files and settings | Contract — Art. 6(1)(b) |
| Store your AI provider, AI gateway, search provider and TypeSafe AI API keys, encrypted | Contract — Art. 6(1)(b) |
| Send your prompt, message history and attachments to the AI provider you chose | Contract — Art. 6(1)(b) |
| Send your prompt, message history and attachments through the AI gateway you chose to route a chat through | Contract — Art. 6(1)(b) |
| Send the search query your model writes from your prompt to Brave Search or Exa, when you turn that search on for a message | Contract — Art. 6(1)(b) |
| Store the sensitive information you choose to include in your chats, projects and files, and send it to the AI provider, AI gateway or search provider you chose | Your explicit consent — GDPR Art. 9(2)(a), in addition to the contract basis above |
| Keep the memory entries you write or ask the assistant to save, and add your memory to your messages | Contract — Art. 6(1)(b) |
| Let the assistant search your earlier chats and send short excerpts to the provider of the chat you are in | Contract — Art. 6(1)(b) |
| Decide which experimental features your account can use (a role or a feature I set for your account by hand, gradual rollouts and version tests), and keep a log of changes to feature access (see [Experimental features](#experimental-features)) | Legitimate interests — Art. 6(1)(f). You can object, see [Experimental features](#experimental-features) |
| Record which experimental features that use your API keys you switched on or off on the Labs page | Contract — Art. 6(1)(b), at your request |
| Keep your objection to gradual rollouts and version tests, so that I can honour it | Legal obligation — Art. 6(1)(c) with Art. 21 |
| Let an AI app you chose sign in to your Besidka account through the approval screen, and keep the records that needs (see [Connected AI apps](#connected-ai-apps)) | Contract — Art. 6(1)(b), at your request each time you connect an app |
| Give a connected AI app the chats, projects, files, memory and settings you approved when it asks with its token, and, if you allowed it, apply the changes it makes, including deletions | Contract — Art. 6(1)(b), on your instruction. For sensitive information in what it receives, also your explicit consent — Art. 9(2)(a), which the approval screen asks for separately for that app and those permissions |
| Store project knowledge and add it to messages in that project | Contract — Art. 6(1)(b) |
| Generate memory from your chats in the background ("Generate memory from chats") | Your consent — Art. 6(1)(a), given by turning on "Generate memory from chats" or by setting a project's automatic memory updates to **On**. Turning the account switch off, or setting the project to **Account setting** or **Off**, withdraws it. The account switch alone does not stop a project that is set to **On** |
| Update memory when you ask: Refresh, Update now, Build memory from past chats, Import, or telling Besidka what to remember | Contract — Art. 6(1)(b), at your request each time |
| Check text before it is saved to memory, and refuse never-stored items and sensitive topics | Legitimate interests — Art. 6(1)(f): keeping out of memory what should not be there. For sensitive information, also your explicit consent — Art. 9(2)(a) |
| Send text to TypeSafe AI for the TypeSafe AI checks you leave on (see [TypeSafe AI checks](#typesafe-ai-checks)), only if you saved a TypeSafe AI key | Contract — Art. 6(1)(b), because you added the key and left the check on. For sensitive information, also your explicit consent — Art. 9(2)(a) |
| Keep a record of your consents, of when you accepted the Terms of Use and of your age confirmation | Legal obligation to be able to prove consent — Art. 6(1)(c) with Art. 7(1) for the consents; legitimate interests — Art. 6(1)(f) for the Terms and age record |
| Send your messages to DeepSeek, Moonshot AI, Qwen, one of the other gateway vendors listed under [Transfers outside the EU](#transfers-outside-the-eu) (in China, Singapore, Malaysia or Indonesia), or to a router or preset model that can pick any provider, outside the EU without an adequacy decision | Your explicit consent to the transfer — Art. 49(1)(a) |
| Send the account emails listed under [Email I send you](#email-i-send-you) | Contract — Art. 6(1)(b) for verification, password reset and confirmation emails, and, mainly, for notices of changes to the Privacy Policy, the Terms of Use or the Cookie Policy, because the Terms are the contract and a change to them binds you only once it has been delivered to you (Polish Civil Code art. 384¹); legal obligation — Art. 6(1)(c) where Art. 13(3) or 14(4) requires me to tell you before I use your data for a new purpose; legitimate interests — Art. 6(1)(f) for security notices that tell you something on your account changed and for the rest of a legal notice, and you can object to that (Art. 21) |
| Send you push notifications | Your consent — Art. 6(1)(a) |
| Publish a chat behind a share link | Your consent — Art. 6(1)(a) |
| Make and store the documents you ask for, and the outline each was built from (see [Documents](#documents)) | Contract — Art. 6(1)(b). For sensitive information in them, also your explicit consent — Art. 9(2)(a), the one you give in [Sensitive information in your chats](#sensitive-information-in-your-chats) |
| Run code at your AI provider, when you turn "Run code" on for a message, and save the files it makes (see [Running code](#running-code)) | Contract — Art. 6(1)(b) |
| Store your artifacts and their versions, run them in a sealed frame and show them to you (see [Artifacts](#artifacts)) | Contract — Art. 6(1)(b). For sensitive information in them, also your explicit consent — Art. 9(2)(a), see [Sensitive information in your chats](#sensitive-information-in-your-chats) |
| Publish an artifact behind a link | Your consent — Art. 6(1)(a), for each link |
| Save the progress an artifact stores for you as a signed-in visitor, when its author allowed it | Contract — Art. 6(1)(b), at your request. For sensitive information in it, also your explicit consent — Art. 9(2)(a), see [Saved progress in artifacts](#saved-progress-in-artifacts) |
| Send a request an artifact makes to the AI provider whose key you use, after you confirm it | Contract — Art. 6(1)(b), at your request each time. For sensitive information, also your explicit consent — Art. 9(2)(a); for DeepSeek, Moonshot AI and Qwen, also your explicit consent to the transfer — Art. 49(1)(a). See [AI features inside artifacts](#ai-features-inside-artifacts) |
| Close an artifact's frame when it tries to leave the page, and keep artifacts safe for the people who open them | Legitimate interests — Art. 6(1)(f): protecting visitors from phishing and data leaks |
| Let search engines index a shared chat | A separate consent — Art. 6(1)(a) |
| Store non-essential preferences in your browser | Your consent — Art. 6(1)(a) and PKE Art. 399 |
| Measure page views and page-load speed with Cloudflare Web Analytics, only if you allow the Analytics category | Your consent — Art. 6(1)(a) and PKE Art. 399 |
| Remember which campaign link brought you to Besidka, and count the milestones above, so I can tell which of my own campaigns work | Legitimate interests — Art. 6(1)(f) |
| Count page views and interface events as aggregate counters | Legitimate interests — Art. 6(1)(f) |
| Handle reports of illegal content, copyright notices and disputes of removals, and keep a record of them (see [Reports and notices about content](#reports-and-notices-about-content)) | Legal obligation — Art. 6(1)(c) where EU or Polish law requires me to act, for example an order from a court or authority; otherwise legitimate interests — Art. 6(1)(f): dealing with abuse, protecting rights holders and the people whose content is reported |
| Error and operational logging | Legitimate interests — Art. 6(1)(f) |
| Security, abuse prevention and rate limiting, including for connected AI apps | Legitimate interests — Art. 6(1)(f) |

Where I rely on legitimate interests, my interest is keeping a free service running, debuggable and not abused. I only log what I need for that, and I never log the content of your messages. For campaign measurement my interest is knowing whether my own campaigns lead anyone to use the app, and I keep that to a few short tags and a handful of milestones. For the memory check, my interest is keeping card numbers, keys, sensitive topics and similar items out of memory; the check stores nothing but counts. For experimental features, my interest is releasing new features safely, a few accounts at a time, learning which version of a feature works better, and keeping a record of who changed whose access; the random choice looks at nothing about you, and a feature that uses your API keys always needs your own switch. You can object to this processing — see [Your rights](#your-rights).

Where I rely on consent, you can withdraw it at any time, and withdrawing is as easy as giving it.

## The AI provider you choose

This is the most important section of this policy, so please read it.

When you send a message, I send your prompt, the message history of that chat and any attachments to the AI provider whose API key you supplied. I send it **with your own API key**, on your instruction. If you use memory, what else goes with your message is described under [Memory](#memory).

Those providers are **independent controllers**, not my processors. I have no contract with them about your data. Your relationship is directly with them, under the terms of your own Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI or Qwen account. What they do with your content, how long they keep it and how you delete it is governed by their terms, not mine.

### Running code

Some models can run code on the provider's side, for example to read a spreadsheet and draw a chart. I offer this only for models you reach directly through **Anthropic, OpenAI or Google**, never through a gateway and not for xAI, DeepSeek, Moonshot AI or Qwen. It is off until you turn on **Run code** for a message, and the first time for each provider I ask you to confirm it.

- **What is sent.** Your prompt and history as for any message, and the files you attach to that message, which are uploaded to the provider's code sandbox for that turn (up to 10 files and 20 MB). The provider also receives the code the model writes, its output and the files that code creates. All of it goes with your own API key.
- **What I do with the result.** I download the files the code made, check them (type, size, and for PDF and Office files that they hold no macros or other active content) and save them as your files. I keep the code and its output in the message, cut to 32 KB each.
- **What I delete.** After the turn I delete the files I uploaded, the files I downloaded and, at OpenAI, the container, as far as the provider allows. Anthropic uploads also carry a one-hour expiry in case a turn is cut short.
- **Internet access.** I never turn on internet access for the sandbox.
- **What stays at the provider, outside my control.** See the provider paragraphs below. In short: Anthropic can keep container data for up to 30 days, OpenAI keeps abuse-monitoring logs for up to 30 days, and Google does not say how long its sandbox keeps data.
- **Cost.** The provider bills your own account for code execution, in addition to the tokens. The "Run code" row shows the provider's price. I cannot see your balance or your free hours, and I cannot cap the spend.
- **Not through connected apps.** A connected app cannot run code for you, because that spends your key.

### If you use a Google Gemini key

Google's Gemini API terms treat paid and unpaid use differently, and where you are matters.

- **In the European Economic Area, Switzerland or the United Kingdom**, Google's terms say its paid-service data terms apply to all your use, **including Google AI Studio and the unpaid quota**. Under those terms Google states that it does not use your prompts or responses to improve its products, that it logs them for a limited period only to detect and prevent policy violations, and that it processes them under its data processing addendum.
- **Elsewhere, on the free (unpaid) tier**, Google states that it uses the content you submit to provide, improve and develop its products and machine-learning technologies, that **human reviewers may read, annotate and process it**, and that you should **not submit sensitive, confidential or personal information** through it. If that applies to you, treat everything you type into Besidka as content Google may keep and review, or use a paid key or another provider.

Google's terms also say the Gemini API is for professional or business use, not consumer use, and that you must be 18 or over to use it. Whether your use fits Google's terms is between you and Google.

**Running code.** I send the files you attach inline with the request where I can. A file that is too large for that goes to Google's file store, which deletes it after 48 hours; I delete it after the turn where I can. Google does not say how long its code sandbox keeps data or whether it has internet access. On a free key outside the EEA, Switzerland and the UK, files you attach for code may be used by Google and read by human reviewers, as described above.

### If you use an OpenAI key

OpenAI states that it does not use data submitted through its API to train its models by default. It does retain logs for abuse monitoring, and those logs can contain your prompts, for **up to 30 days**.

**Running code.** The code runs in a container at OpenAI. OpenAI discards a container after 20 minutes without use, and I delete it, and any file I uploaded, after the turn. The abuse-monitoring logs above can also cover this. I have not found a statement on whether OpenAI's zero-data-retention option covers these containers, so do not assume it does.

### If you use an Anthropic key

Anthropic states that it does not train its models on content submitted through its API. It automatically deletes API inputs and outputs from its backend within **30 days** of receipt or generation, except content flagged for a Usage Policy violation, which it may retain longer for safety enforcement. There is no self-service option to delete this data sooner — deletion relies on that automatic 30-day window. **This does not describe code execution, the Files API or Skills**, which Anthropic says are not eligible for zero data retention.

**Running code.** Files you attach for code are uploaded to Anthropic's Files API with a one-hour expiry, and I delete them, and the files the code made, after the turn. While a file exists it is visible to every API key in your Anthropic workspace. Anthropic says container data can be kept for up to 30 days, that a deleted file may persist in requests that are already running, and that expiry is not a guarantee of deletion; its documentation does not say that deleting a file also removes the copy inside the container. Anthropic bills container time to your account, and bills it when files are attached even if no code runs; its free hours depend on your organisation.

**Anthropic's document skills.** If I offer Anthropic's skills for PDF, Word, PowerPoint and Excel files, I name them by their id on your Anthropic key. They run at Anthropic, under your own agreement with Anthropic, and are not eligible for zero data retention either. I do not bundle, copy or distribute them.

### I never train on your data

I do not train, fine-tune or evaluate any model on your chats, files or any other data you give me. There is no opt-out to offer, because it never happens.

Whether the **provider** trains on your content is a matter between you and that provider, decided by your own account and contract with them. The same is true of an AI gateway you route a chat through and of a search provider you use.

## The AI gateway you route through

Instead of sending a chat straight to an AI provider, you can choose to route it through your own account with an AI gateway: **Vercel AI Gateway**, **Cloudflare AI Gateway** or **OpenRouter**. This only happens when you add a key for that gateway and pick a model through it. I never route a chat through a gateway on my own initiative, and I never send a key you added for a provider directly through a gateway.

When you do, I send your prompt, the message history of that chat and any attachments to the gateway, **with your own gateway credentials**, on your instruction. Through Vercel AI Gateway or OpenRouter, the gateway passes them on, **in transit**, to the company behind the model you selected, so two companies receive your content, not one: the gateway and the model vendor behind it. Through Cloudflare AI Gateway, the models on offer are Workers AI models that Cloudflare itself hosts and runs, so Cloudflare both routes your request and generates the answer.

Your relationship with the gateway is directly with it, under the terms of your own gateway account. What it keeps, for how long, whether it logs your requests, and which model vendors it passes them on to and on what terms, is governed by its terms and by the settings of your gateway account, not by mine.

Those gateways are **independent controllers**, not my processors. I have no contract with them about your data. Your relationship is directly with them, under the terms of your own Vercel, Cloudflare or OpenRouter account.

### If you route through Vercel AI Gateway

Vercel's Data Processing Addendum describes Vercel as a processor for its own customers, but does not name AI Gateway specifically. Vercel's product documentation, not its legal terms, states AI Gateway uses zero data retention by default and does not use your prompts for training — but that commitment lives outside the contract, not inside it.

### If you route through Cloudflare AI Gateway

This is a different role from Cloudflare's hosting of Besidka described earlier in this policy. **AI Gateway logs your prompts and responses to your own Cloudflare dashboard by default** — you can turn this off yourself in your Cloudflare AI Gateway settings. Cloudflare states it does not use your content to train its models.

### If you route through OpenRouter

OpenRouter does not retain your prompts by default (zero data retention), but if you turn on prompt logging in your own OpenRouter account, you grant OpenRouter a broad licence to that content — a setting you control, not me.

## The search provider you choose

You can add your own **Brave Search** or **Exa** API key and turn it on as the web search tool for a message. Only then does the model you are chatting with write a search query from your prompt and the chat so far, and I send that query to the search provider **with your own API key**, on your instruction. The results come back to the model so it can use them in its answer.

If you also have a TypeSafe AI key, two optional [TypeSafe AI checks](#typesafe-ai-checks) apply. When you pick **Auto** web search in the chat input, your message and the last few turns go to TypeSafe AI, which decides whether a search is needed. Brave and Exa results fetched through Besidka are screened by TypeSafe AI for hidden instructions, and flagged results are left out of the model's context. Results from a chat model's own built-in web search cannot be screened. Each check has a toggle, and if TypeSafe AI is unavailable Besidka searches and uses results as it would without the key.

The query is written by the model from what you typed, so it can contain anything your prompt contained, including personal data. Please treat it the same way as your prompt.

Those search providers are **independent controllers**, not my processors. I have no contract with them about your data. Your relationship is directly with them, under the terms of your own Brave or Exa account. What they do with your queries, how long they keep them and how you delete them is governed by their terms, not mine.

### If you use a Brave Search key

Brave states that a record of the search queries submitted through a Brave Search API account is retained for a **maximum of 90 days**, for billing that account and for troubleshooting.

### If you use an Exa key

Exa states that its query fields are not intended for the submission of personal information, and that the queries it receives are **used to improve its products and technology, including by training and fine-tuning its models**. If you use an Exa key, treat every search query your model sends as content Exa may keep and train on.

## Memory

Memory lets the assistant remember things about you and your projects across chats. You control it on the **Memory** page in your profile.

### What memory holds

- **Memory entries.** Each has a title, a one-line description, a text, a category (profile, preferences, areas, topics or people), whether it belongs to your account or to a project, how it was created (by you, by the assistant when you asked it to remember something, generated from your chats, or imported), which chats it came from, and when it was created, changed and last read. Your account can hold up to 30 entries and each project up to 15. An entry holds up to 4 KB of text; your profile and preferences up to 1.5 KB each, because they are sent with every message.
- **Chat exclusions.** A flag on each chat you keep out of memory, stored with the chat.
- **Memory settings.** Whether memory is on, whether memory is generated from your chats and when you turned that on, each project's own automatic memory updates setting (the account setting, on or off) and when you turned it on, whether chat search is on, and which models update your account and project memory.
- **Past-chat runs.** If you build memory from past chats, a record of each run: its progress, counts, the model used, the cost estimate and the tokens used. The last 5 runs are kept.
- **Project knowledge.** Files, notes and folders you add to a project, the text taken from them, and a search index. The text is extracted in your browser. Originals, text and index are stored in Cloudflare R2, with a short record of each item in the database. If you link a folder from your computer, its name is kept only in your browser; see the [Cookie Policy](/cookie-policy).

### How memory is written

Nothing is written to memory unless you do one of these:

1. **You write or edit an entry** on the Memory page.
2. **You ask the assistant** in a message to remember or forget something. It saves it and shows "Saved to memory", with Undo. The assistant saves something only when your current message asks it to.
3. **You turn on "Generate memory from chats", or set a project's automatic memory updates to On.** It is off until you turn it on. Then, about ten minutes after you stop using a chat, Besidka sends the new part of that chat to the model you chose for memory, **on your own key**, and saves the lasting facts and preferences it finds. It sends your messages, with the assistant's replies as context, and never files, tool results or web results. It runs only for chats you use after turning it on. You can override this for a single project: every project has an **automatic memory updates** setting, **Account setting** (the default, which follows this switch), **On** or **Off**. **On** and **Off** beat the account switch for that project's chats. **On** is a separate, explicit choice to have that project's chats read in the background on your own key even when the account switch is off, and like the account switch it covers only messages written after you set it. **Off** stops it for that project. Setting a project from **Off** back to **Account setting** starts from that moment, so nothing written while it was off is read. Memory turned off, or a disabled project, stops it whatever the setting. Earlier chats are read only when you start a run yourself. Each run is billed to your key.
4. **You start a run yourself**: **Refresh** on a project, **Update now**, **Build memory from past chats**, or **Import** from another assistant. Building from past chats shows a cost estimate first, reads at most 200 chats and 4 million tokens per run, and can be cancelled. When you import, the text you paste is not stored, only the entries made from it.
5. **You tell Besidka what to remember** in your own words, in the box on the Memory page or on a project. Besidka sends your text, with never-stored items removed, and a list of the entries it may change to the model you chose for memory, **on your own key**. The model proposes changes; nothing is saved until you tick the ones you want and apply them. Your text is not stored.

You can also exclude a single chat from memory. An excluded chat is never read to write memory, the assistant cannot search it or read it, entries that were generated only from it are removed, and a branch of it is excluded too. Entries you wrote or asked the assistant to save stay.

### What memory never keeps

Every one of those paths goes through an automatic check on my server before anything is saved.

- **Never stored, even if you ask:** payment card numbers; IBAN and bank account numbers; government ID numbers (PESEL, SSN); tax identification numbers; passport numbers; API keys and access tokens; JSON Web Tokens; passwords and credentials; private keys; criminal history; immigration or residence-permit status; precise home address; live location; other highly sensitive identifiers.
- **Sensitive topics are refused:** health, religious or philosophical beliefs, political opinions, racial or ethnic origin, sex life or sexual orientation, trade union membership, genetic and biometric data, and also ongoing legal disputes and drugs. There is no setting that allows them.

The check uses fixed word and pattern rules in English, Ukrainian, Polish and Russian, not an AI model. It is a safeguard, and it can miss unusual wording. If you add a **TypeSafe AI** key under **Profile → API Keys → Smart checks**, an extra check runs after it: Besidka sends each entry the rules allowed, with never-stored items removed, to TypeSafe AI's Jev model, which looks for sensitive information and, for entries a model wrote, checks that the entry really comes from your text. That extra check can only refuse more, never let through something the rules refused, and entries the rules refused are never sent. If TypeSafe AI is unavailable, memory is saved on the rules alone. With the same key, a second check can run before memory is generated from a chat: Besidka sends the chat text, with never-stored items removed, to TypeSafe AI to see whether anything is worth remembering, and skips the memory model when nothing is. If TypeSafe AI is unsure or unavailable, memory is generated as usual. Both are described under [TypeSafe AI checks](#typesafe-ai-checks). If you see something in memory that should not be there, delete it. Before chat text is sent to the memory model, never-stored items such as card numbers and keys are removed from it. My logs record only how many items were refused and in which category, never the text. Because this check reads text that may contain sensitive information, it is covered by your consent described in [Sensitive information in your chats](#sensitive-information-in-your-chats).

### How memory is used

- **Use memory** (on unless you turn it off): a short index of your memory is added to each message you send. It holds your profile and preferences text and a one-line description of every other entry. The assistant can read a full entry when it needs it. In a project, the project's entries are used, plus your account entries if the project is set to use them.
- **Search and reference chats** (on unless you turn it off): the assistant can search your earlier chats and read short excerpts from them. You see it as a visible step with links. Your current chat is not searched. In a project that does not use account memory, only that project's chats are searched.
- **Project knowledge** is added to messages in that project in full when it fits the model's limits, and is searched and quoted otherwise.

### Who receives memory

- The **AI provider or gateway of the chat you are in** receives the memory index, any entry the assistant reads, chat excerpts and project knowledge, with your messages.
- The **provider of the model you chose for memory** receives the chat text it works on, when memory is written from chats or from your own words (paths 3, 4 and 5). By default that is "Same as chat", the model you are chatting with. If you choose a different one, that company receives the text.
- **TypeSafe AI**, only if you saved a TypeSafe AI key: the text of each memory entry about to be saved, after never-stored items are removed, and, for entries a model wrote, a short excerpt of your text the entry was taken from. Entries the automatic check already refused are never sent. Before memory is generated from a chat, the chat text with never-stored items removed is sent too. See [TypeSafe AI checks](#typesafe-ai-checks).
- Nobody else. Cloudflare stores it for me as my processor. Where these companies are, and what that means, is under [Transfers outside the EU](#transfers-outside-the-eu).

### Profiling

Generating memory from chats is **profiling** under GDPR Art. 4(4): an AI model reads your chats and records things about you, such as your preferences, interests and work. It only happens if you turn it on, for your account or for a single project, and its only use is to give the model context in your own later chats.

It is not the kind of automated decision GDPR Art. 22 is about. Nothing is decided about you on the basis of memory: no access is granted or refused, nothing is scored, and nobody else uses it. It changes only what the model knows when it answers you, and you can see, edit and delete every entry.

### Your controls

- Edit or delete any entry, or **Reset** to delete all of them.
- Turn **Use memory** off: entries are kept, but they are no longer added to your messages and nothing new is generated.
- Turn **Generate memory from chats** off: nothing new is generated in the background from your own chats or from projects that follow the account setting. A project set to **On** keeps running until you set that project to **Account setting** or **Off**. You choose whether to keep the entries it already made or delete them.
- Turn memory off for a single project.
- Set a project's automatic memory updates to **Off**: nothing new is generated in the background from that project's chats, whatever the account switch says.
- **Export JSON** on the Memory page downloads your memory entries and memory settings.
- Withdraw your consent to store sensitive information in **Profile → Security → Privacy & consent**: Besidka then stops all memory work until you consent again.
- Deleting a chat deletes generated entries that came only from that chat. Entries you saved yourself or imported stay, because you asked for them. Deleting a project deletes its entries and its knowledge items; the original files stay in your file library. Deleting your account deletes everything.

## TypeSafe AI checks

TypeSafe AI checks are optional. They exist only if you add your own **TypeSafe AI** key, and they add no chat models. TypeSafe AI's Jev model answers short yes/no questions with a probability. It never writes an answer to your messages.

Each check has its own toggle under **Profile → API Keys → Smart checks**. All of them are on once you save the key, and you can switch any of them off, or delete the key to stop all of them. Every check is only a helper. If TypeSafe AI errors, times out or is rate-limited, Besidka behaves as it does without the key.

TypeSafe AI receives only the text each check you left on needs:

| Check | What is sent, and when | If TypeSafe AI is unavailable |
|---|---|---|
| Memory checks | When a memory entry is about to be saved: the entry text, with never-stored items removed, and a short excerpt of the text it came from. It can refuse an entry the built-in checks allowed, never allow one they refused | Memory is saved on the built-in checks alone |
| Auto web search | Only when you pick **Auto** web search in the chat input, for each message: the message and your last three turns, each cut to 4,000 characters, with never-stored values removed. A message with a link, a domain or a word such as "today" or "latest" is searched without asking TypeSafe AI, so nothing is sent for it. Jev decides whether a web search is needed | Besidka searches as usual |
| Memory pre-filter | Before memory is generated from a chat, and only when that runs ("Generate memory from chats", "Build memory from past chats" or a project Refresh; never for "Update memory now" or "Import memory"): the chat text, with never-stored values such as passwords and card numbers removed, in chunks of up to about 8,000 tokens. If Jev finds nothing worth remembering, the memory model is skipped, which saves your own key's cost | If Jev is unsure or unavailable, memory is generated as usual |
| Prompt-injection screening | The extracted text of project knowledge files and notes, and the title and snippet of each Brave and Exa search result fetched through Besidka. Flagged project files wait for your review. Flagged search results are left out of the model's context. A flag never deletes anything. Results from the chat model's own built-in web search cannot be checked | Project files and notes are used unscreened and checked again later, usually within the hour. Search results are used unscreened |
| Re-ranking | When your past chats or project knowledge are searched: the search query and short excerpts (about 300 tokens each, up to 30 per search) of the candidate results | The original search order is kept |
| Share personal-data check | When you open the share window for a chat, before you publish a public link: the chat text being shared, with never-stored values such as card numbers, and emails and phone numbers, removed. Besidka first looks for emails, phone numbers and similar identifiers itself, and only the TypeSafe AI step reads the text. It shows a warning only and never blocks sharing | A generic "check before sharing" reminder is shown, next to anything Besidka's own check found |
| Past-chat retrieval | For models or sends without chat search tools (a model without tool calling, for example), and only while **Search and reference chats** is on, for each message: the message and your last three turns, with never-stored values removed. If the message refers to an earlier, separate conversation, Besidka searches your past chats in its own database and adds relevant excerpts. A message that names an earlier chat ("last time", "we discussed") starts the search without asking TypeSafe AI | Without a TypeSafe AI key, or with the check switched off, no pre-search is done. If TypeSafe AI is unsure or unavailable, Besidka searches your past chats anyway |

The text can contain whatever your chats, projects and memory contain, including sensitive information. The memory pre-filter reads whole chat text, so it is the check that sends the most. If that matters to you, switch it off.

TypeSafe AI, in the United States, is an independent controller towards me, like the AI providers whose keys you add: I have no contract with it about your data, and your own terms with it apply, and the recipient details are in [Who else receives your data](#who-else-receives-your-data) and [Transfers outside the EU](#transfers-outside-the-eu). The calls are billed to your own TypeSafe AI account. My logs keep only counts, scores, statuses and timing for these checks, never the text.

## Connected AI apps

Besidka has a read-and-write interface for AI apps, a server at `https://besidka.com/mcp` that speaks the Model Context Protocol. An AI app you choose, such as a chat assistant or a coding tool from another company, can connect to it so that it can work with your Besidka data. To make sure only you decide who connects, Besidka also runs the sign-in step for that interface (OAuth 2.1). Nothing is connected unless you start it from the app and then approve it on a Besidka screen while you are signed in.

### What a connected app can reach

On the approval screen you choose what the app may do. These are the permissions:

- **Read your chats**: list and search your chats, read their messages and see whether a chat is shared, when the share expires and what it shows. The link itself is shown only to an app that may also change your chats.
- **Read your projects**: your projects, their instructions and their knowledge items, and each project's memory state, including its own automatic memory updates setting and whether automatic updates are in effect for it.
- **Read your memory**: your memory entries.
- **Read your files**: your file list and storage use, and the text of your text files.
- **Read your settings**: your display preferences, favourite models and memory switches, including which models memory uses and whether automatic memory updates are on.
- **Change your chats** (off until you tick it): rename, pin, move and copy (branch) chats, exclude a chat from memory or include it again, and stop sharing a chat.
- **Change your projects** (off until you tick it): create, rename, pin and archive projects, edit a project's instructions and settings, including its memory switch and, for its automatic memory updates, setting it to follow your account setting or to off, never on, and add and edit notes and text in its project knowledge.
- **Change your memory** (off until you tick it): add and edit memory entries. Everything it writes goes through the same never-stored and sensitive-topic checks as any other memory (see [What memory never keeps](#what-memory-never-keeps)).
- **Change your files** (off until you tick it): create text files, create documents (PDF, Word, PowerPoint or Excel files) from content the app supplies, and rename files. A document is built by me from what the app sends; no API key of yours is used, and the app can say whether the content was written by AI. A document or text file it saves is not screened for hidden instructions the way project notes can be, and a document it makes is marked as created by a connected app, and as AI-generated only if the app says so (see [Documents](#documents)).
- **Change your settings** (off until you tick it): your display preferences, favourite models, sidebar pinning, and the memory and chat search switches.
- **Read your artifacts and their share links**: list your artifacts, read their content and versions, and see which public links to them are active.
- **Create and edit your artifacts** (off until you tick it): create artifacts, add new versions to them, and stop an artifact's public links.
- **Publish artifacts as public links (up to 30 days)** (off until you tick it): create a public link to one of your artifacts. Anyone who has that link can open the artifact, as with a link you create yourself (see [Public artifact links](#public-artifact-links)), but a link made by an app always expires within 30 days, never lets visitors save progress or use AI features, is marked in your list of links as created by that app, and an app can create only a limited number a day.
- **Delete your data** (off until you tick it): permanently delete chats and single messages, projects, project knowledge, files, artifacts and memory entries, and reset memory. Deleting a chat, message, project, knowledge item, file, artifact or memory entry, and resetting memory, needs this permission. Deleting an artifact also deletes its versions, its links and the progress visitors saved in it.

**Deleting through a connected app is permanent, like deleting in Besidka.** There is no trash and I cannot undo it for you (see [Backups](#backups)). Deleting is its own permission, **Delete your data**, and it is off until you tick it. A "Change" permission cannot delete those things directly, but some changes remove or replace data as a side effect: excluding a chat from memory removes memory entries that were learned only from that chat, stopping a share removes its link, and editing replaces the old text. Apps you connected before this permission existed do not have it, and have to ask you for it. Each permission is separate, and you tick only the ones you want.

**When a permission grows.** A new kind of permission has to be asked for on the approval screen. When I extend what an existing permission can do, apps you already approved for that permission get the extension without a new prompt, because I record your approval by permission, not by each action. I only do this for changes that cannot delete a record or spend your keys. Creating documents is such a change for an app you approved to change your files. They can still replace something: editing a knowledge item replaces its old text. For example, "Change your projects" now also covers renaming, pinning and archiving a project and editing a knowledge item, and "Read your chats" now also shows whether a chat is shared. After such a change, check **Profile → Connected apps** to see what each app may do. You can also remove a permission there that you do not want the app to keep (see [Disconnecting an app](#disconnecting-an-app)).

A connected app cannot send messages in your chats, run code or use your API keys in this version, and your API keys are never among the data it can read. It cannot create or change a public share link to a chat, although it can stop sharing a chat. The only public link it can create is a link to an artifact, and only with the separate **Publish artifacts** permission above. It cannot read the progress other people saved in your artifacts, use AI features inside an artifact, or send or handle a report. It cannot add, read or change your API keys, sessions, connected apps, consents, notification subscriptions, email address, password, two-factor authentication or passkeys, and it cannot delete your account. It cannot turn on anything that spends your API keys by itself, such as automatic memory updates, or change which models memory uses. That includes setting a project's automatic memory updates to **On**: it can only stop them for a project or return a project that is not set to **Off** to your account setting; a project set to **Off** can only be changed in Besidka, and turning it back covers only messages from then on. It can switch memory and chat search on or off, which changes what Besidka sends to your provider when you chat. Turning on account memory is refused while automatic memory updates are on for your account or for any project, and turning a project's memory back on is refused while that project is set to **On**, because that would resume background updates. Turning a project's memory or a chat's inclusion back on otherwise only covers messages from then on. What it can read is whatever your chats, projects, files, artifacts and memory contain: sensitive information, other people's personal data, and things you wrote or the model produced.

### What I process and keep for this

- **The app's registration.** An app registers itself with Besidka before you see it, without an account. That record holds what the app sent: its name, its redirect web addresses and the other details the app chose to send about itself. It is the app's data, not yours. I delete the registration automatically once it is more than 7 days old and no approval and no token for it exists any more, which covers an app nobody approved and an app whose approvals have all ended. While an approval or a token exists, I keep it.
- **Your approval.** Your user id, the app, the permissions you gave and when you gave them and, to within about 15 minutes, when the app last used them. You can reduce it later by removing permissions, but never add to it: a permission the app does not have is only given when you approve it again from the app. It ends when you disconnect the app. If an approval has no live token left and the app has not been used for 30 days, I delete it automatically (see [How long I keep things](#how-long-i-keep-things)).
- **Tokens.** An access token lets the app call the interface for **15 minutes**. A refresh token lets it ask for a new access token without asking you again, lasts **30 days at most**, and is replaced each time the app uses it. Each token record holds your user id, the app, the permissions and its expiry. A token keeps the permissions it was issued with, but what it can do is only what your approval still includes, which I check on every request. So when you remove a permission from your approval, it stops working on the app's next request, without waiting for the token to expire.
- **Signing keys.** The keys that sign access tokens. They hold no personal data and are stored encrypted by the sign-in library with the server secret.
- **Logs.** My request logs show that a connected app called the interface, which app, which action and how long it took, with your pseudonymous user id. They never hold the content that was read or written.

### Why I may, and what your approval means

I do this because you ask me to. Connecting an app is part of the service you use, and the approval screen is your instruction to me to hand that app, and only that app, the data you ticked (GDPR Art. 6(1)(b)). It is a separate instruction for each app. It is not me deciding to share your data, and I do not share it with an app you did not approve.

Your chats, projects, files and memory may contain sensitive information, so the approval screen also asks for your **explicit consent** (GDPR Art. 9(2)(a)) to send it to that app, for the permissions you ticked. That is separate from the consent described under [Sensitive information in your chats](#sensitive-information-in-your-chats), which covers the providers, gateways and search providers whose keys you add and does not cover apps you connect. I record it with your approval. If your consent under [Sensitive information in your chats](#sensitive-information-in-your-chats) is missing or withdrawn, a connected app cannot read or change anything until you consent again, in the same way that you cannot send messages without it.

### The app and its maker receive the data under their own terms

Whatever an app receives from Besidka is handled by that app and the company behind it. They are **independent controllers**, not my processors. I do not choose them, I have no contract with them about your data, and I cannot see or control what they do with it. Whether the app keeps it, uses it to train a model, shows it to staff or sends it elsewhere is set by their privacy terms and your account with them, not by this policy. Read them before you connect. Some apps run on their maker's servers; some run on your own computer and send what they read on to a model provider you configured there.

The app may be run outside the EU or EEA. I do not know where, because I do not choose or contract with it, and I cannot offer a safeguard of my own for it. I treat what I send as sent on your instruction, and I tell you this on the approval screen. If you approve after that warning, it is also your explicit consent to a transfer to a country without an adequacy decision, in case the law treats it as a transfer by me (GDPR Art. 49(1)(a)). If that is not acceptable to you, do not connect the app. I would rather say plainly that this question is not settled than claim that no transfer rule applies to it.

### Disconnecting an app

Go to **Profile → Connected apps** and disconnect the app. That ends its approval and its refresh token, and the app stops working **at once**: every request it makes is checked against your approval, so its very next call is refused. Without a disconnect, an access token still expires on its own after 15 minutes. You can also remove the connection inside the app, but only disconnecting on Besidka ends it on my side.

If you want an app to keep working with less, remove single permissions there instead of disconnecting. This takes effect on the app's next request, the same way. Removing a permission can only take something away: to give an app a permission it does not have, reconnect it from the app and approve the new options. Some apps connect again each time you reconnect them and leave the older connections behind, so Besidka groups connections with the same name and offers **Disconnect older**, which ends every older connection in the group, after you confirm. Besidka never ends a connection you still use. Only an idle one, with no live token and no use for 30 days, is deleted by the hourly cleanup. An approval that has no live token and has not been used for 30 days is not listed (the hourly cleanup deletes it).

Disconnecting does not erase what the app already read or saved. I cannot delete that, because it is in the app's hands. Use the app maker's own controls and privacy requests.

### Changes made through an app

If you allowed an app to change things, its changes are saved as if you made them: renames, pins and moves of chats and projects, project instructions, project notes, text files, memory entries and your settings, and, if you also ticked **Delete your data**, anything it deletes. You can see and edit what it wrote in Besidka as usual, but a deletion is permanent. For a chat that is generating a reply, deleting and copying are skipped or refused on a best-effort basis. An app can be led astray by text it reads, for example a web page or a document that contains instructions meant for the AI. Allow changes only for apps you trust, tick only the permissions you need, and check what they do. If you notice an app doing something you did not want, remove its permissions or disconnect it under **Profile → Connected apps**.

### Limits

I limit how many requests an app can make, and I may disable an app, or refuse to register one, if it abuses the interface, tries to reach more than you approved or looks like it is impersonating another app. That does not affect your data in Besidka.

## Experimental features

New features often reach a few accounts before everyone. Experimental features may change or be removed (see the [Terms of Use](/terms-of-use)). This section explains how a feature reaches your account and what I record about it.

### How a feature reaches your account

- **By hand.** I can turn an experimental feature on or off for one account, with an optional end date, give an account the tester role, or choose which version of a feature an account sees.
- **Gradual rollout.** I can turn a feature on for a share of accounts, for example one in ten. Which accounts are in that share is decided at random: a fixed calculation over your account number and a random value kept for that feature, which gives the same answer every time, so a feature does not appear and disappear between visits. It looks at nothing about you. Your country, your email address, how you use Besidka and what you write play no part, and I do not choose accounts by any of them.
- **Version tests.** For a feature in a gradual rollout I can show different versions to different accounts, chosen in the same random way, to learn which version works better. Only features that do not use your API keys are tested in versions, so a version test never changes what is spent on your keys.

**Gradual rollouts and version tests start no earlier than 19 December 2026**, and not before the Labs page described below is available. Until then they are switched off for everyone, and I turn experimental features on by hand only for my own account and for testers whom I told beforehand what is recorded and how to object.

A feature that uses your own API keys never switches on by itself. Even when your account may use it, you have to switch it on yourself on the Labs page (**Profile → Labs**), and you can switch it off there at any time. The Labs page is being added; it will be there before any such feature is offered and before any gradual rollout starts.

### What I record

- **Your feature access.** The role and the per-account settings listed under [What I store](#experimental-feature-records), with the account id of whoever made the change. A setting with an end date stops applying on that date, and the record stays until it is removed or you delete your account.
- **Your Labs choices.** For each feature that uses your keys, when you last switched it on and when you last switched it off, and, if you objected to gradual rollouts and version tests, when you did.
- **The change log.** Each change to feature access: how it was made, the account that made it, the account it applied to, the feature, what kind of change it was, and the setting before and after, including the version, the end date and the note. It has no email or name fields; the note is a short free-text reason, which I write without names. The log is deleted automatically after **12 months**. If you delete your account, your account id and the notes are removed from every entry about your account (where you made the change or it applied to you), and the rest of the entry (the feature, the kind of change, when) stays until its 12 months are over.
- **Log lines.** When a gradual rollout or version test gives you a feature, the request log line records the feature, the result, the version and the reason, with your pseudonymous user id. When feature access, a Labs switch or your objection changes, the log line records the account ids involved, the feature and the change, never an email address or the note. I use these lines to put feature access right again if I ever have to restore the database from a backup (see [Backups](#backups)). When I use the admin area, the log records which list I opened and how many results it had, never what I searched for.
- **Feature counters.** When a gradual rollout or version test gives you a feature, that is also counted on the server with the feature, the version and the reason, without a user id (see [Analytics](#analytics)).

Your random position in a rollout is not stored. It is calculated each time it is needed. Nothing about experimental features is stored in your browser.

### Why I may, and how to object

My legal basis for deciding feature access, for gradual rollouts and version tests, for the change log and for the log lines is legitimate interests (GDPR Art. 6(1)(f)): releasing new features safely, a few accounts at a time, finding problems before they reach everyone, learning which version works better, and keeping a record of who changed whose access, so that changes can be checked and undone. Being in a rollout or not, or seeing one version or another, does not change your rights, what you pay your providers or how your data is used elsewhere. Your Labs switches for features that use your keys rest on the contract (Art. 6(1)(b)): you asked for that feature.

**You can object to gradual rollouts and version tests at any time** (GDPR Art. 21) by writing to **:privacy-email-link{}**. The Labs page will also have a switch for it, **Include my account in gradual rollouts and experiments**, which is on until you turn it off. Once your objection is recorded (at once with the switch), your account is left out of every gradual rollout and version test. A feature I turned on for your account by hand stays, and I can still turn one on for you if you ask. If you do not want a role or a feature I set for your account by hand, tell me and I will remove it. I keep your objection with your account so that I can honour it (Art. 6(1)(c)). You can also object to the change log and the log lines; they are my record of what was changed, so I may keep them only where I have compelling legitimate grounds that override your interests, rights and freedoms, or where I need them for legal claims, and I will tell you if I do.

### Who can change feature access

Only I hold the admin role. The admin area can be opened only from an account with a verified email address and two-factor authentication turned on. In the admin area I can search accounts by email address or name to change their access. Nobody else receives the records described in this section, apart from Cloudflare and Axiom, which store and log them for me (see [Who else receives your data](#who-else-receives-your-data)).

## Artifacts

An artifact is something the assistant makes for you in a chat, or an AI app you connected makes through your account: a web page, an interactive component, an image drawn as code (SVG), a diagram or a document. It opens in a panel next to the chat, and you can keep working on it in later messages. Artifacts are an [experimental feature](#experimental-features): they reach accounts step by step, starting with my own account and testers.

### What an artifact holds

- **The content of every version.** Each change makes a new version, and earlier versions are kept so you can go back. The content is stored in Cloudflare R2, under your account.
- **A short record of each artifact**: its title, its kind, which chat and message it came from, whether it was made in a chat or by a connected app, the size and a checksum of each version, which model wrote a version where that is recorded, and when it was created and changed.
- **Limits.** A version can be up to 512 KB, an artifact can have up to 50 versions, and all your artifacts together can use up to 25 MB.

The content is whatever the assistant or the app wrote, which is usually built from what you wrote in the chat. It can contain personal data, including sensitive information and other people's data. With every later message in that chat, the latest version of up to three of its artifacts, up to 30,000 characters each, is sent to the AI provider of the chat as part of the chat, so that the assistant can keep working on them (see [The AI provider you choose](#the-ai-provider-you-choose)).

### Where artifacts run

An artifact does not run on besidka.com itself. It runs in a sealed frame inside the page, loaded from a separate address that I run on Cloudflare only for this. The frame cannot read your Besidka session, and it sees only what Besidka hands it: the artifact itself and, where you allowed it, the progress it saved for you and the answers to its AI requests. It cannot submit forms and is not allowed to contact the internet: the libraries an artifact may use, such as React, are served from that same address, and artifacts cannot load anything from other companies. When you open an artifact, your browser contacts that address, so Cloudflare sees your IP address and browser details there, as for any page of Besidka. A list of those libraries and their licences is published at that address.

One honest limit: browsers let a page inside such a frame try to navigate itself to another address, and anything the artifact puts into that address would leave with the request. Besidka's pages tell the browser not to load any other address into the frame, and Besidka closes the frame and shows an error if an artifact tries. That has been tested in the engines behind Chrome and Safari, but it may not stop every attempt in every browser. So **never type a password, payment details or anything else secret into an artifact**, especially one someone else made. The banner above every public artifact says the same.

### Who can see your artifacts

Only you, unless you share them, plus the AI provider of the chat they belong to (see [What an artifact holds](#what-an-artifact-holds)) and any AI app you connected with permission to read your artifacts (see [Connected AI apps](#connected-ai-apps)). Nobody else can open your artifacts in the app, and I do not look at them, unless they are reported to me or an authority asks for them (see [Reports and notices about content](#reports-and-notices-about-content)). An artifact becomes visible to others in two ways:

- **A public artifact link** that you create for it (see below).
- **A shared chat.** If you share a chat that contains an artifact, anyone with the chat link can open the versions of the artifact that appear in that chat, for as long as the chat share is active. They cannot save progress or use AI features there, and they can report the artifact.

### Public artifact links

Publishing an artifact is off unless you create a link for it. It is based on your consent, for each link, and you can revoke it.

- **Anyone with the link can open the artifact. No account is needed.** An unlisted address is not access control. Treat an artifact link like a public web page you have chosen not to advertise.
- **Artifact links are never indexed.** The pages tell search engines not to index them, and they are not in the sitemap. There is no switch to change that.
- **Every public artifact page carries a banner** that says the artifact was made by AI for a Besidka user and was not reviewed by me, and a **Report** button.
- You choose the expiry (1 hour, 1 day, 1 week, 1 month, 1 year, or never), and whether the link always shows the latest version or one fixed version. An artifact can have up to 10 active links.
- Two switches decide whether signed-in visitors may **save their progress** and use **AI features** in the artifact with their own key. Both start off.
- For visitors, the page sets no cookie beyond the necessary ones in the [Cookie Policy](/cookie-policy) and never loads Cloudflare Web Analytics.
- Before you publish, Besidka checks the artifact for emails, phone numbers and similar identifiers and warns you if it finds any. It only warns.
- At first, only accounts I invite can create public artifact links.

A link that a [connected AI app](#connected-ai-apps) created always expires within 30 days, never lets visitors save progress or use AI features, and is marked in your list of links as created by that app.

**Revoking a link** stops access through me immediately. I keep the record of a revoked or expired link with the artifact until you delete the artifact, so a link I took down cannot come back by itself. As with shared chats, I **cannot** recall copies, screenshots or downloads that visitors made while the link was live (see [Revoking a share](#revoking-a-share)).

### Saved progress in artifacts

Some artifacts, such as a quiz or a tracker, save what you enter so that you can continue later. This works only when you are **signed in**, and, for someone else's artifact, only when its author switched on saved progress for the link you opened. If you are not signed in, an artifact keeps its state in the page's memory only, and it is gone when you close the page.

- **What I store.** Your user id, the artifact, and the values the artifact saved, up to 100 KB and 64 entries for each artifact. I do not interpret them: they are whatever the artifact's code chose to save, for example your quiz answers.
- **Who can see them.** You, through the artifact. The artifact's author cannot see them in Besidka: there is no page, export or connected-app permission that shows one person's saved progress to another. I do not use them for anything, they are never sent to an AI model, and my logs hold only ids and sizes. But the artifact's own code runs in your browser and receives what it saved, and code that its author wrote could send it out in the way described under [Where artifacts run](#where-artifacts-run). Do not save anything in an artifact that you would not give its author.
- **Sensitive information.** What you enter can reveal health, beliefs or other sensitive information, for example the answers to a symptom tracker. Saved progress therefore needs your explicit consent; see [Sensitive information in your chats](#sensitive-information-in-your-chats).
- **How long.** Until you use **Reset saved progress** in the artifact, until the artifact is deleted, or until you delete your account. For someone else's artifact, I also delete it 30 days after the last active link to that artifact ended, and at once when I take the artifact down.

### AI features inside artifacts

An artifact can ask an AI model a question, for example to explain an answer in a quiz. Besidka never lets an artifact do that on its own:

- It works only when you are signed in, and, for someone else's artifact, only when its author switched AI features on for the link you opened.
- It uses **your own API key** for a provider you added directly (not a key for an AI gateway), and your provider bills you for it.
- Before a request is sent, Besidka shows you the artifact's title, the provider and model, the full text the artifact wants to send, including any instructions it gives the model, the most it can cost and how many requests you have left. It also tells you that **the artifact's author wrote that text, not you and not me**, and that your provider's terms for your account apply. Nothing is sent until you confirm. For your own artifacts you can choose not to be asked again until you close the artifact; for an artifact you opened through someone else's link you confirm each time.
- My server sends the request to your provider, like a chat message, and returns the answer to the artifact. The request carries only that text and a short fixed instruction from Besidka: no tools, no memory, no chat history and no web search.
- There are limits of 30 requests an hour for each artifact and 200 a day in all, and each answer is short.
- **I store neither the text nor the answer.** My logs record the artifact, the provider and model, the number of tokens, the cost and the time taken.
- The provider receives the request as described under [The AI provider you choose](#the-ai-provider-you-choose), and for DeepSeek, Moonshot AI and Qwen only after your consent to the transfer (see [Transfers outside the EU](#transfers-outside-the-eu)). Because a stranger wrote the text, your provider may hold you responsible for it under its usage rules, so read it before you confirm.
- AI features inside artifacts need your explicit consent to sensitive information; see [Sensitive information in your chats](#sensitive-information-in-your-chats).

### How long artifacts are kept, and deleting them

- An artifact is kept until you delete it or delete your account. **Deleting a chat does not delete its artifacts**: they stay on your **Artifacts** page, marked as coming from a deleted chat. Delete them there.
- Deleting an artifact deletes all its versions, its links and the progress visitors saved in it. Copies can stay for up to 30 days in backups (see [Backups](#backups)).
- If I take an artifact down after a report, it is disabled, not deleted, and you can still delete it, unless an authority ordered its removal as terrorist content or asked me to preserve it: then I keep it, and the records about it, for six months after the removal, or as long as the authority lawfully requires, and I delete it after that.
- You can download any version of your own artifacts from its panel.

## Documents

A document is a PDF, Word, PowerPoint or Excel file that the assistant makes for you in a chat when you ask for one, or that an AI app you connected makes through your account. Documents are an [experimental feature](#experimental-features): they reach accounts step by step, starting with my own account and testers.

### What a document holds

- **The outline.** The assistant writes an outline of the document first: its text, tables, slide text, sheet cells and which of your own images to use. The outline is stored in Cloudflare R2, under your account, and can be up to 200,000 characters (2,000,000 for a spreadsheet). It is built from what you wrote in the chat, so it can contain personal data, including sensitive information and other people's data.
- **The file.** It is made from the outline and stored as one of your files, in R2, so it counts against your storage limit and follows your file retention (see [How long I keep things](#how-long-i-keep-things)).
- **A short record**: the title, the format, which chat and message it came from, whether it was made in a chat or by a connected app, its state, its size and when it was made. The title can contain personal data.
- **The chat's provider sees document names.** With every later message in that chat, a short list of the chat's documents (title, format and id, up to 10) goes to the chat's AI provider as part of the chat (see [The AI provider you choose](#the-ai-provider-you-choose)). The outline and the file do not.

### Where a document is made

Your browser builds the file on your device. If it cannot, my server builds it, in a separate Cloudflare Worker that only Besidka can reach and that keeps nothing. Every file is checked before it is saved: macros, embedded objects, external links other than web and email links, and other active content are refused. A file that fails the check is not stored.

### Marking and labels

Besidka shows that a document is AI-generated: a label on the card in the chat and in your file list. For a file the assistant made, I also write a machine-readable mark into the file's properties: that it was made with generative AI, and the name of the model. I write no prompt, no account id and no chat id. Anyone can read the mark with standard tools such as `exiftool`, the document properties in Acrobat, or the custom properties in Word, PowerPoint and Excel. It can be lost when someone re-saves, prints or copies the file.

A document that a connected app asked me to make is marked as created by a connected app, because the app wrote the content, and as AI-generated only if the app tells me it is. Files that your provider's code or skills made may carry no mark from me.

### How long documents are kept, and deleting them

- The outline and the file are kept together, as long as the file: 30 days by default, or what you set for your files. Deleting the file deletes the outline.
- **Deleting a chat deletes the documents made in it**, the file and the outline, unless the file is still used somewhere else, such as in another chat or as project knowledge. Then the file stays, and the title and the link to the deleted chat are removed from its record.
- A document made by a connected app has no chat. It is kept until its file expires or you delete it.
- Deleting your account deletes all your documents. Copies can stay for up to 30 days in backups (see [Backups](#backups)).
- A shared chat shows the title of a document only, unless you choose to show files in that share.

## Who else receives your data

| Recipient | What they receive | Where | Safeguard |
| --- | --- | --- | --- |
| Cloudflare | Everything the service stores and serves — Workers, D1 database, KV cache, R2 files and artifacts, Images, Email Sending and Routing, the separate address artifacts run from and the separate Worker that builds documents when your browser cannot — plus Turnstile bot-protection signals on sign-in, sign-up and password reset forms and on the artifact report form for visitors who are not signed in, plus, only if you allow the Analytics category in the cookie banner, the page-view and page-load measurements sent by Cloudflare Web Analytics | EU and US | Processor for me. Certified under the EU–US Data Privacy Framework. For its own use of Turnstile signals, Cloudflare is an independent controller (see below). |
| Axiom | Operational and error logs | US | Processor for me. Standard Contractual Clauses. |
| Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen | Your prompts, message history and attachments, and, if you use memory, your memory index, the memory entries the assistant reads, excerpts of your earlier chats and project knowledge, sent with your own API key. When memory is written from your chats, the text of those chats goes to the provider of the model you chose for memory. If you confirm a request from an artifact, the text the artifact sends, with your own key. If you turn on Run code for a message (Anthropic, OpenAI and Google only), the files you attach to it and the code and files it creates, in the provider's sandbox, with your own key | Anthropic: Ireland for customers in the EEA under Anthropic's terms, otherwise United States. OpenAI: Ireland for customers in the EEA and Switzerland under OpenAI's terms, otherwise United States. Google, xAI: United States. DeepSeek: China. Moonshot AI and Qwen: Singapore, as Besidka calls them | Independent controller. Your own terms with them apply. See [Transfers outside the EU](#transfers-outside-the-eu). |
| Vercel (AI Gateway) | Only if you route a chat through it: your prompts, message history and attachments, in transit to the model vendor you selected, sent with your own gateway key | Depends on your gateway account | Independent controller. Your own terms with them apply. Vercel Inc. is certified under the EU–US Data Privacy Framework. Vercel's DPA describes it as a processor for its own customers, but does not name AI Gateway; the zero-data-retention and no-training commitments are in Vercel's product documentation, not its contract. [Vercel Privacy Notice](https://vercel.com/legal/privacy-notice) |
| Cloudflare (AI Gateway) | Only if you route a chat through it: your prompts, message history and attachments, sent with your own Cloudflare account credentials. The models offered through it are Workers AI models that Cloudflare itself hosts and runs. This is a separate role from Cloudflare's hosting of Besidka above. | Depends on your gateway account | Independent controller — a different role from Cloudflare's hosting of Besidka above. Your own terms with them apply. AI Gateway logs your prompts and responses to your own Cloudflare dashboard by default until you turn that off. Cloudflare states it does not train on your content. [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) |
| OpenRouter | Only if you route a chat through it: your prompts, message history and attachments, in transit to the model vendor you selected, sent with your own gateway key | Depends on your gateway account | Independent controller. Your own terms with them apply. OpenRouter says in its privacy policy that it relies on the Standard Contractual Clauses for transfers. OpenRouter retains nothing by default, but opting into prompt logging in your own OpenRouter account grants OpenRouter a broad licence to that content. [OpenRouter Privacy Policy](https://openrouter.ai/privacy) |
| Brave Search | Only if you turn Brave search on for a message: the search query your model writes from your prompt, sent with your own Brave API key | US | Independent controller. Your own terms with them apply. [Brave Search API privacy notice](https://api-dashboard.search.brave.com/documentation/resources/privacy-notice) |
| Exa | Only if you turn Exa search on for a message: the search query your model writes from your prompt, sent with your own Exa API key | US | Independent controller. Your own terms with them apply. [Exa Privacy Policy](https://exa.ai/privacy-policy) |
| TypeSafe AI, Inc. | Only if you save a TypeSafe AI key, and only for the checks you leave on: memory entries about to be saved and a short excerpt of their source; chat text before memory is generated from it; your message and the last few turns for Auto web search and past-chat retrieval; project files, notes and Brave or Exa results for prompt-injection screening; a search query and short result excerpts for re-ranking; and the chat text you are about to share. It answers short yes/no questions and adds no chat models. See [TypeSafe AI checks](#typesafe-ai-checks) | US | Independent controller. Your own terms with them apply. TypeSafe AI's data processing agreement is its contract with its own account holders, you for the key you add, not with me; under it TypeSafe AI acts as a processor for the account holder, and it relies on the Standard Contractual Clauses (Module 2, controller to processor) and the UK Addendum for the transfer to the US. TypeSafe AI is not certified under the EU–US Data Privacy Framework. Its agreement keeps data "as long as necessary", with no fixed period, and its privacy policy says it does not train models on your input. [TypeSafe AI Privacy Policy](https://typesafe.ai/legal/privacy-policy), [data processing agreement](https://typesafe.ai/legal/data-processing) |
| An AI app you connect, and the company behind it | Only if you connect it, and only what you approved: your chats, projects, project knowledge, files, artifacts, memory and settings, as permitted by the permissions you ticked, when the app asks with its token. If you allowed changes, the app also sends me the new values (names, project instructions, notes, text files, memory entries, settings) and which items to move or delete | Wherever the app and its maker run, which I do not choose and cannot know | Independent controller. Your own terms with them apply. I have no contract with them about your data. See [Connected AI apps](#connected-ai-apps) |
| Google FCM, Apple APNs, Mozilla autopush | The push endpoint your browser issued, plus the encrypted notification | Depends on your browser vendor | Necessary to deliver a push notification you asked for. |
| Google or GitHub | Only if you use them to sign in. I request the scopes `email profile openid` from Google and `read:user user:email` from GitHub. | US | Independent controllers for your account with them. |
| Search engines | A shared chat, and only if you turned on the separate indexing option for that share. Never an artifact | Worldwide | Your consent. |
| Anyone who has a link you created | The chat or the artifact version the link shows | Worldwide | Your consent, for each link. See [Public chat sharing](#public-chat-sharing) and [Public artifact links](#public-artifact-links) |

Sign-in, sign-up and password reset forms, and the form for reporting an artifact when you are not signed in, are protected by **Cloudflare Turnstile**, a bot-detection check that runs as part of Cloudflare, the same infrastructure provider listed above. On most visits it runs without any action from you; if a visit looks automated, it may present a challenge before letting the form through. To do this, Turnstile looks at signals about your browser and device. See Cloudflare's [Turnstile Privacy Addendum](https://www.cloudflare.com/en-gb/turnstile-privacy-policy/) for what a Turnstile check itself collects from your visit. That addendum says Cloudflare also uses the Turnstile signals for its own purposes, to run, secure and improve Turnstile, and that for this use it acts as a controller on the basis of its legitimate interests. So for that use Cloudflare is not only my processor, and its own privacy terms apply to it.

Cloudflare Web Analytics, which loads only if you allow the Analytics category in the cookie banner, is run by Cloudflare as the same infrastructure provider listed above. See [Analytics](#analytics).

The fonts and icons the app uses are served from besidka.com. Your browser does not contact Google Fonts or an icon service to draw a page. Artifacts load their libraries from the separate address I run for them on Cloudflare, never from another company (see [Where artifacts run](#where-artifacts-run)). If the person who shared a chat chose to show their avatar, the image reaches you through besidka.com as well, so when you open a share your browser does not contact Google or GitHub, and the original address of the avatar is not sent to you. Inside the app, your own avatar is loaded by your browser from Google or GitHub, the account you signed in with, so that company sees your IP address when it loads.

I do not sell your data. I do not share it with advertisers, data brokers or analytics networks. There are no advertising scripts on the site, and the only analytics script is Cloudflare Web Analytics, which stays off until you allow it.

I may disclose data if I am legally required to, for example in response to a valid order from a Polish authority. If that happens and I am allowed to tell you, I will.

## Transfers outside the EU

Cloudflare and Axiom process data in the United States as well as in the EU. Cloudflare is certified under the EU–US Data Privacy Framework, which the European Commission found adequate in Decision (EU) 2023/1795. Axiom relies on the European Commission's Standard Contractual Clauses.

When you send a message, **my server** sends it to the AI provider, AI gateway or search provider you chose. If that company is outside the EU or EEA, that is a transfer of your personal data from me to a third country, so here is where each one is and what protects it. I have no contract of my own with these companies. What protects a transfer is what each of them says in its own terms for your account with it.

- **Google and Vercel.** Google LLC and Vercel Inc. are certified under the EU–US Data Privacy Framework, which the European Commission found adequate in Decision (EU) 2023/1795.
- **Anthropic and OpenAI.** Anthropic's terms name **Anthropic Ireland Limited**, and OpenAI's data processing terms name **OpenAI Ireland Ltd**, as their company for customers in the EEA. Transfers on to their US parent companies, Anthropic PBC and OpenAI OpCo, LLC, rely on the Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) under their data processing terms.
- **xAI.** xAI's data processing addendum names **SpaceXAI LLC** (formerly X.AI) and incorporates the Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914).
- **OpenRouter.** OpenRouter, Inc. is a US company, and its privacy policy says it relies on the Standard Contractual Clauses approved by the European Commission.
- **DeepSeek** stores data in the **People's Republic of China**. Besidka reaches **Moonshot AI** and **Qwen** at their **Singapore** endpoints. The European Commission has **not** adopted an adequacy decision for China or Singapore, and I have no contract with these companies that could add safeguards. Your data there is protected only by their own terms and by local law, which may allow access by public authorities that EU law would not allow, and you may find it hard to enforce your rights against them. Choose these providers only if you accept that. Before you add a key for one of them, and before your next message through a key you already added, I show you these risks and ask for your explicit consent to the transfer (GDPR Art. 49(1)(a)). You can withdraw it in **Profile → Security → Privacy & consent**, and deleting the key withdraws it too. If you do not consent, you cannot send messages to that provider and I do not use it for memory; the key stays stored until you delete it. The same consent applies when you pick a DeepSeek, Moonshot AI or Qwen model through an AI gateway (a model whose name starts with `deepseek/`, `moonshotai/`, `alibaba/` or `qwen/`, including OpenRouter's `~deepseek/`-style "latest" aliases), because the gateway can pass your request on to that company. Through a gateway the vendor may process the request in mainland China rather than Singapore. Models a gateway runs itself, such as Cloudflare's own Workers AI models, do not need it.

The gateways also offer models from other vendors outside the EU, and I ask for the same explicit consent, once per vendor, before your first message to one of them through a gateway:

- **Z.ai (Zhipu AI)**, models starting with `z-ai/` or `zai/`. Its international API is run from **Singapore**.
- **MiniMax**, models starting with `minimax/`. Its international API is run by a **Singapore** company; MiniMax says it stores the data in the United States.
- **Tencent**, models starting with `tencent/`. Tencent Cloud says its servers may be in **mainland China**.
- **ByteDance**, models starting with `bytedance/` or `bytedance-seed/`. Its international platform (BytePlus) says it processes data in **Malaysia or Indonesia**.
- **Xiaomi** (`xiaomi/`), **Meituan** (`meituan/`), **StepFun** (`stepfun/`), **inclusionAI** (`inclusionai/`), **TeleAI of China Telecom** (`xingchen-agi/`) and **Dots Studio** (`dots-studio/`). These are companies based in **mainland China**, and I treat them as processing data there.

The European Commission has not adopted an adequacy decision for China, Singapore, Malaysia or Indonesia, so the same risks apply as above.

Some model names do not name a vendor at all: OpenRouter's router models (names starting with `openrouter/`, such as `openrouter/auto`) and presets (`@preset/…`) pick the model that answers each message at request time. Such a request can go to a provider in any country, including China and Singapore, and I cannot know in advance which. Before your first message to a router or preset model I ask for one separate explicit consent to that, which you can withdraw in the same place.

If you route a chat through an AI gateway, where your prompts go depends on the gateway, the account you hold with it and the model vendor you selected behind it. The transfer safeguard is whatever your own agreement with that gateway provides: Vercel Inc. is certified under the EU–US Data Privacy Framework, OpenRouter says it relies on the Standard Contractual Clauses, and Cloudflare's Customer DPA sets out its own mechanisms. Vercel and OpenRouter can pass your request on to model vendors anywhere, including in China, depending on the model you pick; that onward step happens under your own gateway account. For DeepSeek, Moonshot AI, Qwen, Z.ai, MiniMax, Tencent, ByteDance, Xiaomi, Meituan, StepFun, inclusionAI, TeleAI and Dots Studio models, and for router and preset models, I still ask for the transfer consent described above before your first message.

AI features inside artifacts send the artifact's request to the provider whose key you use, under the same rules and with the same transfer consent as a chat message (see [AI features inside artifacts](#ai-features-inside-artifacts)).

[Running code](#running-code) goes only to Anthropic, OpenAI and Google, the providers listed above, so it adds no recipient and no country. It is not offered for DeepSeek, Moonshot AI, Qwen or any gateway model, so the consents above do not change.

If you turn on Brave Search or Exa for a message, the search query goes to that provider, a company based in the United States, under the account you hold with them.

If you save a TypeSafe AI key, the [TypeSafe AI checks](#typesafe-ai-checks) you leave on go to **TypeSafe AI, Inc.** in the United States. It is not certified under the EU–US Data Privacy Framework. As with the AI providers above, I have no contract of my own with it: its data processing agreement, made with you as its account holder, makes it your processor and relies on the Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914, Module 2, controller to processor) and the UK Addendum. Delete the key, or switch a check off, to stop it.

If you connect an AI app, **you** choose the recipient and tell me, on the approval screen, to hand it the data you approved. The app asks for the data itself, so I do not pick where it goes, and I do not know in which country the app or its maker processes it. I have no contract with them and no safeguard of my own to offer. How I treat that, and what the approval screen tells you, is under [Connected AI apps](#connected-ai-apps).

## Operational logging

My logs are deliberately narrow. Specifically:

- **No raw IP address is ever written to my logs.** I keep only coarse metadata that Cloudflare attaches to the request: the data centre, country, region, continent, network operator (ASN) and timezone.
- Email addresses in authentication flows are **masked** before they are logged.
- **The content of your messages, your prompts and the model's answers are not logged.**
- Search queries sent to Brave Search or Exa are not logged either, only how many results came back.
- Push endpoints and push keys are never logged.
- For memory and chat search, logs hold counts (what was saved, refused or skipped, how many chats matched a search), the category of a refused item, which model and provider were used, and technical error labels. They never hold the text of your memory, your chats, your search terms or anything you import.
- For connected AI apps, the log line records which app called the interface, which action it used and its timing, with your pseudonymous user id. It never holds the content that was read or written.
- For [experimental features](#experimental-features), the log line records which feature a gradual rollout or version test gave you, with the result, the version and the reason, and, when feature access, a Labs switch or your objection changes, the account ids involved, the feature and the change. It never holds an email address or the note an admin wrote, and when I search accounts in the admin area the search text is not logged. These lines are kept for 30 days.
- For [artifacts](#artifacts), the log line records ids (artifact, version, link and report numbers), sizes and statuses, that an artifact's frame was closed because it tried to leave the page, and, for an AI feature inside an artifact, the provider, model, tokens, cost and time taken. It never holds an artifact's content, the progress you saved, or the text an artifact sent and the answer.
- When you give or withdraw a consent, the log line for that request records the action, the version of the text and, for a transfer consent, the provider's name, together with your pseudonymous user id.
- When you create an account, save your first key or send your first message, the log line for that event can carry the campaign tags from your first-touch record and, for a key or message, the provider's name. Those log lines already carry a pseudonymous user id, so the campaign tags are linked to that id for as long as the logs are kept.

## How long I keep things

| Data | How long |
| --- | --- |
| Account, chats, messages, projects, settings, API keys | Until you delete them, or until you delete your account |
| Documents (the outline and the record about it) | As long as their file, and deleted with it. Deleting a chat deletes the documents made in it unless the file is used elsewhere; see [Documents](#documents). |
| Files | **30 days by default.** You can change this in your settings, including setting files never to expire. Files linked to a project as knowledge do not expire while they are linked. An hourly job deletes the expired file from R2 and then its database row. |
| Share links | Until you revoke the share, or until the expiry you chose (1 hour, 1 day, 1 week, 1 month, 1 year, or never). Revoking deletes the share record. |
| Artifacts and all their versions | Until you delete the artifact or your account. Deleting a chat does not delete its artifacts. An artifact removed on an authority's order as terrorist content, or one an authority asked me to preserve, is kept with the records about it for six months after the removal, or as long as the authority lawfully requires, and then deleted |
| Artifact links | A link stops working when you revoke it or when it expires. Its record stays with the artifact until you delete the artifact or your account |
| Progress you saved in artifacts | Until you reset it, until the artifact is deleted, or until you delete your account. For someone else's artifact, also deleted 30 days after the last active link to it ended, and at once if I take the artifact down |
| The text an artifact sends to your AI provider, and the answer | Not stored by Besidka. Held by your provider under its own terms |
| The record that a legal change notice was sent to you (which notice, when, whether it was delivered, and an error code if it failed) | Until you delete your account. It is deleted with it. It is my proof that I told you |
| Push subscriptions | Until you turn notifications off, until your browser's push service reports the endpoint as invalid, or until you have not opened Besidka in that browser for 60 days, whichever comes first |
| Sessions | Until they expire or you sign out |
| Campaign attribution and milestone records | Until you delete your account. They are deleted together with it. |
| Aggregate analytics counters, including the feature counters | About three months, which is how long Cloudflare keeps Workers Analytics Engine data |
| Roles and feature access set for your account by hand | Until it is removed, or until you delete your account. A setting with an end date stops applying on that date, and its record stays until it is removed |
| Your Labs switches and your objection to gradual rollouts and version tests | While your account exists. Each switch keeps when you last turned it on and off. Deleted with your account |
| The change log of feature access | 12 months, then deleted automatically. When you delete your account, your account id and the notes are removed from the entries about your account, and the entries stay without them until their 12 months are over |
| Log lines about experimental features (the decisions and changes described under [Experimental features](#experimental-features)) | 30 days, which is how long Axiom keeps my request logs. They hold account ids, so they stay for those 30 days after you delete your account |
| Cloudflare Web Analytics measurements (only if you allow the Analytics category) | Held by Cloudflare, not by me. Cloudflare states that it keeps unsampled data for the past 7 days and then aggregates it, and that its dashboard shows the previous six months. It does not state how long the aggregated data is stored. See Cloudflare's [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/). |
| Operational logs | 30 days, which is how long Axiom keeps my logs under my plan, and only in the reduced form described above |
| Memory entries | Until you delete them or reset memory, delete the only chat a generated entry came from, delete the project (for project entries), or delete your account |
| Text sent to TypeSafe AI for TypeSafe AI checks (only with a TypeSafe AI key) | Not stored by Besidka. Held by TypeSafe AI "as long as necessary" under its data processing agreement, which sets no fixed period |
| Two short markers for TypeSafe AI checks, kept in Cloudflare KV with no text in them | A project file or note that screening could not check yet is queued by its ids and an attempt counter, for up to **14 days** or until it is checked, whichever comes first. Auto web search keeps the outcome of the first message of a new chat (searched or not) for **1 day**, so a retry of that message does not ask TypeSafe AI again |
| Short-lived technical markers in Cloudflare KV | Rate-limit counters, request locks and cooldowns last from seconds to minutes, a back-off counter for building project knowledge 10 minutes, a position marker for the knowledge sweep 6 hours, and the cost estimate for "Build memory from past chats" 10 minutes. They hold ids, counters, timestamps or counts, never message text. The exception is a copy of a file you attached, in the form sent to the model, which is kept for **5 minutes** so a quick follow-up does not read it from storage again |
| Memory settings, including when you turned memory generation on, for your account and for each project | Your account setting until you delete your account. A project's setting and its date until you delete the project or your account; setting a project to Off clears its date |
| Past-chat run records | The last 5 runs; deleted with your account |
| Project knowledge | Until you remove it or delete the project. The original files then stay in your file library under its normal rules |
| Your consent to store sensitive information, your acceptance of the Terms of Use and age confirmation, and your consent to transfers to DeepSeek, Moonshot AI, Qwen, the other gateway vendors or router and preset models | While your account exists. Withdrawing keeps the record of when you gave and withdrew it. Deleted with your account |
| Reports of illegal content, copyright notices, disputes of removals and my decisions about them | Until the matter is closed, and then 12 months so I can answer a challenge, a complaint or an authority. A note that content was removed from an account on a copyright notice is kept 24 months, for the repeat-infringement rule. The emails are deleted on the same schedule. A report about an artifact is kept on this schedule even if the artifact is deleted earlier, and for six months after the removal at least when an authority ordered the removal of terrorist content. See [Reports and notices about content](#reports-and-notices-about-content) |
| Access tokens of connected AI apps | 15 minutes. They stop working then, or the moment you disconnect the app, whichever is first |
| Refresh tokens of connected AI apps | Until you disconnect the app or they expire, 30 days at most, and each is replaced every time the app uses it. Also ended when you reset your password, change it while signing out your other sessions, or sign out of all sessions. Expired or ended tokens are deleted about a day later. Deleted with your account |
| Your approval of a connected AI app (the app, the permissions and when you gave them) | Until you disconnect the app, or, once the app has no live token and has not been used for 30 days, until the hourly cleanup deletes it. Removing permissions shrinks it and does not end it. Deleted with your account |
| The registration of a connected AI app (its name and the details it sent) | Deleted automatically once it is more than 7 days old and no approval and no token for it exists any more; otherwise until I remove it. It holds the app's data, not yours |
| Cookie consent records | Stored in a separate database, pseudonymously — see [Cookie consent records](#cookie-consent-records) |

### Backups

My database runs on Cloudflare D1, which keeps **point-in-time backups for up to 30 days** ("Time Travel"). This is a disaster-recovery feature: it is used only to restore the database after data loss or a bad migration.

The honest consequence is that for up to 30 days after you delete something, a copy of it can still exist inside those backups. I cannot selectively erase a single record from a point-in-time backup. Those backups roll off after 30 days and I do not use them for anything else.

### Cookie consent records

When you make a cookie choice, I record it so I can prove the choice was made. Those records are kept in a **separate database, pseudonymously**: no user id, no IP address, no email address. A record holds a random id, a timestamp, the version of the banner, which categories were granted, denied or changed, how the choice was made, and a coarse country.

## Public chat sharing

Sharing a chat is off unless you switch it on for that specific chat. It is based on your consent and you can revoke it. Please understand exactly what it does.

When you create a share, everything extra on it starts **off**, so a share shows only what you switch on yourself. The link duration starts at "never", and you can pick a shorter expiry before you publish. Shares you created earlier keep the settings that were saved with them.

- **Anyone with the link can open the chat. No account is needed.** An unlisted URL is not access control. Treat a share link like a public web page you have chosen not to advertise.
- **Search-engine indexing is a separate opt-in.** A share is not indexable unless you turn indexing on for it, and it starts off.
- Per-share switches control whether **files and generated images** are included, whether **message metadata** (timestamps, token counts, cost figures and which tools were switched on) is shown, and whether **your name and avatar** are shown. Each starts off. Tool calls are always removed from a shared chat.
- If you show your avatar, the image is delivered through besidka.com, and visitors' browsers do not contact Google or GitHub to load it. The original avatar address is never sent to visitors.
- Another switch controls **branching** ("let others copy"). It starts off. If it is on, a signed-in visitor can copy the shared conversation into their own account and continue it there. Their copy is their own data from that point on, and revoking your share does not remove it.
- Files in a shared chat are served through short-lived signed tokens that expire after **1 hour** and are re-checked against the live share every time. Sharing a chat does not make the file permanently public.
- If the chat contains [artifacts](#artifacts), visitors can open the versions of them that appear in the chat, read-only, with the same banner and **Report** button as on a public artifact page.

### Revoking a share

Revoking a share deletes the share record and stops access through me immediately.

I want to be honest about the limit of that. Once something has been public, I **cannot** recall search-engine caches, web archives, screenshots, copies someone downloaded, or content that was scraped while the link was live. I take the reasonable steps that are within my control. I cannot promise that a shared chat becomes unseen.

If you plan to share a chat, please re-read it first, and remember that it may contain other people's personal data as well as your own.

With a TypeSafe AI key and the share check on, the chat text being shared is sent to TypeSafe AI when you open the share window, before you publish, to look for personal data. Emails, phone numbers, card numbers and similar identifiers are removed from it first. It shows a warning only and never blocks sharing. See [TypeSafe AI checks](#typesafe-ai-checks).

## Reports and notices about content

Anyone can write to **:privacy-email-link{}** to report content they believe is illegal, to send a copyright notice, or, if their content was removed because of a copyright notice, to say the removal was a mistake. A public artifact page, and an artifact in a shared chat, also has a **Report** button with a short form. How that works is in the [Terms of Use](/terms-of-use#reporting-illegal-content) and in [Copyright complaints](/terms-of-use#copyright-complaints). This is what I do with the personal data in them:

- **What I receive.** What the sender chooses to write: their name, email address and, for a copyright notice, the owner's name; the web address of the content; the explanation or statement they give. The report form asks for the reason from a fixed list, an explanation, a statement that the report is made in good faith, and your name and email address, which you may leave out only when you report child sexual abuse material. It fills in the address of the artifact by itself. If you are signed in, it also records your account; if you are not, it runs the Turnstile check described under [Who else receives your data](#who-else-receives-your-data). I do not store your IP address with a report. I may also open the reported content and look at the account that published it, to decide.
- **What I do with it.** I read it, decide what to do, and tell the sender and the user who published the content. If you gave an email address, I confirm by email that I received your report and later tell you my decision and how you can challenge it. Reports about a threat to someone's life or safety, or about terrorist content, are handled first. When I remove or disable content, I send that user a statement of reasons that says what was reported and why I acted; it does not name you. If you dispute a copyright removal, I give your name and contact details to the person who sent the notice only if you agree. Otherwise I share a report only where the law requires it: for example with the police or a prosecutor when a report points to a crime that threatens someone's life or safety, or with an authority that orders the removal of terrorist content.
- **Why I may.** Legal obligation under GDPR Art. 6(1)(c) where EU or Polish law requires me to act, for example an order from a court or authority, and otherwise legitimate interests under Art. 6(1)(f): dealing with abuse and protecting rights holders and users. See the table above.
- **How long I keep it.** Until the matter is closed, and then for 12 months so I can answer a challenge, a complaint or an authority. A note that content was removed from an account on a copyright notice is kept for 24 months, for the rule on repeat infringement. The emails are deleted on the same schedule. A report about an artifact is kept on the same schedule even if the artifact is deleted first. When an authority orders the removal of terrorist content, I keep the removed content and the records about it for six months after the removal, as the law requires, and longer only if an authority lawfully asks.

## Push notifications

Push notifications are optional and based on your consent. You switch them on or off in **Profile → Preferences → Notifications**, in the user menu, or in the prompt Besidka shows you; each choice applies to the browser you make it in. Besidka sends one when a response finishes while you are away, when you open a shared chat in the installed app, and when a shared chat you branched is ready in your chats. The text is fixed and generic. It never contains your messages, a chat title or anything you wrote, only a link to the chat to open.

If you turn them on, your browser issues a subscription endpoint and I store it, along with the keys needed to encrypt a message to your browser, the site address the subscription was created on and when you last opened Besidka in that browser. Delivery goes through your browser's own push service: Google FCM for Chrome, Apple APNs for Safari, Mozilla autopush for Firefox. Those services see the endpoint, the encrypted payload and the link.

Turning notifications off in your settings, or in your browser, revokes the subscription. A subscription from a browser you have not opened for 60 days is deleted automatically, and you are subscribed again the next time you open Besidka there, if the browser still allows notifications.

## Email I send you

I send only transactional email, which is email about your account and what you asked for, plus notices about changes to the documents that govern the service:

::account-email-list
::

That is all. **I never send marketing email**, newsletters or product announcements, and there is no mailing list to unsubscribe from. A legal notice is a notice about a change to these terms that I need to give you for it to apply, so it carries no promotion and no unsubscribe link. The only way to stop receiving them is to delete your account. I keep a record that a legal notice was sent to you, as described under [How long I keep things](#how-long-i-keep-things). Email is sent through Cloudflare's email sending service.

## Analytics

I measure three things. Two of them use no cookie and nothing on your device and run without a banner choice. The third is optional and is off until you allow it.

**Aggregate counters.** I count page views and a small set of interface events (for example, that a call-to-action was clicked) **on the server**, in Cloudflare Workers Analytics Engine. A counter holds the event name, the path, a coarse country, a device class (mobile, tablet or desktop) derived from the User-Agent string, and the campaign tags from the link you opened, if it had any. It holds **no user id, no email address and no IP address**, and no cookie is set or read. Cloudflare keeps this data for about three months.

Because those counters are aggregate and cannot be linked back to you, they are not personal data, and they are not gated behind consent.

**Feature counters.** When a gradual rollout or version test gives you an [experimental feature](#experimental-features), a separate server-side counter records the feature, the version and the reason for the decision. It holds no user id, no path and no position in the rollout. While a feature has reached only one or two accounts, I could still tell whose activity a counter shows, so I do not count these counters as anonymous: I treat them as personal data, on the basis of legitimate interests (Art. 6(1)(f)), releasing features safely and learning which version works. Cloudflare keeps them for about three months, like the other counters. If you object to gradual rollouts and version tests, no new counters about you are recorded.

**Cloudflare Web Analytics, only if you allow it.** The cookie banner has an optional **Analytics** category that is off until you turn it on. Only if you do, Besidka loads a script from `static.cloudflareinsights.com` that measures page views and page-load performance (the browser's Navigation Timing data and the Core Web Vitals) and sends the measurements to Cloudflare at `cloudflareinsights.com`. I see the result as aggregate figures in a Cloudflare dashboard. Cloudflare states that this product sets no cookie, uses no localStorage and does no fingerprinting, and that it does not track individual end users across its customers' sites; see [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) and [how it collects data](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/). Because your browser contacts Cloudflare to send the measurements, Cloudflare receives your IP address and browser details in that request, as in any web request. Cloudflare is my processor for this, as it is for the hosting listed above.

My legal basis is your consent: GDPR Art. 6(1)(a) for the processing, and PKE Art. 399 for reading information from your device. You can withdraw it at any time by turning Analytics off in the cookie settings. If the script was already running, the page reloads once so it stops; on a chat page I wait until you next move to another page, so I never interrupt a reply that is being written. It is not loaded again until you turn the category back on. Withdrawing does not affect what was measured before. Retention is described under [How long I keep things](#how-long-i-keep-things). The script is loaded on the production site only.

**Campaign attribution on your account.** When you create an account after opening a campaign link, I store the link's tags with your account. For every account created after this feature started, with or without a campaign link, I also record the three early milestones described under [Campaign attribution](#campaign-attribution). Accounts that already existed are not tracked. These records are stored with your account and deleted with it. They are personal data, because they are tied to your account. It is separate from the aggregate counters, which never receive your user id. The log lines for those milestones are covered under [Operational logging](#operational-logging).

**How the campaign tags reach your account.** They are read from the web address of the page you opened and passed along in the address of the sign-up and sign-in links. They are held in the page's memory while you browse and are gone when you open the site again without the campaign link. While you use the sign-up page, they stay in its web address. Nothing is stored in a cookie, localStorage or sessionStorage. Because nothing is stored on or read from your device, no consent is needed under PKE Art. 399. A cookie that remembers a campaign across visits was considered and **is not used**.

My legal basis for the account-level record is legitimate interests under GDPR Art. 6(1)(f): knowing whether my own campaigns lead anyone to use the app. I keep the data to what that needs, and you can object to it — see [Your rights](#your-rights). Deleting your account deletes the record.

## Cookies and browser storage

I use a small number of cookies and browser storage keys. The necessary ones keep you signed in and remember your cookie choice. The optional ones remember preferences such as your theme, and a separate optional Analytics category controls whether Cloudflare Web Analytics loads at all. Nothing is used for advertising or cross-site tracking.

The full list, with names and durations, is in the [Cookie Policy](/cookie-policy).

## Security

- All traffic is served over HTTPS.
- Session cookies are `HttpOnly`.
- Your AI provider, AI gateway, search provider and TypeSafe AI API keys are encrypted as described above.
- Access to production data is limited to the controller.
- Only the controller holds the admin role, and the admin area can be opened only from an account with a verified email address and two-factor authentication turned on.
- Connected AI apps get short-lived access tokens (15 minutes), refresh tokens that are replaced each time they are used, and only the permissions you ticked, which you can reduce at any time in Profile → Connected apps and which are checked on every request. Writing is off until you tick each change permission, deleting needs its own permission, and the number of changes an app can make per minute, and of deletions per hour, is limited.

No service is perfectly secure. If you find a security problem, please write to **:privacy-email-link{}** and give me a chance to fix it before disclosing it.

## Automated decision-making and profiling

**GDPR Art. 22 does not apply to Besidka.** I do not make automated decisions that produce legal effects for you or that similarly significantly affect you. The model's answer in a chat is content generated at your request, not a decision about you.

[Memory](#memory) can be **profiling** under GDPR Art. 4(4) when you turn on "Generate memory from chats" or set a project to On, and project memory works the same way. What that means and why it is not an Art. 22 decision is explained under [Profiling](#profiling).

The optional [TypeSafe AI checks](#typesafe-ai-checks) are assistive automated decisions: whether to run a web search, whether to skip a memory pass, in what order search results appear and which clearly irrelevant ones are left out, whether to show a personal-data warning before you share, whether to hold a project file for your review, and whether to search your past chats before answering. None of them has a legal or similarly significant effect on you. Each one falls back to normal behaviour if TypeSafe AI is unsure or unavailable, each can be switched off, and a flag never deletes anything. So Art. 22 does not apply to them either.

[Gradual rollouts and version tests](#experimental-features) are not profiling: the random choice evaluates nothing about you, such as your behaviour, interests or location. Being in a rollout or not, and seeing one version or another, has no legal or similarly significant effect on you, and a version test never changes what is spent on your API keys. So Art. 22 does not apply to them either.

## Sensitive information in your chats

You can type or upload anything into Besidka. So your chats, projects and files may contain what the GDPR calls special category data: information about your health, racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, genetic or biometric data, or sex life or sexual orientation.

I do not ask for this information. I also cannot separate it from the rest of what you write without reading your chats, and I do not read them. Storing a chat and sending it where you told me to is the service itself, so if you include such information, it is stored and sent together with everything else.

My legal basis for that is your **explicit consent** under GDPR Art. 9(2)(a). I ask for it once, in the app, before you send a message, separately from the [Terms of Use](/terms-of-use): in a separate box that is not ticked in advance, next to a second box where you accept the Terms and confirm that you are 18 or over. The consent covers exactly this:

1. storing the sensitive information you choose to include in your chats, projects and files;
2. sending it to the AI providers, AI gateways and search providers whose keys you add, for your chats, for project memory and for memory; and
3. automatically checking text before it is saved to memory, so that sensitive topics are kept out of memory.

If you add a TypeSafe AI key, the [TypeSafe AI checks](#typesafe-ai-checks) you leave on may send the same text to TypeSafe AI. It is an AI provider whose key you add, so point 2 covers it.

**Artifacts.** An [artifact](#artifacts) the assistant makes in a chat is built from that chat and stored as part of your work there, so points 1 and 2 cover the sensitive information in it. An artifact that an AI app you connected writes into your account is covered by the consent you gave on that app's approval screen (see [Connected AI apps](#connected-ai-apps)). Two artifact features go further, and the current text of the consent (version `2026-11-a`, shown in **Profile → Security → Privacy & consent**) does not name them: the progress an artifact saves for you, in your own artifacts or in someone else's ([Saved progress in artifacts](#saved-progress-in-artifacts)), and the text an artifact asks to send to your AI provider ([AI features inside artifacts](#ai-features-inside-artifacts)). I do not offer either feature to your account until I have asked for your consent to a text that names them. Until then, an artifact keeps what you enter in the page's memory only, and it cannot ask an AI model on your key.

I do not use it for anything else. I do not read it, train on it, use it for advertising, or use it to infer anything about you. I record that you gave the consent, when, and which version of the text you agreed to, so that I can prove it (GDPR Art. 7(1)). If I change the text in a way that matters, I ask you again before your next message.

**Withdrawing.** You can withdraw this consent at any time in **Profile → Security → Privacy & consent**, which also shows when you consented and to which version of the text. Withdrawing does not make what happened before unlawful. Because I cannot tell which new messages or content would contain sensitive information, Besidka stops sending new messages and stops storing new content (files, project knowledge and notes, project instructions, memory entries, chats copied with Branch, artifacts, and progress saved in artifacts) until you consent again. It also stops all memory work: generating memory from your chats, building it from past chats, refreshing project memory and importing are skipped or refused, and a build that is running is cancelled. You can still read, export and delete your data. To have sensitive information you already stored removed, delete the chats, projects, files or artifacts that contain it (deleting a chat does not delete its artifacts), or your account, or write to **:privacy-email-link{}** and tell me which ones, and I will delete them.

**If you do not consent**, you can still read, export and delete your data, but you cannot send messages or add new content. I ask for consent rather than forbid such information because I would rather be honest that it will end up in chats than pretend it will not.

Some advice, which is advice and not a rule:

- Whatever you send goes to the provider or gateway you chose, under your own account with them. On some free plans that provider may keep it and let people review it; see [The AI provider you choose](#the-ai-provider-you-choose). Some providers are outside the EU; see [Transfers outside the EU](#transfers-outside-the-eu).
- Take particular care with **other people's** sensitive information. Your consent covers information about you; it cannot cover someone else's.
- Information about criminal convictions or offences is treated differently in the GDPR (Art. 10) and cannot be based on consent. Please keep it out of your chats where you can, and ask me to delete any chat that contains it.

## Age limit

Besidka is for people aged **18 or over**. Using Besidka requires your own AI provider API key, and the providers set 18 as the minimum age for an API account — Google AI Studio requires you to be 18 or over — so there is no younger tier for me to support. Because the service is adults-only, the children's consent rules in GDPR Art. 8 do not arise. I ask you to confirm that you are 18 or over at sign-up: in the box you tick when you sign up with email, and by continuing when you sign up or sign in with Google or GitHub. I ask again in the app before you send your first message, and the record I keep of your age confirmation is the one made there (see [What I store](#what-i-store)). I do not ask for your date of birth. If you are under 18, please do not create an account. If you believe someone under 18 has an account, write to **:privacy-email-link{}** and I will delete it.

## Your rights

Under the GDPR you have the right to:

- **Access** your data and get a copy of it (Art. 15)
- **Correct** inaccurate or incomplete data (Art. 16)
- **Erase** your data (Art. 17)
- **Restrict** how I process it (Art. 18)
- **Portability** — receive your data in a structured, machine-readable format and have it transmitted to another controller (Art. 20)
- **Object** to processing based on my legitimate interests (Art. 21)
- **Withdraw consent** at any time, without affecting what happened before you withdrew it (Art. 7(3))
- **Complain** to a supervisory authority

### How to use them

Most things you can do yourself in the app: edit your profile, delete a chat, delete a file, revoke a share, turn notifications off, change your cookie choices, see, edit, export or reset your memory, withdraw your consent to store sensitive information or to a transfer to DeepSeek, Moonshot AI, Qwen, another vendor or a router or preset model (in **Profile → Security → Privacy & consent**), disconnect a connected AI app or remove some of its permissions (in **Profile → Connected apps**), switch experimental features that use your keys on or off, or object to gradual rollouts and version tests (on the Labs page, once it is there; see [Experimental features](#experimental-features)), or delete your whole account.

For anything else, email **:privacy-email-link{}**. I answer within **one month**. If a request is complex I may extend that by up to **two further months**, and if I do, I will tell you within the first month and explain why.

I do not charge for this. I may ask you to confirm you control the account's email address, so I do not hand your data to someone else.

### Getting a copy of your data

**Memory** has a self-service export: **Export JSON** on the Memory page downloads your memory entries and memory settings. It does not include project knowledge or the technical records of memory (such as past-chat run records and when you turned memory generation on).

**Artifacts** can be downloaded one version at a time from the artifact's panel.

For everything else, including your account data, chats, projects, project knowledge, artifacts and file list, email **:privacy-email-link{}** and I will send you a copy in a machine-readable format. That includes your [experimental feature](#experimental-features) records: your role, the feature access set for your account, your Labs switches, your objection and the change log entries about your account. Where a note in the change log is about someone else, I may leave that part out (GDPR Art. 15(4)).

### Deleting your account

You can delete your account from your settings. I email you a confirmation link, and opening it removes your account and all data associated with it, including your chats, projects, settings, memory entries and memory settings, past-chat run records, project knowledge, your artifacts with their versions and links, the progress you saved in other people's artifacts, your consent records, stored provider, gateway, search and TypeSafe AI API keys, share records, push subscriptions, your campaign attribution and milestone records, your approvals and tokens for connected AI apps, and your stored files.

Open that link in the same browser you are signed in to. The link is tied to your signed-in session, so opening it on a different device will not work.

Seven honest limits:

1. **Backups.** As described under [Backups](#backups), Cloudflare D1 keeps point-in-time backups for up to 30 days. Deleted data can persist there for that window before rolling off. Those backups exist only for disaster recovery.
2. **Your AI provider.** I **cannot** erase anything from Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI or Qwen. That processing happened under **your** provider account, with your key, and they are independent controllers. To delete data there, use their own controls and privacy requests — Anthropic automatically deletes API data within 30 days (container data, Files API files and skills follow other rules, see [Running code](#running-code)), OpenAI at [privacy.openai.com](https://privacy.openai.com/) and Google through your Google account's privacy settings. For xAI, DeepSeek, Moonshot AI and Qwen, use their own controls and privacy requests.
3. **Your AI gateway.** If you routed a chat through Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter, I **cannot** erase anything the gateway kept, such as its own logs of your requests, or anything the model vendor behind it received. That happened under **your** gateway account, and they are independent controllers. Use the gateway's own controls and privacy requests.
4. **Your search provider.** I **cannot** erase a search query from Brave's or Exa's own records. The query was sent under **your** Brave or Exa account, with your key, and they are independent controllers. Brave states that it keeps a record of API queries for up to 90 days; for anything else, use their own controls and privacy requests.
5. **TypeSafe AI.** If you used the [TypeSafe AI checks](#typesafe-ai-checks), I **cannot** erase the text those checks sent from TypeSafe AI's records. It was sent under **your** TypeSafe AI account, with your key. TypeSafe AI keeps it "as long as necessary" under its data processing agreement, with no fixed period, so use its own controls and privacy requests.

6. **Connected AI apps.** I **cannot** erase anything an AI app you connected already read or saved, or anything its maker holds. That happened under **your** account with them, and they are independent controllers. Use their own controls and privacy requests.
7. **Reports and removal orders.** Reports that other people sent about your content, and my decisions about them, are kept on the schedule under [Reports and notices about content](#reports-and-notices-about-content), not deleted with your account. Content that an authority ordered removed as terrorist content, or asked me to preserve, is kept for six months after the removal, or as long as the authority lawfully requires, before it is deleted.

### Complaining

If you think I have handled your data unlawfully, you can complain to the Polish supervisory authority:

**Prezes Urzędu Ochrony Danych Osobowych (UODO)**
ul. Stawki 2, 00-193 Warszawa, Poland
[uodo.gov.pl](https://uodo.gov.pl/)

You can also complain to the supervisory authority of the EU or EEA country where you live or work, and you have the right to an effective judicial remedy.

## Changes to this policy

I tell you about a **material change** before it takes effect. A change is material when it changes what data I collect, why I use it, who receives it, how long I keep it, or what rights and choices you have.

- **Material changes** are announced by email to every account with a verified email address that exists when the notice is published (if you sign up after that, you agree to the new text) and by a notice in the app. I publish the notice on this page and in the app first, at least **30 days** before the change takes effect (**14** when the law or security requires it, with the reason). Emails go out from then on; I send a limited number a day, so yours can arrive a few days after publication. This email is a notice about a change to these terms, not marketing, so it has no unsubscribe link.
- **Everything else** takes effect when published, and I only update the date at the top: typo fixes, formatting, and clarifications that do not change what I do.
- The change history below lists every material change, with the date I announced it and the date it takes effect.

If you do not agree with a change, you can object to it or withdraw a consent you gave (see [Your rights](#your-rights) and **Profile → Security → Privacy & consent**), or [delete your account](#deleting-your-account), before it takes effect. The current version is always at this URL.

### Change history

::legal-change-history{document="privacy-policy"}
::

## Contact

For anything in this policy, including any of the rights above, write to **:privacy-email-link{}**.
