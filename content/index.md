---
title: BYOK AI chat app for GPT, Claude and Gemini
benefits:
  - icon: lucide:piggy-bank
    title: Stop paying for days you don't chat
    body: No flat monthly fee means a quiet week costs you nothing. You pay the AI provider only for the messages you send, at its published rates.
  - icon: lucide:lock-open
    title: Your history is not tied to a plan
    body: Your chats are stored in Besidka's database, scoped to your account, and do not depend on a subscription. Self-host to keep them in your own Cloudflare account.
  - icon: lucide:shuffle
    title: Pick the best model for each job
    body: Claude Opus for hard reasoning, GPT-5.6 for creative work, Gemini Flash for quick drafts, DeepSeek or Qwen for high-volume tasks. Switch between providers in the same interface.
carousel:
  - src: /carousel/any-model.webp
    alt: Besidka on desktop and on a phone, labelled desktop and mobile, installable PWA and push notifications, with a push notification saying the response is ready.
    caption: Desktop and mobile, installable PWA, push notifications
  - src: /carousel/dark-theme.webp
    alt: Besidka in dark theme on a desktop chat comparing D1 and Postgres and on a phone showing a Vue composable answer.
    caption: Light or dark theme, desktop and phone
  - src: /carousel/providers.webp
    alt: API keys settings listing seven direct providers, Anthropic, Google AI Studio, OpenAI, xAI, DeepSeek, Moonshot AI and Qwen, each with its logo and a saved key.
    caption: Your own keys for seven providers
  - src: /carousel/gateways.webp
    alt: Model picker switched to OpenRouter, listing Anthropic models available through the gateway, next to Cloudflare AI Gateway and Vercel AI Gateway.
    caption: "Optional gateways: OpenRouter, Vercel, Cloudflare"
  - src: /carousel/cost-per-answer.webp
    alt: Message menu showing the model, provider, output tokens and the cost of the message, up to that message and for the whole chat.
    caption: Model, tokens and cost on every answer
  - src: /carousel/web-search-prices.webp
    alt: Search provider settings with prices per 1,000 searches for Brave, Exa and the built-in search of Gemini, Anthropic, OpenAI and DeepSeek.
    caption: Web search providers and their prices
  - src: /carousel/projects.webp
    alt: A project page with project instructions marked Active and project memory synthesized from the project's chats.
    caption: Projects with shared instructions and memory
  - src: /carousel/code-and-diagrams.webp
    alt: A light-theme chat answer with a syntax-highlighted TypeScript snippet and a rendered sequence diagram of a Worker reading from KV and falling back to D1.
    caption: Highlighted code and rendered diagrams
  - src: /carousel/reasoning.webp
    alt: An answer with its reasoning steps expanded and the reasoning effort set to High in the chat input.
    caption: Reasoning steps and effort
  - src: /carousel/image-generation.webp
    alt: A chat where Nano Banana 2 generated a flat illustration of a sunset over pink mountains.
    caption: Image generation in the chat
  - src: /carousel/deep-research.webp
    alt: A deep research report from Gemini Deep Research with its trace of searches and pages read.
    caption: Deep research with the full trace
  - src: /carousel/file-manager.webp
    alt: File manager listing uploaded and AI-generated files with type, size, expiry and storage used.
    caption: File manager
  - src: /carousel/shared-chats.webp
    alt: A shared Besidka chat open at besidka.com/shared, readable without an account, with a button to add it to your own chats.
    caption: Share a chat, no account needed to read it
