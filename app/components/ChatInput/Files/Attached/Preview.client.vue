<template>
  <div
    v-if="hasAnyItems"
    class="overflow-hidden attached-files mb-1.5"
    role="region"
    :aria-label="regionLabel"
  >
    <!-- Screen reader announcements -->
    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ statusAnnouncement }}
    </div>

    <div
      ref="carouselRef"
      class="carousel flex gap-1.5 w-full py-1 px-0 rounded-box"
      :class="{ [END_FADE_MASK_CLASS]: isEndFadeVisible }"
    >
      <ChatInputSettingTile
        v-for="tile in tiles"
        :key="tile.id"
        :tile="tile"
        :variant="hasAnyFiles ? 'square' : 'pill'"
        @open="(section, origin, id) => emit('open-tile', section, origin, id)"
        @remove="emit('remove-tile', $event)"
      />
      <ChatInputFilesAttachedChipShell
        v-for="pastedText in pastedTexts"
        :key="pastedText.id"
        role="group"
        :aria-label="PASTED_TEXT_NAME"
        data-testid="pasted-text-item"
      >
        <ChatInputFilesAttachedTextCard
          :file="{
            name: PASTED_TEXT_NAME,
            type: PASTED_TEXT_MEDIA_TYPE,
            size: getPastedTextSize(pastedText.content),
          }"
          :content="pastedText.content"
          @open="emit('open-pasted', pastedText.id)"
        />
        <template #outside>
          <button
            class="absolute top-1 right-1 btn btn-circle btn-xs btn-error btn-soft size-4"
            :aria-label="`Remove ${PASTED_TEXT_NAME.toLowerCase()}`"
            :title="`Remove ${PASTED_TEXT_NAME.toLowerCase()}`"
            data-testid="pasted-text-remove"
            @click="emit('remove-pasted', pastedText.id)"
          >
            <Icon
              name="lucide:x"
              size="10"
            />
          </button>
        </template>
      </ChatInputFilesAttachedChipShell>
      <!-- Completed/attached files -->
      <ChatInputFilesAttachedChipShell
        v-for="file in files"
        :key="file.storageKey"
        :is-bare="isImageFile(file.type)"
        :data-file-name="file.name"
        :aria-label="`File ${file.name}`"
        data-testid="carousel-item"
      >
        <div
          v-if="isImageFile(file.type)"
          class="flex items-center justify-center size-16 rounded-box aspect-square bg-base-300 relative overflow-hidden"
        >
          <img
            v-if="isImageFile(file.type)"
            :src="getFileUrl(file.storageKey)"
            :alt="file.name"
            class="shrink-0 size-full object-cover"
            loading="lazy"
          >
        </div>
        <ChatInputFilesAttachedTextCard
          v-else-if="isTextFileType(file.type) && !hasChipNote(file)"
          :file="file"
          @open="emit('open-text', file.storageKey)"
        />
        <template v-else>
          <ChatInputFilesAttachedChipPreviewBox>
            <Icon
              :name="getChipIcon(file)"
              size="20"
              class="text-base-content/40"
            />
          </ChatInputFilesAttachedChipPreviewBox>
          <div class="flex flex-col items-start gap-1 min-w-0">
            <p
              class="pr-2 text-xs font-medium truncate"
              :title="file.name"
            >
              {{ truncateFilename(file.name) }}
            </p>
            <button
              v-if="deliveryHints.get(file.storageKey)"
              type="button"
              class="badge badge-soft badge-xs leading-none cursor-pointer max-w-36 min-w-0"
              :class="{
                'badge-warning': deliveryHints.get(file.storageKey)?.isBlocking
              }"
              :title="hintTitle(file.storageKey)"
              :aria-label="deliveryHints.get(file.storageKey)?.label"
              :aria-expanded="openHintKey === file.storageKey"
              :aria-controls="hintNoteId"
              data-testid="files-delivery-hint"
              @click="toggleHint(file.storageKey)"
            >
              <span class="truncate">
                {{ deliveryHints.get(file.storageKey)?.label }}
              </span>
            </button>
            <span
              v-if="convertedFromXlsKeys.has(file.storageKey)"
              class="text-[10px] leading-none text-base-content/60"
              :title="XLS_CONVERTED_NOTE_DESCRIPTION"
              data-testid="files-converted-note"
            >
              {{ XLS_CONVERTED_NOTE }}
            </span>
          </div>
        </template>
        <template #outside>
          <span
            v-if="file.externalSource === 'google'"
            class="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-base-100"
            :title="GOOGLE_DRIVE_BRAND_NAME"
            role="img"
            :aria-label="driveCopyLabel(file.name)"
            data-testid="files-preview-drive-mark"
          >
            <Icon
              :name="GOOGLE_DRIVE_ICON"
              size="10"
            />
          </span>
          <button
            class="absolute top-1 right-1 btn btn-circle btn-xs btn-error btn-soft size-4"
            :aria-label="`Remove ${file.name}`"
            :title="`Remove ${file.name}`"
            data-testid="files-preview-detach"
            @click="removeAttachedFile(file.storageKey)"
          >
            <Icon
              name="lucide:x"
              size="10"
            />
          </button>
        </template>
      </ChatInputFilesAttachedChipShell>

      <ChatInputFilesAttachedDriveImport
        v-for="driveImport in driveImports"
        :key="`drive-${driveImport.id}`"
        :item="driveImport"
        :note-id="driveImportNoteId(driveImport.id)"
        :is-note-open="openDriveImport?.id === driveImport.id"
        @toggle-note="toggleDriveImportNote(driveImport.id)"
        @dismiss="dismissDriveImport(driveImport.id)"
      />

      <ChatInputFilesAttachedChipShell
        v-for="placeholderIndex in checkingLinkCount"
        :key="`checking-link-${placeholderIndex}`"
        :is-bare="!hasAnyFiles"
        role="status"
        aria-label="Checking Google link"
        data-testid="google-link-skeleton"
      >
        <div
          v-if="!hasAnyFiles"
          class="flex items-center gap-2.5 h-10 w-32 pl-2 pr-7 rounded-box border border-base-300 bg-base-100/70"
          data-testid="google-link-skeleton-pill"
        >
          <div class="skeleton skeleton--default size-4 shrink-0 rounded-sm" />
          <div class="flex flex-col flex-1 gap-1 min-w-0">
            <div class="skeleton skeleton--default h-2 w-14 rounded-sm" />
            <div class="skeleton skeleton--default h-2.5 w-full rounded-sm" />
          </div>
        </div>
        <template v-else>
          <ChatInputFilesAttachedChipPreviewBox
            data-testid="google-link-skeleton-preview"
          >
            <div class="skeleton skeleton--default size-full" />
          </ChatInputFilesAttachedChipPreviewBox>
          <div class="flex flex-col items-start gap-1 min-w-0 pr-2">
            <div class="skeleton skeleton--default h-3 w-28 rounded-sm" />
            <div class="skeleton skeleton--default h-2.5 w-16 rounded-sm" />
          </div>
        </template>
      </ChatInputFilesAttachedChipShell>
      <!-- Uploading files -->
      <ChatInputFilesAttachedChipShell
        v-for="uploadingFile in uploadingFilesArray"
        :key="uploadingFile.id"
        :is-bare="isImageFile(uploadingFile.file.type)"
        :data-uploading-id="uploadingFile.id"
        :data-file-name="uploadingFile.file.name"
        :aria-label="
          `File ${uploadingFile.file.name}, ${uploadingFile.progress}% uploaded`
        "
      >
        <!-- Image preview with progress overlay -->
        <div
          v-if="isImageFile(uploadingFile.file.type)"
          class="flex items-center justify-center size-16 rounded-box aspect-square bg-base-300 relative overflow-hidden"
        >
          <img
            v-if="uploadingFile.previewUrl"
            :src="uploadingFile.previewUrl"
            :alt="uploadingFile.file.name"
            class="shrink-0 size-full object-cover"
            :class="{
              'opacity-50 blur-[1px]': uploadingFile.status !== 'completed',
            }"
            loading="lazy"
          >
          <div
            v-else
            class="w-full h-full flex items-center justify-center"
          >
            <Icon
              :name="getFileIcon(uploadingFile.file.type)"
              size="24"
              class="text-base-content/40"
            />
          </div>

          <!-- Progress overlay for images -->
          <div
            v-if="uploadingFile.status !== 'completed'"
            class="absolute inset-0 flex items-center justify-center bg-base-300/30"
          >
            <div class="flex flex-col items-center gap-1">
              <Icon
                v-if="uploadingFile.status === 'uploading'"
                name="lucide:loader-circle"
                size="16"
                class="text-info animate-spin"
              />
              <Icon
                v-else-if="uploadingFile.status === 'waiting'"
                name="lucide:clock"
                size="16"
                class="text-warning"
              />
              <Icon
                v-else-if="uploadingFile.status === 'failed'"
                name="lucide:circle-alert"
                size="16"
                class="text-error"
              />
            </div>
          </div>

          <!-- Progress bar for images -->
          <progress
            v-if="
              uploadingFile.status === 'uploading'
                || uploadingFile.status === 'waiting'
            "
            :value="uploadingFile.progress"
            max="100"
            class="progress progress-info w-full h-1 absolute bottom-0 left-0 rounded-none"
            :aria-label="`Upload progress for ${uploadingFile.file.name}`"
          />
        </div>

        <!-- Non-image file preview -->
        <template v-else>
          <ChatInputFilesAttachedChipPreviewBox
            :class="{
              'opacity-50': uploadingFile.status !== 'completed',
            }"
          >
            <Icon
              :name="getFileIcon(uploadingFile.file.type)"
              size="20"
              class="text-base-content/40"
            />
          </ChatInputFilesAttachedChipPreviewBox>
          <div class="flex flex-col gap-1">
            <p
              class="pr-2 text-xs font-medium truncate"
              :title="uploadingFile.file.name"
            >
              {{ truncateFilename(uploadingFile.file.name) }}
            </p>
            <!-- Status indicator -->
            <span class="text-[10px] flex items-center gap-0.5">
              <template v-if="uploadingFile.status === 'waiting'">
                <Icon name="lucide:clock" size="10" class="text-warning" />
                <span class="text-base-content/60">Waiting...</span>
              </template>
              <template v-else-if="uploadingFile.status === 'uploading'">
                <Icon
                  name="lucide:loader-2"
                  size="10"
                  class="text-info animate-spin"
                />
                <span class="text-base-content/60">
                  {{ uploadingFile.progress }}%
                </span>
              </template>
              <template v-else-if="uploadingFile.status === 'failed'">
                <Icon
                  name="lucide:alert-circle"
                  size="10"
                  class="text-error"
                />
                <span class="text-error">Failed</span>
              </template>
            </span>
          </div>

          <!-- Progress bar for non-images -->
          <progress
            v-if="
              uploadingFile.status === 'uploading'
                || uploadingFile.status === 'waiting'
            "
            :value="uploadingFile.progress"
            max="100"
            class="progress progress-info w-full h-1 absolute bottom-0 left-0 rounded-none rounded-b-box"
            :aria-label="`Upload progress for ${uploadingFile.file.name}`"
          />
        </template>

        <template #outside>
          <div class="absolute top-1 right-1 flex gap-0.5">
            <button
              v-if="uploadingFile.status === 'failed'"
              class="btn btn-circle btn-xs btn-warning btn-soft size-4"
              :aria-label="`Retry upload for ${uploadingFile.file.name}`"
              :title="`Retry upload`"
              @click="emit('retry', uploadingFile.id)"
            >
              <Icon name="lucide:rotate-cw" size="10" />
            </button>
            <button
              v-if="uploadingFile.status !== 'completed'"
              class="btn btn-circle btn-xs btn-error btn-soft size-4"
              :aria-label="`Cancel upload for ${uploadingFile.file.name}`"
              title="Cancel upload"
              @click="emit('cancel', uploadingFile.id)"
            >
              <Icon name="lucide:x" size="10" />
            </button>
          </div>
        </template>
      </ChatInputFilesAttachedChipShell>

      <!-- Remove all button -->
      <div
        v-if="showRemoveAll"
        ref="detachAllItemRef"
        class="group sticky right-0 carousel-item flex items-center"
      >
        <button
          class="btn btn-error btn-soft size-16 rounded-box flex flex-col gap-1 shadow-sm"
          aria-label="Detach all files"
          title="Detach all files"
          data-testid="files-preview-detach-all"
          @click="removeAllFiles"
        >
          <Icon
            name="lucide:file-x"
            size="20"
          />
          <span class="sr-only">
            Detach all {{ totalFilesCount }} files
          </span>
          <span class="badge badge-error badge-xs group-hover:badge-soft transition-colors">
            {{ totalFilesCount }}
          </span>
        </button>
      </div>
    </div>
    <ChatInputToolsMenuInfoNote
      v-if="openHint"
      :id="hintNoteId"
      class="mt-1 break-words"
      role="note"
      data-testid="files-delivery-hint-note"
    >
      <span class="font-medium">{{ openHint.name }}:</span>
      {{ openHint.description }}
    </ChatInputToolsMenuInfoNote>
    <ChatInputFilesAttachedDriveImportNote
      v-if="openDriveImport"
      :id="driveImportNoteId(openDriveImport.id)"
      ref="driveImportNoteRef"
      :item="openDriveImport"
      @pick-again="pickDriveImportAgain(openDriveImport.id)"
      @dismiss="dismissDriveImport(openDriveImport.id)"
      @close="closeDriveImportNote(openDriveImport.id)"
    />
  </div>
