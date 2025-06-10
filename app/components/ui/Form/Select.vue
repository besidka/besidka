<template>
  <UiFormLabel>
    <UiFormFieldLabel :label="label" />
    <label
      class="relative select select-bordered join-item w-full rounded-field"
      :class="{
        'validator required': required,
        'select-xs': size === 'xs',
        'select-sm': size === 'sm',
        'select-md': size === 'md',
        'select-lg': size === 'lg',
        'select-xl': size === 'xl',
      }"
    >
      <span
        v-if="$slots.labelBefore"
        class="label"
      >
        <slot name="labelBefore" />
      </span>
      <UiFormFieldBadge
        :validated="validated"
        :required="required"
        :error="error"
        :success="success"
      />
      <select
        ref="field"
        v-model="value"
        :required="required"
        :disabled="disabled"
        :user-valid="isValid"
        :user-invalid="isInvalid"
        @change="validate"
      >
        <option
          v-if="placeholder"
          :selected="!value"
          value=""
        >
          {{ placeholder }}
        </option>
        <slot />
      </select>
    </label>
    <LazyUiFormFieldHint
      v-if="allowError"
      :error="error"
    />
    <UiFormFieldLabel
      :label="note"
      position="after"
    />
    <p
      v-if="$slots.noteAfter"
      class="fieldset-label mt-2 text-base-content/80"
    >
      <slot name="noteAfter" />
    </p>
  </UiFormLabel>
</template>

<script setup lang="ts">
import type { FieldProps, FieldExposed } from '~/types/field.d'

const props = withDefaults(defineProps<FieldProps>(), {
  type: 'select',
  showError: true,
})
const emit = defineEmits<{
  change: [value: string]
}>()

const field = ref<HTMLSelectElement | null>(null)
const value = defineModel<string>()

const dispatchChange = () => {
  field.value?.dispatchEvent(new Event('change', { bubbles: true }))
}

const {
  required,
  disabled,
  allowError,
  error,
  success,
  placeholder,
  validate,
  validated,
  isValid,
  isInvalid,
  resetValidation,
} = useField(
  props,
  // @ts-expect-error
  emit,
  value as Ref<string>,
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

const observer = ref<MutationObserver | null>(null)

onMounted(() => {
  if (!field.value) return

  observer.value = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes'
        && mutation.attributeName === 'data-com-onepassword-filled'
        && field.value?.hasAttribute('data-com-onepassword-filled')
      ) {
        field.value?.removeAttribute('data-com-onepassword-filled')
      }
    }
  })

  observer.value.observe(field.value, { attributes: true })
})

onBeforeUnmount(() => {
  observer.value?.disconnect()
})
</script>
