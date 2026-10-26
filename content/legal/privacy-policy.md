---
title: "Privacy Policy"
description: "How Besidka handles your data — what is stored, who receives it, how long it is kept, and the rights you have under the GDPR."
updatedAt: 2026-10-26
summary: "Besidka stores your account, chats, projects, files, settings and your encrypted API keys on Cloudflare infrastructure. When you send a message, it goes to the AI provider whose key you supplied, or through the AI gateway you chose, and if you turn on Brave or Exa web search for a message, the search query your model writes from it goes to that search provider as well. The assistant can also look up your earlier chats and send short excerpts of them to the provider of the chat you are in, and memory, if you use it, can be written by an AI model on one of your own keys. Each provider is a separate company with its own privacy terms, and some of them are outside the EU, in the United States, China or Singapore. Because you can type anything, your chats may contain sensitive information such as health details or beliefs; I ask for your explicit consent to store it and send it where you tell me to, and I never use it for anything else. If you use a free Google Gemini key outside the EEA, Switzerland and the UK, Google may use your content to improve its products and human reviewers may read it. I never train any model on your data, I never sell it, and there are no ads. If you arrive through a campaign link, I keep the campaign tags from that link (source, medium, campaign and content) with your account, and no cookie or device storage is used for it. Public share links are off by default and anyone who has the link can read the chat. You can delete your account and all its data from your settings at any time."
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

