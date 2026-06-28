---
title: Open-source AI chat with BYOK
benefits:
  - icon: lucide:piggy-bank
    title: Stop paying for days you don't chat
    body: No flat monthly fee means a quiet week costs you nothing. You pay the AI provider only when you actually send a message — not a penny more.
  - icon: lucide:lock-open
    title: Own your history forever
    body: Your conversations live in your Cloudflare D1 database. Cancel, self-host, or switch deployments — your data moves with you, no export required.
  - icon: lucide:shuffle
    title: Pick the best model for each job
    body: GPT-5 for creative work, Gemini Flash for quick drafts, a nano model for high-volume tasks — switch freely across providers in the same interface.
carousel:
  - src: /preview-light-desktop.svg
    alt: Besidka chat interface in light theme — a conversation using GPT-5 showing a markdown response with syntax-highlighted code.
    caption: Light theme — desktop
  - src: /preview-dark-desktop.svg
    alt: Besidka chat interface in dark theme — file attachments panel open with a PDF selected for the current chat.
    caption: Dark theme — desktop
  - src: /preview-light-mobile.svg
    alt: Besidka chat interface on a mobile device — model selector open, switching between GPT and Gemini flagship models.
    caption: Mobile — model switcher
comparison:
  caption: How Besidka compares to popular AI chat subscriptions
  columns:
    - Besidka
    - ChatGPT Plus
    - Google AI Pro
    - Claude Pro
    - T3 Chat
  rows:
    - label: Monthly fee
      values:
        - Free
        - from $20/mo
        - from $20/mo
        - from $20/mo
        - from $8/mo
    - label: Pay only for what you use
      values:
        - yes
        - no
        - no
        - no
        - Only for the most expensive models like Gpt 5.5 Pro ($30/$180)
    - label: Open source
      values:
        - yes
        - no
        - no
        - no
        - no
    - label: Self-hostable
      values:
        - yes
        - no
        - no
        - no
        - no
    - label: Multi-provider models
      values:
        - yes
        - no
        - no
        - no
        - yes
    - label: Message caps from the app
      values:
        - None
        - Usage limits apply
        - Usage limits apply
        - Usage limits apply
        - Usage limits apply
    - label: Bring your own keys
      values:
        - Required
        - no
        - no
        - no
        - Only for the most expensive models like Gpt 5.5 Pro ($30/$180)
  note: A typical casual user sends around 100 messages per month — roughly 50 k input tokens and 50 k output tokens. On a flagship model that works out to well under $1/mo. A heavy user sending 1,000 messages stays in the $5–7/mo range, paying the provider directly with no Besidka markup.
  priceDate: June 2026
description: Your digital besidka for all AI chats. Bring your own API keys, pay only for what you use, and keep full control. No subscriptions, no markup, no lock-in.
faqs:
  - question: What does BYOK mean?
    answer: BYOK stands for "Bring Your Own Key." Instead of paying Besidka a monthly subscription, you connect your own API key from OpenAI or Google AI Studio directly. You pay the provider at their published rates — Besidka adds no markup.
  - question: Which AI providers are supported?
    answer: Currently OpenAI (GPT-5 and the full GPT model family) and Google AI Studio (Gemini models including Gemini 2.5 Pro and Gemini 3 series). More providers are planned. Check the GitHub repository for the latest list.
  - question: Do you store my API keys?
    answer: Your keys are stored encrypted in Cloudflare D1, isolated per account behind Better Auth session guards. They are never logged or transmitted to third parties. You can delete them from your profile at any time.
  - question: Can I self-host this?
    answer: Yes. Besidka is MIT-licensed and designed to run on Cloudflare Workers. Clone the repository, configure your Cloudflare account per the README, and deploy with pnpm run deploy. You bring the Cloudflare account.
  - question: Is my chat history private?
    answer: Chat history is stored in your own Cloudflare D1 database, scoped to your account. If you self-host, no third party has access. On the hosted version at besidka.com, only you can read your conversations.
  - question: How is pricing calculated?
    answer: Besidka itself is free to use and open-source. You pay the AI provider (OpenAI or Google) directly at their per-token rates. There is no monthly fee, no seat charge, and no markup. You only pay when you actually send a message.
  - question: What does "Besidka" mean?
    answer: The name comes from the Ukrainian word “бесідка” for a garden gazebo — a place to sit, talk, and think. The word derives from the Proto-Slavic root besěda (meaning “speech,” “conversation,” or “council”).
  - question: How to pronounce Besidka?
    answer: |-
      Besidka is pronounced “beh-SEED-kah”.

      - “Be-” (Rhymes with “beh” as in “meh”). A short, soft sound. Do not pronounce it like the English word “be” (bee). It should be a short 'e' sound.
      - “-SID-” (Rhymes with “deed”). This is the stressed syllable. You should say this part a little louder and longer than the others.
      - “-ka” (Rhymes with “ah”). A crisp 'k' followed by a short 'a' (like the 'a' in “father”).
