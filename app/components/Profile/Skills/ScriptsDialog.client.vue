<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="skill-scripts-dialog"
      class="js-skill-scripts-dialog modal modal-bottom sm:modal-middle"
      aria-labelledby="skill-scripts-dialog-title"
      @cancel.prevent="decline"
    >
      <div class="modal-box flex max-h-[85vh] max-w-lg flex-col">
        <h3
          id="skill-scripts-dialog-title"
          class="shrink-0 text-lg font-bold"
        >
          Allow scripts for {{ skill.name }}?
        </h3>
        <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          <p class="text-sm">
            Besidka never runs scripts itself. To run them, it uploads this
            skill to your own Anthropic workspace, where the model runs them
            in Anthropic's code sandbox on your key.
          </p>
          <ul
            class="list-disc space-y-2 ps-5 text-sm text-base-content/80"
            data-testid="skill-scripts-dialog-points"
          >
            <li
              v-for="point in SKILL_SCRIPTS_DISCLOSURE_POINTS"
              :key="point"
            >
              {{ point }}
            </li>
          </ul>
          <div
            v-if="skill.scriptsProviderName"
            role="status"
            class="alert alert-info alert-soft text-sm"
            data-testid="skill-scripts-dialog-rename"
          >
            <Icon
              name="lucide:info"
              size="16"
              class="shrink-0"
              aria-hidden="true"
            />
            <span>
              Anthropic does not allow "anthropic" or "claude" in a skill
              name. It is uploaded as
              <strong>{{ skill.scriptsProviderName }}</strong>
              and keeps "{{ skill.name }}" as its title. A change note is
              added to its SKILL.md.
            </span>
          </div>
        </div>
        <div class="modal-action shrink-0">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            autofocus
            data-testid="skill-scripts-dialog-cancel"
            @click="decline"
          >
            Keep scripts off
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-testid="skill-scripts-dialog-confirm"
            @click="confirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="modal-backdrop"
        aria-label="Close"
        @click="decline"
      />
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { SkillSummary } from '#shared/types/skills.d'
import { SKILL_SCRIPTS_DISCLOSURE_POINTS } from '#shared/utils/skills/scripts'

const props = defineProps<{
  skill: Pick<SkillSummary, 'name' | 'scriptsProviderName'>
}>()

const emit = defineEmits<{
  confirm: []
  decline: []
}>()

const modal = useTemplateRef<HTMLDialogElement>('modal')

const confirmLabel = computed<string>(() => {
  return props.skill.scriptsProviderName
    ? 'Allow and rename'
    : 'Allow scripts'
})

function open() {
  modal.value?.showModal()
}

function close() {
  modal.value?.close()
}

function confirm() {
  close()
  emit('confirm')
}

function decline() {
  close()
  emit('decline')
}

defineExpose({ open, close })
</script>
