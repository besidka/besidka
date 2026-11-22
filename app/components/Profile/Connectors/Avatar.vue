<template>
  <div
    class="avatar shrink-0"
    :class="{ 'avatar-placeholder': !isImageVisible && !brandIcon }"
    aria-hidden="true"
    data-testid="connector-avatar"
  >
    <div
      class="relative rounded-full"
      :class="[
        size === 'lg' ? 'w-10' : 'w-8',
        isImageVisible || brandIcon
          ? 'bg-white p-1 ring-1 ring-base-content/10'
          : 'bg-base-300 text-base-content',
      ]"
    >
      <img
        v-if="isImageRequested"
        :src="iconUrl"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="object-contain"
        :class="{ 'absolute inset-0 opacity-0': !hasImageLoaded }"
        data-testid="connector-avatar-image"
        @load="hasImageLoaded = true"
        @error="hasImageFailed = true"
      >
      <template v-if="!isImageVisible">
        <span
          v-if="brandIcon"
          class="grid size-full place-items-center text-neutral-900"
          data-testid="connector-avatar-brand"
        >
          <Icon
            :name="brandIcon"
            :size="size === 'lg' ? 22 : 18"
          />
        </span>
        <span
          v-else
          :class="size === 'lg' ? 'text-base' : 'text-sm'"
        >
          {{ initial }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  connectorId?: string | null
  registryId?: string | null
  presetId?: string | null
  isIconAvailable?: boolean
  size?: 'md' | 'lg'
}>(), {
  connectorId: null,
  registryId: null,
  presetId: null,
  isIconAvailable: false,
  size: 'md',
})

const hasImageFailed = shallowRef<boolean>(false)
const hasImageLoaded = shallowRef<boolean>(false)

const initial = computed<string>(() => {
  return getConnectorInitial(props.title)
})

const cachedConnector = useConnectorById(() => props.connectorId ?? '')

const brandIcon = computed<string | null>(() => {
  return getConnectorBrandIcon(
    props.presetId,
    cachedConnector.value?.host,
  )
})

const iconUrl = computed<string>(() => {
  if (props.registryId) {
    return '/api/v1/connectors/registry/icon?id='
      + encodeURIComponent(props.registryId)
  }

  return props.connectorId && props.isIconAvailable
    ? `/api/v1/connectors/${encodeURIComponent(props.connectorId)}/icon`
    : ''
})

const isImageRequested = computed<boolean>(() => {
  return !!iconUrl.value && !hasImageFailed.value
})

const isImageVisible = computed<boolean>(() => {
  return isImageRequested.value && hasImageLoaded.value
})

watch(iconUrl, () => {
  hasImageFailed.value = false
  hasImageLoaded.value = false
})
</script>