</template>

<script setup lang="ts">
import type { FileMetadata } from '#shared/types/files.d'
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { GOOGLE_DRIVE_BRAND_NAME } from '#shared/utils/google-drive'
import { isGoogleWorkbookMapFile } from '#shared/utils/google-sheets'
import type { DriveImportProgress } from '~/composables/chat-drive-files'
import type { AttachedFile } from '~/types/file-manager'
import type {
  FileDeliveryHint,
  FileDeliveryResolver,
} from '~/utils/file-delivery-hints'
import type { UploadingFile } from '~/composables/chat-files'
import type { PastedText } from '~/utils/pasted-text'
import type {
  ChatInputTile,
  ChatInputTileId,
  ToolsSection,
} from '~/types/chat-input-tools'

const props = withDefaults(defineProps<{
  files: (
    Pick<FileMetadata, 'storageKey' | 'name' | 'type' | 'size'>
    & Partial<Pick<
      AttachedFile,
      | 'textStatus'
      | 'textBytes'
      | 'textVersion'
      | 'textTruncated'
      | 'textOmittedMedia'
      | 'textOmittedCharts'
      | 'workbookSummary'
      | 'externalSource'
      | 'sheetsFallback'
    >>
  )[]
  resolveDelivery?: FileDeliveryResolver
  resolveDeliveryWithRunCode?: FileDeliveryResolver
  uploadingFiles?: Map<string, UploadingFile>
  convertedFromXlsKeys?: ReadonlySet<string>
  uploadingCount?: number
  driveImports?: DriveImportProgress[]
  tiles?: ChatInputTile[]
  pastedTexts?: PastedText[]
  checkingLinkCount?: number
}>(), {
  checkingLinkCount: 0,
  resolveDelivery: undefined,
  resolveDeliveryWithRunCode: undefined,
  uploadingFiles: undefined,
  convertedFromXlsKeys: () => new Set<string>(),
  uploadingCount: undefined,
  driveImports: () => [],
  tiles: () => [],
  pastedTexts: () => [],
})

