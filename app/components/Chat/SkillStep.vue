<template>
  <section
    v-if="step"
    class="mt-2 w-full max-w-sm"
    aria-live="polite"
    :data-state="step.state"
    data-testid="skill-step"
  >
    <p
      v-if="step.state === 'working'"
      class="flex items-center gap-3 rounded-box border border-base-300 bg-base-200 p-3 text-sm"
      role="status"
      data-testid="skill-step-working"
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          name="lucide:sparkles"
          size="20"
          aria-hidden="true"
        />
      </span>
      <span class="flex min-w-0 items-center gap-2">
        <span
          class="loading loading-spinner loading-xs shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">Using skill…</span>
      </span>
    </p>
    <p
      v-else-if="step.state === 'failed'"
      class="flex items-center gap-2 rounded-box border border-base-300 px-3 py-2 text-sm text-base-content/60"
      data-testid="skill-step-failed"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span class="truncate">
        Could not use skill{{ step.name ? ` · ${step.name}` : '' }}
      </span>
    </p>
    <button
      v-else
      type="button"
      class="flex w-full items-center gap-3 rounded-box border border-base-300 bg-base-200 p-3 text-left cursor-pointer transition-colors duration-150 hover:bg-base-300/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :aria-label="`Open skill ${step.name}`"
      data-testid="skill-step-ready"
      @click="onOpen"
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          name="lucide:sparkles"
          size="20"
          aria-hidden="true"
        />
      </span>
      <span class="min-w-0 grow truncate text-sm font-medium">
        Used skill · {{ step.name }}
      </span>
      <Icon
        name="lucide:chevron-right"
        size="16"
        class="shrink-0 text-base-content/50"
        aria-hidden="true"
      />
    </button>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  part: unknown
}>()

const preview = useSkillPreview()

const step = computed(() => {
  return getSkillStepModel(props.part)
})

function onOpen() {
  if (step.value?.skillId) {
    preview.open(step.value.skillId)
  }
}
</script>