features:
  - icon: lucide:layers
    title: Multiple AI models
    body: Switch between the latest GPT and Gemini models in one place without creating separate accounts.
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
  headline: Open-source AI chat. Your keys, your costs.
  subheadline: Self-host or use besidka.com — pay per use, no subscriptions, no markup, no lock-in.
  primaryCta:
    label: Start chatting
    href: /signup
    icon: lucide:arrow-right
  secondaryCta:
    label: View on GitHub
    href: https://github.com/besidka/besidka
    icon: streamline-logos:github-logo-2-solid
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
useCases:
  - icon: lucide:code-2
    persona: Developer
    scenario: Reviews PRs and drafts release notes by dropping in diffs and asking questions, using Projects to keep a standing system prompt per repository.
    payoff: Context survives across sessions — no copy-pasting the same prompt every time.
  - icon: lucide:terminal
    persona: Self-hoster
    scenario: Runs a personal Besidka instance on their own Cloudflare account, pointed at their own API keys, with full access to the source code.
    payoff: Every byte of chat history stays in infrastructure they control — no third-party reads their conversations.
  - icon: lucide:briefcase
    persona: Occasional AI user
    scenario: Skips the flat monthly subscription and pays only for the tokens they actually use, switching between GPT and Gemini flagships depending on the task.
    payoff: A typical light-use month costs a few dollars instead of twenty.
video:
  src: /videos/demo.mp4
  caption: A quick tour of Besidka
  qualities:
    - src: /videos/demo-1080.mp4
      size: 1080
      label: 1080p
    - src: /videos/demo.mp4
      size: 720
      label: 720p
    - src: /videos/demo-360.mp4
      size: 360
      label: 360p
  captions:
    - src: /videos/demo.en.vtt
      label: English
      srclang: en
      default: true
  markers:
    - time: 0:02
      label: Welcome
    - time: 0:04
      label: Multiple models
    - time: 0:06
      label: File attachments
    - time: 0:08
      label: Projects
  thumbnails: true
---

<!-- TODO: Add a real demo screenshots -->
<!-- ::home-bubble{role="user" sr-label="User requesting a product demo"}
Show me what it looks like.
::

::home-bubble{wide role="assistant" sr-label="Product screenshot carousel"}
Here is a quick look at Besidka running in both light and dark themes.

:home-carousel
:: -->

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

Connect an OpenAI or Google AI Studio key and pay only for what you use — no monthly fee, no per-seat charge, no markup. Switch between the latest GPT and Gemini models in one place. Add or remove keys any time from your profile. Because Besidka is open-source and self-hostable, you are never locked in.

  :::home-cta
  ---
  primary:
    label: Start chatting
    href: /signup
    icon: lucide:arrow-right
  secondary:
    label: How it works
    href: "#how-it-works"
  align: left
  ---
  :::
::

::home-bubble{role="user" sr-label="User asking what makes Besidka different"}
Why should I pick this over a regular subscription?
::

::home-bubble
---
wide: true
heading: Why Besidka
id: benefits
role: assistant
sr-label: Key customer benefits of using Besidka
---
:home-features{columns="3" set="benefits"}
::

::home-bubble{role="user" sr-label="User asking for a starting guide"}
How do I get started?
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

<!-- TODO: record a real demo video -->
<!-- ::home-bubble{role="user" sr-label="User asking for a live demo of the app"}
Can I see it in action?
::

::home-bubble
---
wide: true
role: assistant
sr-label: Demo video showing Besidka in action
---
Here is a short walkthrough of the key features.

:home-video
:: -->

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

::home-bubble{role="user" sr-label="User asking who this is for"}
Who is this for?
::

::home-bubble
---
wide: true
role: assistant
sr-label: Use cases — who Besidka is built for
---
:home-testimonials
::

::home-bubble
---
role: user
sr-label: User asking about cost compared to ChatGPT Plus
---
What does it cost compared to ChatGPT Plus?
::

::home-bubble
---
wide: true
heading: What does it cost?
id: pricing
role: assistant
sr-label: Pricing comparison between Besidka and subscription alternatives
---
:home-comparison
::

::home-bubble{role="user" sr-label="User asking for a self-hosting option"}
Can I run this myself?
::

::home-bubble
---
role: assistant
sr-label: Self-hosting and community information
---
Besidka is built on Cloudflare Workers and ships with everything you need to run your own instance. Configure your Cloudflare account per the README, then deploy with pnpm run deploy. The license is MIT — use it, fork it, contribute back.

:home-stars
::

::home-bubble{role="user" sr-label="User asking about what Besidka means"}
What does “Besidka” mean?
::

::home-bubble
---
role: assistant
sr-label: Explanation of the name "Besidka"
---
The name comes from the Ukrainian word “бесідка” for a garden gazebo — a place to sit, talk, and think. Similar words exist across Slavic languages: “besídka” in Czech and “besiedka” in Slovak. All these words derive from the Proto-Slavic root besěda (meaning “speech,” “conversation,” or “council”).
::

::home-bubble{role="user" sr-label="User asking FAQ questions"}
I have more questions.
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
    icon: lucide:arrow-right
  secondary:
    label: View on GitHub
    href: https://github.com/besidka/besidka
    icon: streamline-logos:github-logo-2-solid
  align: center
  ---
  :::
::