const emit = defineEmits<{
  'dismiss-drive-import': [id: string]
  'pick-again-drive-import': [id: string]
  'remove': [fileId: string]
  'removeAll': []
  'cancel': [fileId: string]
  'retry': [fileId: string]
  'open-text': [storageKey: string]
  'open-pasted': [id: PastedText['id']]
  'remove-pasted': [id: PastedText['id']]
  'open-tile': [
    section: ToolsSection | null,
    origin: HTMLElement,
    id: ChatInputTileId,
  ]
  'remove-tile': [id: ChatInputTileId]
}>()

const GOOGLE_WORKBOOK_MAP_ICON = 'lucide:table-2'

type ChipFile = Pick<
  AttachedFile,
  | 'type'
  | 'textStatus'
  | 'textVersion'
  | 'externalSource'
  | 'sheetsFallback'
>

function hasChipNote(file: ChipFile): boolean {
  return isGoogleWorkbookMapFile(file) || !!file.sheetsFallback
}

function getChipIcon(file: ChipFile): string {
  return isGoogleWorkbookMapFile(file)
    ? GOOGLE_WORKBOOK_MAP_ICON
    : getFileIcon(file.type)
}

function driveCopyLabel(name: string): string {
  return `${name} is a copy of a ${GOOGLE_DRIVE_BRAND_NAME} file`
}

