---
title: How to get a DeepSeek API key
description: Create a DeepSeek API key and add it to Besidka. Prepaid balance that does not expire. Read the data note first.
provider: deepseek
keyUrl: https://platform.deepseek.com/api_keys
keyUrlLabel: Open DeepSeek keys page
updatedAt: '2026-10-20'
checkedAt: '2026-10-20'
summary: Top up a small balance, create a key, and chat with DeepSeek models. Check the data note below first.
requirements:
  card: true
  cardNote: Yes, to top up the prepaid balance.
  minimumTopUp: Not published. Start with $5 (max $10). The balance never expires.
  freeTier: None documented.
  sources:
    - label: DeepSeek error codes (insufficient balance)
      url: https://api-docs.deepseek.com/quick_start/error_codes/
    - label: DeepSeek pricing
      url: https://api-docs.deepseek.com/quick_start/pricing/
    - label: DeepSeek privacy policy
      url: https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
---

1. Open the [DeepSeek keys page](https://platform.deepseek.com/api_keys) and sign in.
2. Add balance first: click **Top up**. DeepSeek does not publish a minimum, so start with $5 (max $10). Topped-up balance does not expire, and requests fail when it runs out.
3. Back on the keys page, click **Create new API key**.
4. Type a name such as `Besidka` and click **Create API key**.
5. Click **Copy** to copy the key. DeepSeek shows it only once.
6. In Besidka, go to **Profile**, **API Keys**, then the **DeepSeek** card. Paste the key into **API Key** and click **Save**.
7. Start a new chat and pick a DeepSeek model.

**Privacy.** DeepSeek's privacy policy says your inputs and outputs may be used to train its models, and that data is stored in the People's Republic of China. To opt out, email privacy@deepseek.com. For private or work data, use another provider.
