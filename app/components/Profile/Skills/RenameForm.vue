<template>
  <form
    class="grid gap-2"
    @submit.prevent="emit('submit', name.trim())"
  >
    <label
      for="skill-import-rename"
      class="font-medium"
    >
      {{ label }}
    </label>
    <div class="join w-full">
      <input
        id="skill-import-rename"
        v-model="name"
        type="text"
        class="input input-sm join-item w-full text-base-content"
        :maxlength="SKILL_NAME_MAX"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        data-testid="skill-import-rename"
      >
      <button
        type="submit"
        class="btn btn-sm join-item"
        :disabled="isDisabled || !isSkillNameValid(name.trim())"
        data-testid="skill-import-rename-submit"
      >
        Import
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import {
  SKILL_NAME_MAX,
  isSkillNameValid,
} from '#shared/utils/skills-policy'

withDefaults(defineProps<{
  label?: string
  isDisabled?: boolean
}>(), {
  label: 'Or import under a new name',
  isDisabled: false,
})

const emit = defineEmits<{
  submit: [name: string]
}>()

const name = defineModel<string>({ required: true })
</script>