const openDriveImportId = shallowRef<string | null>(null)

const openDriveImport = computed<DriveImportProgress | null>(() => {
  return props.driveImports.find((item) => {
    return item.id === openDriveImportId.value && item.status === 'failed'
  }) ?? null
})

function driveImportNoteId(id: string): string {
  return `drive-import-note-${id}`
}

function toggleDriveImportNote(id: string) {
  openDriveImportId.value = openDriveImportId.value === id ? null : id
}

const driveImportNoteRef
  = useTemplateRef<{ focus: () => void }>('driveImportNoteRef')

const driveImportAnnouncement = computed<string>(() => {
  const item = openDriveImport.value

  if (!item) {
    return ''
  }

  return [item.name, item.error, item.detail && `(${item.detail})`]
    .filter(Boolean)
    .join(': ')
})

function focusDriveImportElement(id: string, selector?: string) {
  const chip = carouselRef.value?.querySelector<HTMLElement>(
    `[data-drive-import-id="${id}"]`,
  )

  const target = selector ? chip?.querySelector<HTMLElement>(selector) : chip

  target?.focus()
}

async function focusAfterDriveImportRemoved() {
  await nextTick()

  const nextChip = carouselRef.value?.querySelector<HTMLElement>(
    '.js-drive-import-error',
  )

  if (nextChip) {
    nextChip.focus()

    return
  }

  document.querySelector<HTMLElement>('.js-chat-input-textarea')?.focus()
}

