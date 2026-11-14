<template>
  <ChatInputToolsMenuSection
    id="skills"
    title="Skills"
    icon="lucide:sparkles"
    :is-highlighted="isHighlighted"
  >
    <button
      v-for="item in shownItems"
      :key="item.id"
      type="button"
      class="flex items-center gap-2.5 w-full min-h-9 max-md:min-h-11 px-2 py-1 rounded-box text-left text-sm cursor-pointer hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      :aria-pressed="selectedId === item.id"
      :data-testid="`tools-skill-${item.name}`"
      @click="emit('select', item)"
    >
      <Icon
        name="lucide:sparkles"
        size="16"
        class="shrink-0 opacity-75"
        aria-hidden="true"
      />
      <span class="flex flex-col grow min-w-0">
        <span class="leading-tight truncate">{{ item.name }}</span>
        <span
          v-if="item.description"
          class="text-xs leading-tight text-base-content/60 truncate"
        >
          {{ item.description }}
        </span>
      </span>
      <Icon
        v-if="selectedId === item.id"
        name="lucide:check"
        size="14"
        class="shrink-0 text-accent"
        aria-hidden="true"
      />
    </button>
    <ChatInputToolsMenuActionRow
      v-if="hasMore"
      label="All skills…"
      :hint="`${items.length} skills`"
      icon="lucide:list"
      has-chevron
      data-testid="tools-skills-all"
      @click="emit('open-all')"
    />
    <ChatInputToolsMenuActionRow
      label="Manage skills"
      hint="Create, edit and turn skills on or off"
      icon="lucide:settings-2"
      has-chevron
      data-testid="tools-skills-manage"
      @click="emit('manage')"
    />
  </ChatInputToolsMenuSection>
</template>

<script setup lang="ts">
import type { ComposerSkillItem } from '~/composables/composer-skills'

const props = defineProps<{
  items: ComposerSkillItem[]
  selectedId: string | null
  isHighlighted?: boolean
}>()

const emit = defineEmits<{
  'select': [item: ComposerSkillItem]
  'open-all': []
  'manage': []
}>()

const hasMore = computed<boolean>(() => {
  return props.items.length > COMPOSER_SKILLS_MENU_LIMIT
})

const shownItems = computed<ComposerSkillItem[]>(() => {
  return props.items.slice(0, COMPOSER_SKILLS_MENU_LIMIT)
})
</script>
