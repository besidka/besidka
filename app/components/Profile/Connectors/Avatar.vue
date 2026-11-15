<template>
  <div
    class="avatar shrink-0"
    :class="{ 'avatar-placeholder': !isImageShown }"
    aria-hidden="true"
    data-testid="connector-avatar"
  >
    <div
      class="rounded-full"
      :class="[
        size === 'lg' ? 'w-10' : 'w-8',
        isImageShown
          ? 'bg-white p-1 ring-1 ring-base-content/10'
          : 'bg-base-300 text-base-content',
      ]"
    >
      <img
        v-if="isImageShown"
        :src="iconUrl"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="object-contain"
        data-testid="connector-avatar-image"
        @error="hasImageFailed = true"
      >
      <span
        v-else
        :class="size === 'lg' ? 'text-base' : 'text-sm'"
      >
        {{ initial }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  connectorId?: string | null
  isIconAvailable?: boolean
  size?: 'md' | 'lg'
}>(), {
  connectorId: null,
  isIconAvailable: false,
  size: 'md',
})

const hasImageFailed = shallowRef<boolean>(false)

const initial = computed<string>(() => {
  return getConnectorInitial(props.title)
})

const iconUrl = computed<string>(() => {
  return props.connectorId
    ? `/api/v1/connectors/${encodeURIComponent(props.connectorId)}/icon`
    : ''
})

const isImageShown = computed<boolean>(() => {
  return props.isIconAvailable && !!iconUrl.value && !hasImageFailed.value
})

watch(iconUrl, () => {
  hasImageFailed.value = false
})
</script>
