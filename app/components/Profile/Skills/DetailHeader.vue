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
    <ProfileSkillsModeControl
      :skill="data"
      :is-disabled="actions.isBusy(data.id)"
      test-id="skill-detail-mode"
      @select="onSelectMode"
    />
  </div>
</template>

<script setup lang="ts">
import type { SkillMode } from '#shared/utils/skills/mode'

const props = defineProps<{
  skillId: string
}>()

defineOptions({ inheritAttrs: false })

const { data } = useSkillDetail(() => props.skillId)
const actions = useSkillActions()
const editSession = useSkillEditSession()

async function onSelectMode(mode: SkillMode) {
  if (!data.value) {
    return
  }

  await actions.setMode(data.value, mode)
}
</script>
