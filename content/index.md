---
title: Open-source AI chat with BYOK
carousel:
  - src: /preview-light-desktop.svg
    alt: Besidka chat interface in light theme — a conversation with GPT-4o showing a markdown response with syntax-highlighted code.
    caption: Light theme — desktop
  - src: /preview-dark-desktop.svg
    alt: Besidka chat interface in dark theme — file attachments panel open with a PDF selected for the current chat.
    caption: Dark theme — desktop
  - src: /preview-light-mobile.svg
    alt: Besidka chat interface on a mobile device — model selector open, switching between GPT-4o and Gemini 1.5 Pro.
    caption: Mobile — model switcher
description: Your digital besidka for all AI chats. Bring your own API keys, pay only for what you use, and keep full control. No subscriptions, no markup, no lock-in.
faqs:
  - question: What does BYOK mean?
    answer: BYOK stands for "Bring Your Own Key." Instead of paying Besidka a monthly subscription, you connect your own API key from OpenAI or Google AI Studio directly. You pay the provider at their published rates — Besidka adds no markup.
  - question: Which AI providers are supported?
    answer: Currently OpenAI (GPT-4o and other OpenAI models) and Google AI Studio (Gemini models). More providers are planned. Check the GitHub repository for the latest list.
  - question: Do you store my API keys?
    answer: Your keys are stored encrypted in Cloudflare D1, isolated per account behind Better Auth session guards. They are never logged or transmitted to third parties. You can delete them from your profile at any time.
  - question: Can I self-host this?
    answer: Yes. Besidka is MIT-licensed and designed to run on Cloudflare Workers. Clone the repository, follow the Local installation steps in the README, and deploy with a single command. You bring the Cloudflare account.
  - question: Is my chat history private?
    answer: Chat history is stored in your own Cloudflare D1 database, scoped to your account. If you self-host, no third party has access. On the hosted version at besidka.com, only you can read your conversations.
  - question: How is pricing calculated?
    answer: Besidka itself is free to use and open-source. You pay the AI provider (OpenAI or Google) directly at their per-token rates. There is no monthly fee, no seat charge, and no markup. You only pay when you actually send a message.
features:
  - icon: lucide:layers
    title: Multiple AI models
    body: Switch between GPT-4o, Gemini, and other supported LLMs in one place without creating separate accounts.
  - icon: lucide:globe
    title: Web search
    body: Ground AI answers with real-time web context. Besidka can search the web and cite sources inline.
  - icon: lucide:brain
    title: Reasoning mode
    body: Enable step-by-step thinking for complex questions. The model works through its reasoning before giving a final answer.
  - icon: lucide:paperclip
    title: File attachments
    body: Send images and PDFs. Files are stored in your own R2 bucket and can be reused across different chats.
  - icon: lucide:git-branch
    title: Chat branching
    body: Fork any conversation mid-thread to explore a different direction without losing the original.
  - icon: lucide:folder-kanban
    title: Projects
    body: Group related chats under a project with shared instructions and memory so every conversation has context.
hero:
  eyebrow: OPEN SOURCE · BYOK · SELF-HOSTABLE
  headline: Chat with any AI using your own API keys.
  subheadline: Open-source, multi-provider, pay-per-use. No subscriptions, no markup, no lock-in.
  primaryCta:
    label: Start chatting
    href: /signup
  secondaryCta:
    label: View on GitHub
    href: https://github.com/besidka/besidka
steps:
  - icon: lucide:user-plus
    title: 1. Sign up
    body: Create a free account with email and password, or sign in with Google or GitHub. No credit card required.
  - icon: lucide:key
    title: 2. Add your API key
    body: Paste your OpenAI or Google AI Studio API key into your profile. Keys are encrypted at rest and never shared.
  - icon: lucide:message-square
    title: 3. Start chatting
    body: Open a new chat, pick your model, and go. You pay the provider's rate directly — Besidka adds nothing on top.
