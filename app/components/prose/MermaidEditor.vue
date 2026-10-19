<template>
  <div>
    <textarea
      ref="textareaRef"
      v-model="source"
      class="
        textarea w-full min-h-24 max-h-72 resize-none overflow-y-auto
        bg-base-200 p-3 font-code text-sm leading-relaxed
        [--radius-field:0.5rem] focus:shadow-none focus:outline-offset-0
      "
      wrap="off"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      aria-label="Diagram source"
      :aria-describedby="hintId"
      data-testid="mermaid-editor"
      @keydown="onKeydown"
    />
    <p
      :id="hintId"
      class="pt-1 text-xs text-base-content/60"
      data-testid="mermaid-editor-hint"
    >
      Tab inserts spaces · Esc to finish
    </p>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  exit: []
}>()

const INDENT: string = '  '
const IME_KEY_CODE: number = 229

const source = defineModel<string>({ required: true })

const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef')
const hintId = `mermaid-editor-hint-${useId()}`

function resize() {
  const textarea = textareaRef.value

  if (!textarea) {
    return
  }

  const borderHeight = textarea.offsetHeight - textarea.clientHeight

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
}

function insertIndent() {
  const textarea = textareaRef.value

  if (!textarea) {
    return
  }

  textarea.setRangeText(
    INDENT,
    textarea.selectionStart,
    textarea.selectionEnd,
    'end',
  )
  source.value = textarea.value
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === IME_KEY_CODE) {
    return
  }

  if (event.key === 'Escape') {
    emit('exit')

    return
  }

  const hasModifier = event.shiftKey
    || event.ctrlKey
    || event.altKey
    || event.metaKey

  if (event.key === 'Tab' && !hasModifier) {
    event.preventDefault()
    insertIndent()
  }
}

watch(source, resize, { flush: 'post' })

onMounted(() => {
  resize()
  textareaRef.value?.focus()
})
</script>
