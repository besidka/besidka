<template>
  <ProfileKeysCard
    :provider-id="providerId"
    :label="meta.label"
    :status="status"
    :group="group"
    :open="open"
  >
    <UiForm
      ref="form"
      class="!p-0"
      @submit="updateKey"
    >
      <UiFormFieldset>
        <UiFormInput
          ref="apiKeyInput"
          v-model="apiKey"
          autocomplete="off"
          type="password"
          label="API Key"
          data-testid="api-key-field"
          :placeholder="placeholder"
          :rules="[Validation.required()]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              name="lucide:key-round"
              size="16"
            />
          </template>
          <template #labelAfter>
            <UiButton
              mode="default"
              text="Paste"
              icon-name="lucide:clipboard-paste"
              :icon-size="16"
              icon-only
              circle
              ghost
              size="xs"
              tooltip-position="left"
              @click="pasteApiKey"
            />
          </template>
          <template #noteAfter>
            <span class="block">
              Get your API key from {{ meta.label }}:
              <NuxtLink
                :to="meta.dashboardUrl"
                class="link"
                external
                target="_blank"
              >
                {{ meta.dashboardLabel || meta.dashboardUrl }}
              </NuxtLink>
            </span>
            <span
              v-if="status === 'saved'"
              class="mt-1 block"
            >
              A saved key is never sent back to the browser — enter a new one
              to replace it.
            </span>
          </template>
        </UiFormInput>
        <div class="max-md:grid md:flex md:place-content-end gap-2">
          <UiButton
            v-if="status === 'saved'"
            mode="error"
            text="Delete"
            icon-name="lucide:trash"
            :disabled="pending"
            class="w-full"
            outline
            @click="onDeleteKey"
          />
          <UiButton
            type="submit"
            text="Save"
            icon-name="lucide:cloud-upload"
            :disabled="pending"
            class="w-full"
          />
        </div>
      </UiFormFieldset>
    </UiForm>
  </ProfileKeysCard>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { ProviderMeta } from '#shared/utils/provider-meta'
import { defaultKeyPlaceholder, providerMeta } from '#shared/utils/provider-meta'
import type { UserKeyStatus } from '~/composables/user-keys'
import UiForm from '~/components/ui/Form.vue'
import UiFormInput from '~/components/ui/Form/Input.vue'

const props = withDefaults(defineProps<{
  providerId: string
  group?: string
  open?: boolean
}>(), {
  group: undefined,
  open: false,
})

const meta = computed<ProviderMeta>(() => {
  const providerMetaEntry = providerMeta[props.providerId]

  if (!providerMetaEntry) {
    throw new Error(`Unknown provider id: ${props.providerId}`)
  }

  return providerMetaEntry
})

const keyRoute = computed<string>(() => {
  return `/api/v1/profiles/keys/${meta.value.keyProviderId}`
})

const form = ref<InstanceType<typeof UiForm> | null>()
const apiKeyInput = ref<InstanceType<typeof UiFormInput> | null>()

const { Validation } = useValidation()
const { paste } = useClipboardWithPaste()
const {
  keyStatusForProvider,
  refresh: refreshUserKeys,
} = useUserKeys()

const apiKey = shallowRef<string>('')
const pending = shallowRef<boolean>(false)

const status = computed<UserKeyStatus>(() => {
  return keyStatusForProvider(props.providerId)
})

const placeholder = computed<string>(() => {
  if (status.value === 'saved') {
    return 'Enter a new key to replace the saved one'
  }

  return meta.value.keyPlaceholder || defaultKeyPlaceholder
})

async function pasteApiKey() {
  apiKey.value = await paste()
  await nextTick()
  apiKeyInput.value?.dispatchChange()
}

async function updateKey() {
  pending.value = true

  try {
    await $fetch(keyRoute.value, {
      method: 'post',
      body: {
        apiKey: apiKey.value,
      },
    })
    await refreshUserKeys()
    apiKey.value = ''
    await nextTick()
    form.value?.resetValidation()
    useSuccessMessage(`${meta.value.label} API key updated successfully`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message
      || `Failed to update ${meta.value.label} API key`,
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}

async function deleteKey() {
  pending.value = true

  try {
    await $fetch(keyRoute.value, {
      method: 'delete',
    })
    await refreshUserKeys()
    useSuccessMessage(`${meta.value.label} API key deleted successfully`)
    apiKey.value = ''
    await nextTick()
    form.value?.resetValidation()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message
      || `Failed to delete ${meta.value.label} API key`,
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}

async function onDeleteKey() {
  const result = await useConfirm({
    text: `Are you sure you want to delete your ${meta.value.label} API key?`,
    actions: ['Confirm'],
  })

  if (!result) return

  await deleteKey()
}
</script>