testimonials:
  - quote: I was spending $60/month across three different AI subscriptions. With Besidka I connect one Google AI Studio key, use Gemini when I need it, and my bill dropped to a few dollars. The branching feature alone is worth the switch.
    author: Indie developer
    role: GitHub
  - quote: The self-hosting story is genuinely good. Fifteen minutes from clone to a running Cloudflare Workers deployment. I pointed it at my own keys and it just worked. The fact that it is open-source means I can actually audit what touches my API credentials.
    author: DevOps engineer
    role: Early adopter
  - quote: I use it for reviewing PRs and drafting release notes. The file attachment support means I can drop in a diff and ask questions about it. Projects let me keep a standing system prompt for each repository without repeating myself every session.
    author: Open-source maintainer
    role: GitHub
---

::home-bubble{role="user" sr-label="User requesting a product demo"}
Show me what it looks like.
::

::home-bubble{wide role="assistant" sr-label="Product screenshot carousel"}
Here is a quick look at Besidka running in both light and dark themes.

:home-carousel
::

::home-bubble{role="user" sr-label="User question about adoption"}
How many people are using this?
::

::home-bubble{wide role="assistant" sr-label="Community size"}
We are an early, growing community. Here is where things stand today.

:home-stats
::

::home-bubble
---
role: user
sr-label: User expressing frustration with subscription AI tools
---
I am paying $20/month for ChatGPT Plus and I do not even use it most days.
::

::home-bubble
---
role: assistant
sr-label: Explanation of the BYOK cost advantage
---
That is the subscription trap: you pay whether you chat twice a week or twice a day, and the moment you stop, you lose everything.

Most AI tools charge a flat monthly fee, add a markup on top of the underlying API cost, and lock your history behind their platform. When the price goes up — and it usually does — you have no alternative.

Besidka flips this: you connect your own API key, you pay the provider's published rate only for the tokens you actually use, and your data stays yours.
::

::home-bubble
---
role: assistant
sr-label: BYOK solution summary and call to action
---
Your keys, your costs, your data.

Connect an OpenAI or Google AI Studio key and pay only for what you use — no monthly fee, no per-seat charge, no markup. Switch between GPT-4o and Gemini in one place. Add or remove keys any time from your profile. Because Besidka is open-source and self-hostable, you are never locked in.

  :::home-cta
  ---
  primary:
    label: Add your API key
    href: /signup
  secondary:
    label: How it works
    href: "#how-it-works"
  align: left
  ---
  :::
::

::home-bubble
---
wide: true
heading: How it works
id: how-it-works
role: assistant
---
:home-features{set="steps"}
::

::home-bubble{role="user" sr-label="User asking about available features"}
What can I actually do with it?
::

::home-bubble
---
wide: true
heading: Features
id: features
role: assistant
---
:home-features{set="features"}
::

::home-bubble{role="user" sr-label="User asking about testimonials"}
What do people say about it?
::

::home-bubble{wide role="assistant" sr-label="Community testimonials"}
:home-testimonials
::

::home-bubble{role="assistant" sr-label="Self-hosting information"}
Besidka is built on Cloudflare Workers and ships with everything you need to run your own instance. Clone the repo, configure your Cloudflare account, and deploy with one command. The license is MIT — use it, fork it, contribute back.

:home-stars
::

::home-bubble{role="user" sr-label="User asking FAQ questions"}
I have questions.
::

::home-bubble
---
wide: true
heading: FAQ
id: faq
role: assistant
---
:home-faq
::

::home-bubble{wide role="assistant" sr-label="Final call to action"}
Your chat history, your API keys, your costs — no middleman, no subscription, no lock-in. Join an early, growing community building AI workflows that belong to them.

  :::home-cta
  ---
  primary:
    label: Start chatting
    href: /signup
  secondary:
    label: View on GitHub
    href: https://github.com/besidka/besidka
  align: center
  ---
  :::
::