comparison:
  caption: How Besidka compares to popular AI chat subscriptions
  columns:
    - Besidka
    - ChatGPT Go
    - ChatGPT Plus
    - Google AI Plus
    - Google AI Pro
    - Claude Pro
  rows:
    - label: Monthly fee
      values:
        - Free
        - $8/mo
        - $20/mo
        - $4.99/mo
        - $19.99/mo
        - $17–20/mo
    - label: Pay only for what you use
      values:
        - yes
        - no
        - no
        - no
        - no
        - no
    - label: Open source
      values:
        - yes
        - no
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
        - no
    - label: Multi-provider models
      values:
        - yes
        - no
        - no
        - no
        - no
        - no
    - label: Image generation
      values:
        - yes
        - yes
        - yes
        - yes
        - yes
        - no
    - label: Shareable chat links
      values:
        - yes
        - Link + branch, no access controls
        - Link + branch, no access controls
        - Link + branch, no access controls
        - Link + branch, no access controls
        - Link or email invite, view-only
    - label: Bring your own keys
      values:
        - Required
        - no
        - no
        - no
        - no
        - no
    - label: Bring your own search key (Brave / Exa)
      values:
        - yes
        - no
        - no
        - no
        - no
        - no
    - label: Route through your own AI gateway (BYOK)
      values:
        - yes
        - no
        - no
        - no
        - no
        - no
    - label: Deep research
      values:
        - yes
        - Not listed by OpenAI
        - yes
        - yes
        - yes
        - yes
    - label: Per-message cost breakdown
      values:
        - yes
        - no
        - no
        - no
        - no
        - no
  note: Besidka is free; you pay the AI provider for what you use. A casual user sending around 100 messages a month uses roughly 50 k input and 50 k output tokens. At Claude Sonnet 5.5's API rates ($2 input / $10 output per million tokens) that is about $0.60; on Claude Opus 5.5 ($4 / $20) about $1.20. Sending 1,000 messages a month lands near $6 on Sonnet 5.5 or $12 on Opus 5.5. Long chats resend earlier messages as input, so real input counts run higher, and prompt caching bills those repeated tokens at a discount. Web search, image generation and deep research are billed separately at the provider's published rates. There is no Besidka markup. Subscription prices are US list prices. The subscription apps bundle features and limits Besidka does not copy, and the free tiers of ChatGPT and Gemini cover plain text chat at no cost.
  priceDate: "2026-10-20"
  sources:
    - label: ChatGPT Go
      url: https://help.openai.com/en/articles/11989085-what-is-chatgpt-go
    - label: ChatGPT Plus
      url: https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus
    - label: ChatGPT Free
      url: https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq
    - label: ChatGPT uploads
      url: https://help.openai.com/en/articles/8555545-file-uploads-faq
    - label: ChatGPT sharing
      url: https://help.openai.com/en/articles/7925741-sharing-conversations-and-scheduled-tasks-in-chatgpt
    - label: Google AI plans
      url: https://gemini.google/us/subscriptions/
    - label: Gemini models by plan
      url: https://support.google.com/gemini/answer/18648722
    - label: Gemini shared links
      url: https://support.google.com/gemini/answer/13743730
    - label: Claude pricing
      url: https://claude.com/pricing
    - label: Claude images
      url: https://support.claude.com/en/articles/9002504-can-claude-produce-images
    - label: Claude public links
      url: https://support.claude.com/en/articles/16762437-public-links-for-shared-chats
    - label: Claude private sharing
      url: https://support.claude.com/en/articles/16762496-share-a-chat-with-specific-people
    - label: Claude Research
      url: https://support.claude.com/en/articles/11088861-use-research-on-claude
