<template>
  <details
    ref="dropdownRef"
    class="dropdown dropdown-bottom dropdown-end group relative z-20 open:z-40"
  >
    <UiButton
      tag="summary"
      mode="default"
      ghost
      icon-name="lucide:download"
      :icon-size="14"
      size="xs"
      text="Export"
      icon-only-phone
      :disabled="isDisabled"
      data-testid="mermaid-export"
    />
    <div class="dropdown-content z-50 w-56 pt-2">
      <ul
        tabindex="0"
        class="menu menu-sm bg-base-100 rounded-box shadow-lg w-56 p-1"
      >
        <template v-for="group in groups" :key="group.title">
          <li class="menu-title">
            {{ group.title }}
          </li>
          <li v-for="item in group.items" :key="item.action">
            <button
              type="button"
              :data-testid="`mermaid-export-${item.action}`"
              @click="onAction(item.action)"
            >
              <Icon :name="item.icon" size="14" />
              {{ item.label }}
            </button>
          </li>
        </template>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { DiagramExportAction } from '~/types/diagram-export.d'

interface ExportItem {
  action: DiagramExportAction
  label: string
  icon: string
}

interface ExportGroup {
  title: string
  items: ExportItem[]
}

const props = defineProps<{
  source: string
  svg: string
  themeElement: () => HTMLElement | null
}>()

const SUCCESS_MESSAGES: Partial<Record<DiagramExportAction, string>> = {
  'copy-svg': 'SVG copied',
  'copy-markdown': 'Markdown copied',
  'copy-drawio': 'Copied for draw.io — paste into draw.io',
}

const FAILURE_MESSAGE: string = 'Couldn\'t export diagram'

const groups: ExportGroup[] = [
  {
    title: 'Copy',
    items: [
      { action: 'copy-svg', label: 'SVG', icon: 'lucide:copy' },
      { action: 'copy-markdown', label: 'Markdown', icon: 'lucide:copy' },
      { action: 'copy-drawio', label: 'For draw.io', icon: 'lucide:copy' },
    ],
  },
  {
    title: 'Download',
    items: [
      { action: 'download-svg', label: 'SVG', icon: 'lucide:download' },
      { action: 'download-png', label: 'PNG', icon: 'lucide:image' },
      { action: 'download-drawio', label: '.drawio', icon: 'lucide:download' },
    ],
  },
  {
    title: 'Open',
    items: [
      {
        action: 'open-drawio',
        label: 'Open in draw.io',
        icon: 'lucide:external-link',
      },
    ],
  },
]

const { runExportAction } = useDiagramExport()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')

const isDisabled = computed<boolean>(() => {
  return !props.svg
})

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
  }
}

async function reportOutcome(
  action: DiagramExportAction,
  outcome: boolean | Promise<boolean>,
) {
  const isSuccess = await outcome

  if (!isSuccess) {
    useErrorMessage(FAILURE_MESSAGE)

    return
  }

  const message = SUCCESS_MESSAGES[action]

  if (message) {
    useSuccessMessage(message)
  }
}

function onAction(action: DiagramExportAction) {
  const themeElement = props.themeElement()

  if (isDisabled.value || !themeElement) {
    closeDropdown()
    useErrorMessage(FAILURE_MESSAGE)

    return
  }

  const outcome = runExportAction(action, {
    source: props.source,
    svg: props.svg,
    themeElement,
  })

  closeDropdown()
  reportOutcome(action, outcome)
}
</script>
