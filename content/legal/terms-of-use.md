---
title: "Terms of Use"
description: "The rules for using the hosted Besidka service — what you can expect from me, what I expect from you, how to report content, and where you stand legally."
updatedAt: 2026-10-29
summary: "Besidka is a free AI chat app run by one person in Poland. You bring your own AI provider API key, or your own AI gateway account, and optionally your own Brave or Exa search key and your own TypeSafe AI key for optional checks, and you pay each of those companies directly — you never pay me. You must be at least 18. You are talking to an AI system, so its answers can be wrong or invented and are never professional advice. You keep your content; I only use it to run the service for you. You may connect an AI app of your choice to your account, and what it does with your data is between you and that app. Share links make a chat readable by anyone who has the link, every extra on a new share starts off, and you should only publish content you have the right to publish. Anyone can report illegal content to me by email and a person will look at it, and rights holders can send a copyright notice to the same address. I limit my liability only as far as the law allows, and never for intentional harm, gross negligence, or death or personal injury."
---

## Who I am

The hosted Besidka service at **besidka.com** is provided by **Serhii Chernenko**, an individual resident in Poland (European Union). Besidka is a personal, non-commercial project and **not a registered business** — there is no company, no sole proprietorship and no VAT registration behind it.

- Name: **Serhii Chernenko**
- Email: **:privacy-email-link{}**
- Location: **Poland (European Union)**

That one address handles everything — general questions, privacy requests, reports of illegal content, and enquiries from authorities. It is read by a person, not a bot, and it is the fastest way to reach me.

In these terms, "I" and "me" mean the person above, and "you" means the person using the service.

## What these terms cover

These terms are an agreement between you and me about the **hosted service at besidka.com**.

They do not cover copies of Besidka that other people run. If you run your own copy, you set your own terms, you are the data controller for it, and under the EU AI Act you are the provider or deployer of that system. I have no access to and no responsibility for it.

By creating an account or using the service you accept these terms, and the app asks you to confirm that in a box before you send a message. If you do not accept them, please do not use the service.

## The service

Besidka is a chat interface to third-party AI models. I provide the interface, the storage for your chats and files, and the plumbing that talks to the model.

**I do not provide the AI model.** You supply your own API key from an AI provider (currently Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen), and your prompts are sent to that provider using your key.

Instead, you may route a chat through your own account with an AI gateway (currently Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter). Your prompts are then sent to that gateway using your gateway credentials, and the gateway passes them on to the model you selected.

**I do not provide web search either.** You may add your own API key from a search provider (currently Brave Search or Exa) and turn it on for a message. The search query your model writes from your prompt is then sent to that search provider using your key.

**The optional checks are not an AI model either.** You may add your own API key from **TypeSafe AI**, and Besidka then asks TypeSafe AI's Jev model short yes/no questions for the checks you leave on, such as whether a message needs a web search or whether a memory entry holds sensitive information. Jev adds no chat model and never answers your messages. A slow or failed check never blocks you, and Besidka works fully without the key. What each check sends is listed in the [Privacy Policy](/privacy-policy#typesafe-ai-checks).

Each AI provider, AI gateway, search provider and TypeSafe AI is a separate company, with its own terms and its own bill.

## There is no payment

The hosted service is **free**. There is no subscription, no paid tier, no advertising, no donations and no payment processor. You never pay me anything and I never ask for card details.

You pay your **AI provider** directly for the model usage under your own account with them. If you route a chat through an **AI gateway**, you pay that gateway directly under your own account with it. If you use a **search provider**, you pay that search provider directly under your own account with it, and that is a separate bill from your model usage. If you add a TypeSafe AI key, each check is billed by TypeSafe AI to your own account, again separately. Their pricing, invoices and limits are between you and them. I do not resell, mark up or take a share of any of it, and I am not a party to those contracts.

Because you never pay me for anything, there is nothing to refund and no right of withdrawal from a purchase arises.

### If that ever changes

