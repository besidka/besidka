<template>
  <ProfileConnectorsDialog
    :title="registryFeature.active ? 'Add by URL' : 'Add connector'"
    hook-class="js-connector-add-modal"
    test-id="connector-add-dialog"
    @close="emit('close')"
  >
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div
        v-if="tabOptions.length > 1"
        class="tabs tabs-box tabs-sm w-full"
        role="tablist"
        aria-label="How to add a connector"
      >
        <button
          v-for="option in tabOptions"
          :id="`connector-add-tab-${option.id}`"
          :key="option.id"
          type="button"
          role="tab"
          class="tab grow min-h-11 sm:min-h-8"
          :class="{ 'tab-active': tab === option.id }"
          :aria-selected="tab === option.id"
          :aria-controls="`connector-add-panel-${option.id}`"
          :tabindex="tab === option.id ? 0 : -1"
          :data-testid="`connector-add-tab-${option.id}`"
          @click="selectTab(option.id)"
          @keydown="onTabKeydown"
        >
          {{ option.label }}
        </button>
      </div>

      <div
        :id="`connector-add-panel-${tab}`"
        role="tabpanel"
        :aria-labelledby="`connector-add-tab-${tab}`"
        class="grid grid-cols-[minmax(0,1fr)] gap-3"
      >
        <template v-if="tab === 'presets'">
          <ul
            class="grid gap-2 sm:grid-cols-2"
            data-testid="connector-add-presets"
          >
            <ProfileConnectorsPresetCard
              v-for="preset in CONNECTOR_PRESETS"
              :key="preset.id"
              :preset="preset"
              :is-added="addedPresetIds.has(preset.id)"
              @add="pickPreset"
            />
          </ul>
          <p class="text-xs text-base-content/70">
            {{ CONNECTOR_CATALOG_FOOTER }}
          </p>
        </template>

        <form
          v-else-if="tab === 'url'"
          class="grid gap-3"
          novalidate
          data-testid="connector-add-url-form"
          @submit.prevent="pickUrl"
        >
          <div class="grid gap-1">
            <label
              for="connector-add-url"
              class="text-sm font-medium"
            >
              Server address
            </label>
            <input
              id="connector-add-url"
              v-model="url"
              type="url"
              inputmode="url"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="https://mcp.example.com/mcp"
              class="input w-full"
              :class="{ 'input-error': !!urlError }"
              :aria-invalid="!!urlError"
              :aria-describedby="urlError
                ? 'connector-add-url-error'
                : 'connector-add-url-help'"
              data-testid="connector-add-url"
            >
            <p
              v-if="urlError"
              id="connector-add-url-error"
              class="text-sm text-error"
              role="alert"
              data-testid="connector-add-url-error"
            >
              {{ urlError }}
            </p>
            <p
              v-else
              id="connector-add-url-help"
              class="text-xs text-base-content/70"
            >
              The https address of a remote MCP server. Besidka checks that it
              answers in the next step and saves it only after you connect.
            </p>
          </div>
          <div class="grid gap-1">
            <label
              for="connector-add-title"
              class="text-sm font-medium"
            >
              Name (optional)
            </label>
            <input
              id="connector-add-title"
              v-model="title"
              type="text"
              maxlength="80"
              autocomplete="off"
              class="input w-full"
              data-testid="connector-add-title"
            >
          </div>
          <button
            type="submit"
            class="btn btn-primary min-h-11 sm:min-h-8"
            :disabled="!url.trim()"
            data-testid="connector-add-url-submit"
          >
            Continue
          </button>
        </form>
      </div>

      <p class="text-xs text-base-content/70">
        A connector's server gets the arguments the model writes into each
        call. Read the
        <NuxtLink
          to="/privacy-policy"
          class="link"
        >Privacy Policy</NuxtLink>
        before you connect one.
      </p>
    </div>
  </ProfileConnectorsDialog>
</template>

<script setup lang="ts">
import {
  CONNECTOR_CATALOG_FOOTER,
  CONNECTOR_PRESETS,
} from '~~/config/connectors-catalog'

type AddTab = 'presets' | 'url' | 'directory'
type DialogTab = 'presets' | 'url'

const props = defineProps<{
  addedPresetIds: ReadonlySet<string>
  initialTab?: AddTab
}>()

const emit = defineEmits<{
  picked: [draft: ConnectorDraft]
  close: []
}>()

const registryFeature = useFeature('connectors.registry')
const tab = shallowRef<DialogTab>(resolveInitialTab())
const url = shallowRef<string>('')
const title = shallowRef<string>('')
const urlError = shallowRef<string>('')

const tabOptions = computed<Array<{ id: DialogTab, label: string }>>(() => {
  return registryFeature.value.active
    ? [{ id: 'url', label: 'Add by URL' }]
    : [
      { id: 'presets', label: 'Presets' },
      { id: 'url', label: 'Add by URL' },
    ]
})

const addedPresetIds = computed<ReadonlySet<string>>(() => {
  return props.addedPresetIds
})

function resolveInitialTab(): DialogTab {
  if (props.initialTab === 'url' || registryFeature.value.active) {
    return 'url'
  }

  return 'presets'
}

function selectTab(next: DialogTab) {
  tab.value = next
  urlError.value = ''
}

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }

  const options = tabOptions.value
  const currentIndex = options.findIndex(option => option.id === tab.value)
  const step = event.key === 'ArrowRight' ? 1 : -1
  const next = options[(currentIndex + step + options.length) % options.length]!

  event.preventDefault()
  selectTab(next.id)
  await nextTick()
  document.getElementById(`connector-add-tab-${next.id}`)?.focus()
}

function pickPreset(presetId: string) {
  emit('picked', { presetId })
}

function pickUrl() {
  const address = url.value.trim()

  urlError.value = ''

  if (!address.toLowerCase().startsWith('https://')) {
    urlError.value = 'Use the server\'s public https address.'

    return
  }

  emit('picked', {
    url: address,
    ...(title.value.trim() ? { title: title.value.trim() } : {}),
  })
}
</script>
