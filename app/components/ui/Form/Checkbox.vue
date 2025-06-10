<template>
  <label class="label">
    <input
      ref="field"
      v-model="value"
      type="checkbox"
      :required="required"
      :disabled="disabled"
      class="toggle toggle-xs"
      :class="{
        'validator': required,
        'toggle-error': required && isInvalid,
        'toggle-success': required && isValid,
      }"
      :user-valid="required && isValid"
      :user-invalid="required && isInvalid"
      :checked="value"
    >
    <slot />
  </label>
</template>

<script setup lang="ts">
import type { FieldProps, FieldExposed } from '~/types/field.d'

const props = withDefaults(defineProps<FieldProps>(), {
  type: 'text',
  showError: true,
})

const emit = defineEmits<{
  change: [value: boolean]
}>()

const field = ref<HTMLInputElement | null>(null)
const value = defineModel<boolean>() as Ref<boolean>

const dispatchChange = () => {
  field.value?.dispatchEvent(new Event('change', { bubbles: true }))
}

const {
  required,
  disabled,
  error,
  success,
  validate,
  validated,
  isValid,
  isInvalid,
  resetValidation,
} = useFieldCheckbox(
  props,
  // @ts-ignore
  emit,
  value,
)

defineExpose<FieldExposed>({
  field,
  required,
  validate,
  validated,
  success,
  error,
  dispatchChange,
  resetValidation,
})
</script>
