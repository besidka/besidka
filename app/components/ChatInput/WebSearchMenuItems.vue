<template>
  <li class="menu-title text-xs">
    Web search
  </li>
  <li>
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          selected === 'off',
      }"
      @click="emit('select-provider', 'off')"
    >
      <Icon name="lucide:circle-slash-2" class="!size-4 text-current" />
      <span>Off</span>
    </button>
  </li>
  <li v-if="nativeOption">
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          selected === nativeOption.value,
        'opacity-50': !nativeOption.enabled,
      }"
      :disabled="!nativeOption.enabled"
      :title="nativeOption.disabledReason"
      @click="onSelect(nativeOption)"
    >
      <Icon name="lucide:globe" class="!size-4 text-current" />
      <span class="grow text-left">{{ nativeOption.label }}</span>
    </button>
  </li>
  <li v-if="!isToolCallingSupported">
    <span
      class="flex items-center gap-2 px-2 py-1.5 text-2xs opacity-60"
    >
      <Icon name="lucide:circle-off" size="16" class="shrink-0" />
      This model does not support tool calling, so Brave Search and Exa
      are unavailable.
    </span>
  </li>
  <template v-else>
    <li v-for="option in externalOptions" :key="option.value">
      <button
        type="button"
        class="flex items-center gap-2"
        :class="{
          'bg-accent text-accent-content pointer-events-none':
            selected === option.value,
          'opacity-50': !option.enabled,
        }"
        :disabled="!option.enabled"
        :title="option.disabledReason"
        @click="onSelect(option)"
      >
        <ProviderIcon
          :provider-id="option.providerId ?? ''"
          class="!size-4"
        />
        <span class="grow text-left">{{ option.label }}</span>
      </button>
      <NuxtLink
        v-if="!option.enabled"
        to="/profile/keys"
        class="block px-2 pb-1 text-2xs text-warning link"
      >
        Add a key
      </NuxtLink>
    </li>
  </template>
</template>

<script setup lang="ts">
import type {
  WebSearchOption,
  WebSearchSelection,
} from '~/types/web-search'

const props = defineProps<{
  selected: WebSearchSelection
  options: WebSearchOption[]
  isToolCallingSupported: boolean
}>()

const emit = defineEmits<{
  'select-provider': [value: WebSearchSelection]
}>()

const nativeOption = computed<WebSearchOption | undefined>(() => {
  return props.options.find((option) => {
    return option.value === 'web_search'
  })
})

const externalOptions = computed<WebSearchOption[]>(() => {
  return props.options.filter((option) => {
    return option.value !== 'web_search'
  })
})

function onSelect(option: WebSearchOption) {
  if (!option.enabled) {
    return
  }

  emit('select-provider', option.value)
}
</script>
