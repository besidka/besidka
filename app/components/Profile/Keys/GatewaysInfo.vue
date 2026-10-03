<template>
  <div
    role="alert"
    class="alert alert-soft alert-info !items-start mb-6"
    data-testid="gateways-info"
  >
    <Icon
      name="lucide:info"
      size="20"
      class="mt-0.5 shrink-0"
    />
    <div class="grid gap-2 text-sm">
      <p>
        One gateway key unlocks many vendors' models under a single
        bill, including models this app doesn't offer as a direct
        provider.
      </p>
      <ul class="list-disc pl-4">
        <li>
          Many models behind one key, with one invoice instead of a
          separate bill per provider.
        </li>
        <li>
          An extra hop — the gateway sees your prompts too (see our
          <NuxtLink
            to="/privacy-policy"
            class="link link-hover"
          >
            Privacy Policy
          </NuxtLink>) — and may add its own fees or credit markup on
          top of the model's price.
        </li>
        <li>
          Some features differ from direct providers: deep research is
          direct-provider only, and models without native search still
          need a Brave or Exa key. Cloudflare's gateway lists Workers AI
          models only.
        </li>
        <li>
          Direct providers are used by default — a gateway is only used
          when you pick a gateway model.
        </li>
      </ul>
    </div>
  </div>
</template>
