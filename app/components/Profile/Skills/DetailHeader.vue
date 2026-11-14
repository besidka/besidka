<template>
  <div
    v-if="data"
    class="flex items-center gap-3"
  >
    <button
      type="button"
      class="btn btn-sm"
      :aria-label="`Edit ${data.name}`"
      data-testid="skill-detail-edit"
      @click="editSession.open(data.id)"
    >
      <Icon name="lucide:pencil" size="14" aria-hidden="true" />
      Edit
    </button>
    <label
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
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  skillId: string
}>()

defineOptions({ inheritAttrs: false })

const { data } = useSkillDetail(() => props.skillId)
const actions = useSkillActions()
const editSession = useSkillEditSession()

async function onToggle() {
  if (!data.value) {
    return
  }

  await actions.setEnabled(data.value, !data.value.enabled)
}
</script>