The absence of any revenue is not an accident, and it is part of what these terms are built on. If I ever introduce advertising, sponsorship, donations (including a "buy me a coffee" style button to cover hosting), a paid tier, or any monetisation of user data, the service stops being a non-gainful personal project. I would then publish a full set of service-provider details, including a postal address, and update these terms before that change takes effect, with advance notice as described under [Changes to these terms](#changes-to-these-terms).


## Who may use it

You must be at least **18 years old**. Besidka only works if you bring your own AI provider API key, and the providers set their own minimum age for an API account — Google AI Studio requires you to be 18 or over. You cannot use Besidka without such an account, so 18 is the minimum here too.

I ask you to confirm you are 18 or over when you sign up: in the box you tick when you sign up with email, and by continuing when you sign up or sign in with Google or GitHub. I ask again in the app before your first message. I do not ask for your date of birth. If you are under 18, do not create an account. If you find out that someone under 18 has one, tell me at **:privacy-email-link{}** and I will delete it.

## Your account

- Give a real email address you control. You need it to verify your account and to reset your password.
- Keep your password and your session to yourself. You are responsible for activity under your account.
- One person per account. Do not share an account.
- Tell me at **:privacy-email-link{}** if you think someone else has access to your account.

You can delete your account at any time from your settings. That deletes your account and its data — see the [Privacy Policy](/privacy-policy) for exactly what happens, including the 30-day backup window.

## You need your own API key

This section applies to every key you enter: an AI provider key, an AI gateway key or credential, a search provider key, and a TypeSafe AI key.

- You must have the right to use the API key you enter, and you must comply with the terms and usage policies of whoever issued it — your AI provider, AI gateway, search provider or TypeSafe AI. Breaking them is between you and them, but it can also mean Besidka stops working for you.
- Your key is stored encrypted (see the [Privacy Policy](/privacy-policy)), but you should still treat entering a key anywhere as a decision with risk. Use a key scoped and limited to what you need, and rotate it if you have any doubt.
- You are responsible for the usage costs your key incurs, including costs from long conversations, large attachments and deep research runs.
- **A search provider key is a separate cost.** Every search your model runs with your Brave or Exa key is billed to your Brave or Exa account, separately from what your AI provider or AI gateway charges for the model usage. One message can run more than one search.
- **TypeSafe AI is a separate cost too.** Every check you leave on is billed to your TypeSafe AI account, a fraction of a cent each, separately from your model usage. You can switch single checks off, or delete the key to stop all of them.
- **An AI gateway bills you itself.** If you route a chat through a gateway, the model usage is charged through your gateway account, under the gateway's own pricing and terms.
- I cannot see, refund or cap your spending with any of them. Set spending limits in your provider, gateway and search provider accounts if you want a ceiling.

## You are interacting with an AI system

You are using an **AI system**. The text, code, summaries, images and reports you see are generated by a machine-learning model, not written by a person and not checked by me.

- **Output can be wrong.** Models state incorrect things confidently, and they invent facts, quotations, numbers, names, links and citations that look plausible. Verify anything that matters before you rely on it.
- **It is not professional advice.** Nothing you get from Besidka is medical, legal, financial, tax, psychological or other professional advice. It is not a substitute for a qualified professional. In an emergency, contact your local emergency services, not a chat app.
- **Deep research reports can be wrong in a specific way.** A deep research report may contain **fabricated or misattributed citations** — sources that do not exist, or real sources that do not say what the report claims. Open and read the sources yourself before citing them.
- Output is not unique to you. Another user with a similar prompt may receive substantially the same answer.
- Do not use output to make decisions about other people (hiring, credit, eligibility, discipline) without a human being who is competent to make that decision reviewing it.
- Images the model generates are labelled as AI-generated in the app and on share pages. If you publish AI-generated content that could pass for real, label it where the law requires.

## Memory and project knowledge

Memory is optional and under your control. You can turn it off, turn off memory generation from chats, edit or delete any entry, reset it, or export it at any time.

- **Memory can be wrong.** An entry generated from your chats is an AI model's summary and can misunderstand, mix up or outdate what you said. Check it, correct it, or delete it.
- Memory does not keep sensitive topics or the items listed as never stored in the [Privacy Policy](/privacy-policy#memory), even if you ask.
- Generating memory from chats, building it from past chats, refreshing project memory and importing all run on your own API key and are billed to it. The app shows an estimate before building from past chats.
- Do not add files or notes to project knowledge that you have no right to use.

## Connected apps

You may connect an AI app made by someone else to your Besidka account, from its own settings, by approving it on a Besidka screen. The app then reads, and if you allowed it, changes or deletes, the chats, projects, files, memory and settings you approved. How this works and what it means for your data is in the [Privacy Policy](/privacy-policy#connected-ai-apps).

- **The app is yours to choose and yours to answer for.** I do not make, check or endorse any app. You decide whether to connect it and which permissions to give. What the app and its maker do with the data it receives, and what it does in your account with the permissions you gave, is between you and them, under their terms. Connect only apps you trust, and give write permission only where you need it. Deleting is a separate permission that is off until you tick it. Anything an app deletes through your account is deleted for good, exactly as if you had deleted it in Besidka, and I cannot restore it for you.
- **Your responsibilities do not change.** What an app reads or writes through your account is your content and your use of Besidka, so [Other people's data](#other-peoples-data) and [What you may not do](#what-you-may-not-do) apply to it as if you had done it yourself.
- **You can disconnect at any time** in **Profile → Connected apps**. The app stops working at once, on its next request. You can also remove single permissions there, and that takes effect on the app's next request too. Removing a permission only takes something away: to give an app more, reconnect it from the app and approve again. I cannot take back what the app already received.
- **I may disable an app or refuse to register it**, and revoke what it holds, if it abuses the interface, tries to go beyond what you approved, impersonates another app, or puts the service or other users at risk. I do not have to tell the app's maker first.
- **No guarantee.** Connected apps are provided as is, as everything else on the free service (see [Availability and changes to the service](#availability-and-changes-to-the-service)). I may change or remove the connection interface, its permissions and its limits, and an app can stop working because of it, because of a change by its maker, or because of a limit I set to protect the service.

## What you may not do

Do not use Besidka to:

- Break the law, or to produce, store or distribute illegal content, including child sexual abuse material, terrorist content, or content that infringes somebody else's copyright or trade marks.
- Harass, threaten, defame, stalk or doxx anyone.
- Produce malware, exploits, phishing pages or other material designed to break into systems or defraud people.
- Present AI output as human-written where doing so deceives someone to their detriment, or impersonate a real person or organisation.
- Attack the service — no scraping at scale, no brute forcing, no attempt to bypass rate limits or access other users' data, no probing for vulnerabilities beyond good-faith reporting to me.
- Resell or wrap the hosted service as your own commercial product. You may self-host the code instead; that is what the licence is for.

## Sensitive information

You may share sensitive information about yourself in Besidka, such as details of your health or your beliefs, if you want the assistant's help with it. Before you do, know what happens to it:

- It is stored with the rest of the chat and sent to the AI provider, AI gateway or search provider you chose, and to TypeSafe AI if you added a key and left a check on, under your own account with them. On a free Google Gemini key outside the EEA, Switzerland and the UK, Google may keep it and let human reviewers read it, and Exa states it uses the search queries it receives to train its models. I cannot undo that.
- I store and send it only with your explicit consent, which I ask for in the app, separately from these terms. The [Privacy Policy](/privacy-policy#sensitive-information-in-your-chats) explains it, including how to withdraw it. If you do not give that consent, or you withdraw it, you can still read, export and delete your data, but you cannot send new messages or add new content.
- Please take particular care with other people's sensitive information, and with anything about criminal offences; see [Other people's data](#other-peoples-data).

I do not read your chats. What the app does with chat content beyond storing and sending it, such as memory and looking up your earlier chats, is described in the [Privacy Policy](/privacy-policy). None of it is used to make decisions about you.

## Other people's data

If you put someone else's personal data into a chat, you are responsible for having a lawful reason to do that. If you then publish that chat with a share link, you are responsible for that publication too — see below. Memory never keeps sensitive information about anyone, you or other people; see the [Privacy Policy](/privacy-policy#memory).

## Your content

You keep all rights in what you write and upload. I claim no ownership of it.

To run the service, I need a **narrow, limited permission** from you. You grant me a non-exclusive, royalty-free licence, limited strictly to operating the service for you, to:

1. store your content and serve it back to you;
2. transmit your content to the AI provider you chose, or through the AI gateway you chose, using your key, so it can answer, including your memory, project knowledge and excerpts of your earlier chats; transmit chat text to the model you chose for memory, using your key, when memory is written from your chats as described in the [Privacy Policy](/privacy-policy#memory); and transmit the search queries your model writes from it to the search provider you turned on, using your key; transmit the text the TypeSafe AI checks you left on need to TypeSafe AI, using your key, as described in the [Privacy Policy](/privacy-policy#typesafe-ai-checks);
3. keep the memory entries and project knowledge you create or allow, and use them as context for your own later chats; and
4. render your content on a share page **that you yourself created**, for as long as that share is active.

That is the whole licence. It is not perpetual, not transferable and not for any other purpose. It ends for any given content when you delete that content or your account. I do not use your content to train models, to advertise, or to build any other product.

The rights of an AI provider, an AI gateway, a search provider or TypeSafe AI over what you send it come from **your** agreement with that company, not from this licence.

## Share links

Sharing a chat is optional, off by default, and you switch it on per chat. When you create a share, everything extra on it starts off: search indexing, files and generated images, message metadata, your name and avatar, and branching. You switch on only what you want to show. Shares created earlier keep the settings saved with them. Before you share, be clear about what it means.

- **Anyone with the link can read the chat, without an account.** An unlisted URL is not access control. Publish nothing you would not put on a public page.
- **Indexing by search engines is a separate opt-in.** A share is not indexable unless you turn that on too.
- You choose an expiry (1 hour, 1 day, 1 week, 1 month, 1 year, or never; it starts at never) and you can revoke a share at any time.
- Per-share switches control whether files and generated images, message metadata and your name and avatar are visible. Each starts off. Tool calls are always stripped out. If you show your avatar, it is delivered through besidka.com.
- If you turn **branching** on ("let others copy"), a signed-in visitor can copy the shared conversation into their own account and carry on from it. Their copy is theirs; revoking your share does not delete it.

### What you promise when you publish a chat

By turning a share on, you confirm that:

- you have the right to publish everything in that chat, including any content the model produced from material you supplied; and
- you have a lawful basis to publish **any third party's personal data** that appears in it, and you have considered whether you should be publishing it at all.

### Revoking is not undoing

Revoking a share stops access through me immediately and deletes the share record. It cannot recall search-engine caches, web archives, screenshots, downloads, branch copies or anything that was scraped while the link was live. I take the reasonable steps in my control; I cannot promise a published chat becomes unseen.

## Reporting illegal content

Anyone — user or not — can tell me about content on Besidka they believe is illegal. Besidka hosts content that users choose to publish, mainly through share links. I voluntarily follow the notice-and-action rules of the Digital Services Act (Arts. 11, 12, 14, 16, 17 and 18): a single point of contact, reports by email, a decision by a person, and a statement of reasons when I act.

**Send reports to :privacy-email-link{}.** There is no form to fill in, and the mailbox is read by a person — it is not a bot-only address.

If the Digital Services Act applies to Besidka, that same address is my single point of contact under its Articles 11 and 12, and I use it that way in any case:

- **for users, and for anyone else reporting content;** and
- **for Member State authorities, the European Commission and the European Board for Digital Services.**

I accept reports and communications in **English or Polish**.

### What to put in a report

To let me act quickly, please include:

1. A clear explanation of **why you believe the content is illegal**.
2. The **exact URL** (or URLs) of the content. For a shared chat, that is the share link.
3. Your **name and email address**. You may leave them out only if the report concerns child sexual abuse material.
4. A statement, made in good faith, that the information in your report is **accurate and complete**.

### What I do with a report

I confirm I received your report, review it, and decide without undue delay whether the content stays up, is removed or is disabled. I tell you the outcome and how you can challenge it in court. Decisions are made by a person, not automatically.

If your report concerns a **crime involving a threat to someone's life or safety**, I will inform the relevant authorities.

Please do not send reports you know to be false. Reports that are manifestly unfounded and repeated may be ignored.

### Statement of reasons

If I remove or disable your content, restrict its visibility, suspend a share link, or suspend or terminate your account, I will send you a **statement of reasons**. It will say what I did and to which content, why I did it — the legal ground or the rule in these terms I relied on — the facts I relied on, whether automated means were used, and how you can challenge the decision, including in court.

I will not send it where the law forbids it, or where I have no way to contact you.

I do not publish transparency reports and I do not run a formal internal complaint-handling system. If you disagree with a decision, reply to the statement of reasons and a person will look at it again, and your right to go to court is unaffected.

## Copyright complaints

If you hold the rights in a work and believe something on Besidka infringes them, send a copyright notice to **:privacy-email-link{}**. It goes through the same process as a report of illegal content above, and I will tell the user who published the content what I did and why. The elements below are modelled on United States law (17 U.S.C. § 512), so a notice written for it works here too. I have not designated an agent with the US Copyright Office and do not claim the US safe harbour; every notice is handled by the process described here.

### What a copyright notice must contain

A notice needs all of these, so I can act on it:

1. Your physical or electronic signature, as the owner of the right or as a person authorised to act for the owner.
2. Which copyrighted work you say is infringed.
3. Which material you say infringes it, and its **exact URL on besidka.com**, with enough detail for me to find it. For a shared chat, that is the share link.
4. Your name and email address, and, if you act for the owner, the owner's name.
5. A statement that you believe in good faith that the use is not authorised by the copyright owner, its agent or the law.
6. A statement that the information in the notice is accurate and that you are the owner of the right or authorised to act for the owner.

If a notice is missing something, I may ask you to complete it before I act.

### What I do with a notice

If a notice is valid, I remove the material or disable access to it promptly, and I tell the user who published it. I also send them a statement of reasons, as described above.

### If you think a removal was a mistake

If your content was removed because of a copyright notice and you believe that was a mistake or that the material was misidentified, reply to the statement of reasons, or write to **:privacy-email-link{}**, with the link to the material and your reasons. A person will look at it again. If I restore the material, I tell the person who sent the notice. I give them your name or contact details only if you agree.

### Repeat infringers

If a user repeatedly publishes material that I have removed on copyright notices, I may restrict sharing for that account or suspend or terminate it. I send a statement of reasons each time. A notice that was withdrawn or that turned out to be mistaken does not count.

### False notices

A notice that you know contains false statements can make you liable for the damage it causes, for example under 17 U.S.C. § 512(f) in the United States. Please do not send one.

## Content moderation

I do not read your private chats and I do not run automated scanning of chat content for moderation. No automatic system reports what you write to me or to anyone else, and none decides anything about your account.

Besidka has two kinds of automatic check on content. Neither is moderation: neither reports anything, and neither acts on you or your account.

- **The memory check.** Before text is saved to memory, it is checked so that sensitive topics and never-stored items such as card numbers are kept out, and never-stored items are removed from chat text before it is sent to the memory model. It only decides what memory may keep.
- **The optional TypeSafe AI checks,** which run only if you add a TypeSafe AI key and leave them on. They decide whether to search the web, whether memory is worth generating from a chat, how search results are ordered, whether to warn you about personal data before you share a chat, and whether a project file or a search result looks like hidden instructions aimed at the AI. A flagged project file waits for your review and a flagged search result is left out of the model's context, but nothing is deleted, nothing is reported to anyone, and there is no effect on your account.

Moderation is therefore **reactive**. I act on reports, on notices from authorities, and on things I notice while running the service. When I act, I may remove or disable specific content, revoke a share link, restrict a feature for an account, or suspend or terminate an account for serious or repeated breaches of these terms. I aim to act proportionately, and I send a statement of reasons as described above.

## Availability and changes to the service

- **There is no uptime guarantee.** This is a free service run by one person. It may be slow, unavailable, or interrupted for maintenance, and features may change or be removed.
- The service depends on third parties (Cloudflare, your AI provider, and any AI gateway, search provider or TypeSafe AI you use). If they have an outage or change their terms, Besidka is affected.
- **I may discontinue the free hosted service.** If I do, I will give you notice in the app and a reasonable period to get your data out before it is deleted, and I will tell you where to find the source code so you can host it yourself.

## Changes to these terms

If I change these terms in a way that matters to you (a **material change**), I email every account and show a notice in the app at least **30 days** before the change takes effect, and I say what changes and when. When a change is required by law or is needed for security and cannot wait that long, I give at least **14 days** and say in the notice why. This email is a notice about the service, not marketing, so it has no unsubscribe link.

If you do not accept the new terms, you can stop using the service and delete your account before they take effect. Continuing to use the service after the change takes effect means you accept it.

Typo fixes, formatting, updated contact details and clarifications that do not affect your rights or obligations take effect when published, and I only update the date at the top.

### Change history

The change history lists every material change to these terms, with the date I announced it and the date it takes effect.

::legal-change-history{document="terms-of-use"}
::

## Open source, self-hosting and the Besidka name

Besidka's source code is published under the **MIT licence**. You are free to use, modify and self-host it on those terms.

Two things follow that people often get wrong:

1. **The MIT licence covers the source code, not this hosted service.** The MIT "AS IS" disclaimer applies to the code you obtain under that licence. It does not disclaim anything about the service at besidka.com. My disclaimers for the service are the ones set out below, and they are subject to the mandatory law described there.
2. **The MIT licence does not license the "Besidka" name, logo or brand.** You may run your own copy; please do not present it as being Besidka, or use the name or logo in a way that suggests I run it or endorse it.

If you self-host, you are the operator: your users' data is yours to protect, these terms do not apply to your deployment, and you must write your own.

## Disclaimers

To the extent the law allows, the hosted service is provided **as it is and as available**, and I give no warranty that it will be uninterrupted, error-free, secure, or fit for a particular purpose, and no warranty about the accuracy, completeness or usefulness of AI output.

Nothing in this section excludes or limits anything that cannot lawfully be excluded or limited, and it does not take away any statutory right you have that applies to you regardless of what these terms say.

## Liability

I limit my liability **only as far as the law allows** — and no further.

**I am always fully liable, without any limit, for:**

- harm I cause **intentionally**;
- harm I cause by **gross negligence**;
- **death or personal injury**; and
- anything else where the law does not permit liability to be limited or excluded.

Polish law is explicit on the first of these: under Art. 473 § 2 of the Civil Code (Kodeks cywilny), any provision purporting to exclude liability for damage caused intentionally is void. So that provision does not exist here.

Subject to the above, and to the extent the law allows, I am not liable for:

- loss or corruption of data, beyond restoring from my routine backups;
- decisions you take, or content you publish, based on AI output;
- what your AI provider or AI gateway does with your prompts, what your search provider does with your search queries, what TypeSafe AI does with the text its checks receive, or what any of them charges your account;
- unavailability of the service or of a third party it depends on; or
- consequences of a share link you created, once the content has been public.

**Nothing in these terms limits or excludes any right or remedy that cannot lawfully be limited or excluded.** If a court finds any limitation here unenforceable, it is reduced to what is enforceable and the rest stands.

## Governing law and where to go to court

These terms are governed by **Polish law**.

That choice of law is not a way to strip protections from you. To the extent the consumer rules apply to you as someone habitually resident in another EU or EEA country, Art. 6(2) of the Rome I Regulation applies: choosing Polish law cannot deprive you of the protection of the mandatory rules of the country where you habitually live, and those rules apply where they are more favourable to you.

If you live in the EU or EEA, you can bring a dispute in the courts of your own country, and I will not argue that you had to go to Poland.

I would much rather sort a problem out by email first. Write to **:privacy-email-link{}**.

## Contact

One address covers everything in these terms — general questions, privacy and data protection requests, reports of illegal content, and enquiries from authorities:

**:privacy-email-link{}**

See also the [Privacy Policy](/privacy-policy) and the [Cookie Policy](/cookie-policy).