description: Open-source BYOK AI chat app. Use GPT, Claude and Gemini with your own API key, see the price of every message, no subscription. Start free with Gemini.
faqs:
  - question: What does BYOK mean?
    answer: BYOK stands for "Bring Your Own Key." Instead of paying Besidka a monthly subscription, you connect your own API key from an AI provider (Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen) or from an AI gateway such as Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter. You pay the provider or gateway at its published rates. Besidka adds no markup.
  - question: Can I use ChatGPT with my own API key?
    answer: The ChatGPT app itself does not accept an API key, and a ChatGPT subscription and OpenAI API billing are separate products. With an OpenAI API key you can use the same GPT models in a BYOK app such as Besidka and pay OpenAI per use. OpenAI sells API credit in advance, with a minimum purchase of $5 as of 20 October 2026. The ChatGPT app has features that an API key does not give you, such as its own apps and voice mode. The BYOK guide has the steps.
  - question: Can I start for free?
    answer: Yes, with a Gemini API key from Google AI Studio. Creating one needs a Google account but no card or billing account, and Besidka itself is free. [How to get a free Gemini API key](/guides/gemini-api-key) has the steps and a short video. The free tier has rate limits, and Google may use your prompts and responses on the free tier to improve its products, so do not send anything sensitive. Moving to the paid tier (a billing account; new accounts start on prepaid credit) stops Google using your prompts to improve its products. Other providers need prepaid credit or a card before their API accepts requests.
  - question: Which AI providers are supported?
    answer: "Besidka connects directly to seven AI providers: Anthropic (Claude Opus 5, Claude Sonnet 5 and Claude Haiku 4.5), OpenAI (GPT-5.6, GPT-5.5 and the wider GPT family), Google AI Studio (Gemini 3.8 Flash, Gemini 3.1 Pro Preview and other Gemini models), xAI (Grok 4.6 and other Grok models), DeepSeek (DeepSeek V4 Pro and DeepSeek V4.1 Flash), Moonshot AI (Kimi K3 and Kimi K2.6) and Qwen (Qwen3.8 Max, Qwen3.8 Flash and other Qwen models). Instead of per-provider keys, you can also route chats through your own AI gateway account (Vercel AI Gateway, Cloudflare AI Gateway or OpenRouter), using the models that gateway makes available to your account. For web search, you can add your own Brave Search or Exa key and use it with any model that supports tool calling, whichever provider or gateway runs it. Check the GitHub repository for the full, current model list."
  - question: Can Besidka generate images and documents?
    answer: Yes for images. Select Create image with a supported OpenAI, Google or xAI chat model, and Besidka generates one image per request. The image is stored privately in your file library, counts toward your storage quota, and remains available to download. Besidka does not generate PDF, PPTX, or XLSX files yet.
  - question: Do you store my API keys?
    answer: Your keys are stored encrypted in Cloudflare D1, isolated per account behind Better Auth session guards. They are never logged or transmitted to third parties. You can delete them from your profile at any time.
  - question: Can I self-host this?
    answer: Yes. Besidka is MIT-licensed and designed to run on Cloudflare Workers. Clone the repository, configure your Cloudflare account per the README, and deploy with pnpm run deploy. You bring the Cloudflare account.
  - question: Is my chat history private?
    answer: On the hosted version at besidka.com, your chats are stored in Besidka's database and scoped to your account, so only you can read them through the app. If you self-host, they are stored in your own Cloudflare account and no third party has access. Messages are sent to the AI provider whose key you use, and that provider's own data terms apply to them.
  - question: Can I share a chat?
    answer: Yes. Any chat can be shared via a public, unguessable link. Recipients view a read-only copy without needing an account, and can branch it into their own chats. You control per-share options like link expiry, search-engine indexing, and whether images, file names, message details, or your avatar are visible, and you can revoke a share at any time. Shared files are served through short-lived, revocable tokens rather than a public bucket.
  - question: Does Besidka support deep research like ChatGPT?
    answer: Yes. Besidka supports deep research the same way ChatGPT and Gemini do, running on Google's dedicated Gemini Deep Research agent models. Instead of a single quick reply, the agent autonomously browses the web, cross-checks multiple sources, and writes a fully cited report on the topic you give it. It runs on your own Google API key, so a typical report costs roughly $1 to $7 depending on the model and depth you pick, with no Besidka markup. Anthropic does not currently offer a dedicated deep-research agent model and OpenAI has retired its own, so this is not available on a Claude or OpenAI key. You get a push notification the moment the report is ready, so you do not need to keep the tab open while it works.
  - question: How is pricing calculated?
    answer: Besidka itself is free to use and open-source. You pay your AI provider (such as Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI or Qwen) directly at its published API rates, including token usage and any image-generation charges. If you route chats through an AI gateway, you pay that gateway at its own rates instead. If you add a Brave Search or Exa key for web search, that search provider bills you separately at its own rates. There is no monthly fee, no seat charge, and no Besidka markup on any of these. You pay only when you use a provider-backed feature.
  - question: How to pronounce Besidka?
    answer: |-
      Besidka is pronounced “beh-SEED-kah”.

      - “Be-” (Rhymes with “beh” as in “meh”). A short, soft sound. Do not pronounce it like the English word “be” (bee). It should be a short 'e' sound.
      - “-SID-” (Rhymes with “deed”). This is the stressed syllable. You should say this part a little louder and longer than the others.
      - “-ka” (Rhymes with “ah”). A crisp 'k' followed by a short 'a' (like the 'a' in “father”).
