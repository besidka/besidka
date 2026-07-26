---
title: "Privacy Policy"
description: "How Besidka handles your data — what is stored, who receives it, how long it is kept, and the rights you have under the GDPR."
updatedAt: 2026-07-26
summary: "Besidka stores your account, chats, files, settings and your encrypted AI provider API key on Cloudflare infrastructure. When you send a message, it goes to the AI provider whose key you supplied — that provider is a separate company with its own privacy terms, and if you use a free Google Gemini key, Google may use your content to improve its products and human reviewers may read it. I never train any model on your data, I never sell it, and there are no ads. Public share links are off by default and anyone who has the link can read the chat. You can delete your account and all its data from your settings at any time."
---

## What this policy covers

This policy applies to the hosted service at **www.besidka.com** only.

Besidka is open-source software. If you run your own copy of it, **you** are the data controller for that deployment. I have no access to it, and this policy does not apply to it. Under the EU AI Act you would also be the provider or deployer of that system, not me.

## Who is responsible for your data

The controller of your personal data is **Serhii Chernenko**, an individual resident in Poland (European Union).

Besidka is a personal, non-commercial project. It is **not a registered business** — there is no company, no sole proprietorship and no VAT registration behind it.

- Name: **Serhii Chernenko**
- Email: **{{ privacyEmail }}**
- Location: **Poland (European Union)**

