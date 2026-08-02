<template>
  <label class="otp otp-lg">
    <span />
    <span />
    <span />
    <span />
    <span />
    <span />
    <input
      ref="field"
      :value="value"
      type="text"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :maxlength="maxlength"
      :pattern="pattern"
      :disabled="disabled"
      @input="onInput"
    >
  </label>
</template>

<script setup lang="ts">
type OtpVariant = 'totp' | 'backup-code'

const props = withDefaults(defineProps<{
  variant?: OtpVariant
  disabled?: boolean
}>(), {
  variant: 'totp',
  disabled: false,
})

const emit = defineEmits<{
  complete: [value: string]
}>()

const field = ref<HTMLInputElement | null>(null)
const value = defineModel<string>({ default: '' })

const autocomplete = 'one-time-code'

const maxlength = computed<number>(() => {
  return props.variant === 'backup-code' ? 11 : 6
})

const inputmode = computed<'numeric' | 'text'>(() => {
  return props.variant === 'backup-code' ? 'text' : 'numeric'
})

const pattern = computed<string>(() => {
  return props.variant === 'backup-code'
    ? '[A-Za-z0-9]{5}-[A-Za-z0-9]{5}'
    : '[0-9]{6}'
})

function sanitize(raw: string): string {
  if (props.variant === 'backup-code') {
    return raw.slice(0, maxlength.value)
  }

  return raw.replace(/\D/g, '').slice(0, maxlength.value)
}

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  const sanitized = sanitize(target.value)

  target.value = sanitized
  value.value = sanitized

  if (sanitized.length === maxlength.value) {
    emit('complete', sanitized)
  }
}

function focus() {
  field.value?.focus()
}

defineExpose({ field, focus })
</script>
