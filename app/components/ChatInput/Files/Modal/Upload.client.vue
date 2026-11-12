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
          <strong
            class="block font-semibold"
            data-testid="files-upload-formats"
          >
            {{ formattedFileFormats }}
          </strong>
        </p>
        <div
          v-if="legacyOfficeMessage"
          role="alert"
          class="alert alert-warning alert-soft mt-4 text-left text-sm"
          data-testid="files-upload-legacy-hint"
          @click.stop
        >
          <Icon
            name="lucide:circle-alert"
            size="16"
            class="shrink-0"
          />
          <span>{{ legacyOfficeMessage }}</span>
        </div>
      </div>
      <div class="hidden">
        <input
          ref="fileInput"
          data-testid="files-upload-input"
          type="file"
          class="file-input file-input-bordered file-input-sm"
          :accept="acceptAttribute"
          multiple
          @change="onFileInputChange"
          @click.stop
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  canAttachMediaType?: (mediaType: string) => boolean
}>(), {
  canAttachMediaType: () => true,
})

const emit = defineEmits<{
  upload: [files: File[]]
}>()

const { allowedFileFormats } = useRuntimeConfig().public
const officeFeature = useFeature('files.office')

const legacyOfficeMessage = shallowRef<string>('')

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

const effectiveFileFormats = computed<string[]>(() => {
  const formats = getAllowedFileFormats(allowedFileFormats as string[], {
    office: officeFeature.value.active,
  })

  return formats.filter((format) => {
    return !isMediaTypeRejectedByModel(format, props.canAttachMediaType)
  })
})

const TEXT_FILE_EXTENSIONS = ['.md', '.markdown', '.txt', '.csv', '.tsv']

const acceptAttribute = computed<string>(() => {
  const hasTextFormat = effectiveFileFormats.value.some((format) => {
    return format.startsWith('text/')
  })

  return [
    ...effectiveFileFormats.value,
    ...hasTextFormat ? TEXT_FILE_EXTENSIONS : [],
    ...officeFeature.value.active
      ? [...OFFICE_ACCEPT_EXTENSIONS, ...LEGACY_OFFICE_ACCEPT_EXTENSIONS]
      : [],
  ].join(',')
})

const formattedFileFormats = computed<string>(() => {
  return formatUploadFormatLabels(effectiveFileFormats.value)
})

function filterValidFiles(files: File[]): File[] {
  const formats = effectiveFileFormats.value
  const valid: File[] = []
  const invalid: string[] = []
  const legacyOffice: string[] = []

  legacyOfficeMessage.value = ''

  for (const file of files) {
    if (officeFeature.value.active && isLegacyOfficeFile(file)) {
      legacyOffice.push(file.name)

      continue
    }

    const normalizedFile = normalizeUploadFile(file)

    if (formats.includes(normalizedFile.type)) {
      valid.push(normalizedFile)
    } else {
      invalid.push(file.name)
    }
  }

  if (legacyOffice.length > 0) {
    legacyOfficeMessage.value = getLegacyOfficeMessage(legacyOffice)
    useWarningMessage(legacyOfficeMessage.value)
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