I tell you the country because it decides which supervisory authority is competent for you to complain to — see [Complaining](#complaining).

Besidka does not process personal data on the scale that requires a data protection officer, so none has been appointed. Write to the address above and you reach the controller directly, not a bot.

## How Besidka works, in one paragraph

Besidka is a free AI chat app. You bring your own API key from an AI provider (OpenAI or Google AI Studio), and you pay that provider directly for the usage. **There is no payment relationship between you and me at all** — no subscription, no ads, no donations, no payment processor, and therefore no billing or card data anywhere in this policy. What I store is what is needed to run the chat app for you.

## What I store

Everything below lives in a Cloudflare D1 database, except files, which live in Cloudflare R2 object storage.

### Account and sign-in

- Your name, email address, whether your email is verified, and your avatar URL
- Your sessions, **including the IP address and browser User-Agent** recorded when the session was created
- Your linked Google or GitHub account, if you sign in that way, and which sign-in method you used last
- A hash of your password, if you sign in with a password. I never store the password itself.

### Your content

- Your chats and messages. The full message content is stored, including text, attachments references and model output.
- Your projects, including the project name, its instructions and its memory
- Metadata about your files (name, size, type, storage key, expiry). The file itself is stored in Cloudflare R2.
- Your settings, such as your preferred model and file retention period
- Deep research jobs, including the request and the resulting report

### Your AI provider API keys

Your provider API keys are stored **encrypted**. That column uses AES-256-GCM with a key derived using PBKDF2-SHA512 (5000 iterations), with a random salt and a random initialisation vector for every stored value.

This is the only field encrypted in this way. Please do not read it as a claim that the whole database is encrypted at the application level.

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
| Store your AI provider API key, encrypted | Contract — Art. 6(1)(b) |
| Send your prompt, message history and attachments to the AI provider you chose | Contract — Art. 6(1)(b) |
| Send the email verification and password reset emails | Contract — Art. 6(1)(b) |
| Send you push notifications | Your consent — Art. 6(1)(a) |
| Publish a chat behind a share link | Your consent — Art. 6(1)(a) |
| Let search engines index a shared chat | A separate consent — Art. 6(1)(a) |
| Store non-essential preferences in your browser | Your consent — Art. 6(1)(a) and PKE Art. 399 |
| Error and operational logging | Legitimate interests — Art. 6(1)(f) |
| Security, abuse prevention and rate limiting | Legitimate interests — Art. 6(1)(f) |

Where I rely on legitimate interests, my interest is keeping a free service running, debuggable and not abused. I only log what I need for that, and I never log the content of your messages. You can object to this processing — see [Your rights](#your-rights).

Where I rely on consent, you can withdraw it at any time, and withdrawing is as easy as giving it.

## The AI provider you choose

This is the most important section of this policy, so please read it.

When you send a message, I send your prompt, the message history of that chat and any attachments to the AI provider whose API key you supplied. I send it **with your own API key**, on your instruction.

Those providers are **independent controllers**, not my processors. I have no contract with them about your data. Your relationship is directly with them, under the terms of your own OpenAI or Google account. What they do with your content, how long they keep it and how you delete it is governed by their terms, not mine.

### If you use a free Google Gemini key

Google's API terms for the **free, unpaid tier** of the Gemini API say that Google uses the content you submit to provide, improve and develop Google products and machine learning technologies, that **human reviewers may read, annotate and process it**, and that you should **not submit sensitive, confidential or personal information** through it.

Most people using their own Google AI Studio key are on that free tier. If that is you, treat everything you type into Besidka as content Google may keep and review. If you do not want that, use a paid Google key on Google's paid terms, or use a different provider.

### If you use an OpenAI key

OpenAI states that it does not use data submitted through its API to train its models by default. It does retain logs for abuse monitoring, and those logs can contain your prompts, for **up to 30 days**.

### I never train on your data

I do not train, fine-tune or evaluate any model on your chats, files or any other data you give me. There is no opt-out to offer, because it never happens.

Whether the **provider** trains on your content is a matter between you and that provider, decided by your own account and contract with them.

## Who else receives your data

| Recipient | What they receive | Where | Safeguard |
| --- | --- | --- | --- |
| Cloudflare | Everything the service stores and serves — Workers, D1 database, KV cache, R2 files, Images, Email Sending and Routing | EU and US | Processor for me. Certified under the EU–US Data Privacy Framework. |
| Axiom | Operational and error logs | US | Processor for me. Standard Contractual Clauses. |
| OpenAI or Google AI Studio | Your prompts, message history and attachments, sent with your own API key | Depends on your provider account | Independent controller. Your own terms with them apply. |
| Google FCM, Apple APNs, Mozilla autopush | The push endpoint your browser issued, plus the encrypted notification | Depends on your browser vendor | Necessary to deliver a push notification you asked for. |
| Google or GitHub | Only if you use them to sign in. I request the scopes `email profile openid` from Google and `read:user user:email` from GitHub. | US | Independent controllers for your account with them. |
| Search engines | A shared chat, and only if you turned on the separate indexing option for that share | Worldwide | Your consent. |

I do not sell your data. I do not share it with advertisers, data brokers or analytics networks. There are no advertising or tracking scripts on the site.

I may disclose data if I am legally required to, for example in response to a valid order from a Polish authority. If that happens and I am allowed to tell you, I will.

## Transfers outside the EU

Cloudflare and Axiom process data in the United States as well as in the EU. Cloudflare is certified under the EU–US Data Privacy Framework. Axiom relies on the European Commission's Standard Contractual Clauses.

Where your prompts go depends on the provider you chose and the account you hold with them.

## Operational logging

My logs are deliberately narrow. Specifically:

- **No raw IP address is ever written to my logs.** I keep only coarse metadata that Cloudflare attaches to the request: the data centre, country, region, continent, network operator (ASN) and timezone.
- Email addresses in authentication flows are **masked** before they are logged.
- **The content of your messages, your prompts and the model's answers are not logged.**
- Push endpoints and push keys are never logged.

## How long I keep things

| Data | How long |
| --- | --- |
| Account, chats, messages, projects, settings, API keys | Until you delete them, or until you delete your account |
| Files | **30 days by default.** You can change this in your settings, including setting files never to expire. An hourly job deletes the expired file from R2 and then its database row. |
| Share links | Until you revoke the share, or until the expiry you chose (1 hour, 1 day, 1 week, 1 month, 1 year, or never). Revoking deletes the share record. |
| Push subscriptions | Until you turn notifications off, or until your browser's push service reports the endpoint as invalid |
| Sessions | Until they expire or you sign out |
| Operational logs | As kept by Axiom under my plan, and only in the reduced form described above |
| Consent records | Stored in a separate database, pseudonymously — see [Cookie consent records](#cookie-consent-records) |

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

I count page views and a small set of interface events (for example, that a call-to-action was clicked) **server-side**. That counting uses **no cookie, no user identifier and stores no IP address**. What is recorded is the event name, the path, a coarse country, and a device class (mobile, tablet or desktop) derived from the User-Agent string.

Because those counts are aggregate and cannot be linked back to you, they are not personal data, and they are not gated behind consent.

## Cookies and browser storage

I use a small number of cookies and browser storage keys. The necessary ones keep you signed in and remember your cookie choice. The optional ones remember preferences such as your theme. Nothing is used for advertising or cross-site tracking.

The full list, with names and durations, is in the [Cookie Policy](/cookie-policy).

## Security

- All traffic is served over HTTPS.
- Session cookies are `HttpOnly` and, over HTTPS, carry the `__Secure-` prefix.
- Your provider API keys are encrypted as described above.
- Access to production data is limited to the controller.

No service is perfectly secure. If you find a security problem, please write to **{{ privacyEmail }}** and give me a chance to fix it before disclosing it.

## Automated decision-making and profiling

**GDPR Art. 22 does not apply to Besidka.** I do not make automated decisions that produce legal effects for you or that similarly significantly affect you. The model's answer in a chat is content generated at your request, not a decision about you.

I also build no features that infer, classify, score or profile you from the content of your chats.

## Special category data

Please do not put special category data into Besidka — health data, political opinions, religious or philosophical beliefs, trade union membership, genetic or biometric data, sex life or sexual orientation, or data about criminal convictions. This is also a rule in the [Terms of Use](/terms-of-use).

I do not ask for it, I have no lawful basis to process it, and content you type is forwarded to a third-party AI provider whose handling of it I do not control.

## Age limit

Besidka is for people aged **18 or over**. Using Besidka requires your own AI provider API key, and the providers set 18 as the minimum age for an API account — Google AI Studio requires you to be 18 or over — so there is no younger tier for me to support. Because the service is adults-only, the children's consent rules in GDPR Art. 8 do not arise. If you are under 18, please do not create an account. If you believe someone under 18 has an account, write to **{{ privacyEmail }}** and I will delete it.

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

Most things you can do yourself in the app: edit your profile, delete a chat, delete a file, revoke a share, turn notifications off, change your cookie choices, or delete your whole account.

For anything else, email **{{ privacyEmail }}**. I answer within **one month**. If a request is complex I may extend that by up to **two further months**, and if I do, I will tell you within the first month and explain why.

I do not charge for this. I may ask you to confirm you control the account's email address, so I do not hand your data to someone else.

### Getting a copy of your data

There is **no self-service export button yet**. Until there is, email **{{ privacyEmail }}** and I will send you a copy of your account data, chats, projects and file list in a machine-readable format.

### Deleting your account

You can delete your account from your settings. I email you a confirmation link, and opening it removes your account and all data associated with it, including your chats, projects, settings, stored provider API keys, share records, push subscriptions and your stored files.

Open that link in the same browser you are signed in to. The link is tied to your signed-in session, so opening it on a different device will not work.

Two honest limits:

1. **Backups.** As described under [Backups](#backups), Cloudflare D1 keeps point-in-time backups for up to 30 days. Deleted data can persist there for that window before rolling off. Those backups exist only for disaster recovery.
2. **Your AI provider.** I **cannot** erase anything from OpenAI or Google. That processing happened under **your** provider account, with your key, and they are independent controllers. To delete data there, use their own controls and privacy requests — OpenAI at [privacy.openai.com](https://privacy.openai.com/) and Google through your Google account's privacy settings.

### Complaining

If you think I have handled your data unlawfully, you can complain to the Polish supervisory authority:

**Prezes Urzędu Ochrony Danych Osobowych (UODO)**
ul. Stawki 2, 00-193 Warszawa, Poland
[uodo.gov.pl](https://uodo.gov.pl/)

You can also complain to the supervisory authority of the EU or EEA country where you live or work, and you have the right to an effective judicial remedy.

## Changes to this policy

If I change this policy in a way that matters, I will update the date at the top and, for significant changes, tell you in the app before the change takes effect. The current version is always at this URL.

## Contact

For anything in this policy, including any of the rights above, write to **{{ privacyEmail }}**.
