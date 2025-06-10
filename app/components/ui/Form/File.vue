<template>
  <UiFormLabel>
    <UiFormFieldLabel :label="label" />
    <p class="relative">
      <input
        ref="field"
        type="file"
        :multiple="multiple"
        :accept="accept || undefined"
        class="file-input file-input-bordered w-full bg-base-100 rounded-field"
        :class="{
          'validator required': required,
          'file-input-error': validated && error,
          'file-input-success': validated && success,
          'file-input-xs': size === 'xs',
          'file-input-sm': size === 'sm',
          'file-input-md': size === 'md',
          'file-input-lg': size === 'lg',
          'file-input-xl': size === 'xl',
        }"
        :required="required"
        :disabled="disabled"
        :user-valid="isValid"
        :user-invalid="isInvalid"
        @change="validate"
      >
      <LazyUiFormFieldHint
        v-if="allowError"
        :error="error"
      />
      <UiFormFieldBadge
        :validated="validated"
        :required="required"
        :error="error"
        :success="success"
        :size="size"
      />
    </p>
    <UiFormFieldLabel
      :label="note"
      position="after"
    />
  </UiFormLabel>
</template>

<script setup lang="ts">
import type { FieldFileProps, FieldExposed } from '~/types/field.d'

const props = withDefaults(defineProps<FieldFileProps>(), {
  showError: true,
})
const emit = defineEmits<{
  change: [files: FileList]
}>()

const field = ref<HTMLInputElement | null>(null)

const dispatchChange = () => {
  field.value?.dispatchEvent(new Event('change', { bubbles: true }))
}

const {
  multiple,
  required,
  accept,
  disabled,
  allowError,
  error,
  success,
  validate,
  validated,
  isValid,
  isInvalid,
  resetValidation,
} = useFieldFile(
  field,
  props,
  emit,
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
