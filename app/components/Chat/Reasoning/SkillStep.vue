<template>
  <div
    class="my-2.5 min-w-0 flex-1"
    :data-state="data.state"
    data-testid="reasoning-skill-step"
  >
    <p
      class="min-w-0 break-words text-xs"
      :class="pending
        ? 'skeleton skeleton-text reasoning-main-title-skeleton'
        : undefined
      "
      data-testid="reasoning-skill-step-title"
    >
      <span>{{ prefix }}</span>{{ ' ' }}<button
        v-if="canOpen"
        type="button"
        class="link text-left font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :aria-label="`Open skill ${data.name}`"
        data-testid="reasoning-skill-step-open"
        @click="onOpen"
      >
        {{ data.name }}
      </button>
      <span v-else-if="data.name">{{ data.name }}</span>
      <span v-if="pending">…</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import type { SkillStepModel } from '~/utils/skill-step'

const props = defineProps<{
  data: SkillStepModel
  title: string
  pending: boolean
}>()

const preview = useSkillPreview()

const prefix = computed<string>(() => {
  const name = props.data.name

  if (!name) {
    return props.title
  }

  const suffix = ` · ${name}`

  return props.title.endsWith(suffix)
    ? `${props.title.slice(0, -suffix.length)} ·`
    : props.title
})

const canOpen = computed<boolean>(() => {
  return !!props.data.skillId && !!props.data.name && !props.pending
})

function onOpen() {
  if (props.data.skillId) {
    preview.open(props.data.skillId)
  }
}
</script>
