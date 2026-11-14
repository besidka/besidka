<template>
  <label
    v-if="data"
    class="flex min-h-8 cursor-pointer items-center gap-2 text-sm"
    data-testid="skill-detail-enable"
  >
    <span>{{ data.enabled ? 'On' : 'Off' }}</span>
    <input
      type="checkbox"
      class="toggle toggle-sm"
      :checked="data.enabled"
      :disabled="actions.isBusy(data.id) || data.status === 'broken'"
      :aria-label="`${data.enabled ? 'Turn off' : 'Turn on'} ${data.name}`"
      data-testid="skill-detail-toggle"
      @click.prevent="onToggle"
    >
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  skillId: string
}>()

defineOptions({ inheritAttrs: false })

const { data } = useSkillDetail(() => props.skillId)
const actions = useSkillActions()

async function onToggle() {
  if (!data.value) {
    return
  }

  await actions.setEnabled(data.value, !data.value.enabled)
}
</script>
