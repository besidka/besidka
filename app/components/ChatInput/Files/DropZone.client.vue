<template>
  <div>
    <Teleport to="body">
      <div
        ref="dropZoneRef"
        class="fixed inset-0"
        :class="{
          '-z-10 hidden pointer-events-none': !isDraggingOverWindow,
          'z-60 pointer-events-auto': isDraggingOverWindow
        }"
      >
        <Transition
          enter-active-class="transition-opacity duration-200"
          leave-active-class="transition-opacity duration-200"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div
            v-show="isOverDropZone"
            class="absolute inset-0 bg-base-100/60 backdrop-blur-sm flex items-center justify-center"
          >
            <div class="text-center p-8">
              <Icon name="lucide:upload-cloud" size="48" />
              <h3 class="mb-2 text-2xl font-bold">
                Drop files to upload
              </h3>
              <p class="text-base-content/80">
                Files will be attached to your message
              </p>
            </div>
          </div>
        </Transition>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  filesDropped: [files: File[]]
}>()

const dropZoneRef = useTemplateRef<HTMLDivElement>('dropZoneRef')
const isDraggingOverWindow = shallowRef<boolean>(false)
let dragCounter = 0

const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop(droppedFiles) {
    isDraggingOverWindow.value = false
    dragCounter = 0

    if (droppedFiles && droppedFiles.length > 0) {
      emit('filesDropped', Array.from(droppedFiles))
    }
  },
})

function onDragEnter(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    dragCounter++
    isDraggingOverWindow.value = true
  }
}

function onDragLeave() {
  dragCounter--

  if (dragCounter === 0) {
    isDraggingOverWindow.value = false
  }
}

function onDrop() {
  isDraggingOverWindow.value = false
  dragCounter = 0
}

onMounted(() => {
  document.addEventListener('dragenter', onDragEnter)
  document.addEventListener('dragleave', onDragLeave)
  document.addEventListener('drop', onDrop)
})

onUnmounted(() => {
  document.removeEventListener('dragenter', onDragEnter)
  document.removeEventListener('dragleave', onDragLeave)
  document.removeEventListener('drop', onDrop)
})
</script>
