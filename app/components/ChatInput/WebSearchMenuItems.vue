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
      <NuxtLink
        v-if="option.addKeyHref"
        :to="option.addKeyHref"
        class="flex items-center gap-2"
      >
        <ProviderIcon
          :provider-id="option.providerId ?? ''"
          class="!size-4"
        />
        <span class="grow text-left">{{ option.label }}</span>
        <Icon
          name="lucide:arrow-right"
          size="14"
          class="shrink-0 opacity-50"
        />
      </NuxtLink>
      <button
        v-else
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
