<template>
  <ProfileConnectorsDialog
    title="Add connector"
    hook-class="js-connector-add-modal"
    test-id="connector-add-dialog"
    :is-busy="isSubmitting"
    @close="emit('close')"
  >
    <div class="grid gap-4">
      <div
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
          :disabled="isSubmitting"
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
        class="grid gap-3"
      >
        <template v-if="tab === 'presets'">
          <ul
            class="grid gap-2 sm:grid-cols-2"
            data-testid="connector-add-presets"
          >
            <li
              v-for="preset in CONNECTOR_PRESETS"
              :key="preset.id"
              class="card card-border card-sm"
              :data-testid="`connector-preset-${preset.id}`"
            >
              <div class="card-body gap-2">
                <div class="flex items-center gap-3">
                  <ProfileConnectorsAvatar :title="preset.title" />
                  <div class="min-w-0 grow">
                    <p class="truncate font-medium">
                      {{ preset.title }}
                    </p>
                    <p class="text-xs text-base-content/70">
                      {{ authHint(preset.auth) }}
                    </p>
                  </div>
                </div>
                <p
                  v-if="preset.notice"
                  class="text-xs text-base-content/70"
                >
                  {{ preset.notice }}
                </p>
                <button
                  type="button"
                  class="btn btn-sm min-h-11 sm:min-h-8"
                  :disabled="isSubmitting || addedPresetIds.has(preset.id)"
                  :data-testid="`connector-preset-add-${preset.id}`"
                  @click="addPreset(preset.id)"
                >
                  {{ addedPresetIds.has(preset.id) ? 'Added' : 'Add' }}
                </button>
              </div>
            </li>
          </ul>
          <p class="text-xs text-base-content/70">
            {{ CONNECTOR_CATALOG_FOOTER }}
          </p>
          <p
            v-if="presetError"
            class="text-sm text-error"
            role="alert"
            data-testid="connector-preset-error"
          >
            {{ presetError }}
          </p>
        </template>

        <form
          v-else-if="tab === 'url'"
          class="grid gap-3"
          novalidate
          data-testid="connector-add-url-form"
          @submit.prevent="addByUrl"
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
              :disabled="isSubmitting"
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
              The https address of a remote MCP server. Adding it sends
              nothing; you connect it in the next step.
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
              :disabled="isSubmitting"
              data-testid="connector-add-title"
            >
          </div>
          <button
            type="submit"
            class="btn btn-primary min-h-11 sm:min-h-8"
            :disabled="isSubmitting || !url.trim()"
            data-testid="connector-add-url-submit"
          >
            <span
              v-if="isSubmitting"
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            />
            Add
          </button>
        </form>

        <template v-else>
          <ProfileConnectorsRegistrySearch
            :added-preset-ids="addedPresetIds"
            :is-adding="isSubmitting"
            @add="addFromDirectory"
          />
          <p
            v-if="directoryError"
            class="text-sm text-error"
            role="alert"
            data-testid="connector-registry-add-error"
          >
            {{ directoryError }}
          </p>
        </template>
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
import { parseError } from 'evlog'
import {
  CONNECTOR_CATALOG_FOOTER,
  CONNECTOR_PRESETS,
} from '~~/config/connectors-catalog'
import type { ConnectorPreset } from '~~/config/connectors-catalog'
import type { ConnectorDirectoryItem } from '#shared/types/connectors.d'

type AddTab = 'presets' | 'url' | 'directory'

const props = withDefaults(defineProps<{
  addedPresetIds: ReadonlySet<string>
  initialTab?: AddTab
}>(), {
  initialTab: 'presets',
})

const emit = defineEmits<{
  added: [connectorId: string]
  close: []
}>()

const registryFeature = useFeature('connectors.registry')
const tab = shallowRef<AddTab>(
  props.initialTab === 'directory' && !registryFeature.value.active
    ? 'presets'
    : props.initialTab,
)
const url = shallowRef<string>('')
const title = shallowRef<string>('')
const urlError = shallowRef<string>('')
const presetError = shallowRef<string>('')
const directoryError = shallowRef<string>('')
const isSubmitting = shallowRef<boolean>(false)

const tabOptions = computed<Array<{ id: AddTab, label: string }>>(() => {
  return [
    { id: 'presets', label: 'Presets' },
    { id: 'url', label: 'Add by URL' },
    ...(registryFeature.value.active
      ? [{ id: 'directory' as const, label: 'Directory' }]
      : []),
  ]
})

const addedPresetIds = computed<ReadonlySet<string>>(() => {
  return props.addedPresetIds
})

function authHint(auth: ConnectorPreset['auth']): string {
  const labels = auth.map((kind) => {
    return kind === 'oauth' ? 'Sign in' : 'API key or token'
  })

  return labels.join(' or ')
}

function selectTab(next: AddTab) {
  tab.value = next
  urlError.value = ''
  presetError.value = ''
  directoryError.value = ''
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

function describeError(exception: unknown, fallback: string): string {
  const parsedException = parseError(exception)
  const message = parsedException.message || fallback

  return parsedException.fix ? `${message}. ${parsedException.fix}.` : message
}

async function create(body: Record<string, string>) {
  const result = await $fetch('/api/v1/connectors', {
    method: 'POST',
    body,
  })

  await refreshConnectors()
  emit('added', result.connector.id)
}

async function addPreset(presetId: string) {
  isSubmitting.value = true
  presetError.value = ''

  try {
    await create({ presetId })
  } catch (exception) {
    presetError.value = describeError(exception, 'Could not add the connector')
  } finally {
    isSubmitting.value = false
  }
}

async function addFromDirectory(item: ConnectorDirectoryItem) {
  isSubmitting.value = true
  directoryError.value = ''

  try {
    await create(item.presetId
      ? { presetId: item.presetId }
      : { registryId: item.id })
  } catch (exception) {
    directoryError.value = describeError(
      exception,
      'Could not add the connector',
    )
  } finally {
    isSubmitting.value = false
  }
}

async function addByUrl() {
  const address = url.value.trim()

  urlError.value = ''

  if (!address.toLowerCase().startsWith('https://')) {
    urlError.value = 'Use the server\'s public https address.'

    return
  }

  isSubmitting.value = true

  try {
    await create({
      url: address,
      ...(title.value.trim() ? { title: title.value.trim() } : {}),
    })
  } catch (exception) {
    urlError.value = describeError(exception, 'Could not add the connector')
  } finally {
    isSubmitting.value = false
  }
}
</script>