async function closeDriveImportNote(id: string) {
  openDriveImportId.value = null
  await nextTick()
  focusDriveImportElement(id, '.js-drive-import-error')
}

async function pickDriveImportAgain(id: string) {
  openDriveImportId.value = null
  emit('pick-again-drive-import', id)
  await nextTick()
  focusDriveImportElement(id)
}

async function dismissDriveImport(id: string) {
  openDriveImportId.value = null
  emit('dismiss-drive-import', id)
  await focusAfterDriveImportRemoved()
}

watch(() => openDriveImport.value?.id, async (id) => {
  if (!id) {
    return
  }

  await nextTick()
  driveImportNoteRef.value?.focus()
}, { flush: 'post' })

const deliveryHints = computed<Map<string, FileDeliveryHint>>(() => {
  const hints = new Map<string, FileDeliveryHint>()
  const resolve = props.resolveDelivery

  if (!resolve) {
    return hints
  }

  for (const file of props.files) {
    const hint = getFileDeliveryHint(
      file,
      resolve,
      props.resolveDeliveryWithRunCode,
      { spreadsheetNote: true },
    )

    if (hint) {
      hints.set(file.storageKey, hint)
    }
  }

  return hints
})

const hintNoteId = useId()
const openHintKey = shallowRef<string | null>(null)