features:
  - icon: lucide:layers
    title: Multiple AI models
    body: Switch between the latest models from Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot AI and Qwen in one place, on your own keys or through your own AI gateway.
  - icon: lucide:globe
    title: Web search
    body: "Ground AI answers with real-time web context and inline sources. Pick your search provider: the model's built-in search, or your own Brave or Exa key."
  - icon: lucide:brain
    title: Reasoning mode
    body: Enable step-by-step thinking for complex questions. The model works through its reasoning before giving a final answer.
  - icon: lucide:image-plus
    title: AI image generation
    body: Generate one image at a time with supported OpenAI, Google and xAI models. Besidka saves each result privately in your file library so you can preview and download it.
  - icon: lucide:paperclip
    title: File attachments
    body: Send images and PDFs. Files are stored in your own R2 bucket and can be reused across different chats.
  - icon: lucide:git-branch
    title: Chat branching
    body: Fork any conversation mid-thread to explore a different direction without losing the original.
  - icon: lucide:share-2
    title: Shareable chats
    body: Share a chat with a public, unguessable link. Anyone can view it without an account and branch it into their own chats. You control expiry, indexing, and what's visible.
  - icon: lucide:folder-kanban
    title: Projects
    body: Group related chats under a project with shared instructions and memory so every conversation has context.
  - icon: lucide:telescope
    title: Deep research
    body: Kick off an autonomous agent that browses the web, cross-checks sources, and writes a cited report while you do something else. Runs on your own key for roughly $1 to $10 per task, with a push notification when it's done.
hero:
  eyebrow: OPEN SOURCE · SELF-HOSTABLE · NO SUBSCRIPTION
  headline: "Besidka: BYOK AI chat. Pay only for the AI you use"
  subheadline: Use GPT, Gemini, Claude, DeepSeek and more in one chat with your own API keys. No subscription, no markup, and you see the price of every message.
  primaryCta:
    label: Start free with a Gemini key
    href: /signup?next=%2Fprofile%2Fkeys%3Fprovider%3Dgoogle
    icon: lucide:arrow-right
  secondaryCta:
    label: Self-host on GitHub
    href: https://github.com/besidka/besidka
    icon: streamline-logos:github-logo-2-solid
  guideLink:
    label: How to get the key
    href: /guides/gemini-api-key
steps:
  - icon: lucide:user-plus
    title: 1. Sign up
    body: Create a free account with email and password, or sign in with Google or GitHub. No credit card required.
  - icon: lucide:key
    title: 2. Add your API key
    body: Paste an API key from Anthropic, OpenAI, Google AI Studio, xAI, DeepSeek, Moonshot AI or Qwen into your profile, or connect your own AI gateway instead. The easiest start is a free Gemini key from Google AI Studio, which needs no card. Keys are encrypted at rest and never shared.
  - icon: lucide:message-square
    title: 3. Start chatting
    body: Open a new chat, pick your model, and go. You pay your provider or gateway directly. Besidka adds nothing on top.
video:
  src: /videos/demo.mp4
  poster: /promo/poster.webp
  caption: A 54-second tour of Besidka
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
    - time: "0:00"
      label: Any model
    - time: "0:10"
      label: Desktop and phone
    - time: "0:18"
      label: Search and cost
    - time: "0:28"
      label: Images and files
    - time: "0:35"
      label: Projects
    - time: "0:39"
      label: Code and diagrams
    - time: "0:42"
      label: Reasoning
    - time: "0:50"
      label: Get started
  thumbnails: true
---

::home-bubble{role="user" sr-label="User requesting a product demo"}
Show me what it looks like.
::

::home-bubble{wide role="assistant" sr-label="Product screenshot carousel"}
Here is a quick look at what Besidka can do.

:home-carousel
::

::home-bubble{role="user" heading id="community"}
How many people are using this?
::

::home-bubble{wide role="assistant" sr-label="Community size"}
We are an early, growing community. Here is where things stand today.

:home-stats
::

::home-bubble{role="user" heading id="subscriptions"}
I pay for ChatGPT Plus and rarely use it. Is there an alternative without a subscription?
::

::home-bubble
---
role: assistant
sr-label: Explanation of the BYOK cost advantage
---
Yes, if you are fine creating an API key.

A flat fee costs the same whether you send ten messages or ten thousand. That is a fair deal if you use the app heavily and a poor one if you do not.

With your own API key you pay the provider for each message instead, at its published rates, and Besidka shows the price of every one. There is no subscription and no Besidka markup. The quickest way to try it is a free Gemini key, which needs no card: see [how to get a free Gemini API key](/guides/gemini-api-key).

