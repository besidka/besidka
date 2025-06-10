<template>
  <form
    novalidate
    class="p-3"
    @submit.prevent="onSubmit"
  >
    <slot />
  </form>
</template>

<script setup lang="ts">
import type { FormEmit } from '~/types/form.d'

const emit = defineEmits<FormEmit>()

// eslint-disable-next-line
// @ts-expect-error  Argument of type '((evt: "submit") => void) & ((evt: "onValidationError", args_0: Field) => void)' is not assignable to parameter of type '(event: keyof FormEmit, ...args: any[]) => void'.
const { onSubmit, resetValidation } = useForm(emit)

defineExpose({
  onSubmit,
  resetValidation,
})
</script>