const openHint = computed<{ name: string, description: string } | null>(() => {
  const key = openHintKey.value

  if (key === null) {
    return null
  }

  const file = props.files.find(item => item.storageKey === key)
  const hint = deliveryHints.value.get(key)

  if (!file || !hint) {
    return null
  }

  return { name: file.name, description: hint.description }
})

function toggleHint(storageKey: string) {
  openHintKey.value = openHintKey.value === storageKey ? null : storageKey
}

function hintTitle(storageKey: string): string | undefined {
  const hint = deliveryHints.value.get(storageKey)

  if (!hint) {
    return undefined
  }

  return hint.description ? `${hint.label}: ${hint.description}` : hint.label
}

const carouselRef = useTemplateRef<HTMLDivElement>('carouselRef')
const detachAllItemRef = useTemplateRef<HTMLDivElement>('detachAllItemRef')

const uploadingFilesArray = computed<UploadingFile[]>(() => {
  if (!props.uploadingFiles) {
    return []
  }

  return Array.from(props.uploadingFiles.values()).filter((file) => {
    return file.status !== 'completed'
  })
})

const hasAnyFiles = computed<boolean>(() => {
  return props.files.length > 0
    || uploadingFilesArray.value.length > 0
    || props.driveImports.length > 0
    || props.pastedTexts.length > 0
})

const hasAnyItems = computed<boolean>(() => {
  return hasAnyFiles.value
    || props.checkingLinkCount > 0
    || props.tiles.length > 0
})

const attachmentsLabel = computed<string>(() => {
  const pastedTextsCount = props.pastedTexts.length

  if (!pastedTextsCount) {
    return totalFilesCount.value === 1 ? 'File' : 'Files'
  }

  if (totalFilesCount.value) {
    return 'Files and pasted text'
  }

  return pastedTextsCount === 1 ? 'Pasted text' : 'Pasted texts'
})

const regionLabel = computed<string>(() => {
  if (!props.tiles.length) {
    return attachmentsLabel.value
  }

  return hasAnyFiles.value
    ? `Active settings and ${attachmentsLabel.value.toLowerCase()}`
    : 'Active settings'
})

const totalFilesCount = computed<number>(() => {
  return props.files.length + uploadingFilesArray.value.length
})

const showRemoveAll = computed<boolean>(() => {
  return totalFilesCount.value > 1
})

const END_FADE_THRESHOLD_PX = 2
const END_FADE_MASK_CLASS
  = '[mask-image:linear-gradient(to_right,#000_calc(100%-1.75rem),transparent)]'
const hasHiddenContentOnRight = shallowRef<boolean>(false)

const isEndFadeVisible = computed<boolean>(() => {
  return hasHiddenContentOnRight.value && !showRemoveAll.value
})

function updateHiddenContentOnRight() {
  const carousel = carouselRef.value

  if (!carousel) {
    hasHiddenContentOnRight.value = false

    return
  }

  const hiddenWidth = carousel.scrollWidth
    - carousel.scrollLeft
    - carousel.clientWidth

  hasHiddenContentOnRight.value = hiddenWidth > END_FADE_THRESHOLD_PX
}

/**
 * Lets a mouse wheel scroll the row sideways. Only a mostly vertical wheel
 * on a row that can still move is captured, so the page keeps scrolling
 * once the row reaches either end.
 */
function scrollCarouselWithWheel(event: WheelEvent) {
  const carousel = carouselRef.value

  if (!carousel || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
    return
  }

  const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth
  const nextScrollLeft = Math.min(
    maxScrollLeft,
    Math.max(0, carousel.scrollLeft + event.deltaY),
  )

  if (maxScrollLeft <= 0 || nextScrollLeft === carousel.scrollLeft) {
    return
  }

  event.preventDefault()
  carousel.scrollLeft = nextScrollLeft
}