Free tiers are fine for plain text chat. They limit other things: ChatGPT Free allows [3 file uploads a day](https://help.openai.com/en/articles/8555545-file-uploads-faq) and [limited image generation](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq), and the free Gemini app gives access to fewer and smaller models than the paid plans ([Gemini models by plan](https://support.google.com/gemini/answer/18648722)). Whether paying per use is cheaper for you depends on how much you use AI, so check the comparison below.
::

::home-bubble
---
role: assistant
sr-label: BYOK solution summary and call to action
---
Your keys, your costs, your data.

Connect your own key from any of seven AI providers, or route through your own AI gateway, and pay only for what you use. There is no monthly fee, no per-seat charge and no Besidka markup. Switch between the latest Claude, GPT, Gemini, Grok, DeepSeek, Kimi and Qwen models in one place. Add or remove keys any time from your profile. Because Besidka is open-source and self-hostable, you are never locked in.

New to BYOK? The [BYOK guide](/byok) walks through getting a key, adding it, how cost works and where keys are stored.

  :::home-cta
  ---
  primary:
    label: Start free with a Gemini key
    href: /signup?next=%2Fprofile%2Fkeys%3Fprovider%3Dgoogle
    icon: lucide:arrow-right
  secondary:
    label: How it works
    href: "#how-it-works"
  align: left
  ---
  :::
::

::home-bubble
---
role: user
heading: true
id: benefits
---
Why should I pick this over a regular subscription?
::

::home-bubble
---
wide: true
role: assistant
sr-label: Key customer benefits of using Besidka
---
:home-features{columns="3" set="benefits"}
::

::home-bubble
---
role: user
heading: true
id: how-it-works
---
How do I get started?
::

::home-bubble
---
wide: true
role: assistant
---
:home-features{set="steps"}
::

::home-bubble{role="user" sr-label="User asking for a live demo of the app"}
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
::

::home-bubble
---
role: user
heading: true
id: features
---
What can I actually do with it?
::

::home-bubble
---
wide: true
role: assistant
---
:home-features{set="features"}
::

::home-bubble{role="user" heading id="use-cases"}
Who is it for?
::

::home-bubble
---
role: assistant
sr-label: Who Besidka is and is not a good fit for
---
A good fit if you:

- use AI every day for search, translation, PDFs, images or code
- do not want another subscription
- are fine creating an API key in a provider's developer console
- want several models in one place and want to see what each message costs

Probably not for you if you:

- already pay for ChatGPT Plus or Pro, Claude Pro or Google AI Pro and rarely hit their limits. Those apps do more than a chat window, such as voice, agents and desktop apps
- do not want to deal with API keys, or with adding a card or prepaying credit at a provider

For scale: the maintainer's own non-work use costs between $1 and $5 a month. That is one person's usage, not a promise, and your bill depends on the models and how much you chat.
::

::home-bubble
---
role: user
heading: true
id: pricing
---
What does it cost compared to ChatGPT, Gemini and Claude subscriptions?
::

::home-bubble
---
wide: true
role: assistant
sr-label: Pricing comparison between Besidka and subscription alternatives
---
:home-comparison
::

::home-bubble{role="user" heading id="self-hosting"}
Can I self-host Besidka?
::

::home-bubble
---
role: assistant
sr-label: Self-hosting and community information
---
Besidka is built on Cloudflare Workers and ships with everything you need to run your own instance. Configure your Cloudflare account per the README, then deploy with pnpm run deploy. The license is MIT: use it, fork it, contribute back.

:home-stars
::

::home-bubble
---
role: user
heading: true
id: about-the-name
---
What does “Besidka” mean?
::

::home-bubble
---
wide: true
role: assistant
sr-label: Explanation of the name "Besidka"
---
Besidka, Ukrainian “бесідка”, is an open-source AI chat application. The name is the Ukrainian word for a garden gazebo, a place to sit, talk, and think. Similar words exist across other Slavic languages, such as “besídka” in Czech and “besiedka” in Slovak, and all of them derive from the Proto-Slavic root besěda (meaning “speech,” “conversation,” or “council”).
::

::home-bubble
---
role: user
heading: true
id: faq
---
I have more questions.
::

::home-bubble
---
wide: true
role: assistant
---
:home-faq
::

::home-bubble{wide role="assistant" sr-label="Final call to action"}
Add your own API key, see what each message costs, and stop paying for months you did not use. Besidka is open source, MIT licensed and self-hostable.

  :::home-cta
  ---
  primary:
    label: Start free with a Gemini key
    href: /signup?next=%2Fprofile%2Fkeys%3Fprovider%3Dgoogle
    icon: lucide:arrow-right
  secondary:
    label: Self-host on GitHub
    href: https://github.com/besidka/besidka
    icon: streamline-logos:github-logo-2-solid
  align: center
  ---
  :::
::
