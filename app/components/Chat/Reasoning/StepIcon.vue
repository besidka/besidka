<template>
  <span
    v-if="icon"
    aria-hidden="true"
    :data-kind="icon.kind"
    data-testid="reasoning-step-icon"
    class="inline-flex size-3.5 shrink-0 items-center justify-center align-text-bottom text-base-content/70"
  >
    <ProviderIcon
      v-if="icon.kind === 'provider'"
      :provider-id="icon.providerId"
      class="size-full"
    />
    <SvgoFavicon
      v-else-if="icon.kind === 'besidka'"
      class="size-full"
    />
    <template v-else-if="icon.kind === 'connector'">
      <img
        v-if="!hasImageFailed"
        :src="connectorIconUrl"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        data-testid="reasoning-step-icon-image"
        class="size-full rounded-[0.2rem] bg-white object-contain ring-1 ring-base-content/10"
        @error="onImageError"
      >
      <span
        v-else
        data-testid="reasoning-step-icon-letter"
        class="flex size-full items-center justify-center rounded-[0.2rem] bg-base-content/10 text-[0.55rem] font-semibold leading-none text-base-content/70"
      >
        {{ icon.letter }}
      </span>
    </template>
    <Icon
      v-else
      :name="icon.name"
      class="size-full"
    />
  </span>
</template>

<script setup lang="ts">
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'

const props = defineProps<{
  icon: ReasoningStepIcon | null
}>()

const hasImageFailed = shallowRef<boolean>(false)

const connectorIconUrl = computed<string>(() => {
  return props.icon?.kind === 'connector'
    ? `/api/v1/connectors/${encodeURIComponent(props.icon.connectorId)}/icon`
    : ''
})

watch(connectorIconUrl, () => {
  hasImageFailed.value = false
})

function onImageError() {
  hasImageFailed.value = true
}
</script>
