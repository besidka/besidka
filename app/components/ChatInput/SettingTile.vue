<template>
  <div
    class="carousel-item relative"
    :data-testid="`chat-input-tile-${tile.id}`"
    :data-tile-id="tile.id"
  >
    <button
      type="button"
      class="js-chat-input-tile flex flex-col justify-between items-start size-16 p-1 pb-1.5 rounded-box border text-left cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      :class="[
        getChatInputTileToneClass(tile),
        { 'opacity-60': tile.isDisabled },
      ]"
      :aria-label="tile.ariaLabel"
      :title="tile.ariaLabel"
      :aria-disabled="tile.isDisabled || undefined"
      :data-testid="`chat-input-tile-${tile.id}-body`"
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
      </span>
      <span class="flex flex-col w-full min-w-0">
        <span
          class="text-[9px] leading-[10px] font-semibold opacity-85 truncate"
        >
          {{ tile.caption }}
        </span>
        <span
          class="text-[10.5px] leading-3 font-bold line-clamp-2 break-words"
        >
          {{ tile.value }}
        </span>
      </span>
    </button>
    <button
      v-if="tile.removeLabel"
      type="button"
      class="absolute top-1 right-1 btn btn-circle btn-xs btn-error btn-soft size-4"
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

const props = defineProps<{
  tile: ChatInputTile
}>()

const emit = defineEmits<{
  open: [section: ToolsSection | null, origin: HTMLElement]
  remove: [id: ChatInputTileId]
}>()

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
