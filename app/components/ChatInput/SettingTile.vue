<template>
  <div
    class="carousel-item relative"
    :data-testid="`chat-input-tile-${tile.id}`"
    :data-tile-id="tile.id"
  >
    <button
      type="button"
      class="js-chat-input-tile flex rounded-box border text-left cursor-pointer transition-[height] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      :class="[
        bodyVariantClass,
        getChatInputTileToneClass(tile),
        { 'opacity-60': tile.isDisabled },
      ]"
      :aria-label="tile.ariaLabel"
      :title="tile.ariaLabel"
      :aria-disabled="tile.isDisabled || undefined"
      :data-testid="`chat-input-tile-${tile.id}-body`"
      :data-variant="variant"
      @click="onOpen"
    >
      <span class="relative block size-4">
        <ProviderIcon
          v-if="tile.icon.kind === 'provider'"
          :provider-id="tile.icon.providerId"
          class="!size-4"
        />
        <component
          :is="reasoningIconComponent"
          v-else-if="tile.icon.kind === 'reasoning'"
          class="size-4 text-current"
        />
        <Icon
          v-else
          :name="tile.icon.name"
          size="16"
        />
        <span
          v-if="tile.isAuto"
          class="absolute -right-1.5 -bottom-1 grid place-items-center size-2.5 rounded-full bg-accent text-accent-content"
          data-testid="chat-input-tile-auto-badge"
        >
          <Icon
            name="lucide:sparkles"
            size="7"
          />
        </span>
        <span
          v-else-if="tile.isLocked"
          class="absolute -right-1.5 -bottom-1 grid place-items-center size-2.5 rounded-full bg-base-content/70 text-base-100"
          data-testid="chat-input-tile-lock-badge"
        >
          <Icon
            name="lucide:lock"
            size="7"
          />
        </span>
      </span>
      <span class="flex flex-col min-w-0" :class="textVariantClass">
        <span
          class="font-semibold opacity-85 truncate"
          :class="isPill ? 'text-[10px] leading-3' : 'text-[9px] leading-[10px]'"
        >
          {{ tile.caption }}
        </span>
        <span
          class="font-bold"
          :class="valueVariantClass"
        >
          {{ tile.value }}
        </span>
      </span>
    </button>
    <button
      v-if="tile.removeLabel"
      type="button"
      class="absolute btn btn-circle btn-xs btn-error btn-soft size-4"
      :class="isPill ? 'right-2 top-3' : 'right-1 top-1'"
      :aria-label="tile.removeLabel"
      :title="tile.removeLabel"
      :data-testid="`chat-input-tile-${tile.id}-remove`"
      @click="emit('remove', tile.id)"
    >
      <Icon
        name="lucide:x"
        size="10"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import type {
  ChatInputTile,
  ChatInputTileId,
  ToolsSection,
} from '~/types/chat-input-tools'

const props = withDefaults(defineProps<{
  tile: ChatInputTile
  variant?: 'pill' | 'square'
}>(), {
  variant: 'square',
})

const emit = defineEmits<{
  open: [section: ToolsSection | null, origin: HTMLElement]
  remove: [id: ChatInputTileId]
}>()

const isPill = computed<boolean>(() => {
  return props.variant === 'pill'
})

const bodyVariantClass = computed<string>(() => {
  if (!isPill.value) {
    return 'flex-col justify-between items-start size-16 p-1 pb-1.5'
  }

  return props.tile.removeLabel
    ? 'flex-row items-center gap-2.5 h-10 max-w-40 pl-2 pr-7'
    : 'flex-row items-center gap-2.5 h-10 max-w-40 px-2'
})

const textVariantClass = computed<string>(() => {
  return isPill.value ? 'flex-1' : 'w-full'
})

const valueVariantClass = computed<string>(() => {
  return isPill.value
    ? 'text-xs leading-4 truncate'
    : 'text-[10.5px] leading-3 line-clamp-2 break-words'
})

const reasoningIconComponent = computed<string>(() => {
  if (props.tile.icon.kind !== 'reasoning') {
    return ''
  }

  const level = props.tile.icon.level

  return `SvgoThink${level.charAt(0).toUpperCase()}${level.slice(1)}`
})

function onOpen(event: MouseEvent) {
  emit('open', props.tile.section, event.currentTarget as HTMLElement)
}
</script>