Besidka is a free AI chat app. You bring your own API key from an AI provider (Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen), and you pay that provider directly for the usage. Instead of a provider key, you can route a chat through your own account with an AI gateway (Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter), and you pay that gateway directly. You can also add your own Brave Search or Exa API key to use as a web search tool, and you pay that search provider directly. **There is no payment relationship between you and me at all** — no subscription, no ads, no donations, no payment processor, and therefore no billing or card data anywhere in this policy. What I store is what is needed to run the chat app for you.

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
- Your settings, such as your preferred model and file retention period
- Deep research jobs, including the request and the resulting report
- Your memory entries and memory settings (see [Memory](#memory))
- Your consent record: when you accepted the Terms of Use and confirmed that you are 18 or over, when you gave your consent to store sensitive information and when you withdrew it, if you did, and which version of the text you agreed to (see [Sensitive information in your chats](#sensitive-information-in-your-chats)). If you consent to sending your messages to DeepSeek, Moonshot AI or Qwen, I also keep when you gave that consent and when you withdrew it (see [Transfers outside the EU](#transfers-outside-the-eu))

### Your API keys

Your provider API keys are stored **encrypted**. That column uses AES-256-GCM with a key derived using PBKDF2-SHA512 (5000 iterations), with a random salt and a random initialisation vector for every stored value.

The same applies to the keys you add for an AI gateway or a search provider. A Cloudflare AI Gateway credential is stored as one encrypted value that holds your Cloudflare account ID, and the gateway name if you set one, together with the token, so those identifiers are encrypted at rest as well.

This is the only field encrypted in this way. Please do not read it as a claim that the whole database is encrypted at the application level.

### Campaign attribution

If you reach Besidka through a link that carries campaign tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) and you then create an account, I store those values with your account, in a separate table in the same D1 database. I store them once, as they were in the link you clicked, after a strict clean-up: only short values made of lowercase letters, digits, dots, hyphens and underscores are kept, and anything else is discarded. If your link had no campaign tags, nothing is stored. This is a first-touch record. It is never updated.

If your account is created after this feature started (accounts that already existed are not tracked), I also record, once per account and with or without a campaign link, whether you reached three early milestones: your account was created, you saved your first AI provider or gateway key, and you sent your first chat message that got a complete answer. A failed or interrupted answer does not count. That record holds your user id, the milestone name, the provider involved and a timestamp. It tells me whether a campaign led to real use, and it keeps each milestone from being counted twice.

The campaign tags travel in the web address and in the page's memory only. I do not set a cookie or write to your browser storage for this. See the [Cookie Policy](/cookie-policy).

### Sharing and notifications

- Share records, if you publish a chat with a share link
- Push notification subscriptions, if you turn push notifications on. A subscription contains the endpoint URL issued by your browser's push service and the public keys needed to encrypt a message to your browser.

### Operational logs

I record structured logs of requests and errors so I can keep the service working. What goes into those logs is described under [Operational logging](#operational-logging).

## Why I am allowed to process your data

| What I do | Legal basis |
| --- | --- |
| Create your account, sign you in, keep you signed in | Contract — GDPR Art. 6(1)(b) |
| Store your chats, messages, projects, files and settings | Contract — Art. 6(1)(b) |
| Store your AI provider, AI gateway and search provider API keys, encrypted | Contract — Art. 6(1)(b) |
| Send your prompt, message history and attachments to the AI provider you chose | Contract — Art. 6(1)(b) |
| Send your prompt, message history and attachments through the AI gateway you chose to route a chat through | Contract — Art. 6(1)(b) |
| Send the search query your model writes from your prompt to Brave Search or Exa, when you turn that search on for a message | Contract — Art. 6(1)(b) |
| Store the sensitive information you choose to include in your chats, projects and files, and send it to the AI provider, AI gateway or search provider you chose | Your explicit consent — GDPR Art. 9(2)(a), in addition to the contract basis above |
| Keep the memory entries you write or ask the assistant to save, and add your memory to your messages | Contract — Art. 6(1)(b) |
| Let the assistant search your earlier chats and send short excerpts to the provider of the chat you are in | Contract — Art. 6(1)(b) |
| Store project knowledge and add it to messages in that project | Contract — Art. 6(1)(b) |
| Generate memory from your chats in the background ("Generate memory from chats") | Your consent — Art. 6(1)(a). Turning it off withdraws it |
| Update memory when you ask: Refresh, Update now, Build memory from past chats, Import | Contract — Art. 6(1)(b), at your request each time |
| Check text before it is saved to memory, and refuse never-stored items and sensitive topics | Legitimate interests — Art. 6(1)(f): keeping out of memory what should not be there. For sensitive information, also your explicit consent — Art. 9(2)(a) |
| Keep a record of your consents, of when you accepted the Terms of Use and of your age confirmation | Legal obligation to be able to prove consent — Art. 6(1)(c) with Art. 7(1) for the consents; legitimate interests — Art. 6(1)(f) for the Terms and age record |
| Send your messages to DeepSeek, Moonshot AI or Qwen, outside the EU without an adequacy decision | Your explicit consent to the transfer — Art. 49(1)(a) |
| Send the email verification and password reset emails | Contract — Art. 6(1)(b) |
| Send you push notifications | Your consent — Art. 6(1)(a) |
| Publish a chat behind a share link | Your consent — Art. 6(1)(a) |
| Let search engines index a shared chat | A separate consent — Art. 6(1)(a) |
| Store non-essential preferences in your browser | Your consent — Art. 6(1)(a) and PKE Art. 399 |
| Measure page views and page-load speed with Cloudflare Web Analytics, only if you allow the Analytics category | Your consent — Art. 6(1)(a) and PKE Art. 399 |
| Remember which campaign link brought you to Besidka, and count the milestones above, so I can tell which of my own campaigns work | Legitimate interests — Art. 6(1)(f) |
| Count page views and interface events as aggregate counters | Legitimate interests — Art. 6(1)(f) |
| Error and operational logging | Legitimate interests — Art. 6(1)(f) |
| Security, abuse prevention and rate limiting | Legitimate interests — Art. 6(1)(f) |

Where I rely on legitimate interests, my interest is keeping a free service running, debuggable and not abused. I only log what I need for that, and I never log the content of your messages. For campaign measurement my interest is knowing whether my own campaigns lead anyone to use the app, and I keep that to a few short tags and a handful of milestones. For the memory check, my interest is keeping card numbers, keys, sensitive topics and similar items out of memory; the check stores nothing but counts. You can object to this processing — see [Your rights](#your-rights).

Where I rely on consent, you can withdraw it at any time, and withdrawing is as easy as giving it.

## The AI provider you choose

This is the most important section of this policy, so please read it.

When you send a message, I send your prompt, the message history of that chat and any attachments to the AI provider whose API key you supplied. I send it **with your own API key**, on your instruction. If you use memory, what else goes with your message is described under [Memory](#memory).

Those providers are **independent controllers**, not my processors. I have no contract with them about your data. Your relationship is directly with them, under the terms of your own Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI or Qwen account. What they do with your content, how long they keep it and how you delete it is governed by their terms, not mine.

### If you use a Google Gemini key

Google's Gemini API terms treat paid and unpaid use differently, and where you are matters.

- **In the European Economic Area, Switzerland or the United Kingdom**, Google's terms say its paid-service data terms apply to all your use, **including Google AI Studio and the unpaid quota**. Under those terms Google states that it does not use your prompts or responses to improve its products, that it logs them for a limited period only to detect and prevent policy violations, and that it processes them under its data processing addendum.
- **Elsewhere, on the free (unpaid) tier**, Google states that it uses the content you submit to provide, improve and develop its products and machine-learning technologies, that **human reviewers may read, annotate and process it**, and that you should **not submit sensitive, confidential or personal information** through it. If that applies to you, treat everything you type into Besidka as content Google may keep and review, or use a paid key or another provider.

Google's terms also say the Gemini API is for professional or business use, not consumer use, and that you must be 18 or over to use it. Whether your use fits Google's terms is between you and Google.

### If you use an OpenAI key

OpenAI states that it does not use data submitted through its API to train its models by default. It does retain logs for abuse monitoring, and those logs can contain your prompts, for **up to 30 days**.

### If you use an Anthropic key

Anthropic states that it does not train its models on content submitted through its API. It automatically deletes API inputs and outputs from its backend within **30 days** of receipt or generation, except content flagged for a Usage Policy violation, which it may retain longer for safety enforcement. There is no self-service option to delete this data sooner — deletion relies on that automatic 30-day window.

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
- **Memory settings.** Whether memory is on, whether memory is generated from your chats and when you turned that on, whether chat search is on, and which models update your account and project memory.
- **Past-chat runs.** If you build memory from past chats, a record of each run: its progress, counts, the model used, the cost estimate and the tokens used. The last 5 runs are kept.
- **Project knowledge.** Files, notes and folders you add to a project, the text taken from them, and a search index. The text is extracted in your browser. Originals, text and index are stored in Cloudflare R2, with a short record of each item in the database. If you link a folder from your computer, its name is kept only in your browser; see the [Cookie Policy](/cookie-policy).

### How memory is written

Nothing is written to memory unless you do one of these:

1. **You write or edit an entry** on the Memory page.
2. **You ask the assistant** in a message to remember or forget something. It saves it and shows "Saved to memory", with Undo. The assistant saves something only when your current message asks it to.
3. **You turn on "Generate memory from chats".** It is off until you turn it on. Then, about ten minutes after you stop using a chat, Besidka sends the new part of that chat to the model you chose for memory, **on your own key**, and saves the lasting facts and preferences it finds. It sends your messages, with the assistant's replies as context, and never files, tool results or web results. It runs only for chats you use after turning it on. Each run is billed to your key.
4. **You start a run yourself**: **Refresh** on a project, **Update now**, **Build memory from past chats**, or **Import** from another assistant. Building from past chats shows a cost estimate first, reads at most 200 chats and 4 million tokens per run, and can be cancelled. When you import, the text you paste is not stored, only the entries made from it.

### What memory never keeps

Every one of those paths goes through an automatic check on my server before anything is saved.

- **Never stored, even if you ask:** payment card numbers; IBAN and bank account numbers; government ID numbers (PESEL, SSN); tax identification numbers; passport numbers; API keys and access tokens; JSON Web Tokens; passwords and credentials; private keys; criminal history; immigration or residence-permit status; precise home address; live location; other highly sensitive identifiers.
- **Sensitive topics are refused:** health, religious or philosophical beliefs, political opinions, racial or ethnic origin, sex life or sexual orientation, trade union membership, genetic and biometric data, and also ongoing legal disputes and drugs. There is no setting that allows them.

The check uses fixed word and pattern rules in English, Ukrainian, Polish and Russian, not an AI model. It is a safeguard, and it can miss unusual wording. If you see something in memory that should not be there, delete it. Before chat text is sent to the memory model, never-stored items such as card numbers and keys are removed from it. My logs record only how many items were refused and in which category, never the text. Because this check reads text that may contain sensitive information, it is covered by your consent described in [Sensitive information in your chats](#sensitive-information-in-your-chats).

### How memory is used

- **Use memory** (on unless you turn it off): a short index of your memory is added to each message you send. It holds your profile and preferences text and a one-line description of every other entry. The assistant can read a full entry when it needs it. In a project, the project's entries are used, plus your account entries if the project is set to use them.
- **Search and reference chats** (on unless you turn it off): the assistant can search your earlier chats and read short excerpts from them. You see it as a visible step with links. Your current chat is not searched. In a project that does not use account memory, only that project's chats are searched.
- **Project knowledge** is added to messages in that project in full when it fits the model's limits, and is searched and quoted otherwise.

### Who receives memory

- The **AI provider or gateway of the chat you are in** receives the memory index, any entry the assistant reads, chat excerpts and project knowledge, with your messages.
- The **provider of the model you chose for memory** receives the chat text it works on, when memory is written from chats (paths 3 and 4). By default that is "Same as chat", the model you are chatting with. If you choose a different one, that company receives the text.
- Nobody else. Cloudflare stores it for me as my processor. Where these companies are, and what that means, is under [Transfers outside the EU](#transfers-outside-the-eu).

### Profiling

Generating memory from chats is **profiling** under GDPR Art. 4(4): an AI model reads your chats and records things about you, such as your preferences, interests and work. It only happens if you turn it on, and its only use is to give the model context in your own later chats.

It is not the kind of automated decision GDPR Art. 22 is about. Nothing is decided about you on the basis of memory: no access is granted or refused, nothing is scored, and nobody else uses it. It changes only what the model knows when it answers you, and you can see, edit and delete every entry.

### Your controls

- Edit or delete any entry, or **Reset** to delete all of them.
- Turn **Use memory** off: entries are kept, but they are no longer added to your messages and nothing new is generated.
- Turn **Generate memory from chats** off: nothing new is generated in the background. The entries it already made stay until you delete them.
- Turn memory off for a single project.
- **Export JSON** on the Memory page downloads your memory entries and memory settings.
- Withdraw your consent to store sensitive information in **Profile → Security → Privacy & consent**: Besidka then stops all memory work until you consent again.
- Deleting a chat deletes generated entries that came only from that chat. Entries you saved yourself or imported stay, because you asked for them. Deleting a project deletes its entries and its knowledge items; the original files stay in your file library. Deleting your account deletes everything.

## Who else receives your data

| Recipient | What they receive | Where | Safeguard |
| --- | --- | --- | --- |
| Cloudflare | Everything the service stores and serves — Workers, D1 database, KV cache, R2 files, Images, Email Sending and Routing — plus Turnstile bot-protection signals on sign-in, sign-up and password reset forms, plus, only if you allow the Analytics category in the cookie banner, the page-view and page-load measurements sent by Cloudflare Web Analytics | EU and US | Processor for me. Certified under the EU–US Data Privacy Framework. |
| Axiom | Operational and error logs | US | Processor for me. Standard Contractual Clauses. |
| Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen | Your prompts, message history and attachments, and, if you use memory, your memory index, the memory entries the assistant reads, excerpts of your earlier chats and project knowledge, sent with your own API key. When memory is written from your chats, the text of those chats goes to the provider of the model you chose for memory | Anthropic: Ireland for customers in the EEA under Anthropic's terms, otherwise United States. OpenAI: Ireland for customers in the EEA and Switzerland under OpenAI's terms, otherwise United States. Google, xAI: United States. DeepSeek: China. Moonshot AI and Qwen: Singapore, as Besidka calls them | Independent controller. Your own terms with them apply. See [Transfers outside the EU](#transfers-outside-the-eu). |
| Vercel (AI Gateway) | Only if you route a chat through it: your prompts, message history and attachments, in transit to the model vendor you selected, sent with your own gateway key | Depends on your gateway account | Independent controller. Your own terms with them apply. Vercel Inc. is certified under the EU–US Data Privacy Framework. Vercel's DPA describes it as a processor for its own customers, but does not name AI Gateway; the zero-data-retention and no-training commitments are in Vercel's product documentation, not its contract. [Vercel Privacy Notice](https://vercel.com/legal/privacy-notice) |
| Cloudflare (AI Gateway) | Only if you route a chat through it: your prompts, message history and attachments, sent with your own Cloudflare account credentials. The models offered through it are Workers AI models that Cloudflare itself hosts and runs. This is a separate role from Cloudflare's hosting of Besidka above. | Depends on your gateway account | Independent controller — a different role from Cloudflare's hosting of Besidka above. Your own terms with them apply. AI Gateway logs your prompts and responses to your own Cloudflare dashboard by default until you turn that off. Cloudflare states it does not train on your content. [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) |
| OpenRouter | Only if you route a chat through it: your prompts, message history and attachments, in transit to the model vendor you selected, sent with your own gateway key | Depends on your gateway account | Independent controller. Your own terms with them apply. OpenRouter says in its privacy policy that it relies on the Standard Contractual Clauses for transfers. OpenRouter retains nothing by default, but opting into prompt logging in your own OpenRouter account grants OpenRouter a broad licence to that content. [OpenRouter Privacy Policy](https://openrouter.ai/privacy) |
| Brave Search | Only if you turn Brave search on for a message: the search query your model writes from your prompt, sent with your own Brave API key | US | Independent controller. Your own terms with them apply. [Brave Search API privacy notice](https://api-dashboard.search.brave.com/documentation/resources/privacy-notice) |
| Exa | Only if you turn Exa search on for a message: the search query your model writes from your prompt, sent with your own Exa API key | US | Independent controller. Your own terms with them apply. [Exa Privacy Policy](https://exa.ai/privacy-policy) |
| Google FCM, Apple APNs, Mozilla autopush | The push endpoint your browser issued, plus the encrypted notification | Depends on your browser vendor | Necessary to deliver a push notification you asked for. |
| Google or GitHub | Only if you use them to sign in. I request the scopes `email profile openid` from Google and `read:user user:email` from GitHub. | US | Independent controllers for your account with them. |
| Search engines | A shared chat, and only if you turned on the separate indexing option for that share | Worldwide | Your consent. |

Sign-in, sign-up and password reset forms are protected by **Cloudflare Turnstile**, a bot-detection check that runs as part of Cloudflare, the same infrastructure provider listed above. On most visits it runs without any action from you; if a visit looks automated, it may present a challenge before letting the form through. To do this, Turnstile looks at signals about your browser and device. See Cloudflare's [Turnstile Privacy Addendum](https://www.cloudflare.com/en-gb/turnstile-privacy-policy/) for what a Turnstile check itself collects from your visit.

Cloudflare Web Analytics, which loads only if you allow the Analytics category in the cookie banner, is run by Cloudflare as the same infrastructure provider listed above. See [Analytics](#analytics).

I do not sell your data. I do not share it with advertisers, data brokers or analytics networks. There are no advertising scripts on the site, and the only analytics script is Cloudflare Web Analytics, which stays off until you allow it.

I may disclose data if I am legally required to, for example in response to a valid order from a Polish authority. If that happens and I am allowed to tell you, I will.

## Transfers outside the EU

Cloudflare and Axiom process data in the United States as well as in the EU. Cloudflare is certified under the EU–US Data Privacy Framework, which the European Commission found adequate in Decision (EU) 2023/1795. Axiom relies on the European Commission's Standard Contractual Clauses.

When you send a message, **my server** sends it to the AI provider, AI gateway or search provider you chose. If that company is outside the EU or EEA, that is a transfer of your personal data from me to a third country, so here is where each one is and what protects it. I have no contract of my own with these companies. What protects a transfer is what each of them says in its own terms for your account with it.

- **Google and Vercel.** Google LLC and Vercel Inc. are certified under the EU–US Data Privacy Framework, which the European Commission found adequate in Decision (EU) 2023/1795.
- **Anthropic and OpenAI.** Anthropic's terms name **Anthropic Ireland Limited**, and OpenAI's data processing terms name **OpenAI Ireland Ltd**, as their company for customers in the EEA. Transfers on to their US parent companies, Anthropic PBC and OpenAI OpCo, LLC, rely on the Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) under their data processing terms.
- **xAI.** xAI's data processing addendum names **SpaceXAI LLC** (formerly X.AI) and incorporates the Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914).
- **OpenRouter.** OpenRouter, Inc. is a US company, and its privacy policy says it relies on the Standard Contractual Clauses approved by the European Commission.
- **DeepSeek** stores data in the **People's Republic of China**. Besidka reaches **Moonshot AI** and **Qwen** at their **Singapore** endpoints. The European Commission has **not** adopted an adequacy decision for China or Singapore, and I have no contract with these companies that could add safeguards. Your data there is protected only by their own terms and by local law, which may allow access by public authorities that EU law would not allow, and you may find it hard to enforce your rights against them. Choose these providers only if you accept that. Before you add a key for one of them, and before your next message through a key you already added, I show you these risks and ask for your explicit consent to the transfer (GDPR Art. 49(1)(a)). You can withdraw it in **Profile → Security → Privacy & consent**, and deleting the key withdraws it too. If you do not consent, you cannot send messages to that provider and I do not use it for memory; the key stays stored until you delete it. This consent does not apply to a model you reach through a gateway, because the onward step then happens under your own gateway account.

If you route a chat through an AI gateway, where your prompts go depends on the gateway, the account you hold with it and the model vendor you selected behind it. The transfer safeguard is whatever your own agreement with that gateway provides: Vercel Inc. is certified under the EU–US Data Privacy Framework, OpenRouter says it relies on the Standard Contractual Clauses, and Cloudflare's Customer DPA sets out its own mechanisms. Vercel and OpenRouter can pass your request on to model vendors anywhere, including in China, depending on the model you pick; that onward step happens under your own gateway account.

If you turn on Brave Search or Exa for a message, the search query goes to that provider, a company based in the United States, under the account you hold with them.

## Operational logging

My logs are deliberately narrow. Specifically:

- **No raw IP address is ever written to my logs.** I keep only coarse metadata that Cloudflare attaches to the request: the data centre, country, region, continent, network operator (ASN) and timezone.
- Email addresses in authentication flows are **masked** before they are logged.
- **The content of your messages, your prompts and the model's answers are not logged.**
- Search queries sent to Brave Search or Exa are not logged either, only how many results came back.
- Push endpoints and push keys are never logged.
- For memory and chat search, logs hold counts (what was saved, refused or skipped, how many chats matched a search), the category of a refused item, which model and provider were used, and technical error labels. They never hold the text of your memory, your chats, your search terms or anything you import.
- When you give or withdraw a consent, the log line for that request records the action, the version of the text and, for a transfer consent, the provider's name, together with your pseudonymous user id.
- When you create an account, save your first key or send your first message, the log line for that event can carry the campaign tags from your first-touch record and, for a key or message, the provider's name. Those log lines already carry a pseudonymous user id, so the campaign tags are linked to that id for as long as the logs are kept.

## How long I keep things

| Data | How long |
| --- | --- |
| Account, chats, messages, projects, settings, API keys | Until you delete them, or until you delete your account |
| Files | **30 days by default.** You can change this in your settings, including setting files never to expire. Files linked to a project as knowledge do not expire while they are linked. An hourly job deletes the expired file from R2 and then its database row. |
| Share links | Until you revoke the share, or until the expiry you chose (1 hour, 1 day, 1 week, 1 month, 1 year, or never). Revoking deletes the share record. |
| Push subscriptions | Until you turn notifications off, or until your browser's push service reports the endpoint as invalid |
| Sessions | Until they expire or you sign out |
| Campaign attribution and milestone records | Until you delete your account. They are deleted together with it. |
| Aggregate analytics counters | About three months, which is how long Cloudflare keeps Workers Analytics Engine data |
| Cloudflare Web Analytics measurements (only if you allow the Analytics category) | Held by Cloudflare, not by me. Cloudflare states that it keeps unsampled data for the past 7 days and then aggregates it, and that its dashboard shows the previous six months. It does not state how long the aggregated data is stored. See Cloudflare's [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/). |
| Operational logs | As kept by Axiom under my plan, and only in the reduced form described above |
| Memory entries | Until you delete them or reset memory, delete the only chat a generated entry came from, delete the project (for project entries), or delete your account |
| Memory settings, including when you turned memory generation on | Until you delete your account |
| Past-chat run records | The last 5 runs; deleted with your account |
| Project knowledge | Until you remove it or delete the project. The original files then stay in your file library under its normal rules |
| Your consent to store sensitive information, your acceptance of the Terms of Use and age confirmation, and your consent to transfers to DeepSeek, Moonshot AI or Qwen | While your account exists. Withdrawing keeps the record of when you gave and withdrew it. Deleted with your account |
| Cookie consent records | Stored in a separate database, pseudonymously — see [Cookie consent records](#cookie-consent-records) |

### Backups

My database runs on Cloudflare D1, which keeps **point-in-time backups for up to 30 days** ("Time Travel"). This is a disaster-recovery feature: it is used only to restore the database after data loss or a bad migration.

The honest consequence is that for up to 30 days after you delete something, a copy of it can still exist inside those backups. I cannot selectively erase a single record from a point-in-time backup. Those backups roll off after 30 days and I do not use them for anything else.

### Cookie consent records

When you make a cookie choice, I record it so I can prove the choice was made. Those records are kept in a **separate database, pseudonymously**: no user id, no IP address, no email address. A record holds a random id, a timestamp, the version of the banner, which categories were granted, denied or changed, how the choice was made, and a coarse country.

## Public chat sharing

Sharing a chat is off unless you switch it on for that specific chat. It is based on your consent and you can revoke it. Please understand exactly what it does.

- **Anyone with the link can open the chat. No account is needed.** An unlisted URL is not access control. Treat a share link like a public web page you have chosen not to advertise.
- **Search-engine indexing is a separate switch.** A share is not indexable unless you also turn indexing on for it.
- Per-share switches control whether **files** are included, whether **message metadata** (timestamps, token counts and cost figures) is shown, and whether **your name and avatar** are shown. Tool calls are always removed from a shared chat.
- Another switch controls **branching**. If it is on, a signed-in visitor can copy the shared conversation into their own account and continue it there. Their copy is their own data from that point on, and revoking your share does not remove it.
- Files in a shared chat are served through short-lived signed tokens that expire after **1 hour** and are re-checked against the live share every time. Sharing a chat does not make the file permanently public.

### Revoking a share

Revoking a share deletes the share record and stops access through me immediately.

I want to be honest about the limit of that. Once something has been public, I **cannot** recall search-engine caches, web archives, screenshots, copies someone downloaded, or content that was scraped while the link was live. I take the reasonable steps that are within my control. I cannot promise that a shared chat becomes unseen.

If you plan to share a chat, please re-read it first, and remember that it may contain other people's personal data as well as your own.

## Push notifications

Push notifications are optional and based on your consent. If you turn them on, your browser issues a subscription endpoint and I store it, along with the keys needed to encrypt a message to your browser. Delivery goes through your browser's own push service — Google FCM for Chrome, Apple APNs for Safari, Mozilla autopush for Firefox. Those services see the endpoint and the encrypted payload.

Turning notifications off in your settings, or in your browser, revokes the subscription.

## Email I send you

I send exactly two kinds of email:

1. Email address verification
2. Password reset

That is all. **I never send marketing email**, newsletters or product announcements, and there is no mailing list to unsubscribe from. Email is sent through Cloudflare's email sending service.

## Analytics

I measure three things. Two of them use no cookie and nothing on your device and run without a banner choice. The third is optional and is off until you allow it.

**Aggregate counters.** I count page views and a small set of interface events (for example, that a call-to-action was clicked) **on the server**, in Cloudflare Workers Analytics Engine. A counter holds the event name, the path, a coarse country, a device class (mobile, tablet or desktop) derived from the User-Agent string, and the campaign tags from the link you opened, if it had any. It holds **no user id, no email address and no IP address**, and no cookie is set or read. Cloudflare keeps this data for about three months.

Because those counters are aggregate and cannot be linked back to you, they are not personal data, and they are not gated behind consent.

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
- Your AI provider, AI gateway and search provider API keys are encrypted as described above.
- Access to production data is limited to the controller.

No service is perfectly secure. If you find a security problem, please write to **:privacy-email-link{}** and give me a chance to fix it before disclosing it.

## Automated decision-making and profiling

**GDPR Art. 22 does not apply to Besidka.** I do not make automated decisions that produce legal effects for you or that similarly significantly affect you. The model's answer in a chat is content generated at your request, not a decision about you.

[Memory](#memory) can be **profiling** under GDPR Art. 4(4) when you turn on "Generate memory from chats", and project memory works the same way. What that means and why it is not an Art. 22 decision is explained under [Profiling](#profiling).

## Sensitive information in your chats

You can type or upload anything into Besidka. So your chats, projects and files may contain what the GDPR calls special category data: information about your health, racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, genetic or biometric data, or sex life or sexual orientation.

I do not ask for this information. I also cannot separate it from the rest of what you write without reading your chats, and I do not read them. Storing a chat and sending it where you told me to is the service itself, so if you include such information, it is stored and sent together with everything else.

My legal basis for that is your **explicit consent** under GDPR Art. 9(2)(a). I ask for it once, in the app, before you send a message, separately from the [Terms of Use](/terms-of-use): in a separate box that is not ticked in advance, next to a second box where you accept the Terms and confirm that you are 18 or over. The consent covers exactly this:

1. storing the sensitive information you choose to include in your chats, projects and files;
2. sending it to the AI providers, AI gateways and search providers whose keys you add, for your chats, for project memory and for memory; and
3. automatically checking text before it is saved to memory, so that sensitive topics are kept out of memory.

I do not use it for anything else. I do not read it, train on it, use it for advertising, or use it to infer anything about you. I record that you gave the consent, when, and which version of the text you agreed to, so that I can prove it (GDPR Art. 7(1)). If I change the text in a way that matters, I ask you again before your next message.

**Withdrawing.** You can withdraw this consent at any time in **Profile → Security → Privacy & consent**, which also shows when you consented and to which version of the text. Withdrawing does not make what happened before unlawful. Because I cannot tell which new messages would contain sensitive information, Besidka stops sending new messages until you consent again. It also stops all memory work: generating memory from your chats, building it from past chats, refreshing project memory and importing are skipped or refused, and a build that is running is cancelled. You can still read, export and delete your data. To have sensitive information you already stored removed, delete the chats, projects or files that contain it, or your account, or write to **:privacy-email-link{}** and tell me which ones, and I will delete them.

**If you do not consent**, you can still read, export and delete your data, but you cannot send messages. I ask for consent rather than forbid such information because I would rather be honest that it will end up in chats than pretend it will not.

Some advice, which is advice and not a rule:

- Whatever you send goes to the provider or gateway you chose, under your own account with them. On some free plans that provider may keep it and let people review it; see [The AI provider you choose](#the-ai-provider-you-choose). Some providers are outside the EU; see [Transfers outside the EU](#transfers-outside-the-eu).
- Take particular care with **other people's** sensitive information. Your consent covers information about you; it cannot cover someone else's.
- Information about criminal convictions or offences is treated differently in the GDPR (Art. 10) and cannot be based on consent. Please keep it out of your chats where you can, and ask me to delete any chat that contains it.

## Age limit

Besidka is for people aged **18 or over**. Using Besidka requires your own AI provider API key, and the providers set 18 as the minimum age for an API account — Google AI Studio requires you to be 18 or over — so there is no younger tier for me to support. Because the service is adults-only, the children's consent rules in GDPR Art. 8 do not arise. You confirm that you are 18 or over in the app before you send your first message. If you are under 18, please do not create an account. If you believe someone under 18 has an account, write to **:privacy-email-link{}** and I will delete it.

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

Most things you can do yourself in the app: edit your profile, delete a chat, delete a file, revoke a share, turn notifications off, change your cookie choices, see, edit, export or reset your memory, withdraw your consent to store sensitive information or to a transfer to DeepSeek, Moonshot AI or Qwen (in **Profile → Security → Privacy & consent**), or delete your whole account.

For anything else, email **:privacy-email-link{}**. I answer within **one month**. If a request is complex I may extend that by up to **two further months**, and if I do, I will tell you within the first month and explain why.

I do not charge for this. I may ask you to confirm you control the account's email address, so I do not hand your data to someone else.

### Getting a copy of your data

**Memory** has a self-service export: **Export JSON** on the Memory page downloads your memory entries and memory settings. It does not include project knowledge or the technical records of memory (such as past-chat run records and when you turned memory generation on).

For everything else, including your account data, chats, projects, project knowledge and file list, email **:privacy-email-link{}** and I will send you a copy in a machine-readable format.

### Deleting your account

You can delete your account from your settings. I email you a confirmation link, and opening it removes your account and all data associated with it, including your chats, projects, settings, memory entries and memory settings, past-chat run records, project knowledge, your consent records, stored provider, gateway and search API keys, share records, push subscriptions, your campaign attribution and milestone records and your stored files.

Open that link in the same browser you are signed in to. The link is tied to your signed-in session, so opening it on a different device will not work.

Four honest limits:

1. **Backups.** As described under [Backups](#backups), Cloudflare D1 keeps point-in-time backups for up to 30 days. Deleted data can persist there for that window before rolling off. Those backups exist only for disaster recovery.
2. **Your AI provider.** I **cannot** erase anything from Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI or Qwen. That processing happened under **your** provider account, with your key, and they are independent controllers. To delete data there, use their own controls and privacy requests — Anthropic automatically deletes API data within 30 days, OpenAI at [privacy.openai.com](https://privacy.openai.com/) and Google through your Google account's privacy settings. For xAI, DeepSeek, Moonshot AI and Qwen, use their own controls and privacy requests.
3. **Your AI gateway.** If you routed a chat through Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter, I **cannot** erase anything the gateway kept, such as its own logs of your requests, or anything the model vendor behind it received. That happened under **your** gateway account, and they are independent controllers. Use the gateway's own controls and privacy requests.
4. **Your search provider.** I **cannot** erase a search query from Brave's or Exa's own records. The query was sent under **your** Brave or Exa account, with your key, and they are independent controllers. Brave states that it keeps a record of API queries for up to 90 days; for anything else, use their own controls and privacy requests.

### Complaining

If you think I have handled your data unlawfully, you can complain to the Polish supervisory authority:

**Prezes Urzędu Ochrony Danych Osobowych (UODO)**
ul. Stawki 2, 00-193 Warszawa, Poland
[uodo.gov.pl](https://uodo.gov.pl/)

You can also complain to the supervisory authority of the EU or EEA country where you live or work, and you have the right to an effective judicial remedy.

## Changes to this policy

If I change this policy in a way that matters, I will update the date at the top and, for significant changes, tell you in the app before the change takes effect. The current version is always at this URL.

## Contact

For anything in this policy, including any of the rights above, write to **:privacy-email-link{}**.
