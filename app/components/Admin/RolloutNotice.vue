<template>
  <div
    role="note"
    class="alert alert-warning alert-soft text-sm"
    data-testid="admin-rollout-notice"
  >
    <Icon
      name="lucide:info"
      size="16"
      class="shrink-0"
      aria-hidden="true"
    />
    <span>
      Gradual rollouts and variants are off until the Privacy notice is in
      force (<code>NUXT_FEATURES_ROLLOUT_ENABLED</code>). Grant features only
      to the owner and to testers who were told individually.
    </span>
  </div>
</template>
