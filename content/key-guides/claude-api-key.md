---
title: How to get an Anthropic (Claude) API key
description: Create an Anthropic API key for Claude and add it to Besidka. Prepaid credits, no free API tier.
provider: anthropic
keyUrl: https://platform.claude.com/settings/keys
keyUrlLabel: Open Anthropic Console keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: Buy a small prepaid balance, create a key, and chat with Claude on your own bill.
video:
  src: /videos/key-guide-anthropic.mp4
  poster: /key-guides/anthropic.webp
  duration: PT38S
  uploadDate: '2026-10-20'
  alt: Screen recording of Claude Console. The API keys page, the Continue with an API key screen, the dialog for naming the new key, the new key shown once, then the key pasted into Besidka and a first answer from Claude.
  qualities:
    - src: /videos/key-guide-anthropic-1080.mp4
      size: 1080
    - src: /videos/key-guide-anthropic.mp4
      size: 720
    - src: /videos/key-guide-anthropic-360.mp4
      size: 360
  markers:
    - time: "0:00"
      label: Get a Claude key
    - time: "0:03"
      label: Create key
    - time: "0:07"
      label: Continue with an API key
    - time: "0:11"
      label: Name the key
    - time: "0:16"
      label: Copy your key
    - time: "0:21"
      label: Paste into Besidka
    - time: "0:28"
      label: First answer
    - time: "0:34"
      label: Done
requirements:
  card: true
  cardNote: Yes, to buy prepaid credits.
  minimumTopUp: No minimum is published. Start with $5.
  freeTier: No. The Claude API has no free tier.
  sources:
    - label: Anthropic API keys
      url: https://platform.claude.com/docs/en/get-api-key
    - label: Paying for the Claude API
      url: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
    - label: Claude plans and API credits
      url: https://support.claude.com/en/articles/8114531
    - label: Phone verification
      url: https://support.claude.com/en/articles/8287232-verify-your-phone-number
    - label: Anthropic privacy (commercial data)
      url: https://privacy.claude.com/en/articles/7996868
---

1. Open the [Anthropic Console keys page](https://platform.claude.com/settings/keys) and sign in. New users verify a phone number first.
2. Add credits before you create a key. In **Billing**, click **Buy credits**. Anthropic publishes no minimum, so start with $5.
3. Back on the keys page, click **Create key**. If Anthropic shows a screen about identity federation, click **Continue with an API key**.
4. Type a **Name** such as `Besidka` and pick **Expires**. The default is 30 days, so choose a later date if you do not want to create a new key next month. Leave **Linked account** and **Scope** as they are, then click **Create key**.
5. In **Save your API key**, click **Copy key**, then **Done**. Anthropic shows the key only once, and it starts with `sk-ant-`.
6. In Besidka, go to **Profile**, **API Keys**, then the **Anthropic** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick a Claude model.

**Good to know.** Credits expire after one year. By default, Anthropic does not use your API inputs and outputs to train its models.
