<template>
  <dialog
    ref="modal"
    class="modal modal-bottom sm:modal-middle"
    @cancel.prevent
  >
    <div class="modal-box">
      <h3 class="text-lg font-bold">
        Save your backup codes
      </h3>
      <p class="mt-2 text-sm text-base-content/70">
        Each code can be used once to sign in if you lose access to your
        authenticator app. Store them somewhere safe — they will not be
        shown again.
      </p>
      <ul class="grid grid-cols-2 gap-2 mt-4 font-mono text-sm">
        <li
          v-for="code in codes"
          :key="code"
          class="bg-base-200 rounded-box px-3 py-2 text-center"
        >
          {{ code }}
        </li>
      </ul>
      <div class="modal-action flex-wrap justify-between gap-2">
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-sm"
            data-testid="backup-codes-copy"
            @click="copyAll"
          >
            <Icon
              name="lucide:copy"
              size="14"
            />
            Copy all
          </button>
          <button
            type="button"
            class="btn btn-sm"
            data-testid="backup-codes-download"
            @click="download"
          >
            <Icon
              name="lucide:download"
              size="14"
            />
            Download
          </button>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="backup-codes-acknowledge"
          @click="acknowledge"
        >
          I've saved these codes
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
const props = defineProps<{
  codes: string[]
  open: boolean
}>()

const emit = defineEmits<{
  acknowledge: []
}>()

const modal = useTemplateRef<HTMLDialogElement>('modal')

watch(() => props.open, (isOpen) => {
  if (!modal.value) {
    return
  }

  isOpen ? modal.value.showModal() : modal.value.close()
}, { flush: 'post' })

async function copyAll() {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'))

    useSuccessMessage('Copied to clipboard')
  } catch {
    useErrorMessage('Failed to copy backup codes')
  }
}

function download() {
  const blob = new Blob([props.codes.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = 'besidka-backup-codes.txt'
  link.click()

  URL.revokeObjectURL(url)
}

function acknowledge() {
  emit('acknowledge')
}
</script>