useEventListener(carouselRef, 'scroll', updateHiddenContentOnRight, {
  passive: true,
})
useEventListener(carouselRef, 'wheel', scrollCarouselWithWheel, {
  passive: false,
})
useResizeObserver(carouselRef, updateHiddenContentOnRight)

watch(
  [
    () => props.tiles.length,
    () => props.pastedTexts.length,
    totalFilesCount,
    carouselRef,
  ],
  async () => {
    await nextTick()
    updateHiddenContentOnRight()
  },
  { flush: 'post' },
)

const uploadStatusAnnouncement = computed<string>(() => {
  const uploadingCount = props.uploadingCount || 0
  const totalUploading = props.uploadingFiles?.size || 0

  if (uploadingCount > 0) {
    return `Uploading ${uploadingCount} of ${totalUploading} files`
  } else if (totalUploading > 0 && uploadingCount === 0) {
    return `All ${totalUploading} files uploaded successfully`
  }

  return ''
})

const statusAnnouncement = computed<string>(() => {
  return driveImportAnnouncement.value || uploadStatusAnnouncement.value
})

const currentUploadingId = computed<string | undefined>(() => {
  return uploadingFilesArray.value.find((file) => {
    return file.status === 'uploading'
  })?.id
})

async function waitForFrame() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

async function revealCarouselItem(uploadingId: string) {
  await waitForFrame()

  const carousel = carouselRef.value

  if (!carousel) return

  const item = Array.from(carousel.children).find((child) => {
    return child instanceof HTMLElement
      && child.dataset.uploadingId === uploadingId
  })

  if (!(item instanceof HTMLElement)) return

  const carouselRect = carousel.getBoundingClientRect()
  const removeAllItem = detachAllItemRef.value
  const hasOverflow = carousel.scrollWidth > carousel.clientWidth
  const removeAllWidth = removeAllItem && hasOverflow
    ? removeAllItem.getBoundingClientRect().width
    : 0
  const effectiveRight = carouselRect.right - removeAllWidth
  const itemRect = item.getBoundingClientRect()
  const hiddenRight = itemRect.right - effectiveRight

  if (hiddenRight <= 0) return

  const carouselItems = Array.from(carousel.children).filter((child) => {
    return child instanceof HTMLElement
      && child !== removeAllItem
  })
  const firstVisibleIndex = carouselItems.findIndex((carouselItem) => {
    const carouselItemRect = carouselItem.getBoundingClientRect()

    return carouselItemRect.right > carouselRect.left
  })
  const stepItem = firstVisibleIndex >= 0
    ? carouselItems[firstVisibleIndex + 1]
    : undefined
  const targetItem = stepItem instanceof HTMLElement
    ? stepItem
    : item

  carousel.scrollTo({
    left: Math.min(targetItem.offsetLeft, item.offsetLeft),
    behavior: 'smooth',
  })
}

async function revealCarouselEnd() {
  await waitForFrame()

  const carousel = carouselRef.value

  if (!carousel) return

  const removeAllItem = detachAllItemRef.value

  if (!removeAllItem) return

  const carouselRect = carousel.getBoundingClientRect()
  const removeAllRect = removeAllItem.getBoundingClientRect()
  const hiddenRight = removeAllRect.right - carouselRect.right

  if (hiddenRight <= 0) return

  carousel.scrollTo({
    left: carousel.scrollWidth - carousel.clientWidth,
    behavior: 'smooth',
  })
}

async function removeAttachedFile(storageKey: FileMetadata['storageKey']) {
  const result = await useConfirm({
    text: 'Are you sure you want to detach this file?',
    actions: ['Confirm'],
  })

  if (!result) return

  emit('remove', storageKey)
}

async function removeAllFiles() {
  const result = await useConfirm({
    text: `Detach all ${totalFilesCount.value} files?`,
    actions: ['Confirm'],
  })

  if (!result) return

  emit('removeAll')
}

watch(currentUploadingId, (newId, oldId) => {
  if (newId) {
    revealCarouselItem(newId)
  } else if (oldId) {
    revealCarouselEnd()
  }
}, {
  flush: 'post',
})

</script>
