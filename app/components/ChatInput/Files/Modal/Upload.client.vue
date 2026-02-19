<template>
  <div
    ref="dropZoneRef"
    tabindex="1"
    class="flex items-center justify-center my-4 rounded-box bg-base-200 backdrop-blur-sm shadow-inner cursor-pointer hover:bg-base-300/50 transition-colors"
    :class="{
      'ring-2 ring-primary bg-primary/10': isOverDropZone
    }"
    @click="fileInput?.click()"
  >
    <div class="w-full p-8 text-center">
      <div
        class="transition-opacity"
        :class="{
          'opacity-50': isInputFocused
        }"
      >
        <Icon
          name="lucide:upload-cloud"
          size="48"
          :class="{
            'text-primary': isOverDropZone,
            'text-base-content/60': !isOverDropZone
          }"
        />
        <p class="text-base-content/80 mt-2">
          <template v-if="isOverDropZone">
            Drop files here
          </template>
          <template v-else-if="$device.isDesktop">
            Drag and drop files or click here to upload
          </template>
          <template v-else>
            Click here to select files to upload
          </template>
        </p>
        <p class="mt-2 text-sm text-base-content/60">
          Allowed file types:
          <strong class="block font-semibold lowercase">
            {{ formattedFileFormats }}
          </strong>
        </p>
      </div>
      <div class="hidden">
        <input
          ref="fileInput"
          data-testid="files-upload-input"
          type="file"
          class="file-input file-input-bordered file-input-sm"
          :accept="allowedFileFormats.join(',')"
          multiple
          @change="onFileInputChange"
          @click.stop
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  upload: [files: File[]]
}>()

const { allowedFileFormats } = useRuntimeConfig().public

const dropZoneRef = useTemplateRef<HTMLDivElement>('dropZoneRef')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop(droppedFiles) {
    if (droppedFiles && droppedFiles.length > 0) {
      const validFiles = filterValidFiles(Array.from(droppedFiles))
      if (validFiles.length > 0) {
        emit('upload', validFiles)
      }
    }
  },
})

const { focused: isInputFocused } = useFocus(fileInput)

const formattedFileFormats = computed<string>(() => {
  return (allowedFileFormats as string[])
    .map(format => format.split('/')[1])
    .filter(Boolean)
    .join(', ')
})

function filterValidFiles(files: File[]): File[] {
  const formats = allowedFileFormats as string[]
  const valid: File[] = []
  const invalid: string[] = []

  for (const file of files) {
    if (formats.includes(file.type)) {
      valid.push(file)
    } else {
      invalid.push(file.name)
    }
  }

  if (invalid.length > 0) {
    useWarningMessage(
      `${invalid.length} file(s) skipped due to invalid format: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '...' : ''}`,
    )
  }

  return valid
}

function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files

  if (files && files.length > 0) {
    const validFiles = filterValidFiles(Array.from(files))

    if (validFiles.length > 0) {
      emit('upload', validFiles)
    }
  }

  target.value = ''
}
</script>
