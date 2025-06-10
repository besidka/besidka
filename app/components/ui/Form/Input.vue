<template>
  <UiFormLabel>
    <UiFormFieldLabel :label="label" />
    <label
      class="relative input w-full rounded-field"
      :class="{
        'validator required': required,
        'input-xs': size === 'xs',
        'input-sm': size === 'sm',
        'input-md': size === 'md',
        'input-lg': size === 'lg',
        'input-xl': size === 'xl',
      }"
    >
      <span
        v-if="$slots.labelBefore"
        class="label"
      >
        <slot name="labelBefore" />
      </span>
      <input
        ref="field"
        v-model="value"
        :autocomplete="autocomplete"
        :type="type"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :user-valid="isValid"
        :user-invalid="isInvalid"
        v-on="listeners"
      >
      <span
        v-if="$slots.labelAfter"
        class="label"
      >
        <slot name="labelAfter" />
      </span>
      <UiFormFieldBadge
        :validated="validated"
        :required="required"
        :error="error"
        :success="success"
        :size="size"
      />
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
  type: 'text',
  showError: true,
})
const emit = defineEmits<{
  change: [value: string]
  input: [value: string]
  focus: []
  blur: []
}>()

const field = ref<HTMLInputElement | null>(null)
const value = defineModel<string | number>() as Ref<string | number>

if (toValue(props.value) && !value.value) {
  value.value = toValue(props.value) ?? ''
}

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
  listeners,
  validate,
  validated,
  isValid,
  isInvalid,
  resetValidation,
} = useField(
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
