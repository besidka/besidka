<template>
  <section class="grid place-items-center gap-2 pt-4">
    <ProviderIcon
      :provider-id="providerId"
      class="!size-16"
    />
    <h3 class="text-2xl font-bold">{{ meta.label }}</h3>
    <p>Manage your {{ meta.label }} API key here</p>
    <UiForm
      ref="form"
      class="w-full"
      @submit="updateKey"
    >
      <UiFormFieldset>
        <UiFormInput
          ref="apiKeyInput"
          v-model="apiKey"
          autocomplete="off"
          type="password"
          label="API Key"
          placeholder="xxxx..."
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
              size="sm"
              @click="pasteApiKey"
            />
          </template>
          <template #noteAfter>
            <span>
              Get your API key from {{ meta.label }}:
              <NuxtLink
                :to="meta.dashboardUrl"
                external
                target="_blank"
              >
                {{ meta.dashboardLabel || meta.dashboardUrl }}
              </NuxtLink>
            </span>
          </template>
        </UiFormInput>
        <div class="max-md:grid md:flex md:place-content-end gap-2">
          <UiButton
            v-if="apiKey"
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
  </section>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { ProviderMeta } from '#shared/utils/provider-meta'
import { providerMeta } from '#shared/utils/provider-meta'
import UiForm from '~/components/ui/Form.vue'
import UiFormInput from '~/components/ui/Form/Input.vue'

const props = defineProps<{
  providerId: string
}>()

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

const {
  data: fetchedApiKey,
  error,
  refresh,
} = await useFetch<string>(keyRoute)

if (error.value) {
  const parsedException = parseError(error.value)

  useErrorMessage(
    parsedException.message || `Failed to fetch ${meta.value.label} key`,
    parsedException.why,
  )
}

const form = ref<InstanceType<typeof UiForm> | null>()
const apiKeyInput = ref<InstanceType<typeof UiFormInput> | null>()

const { Validation } = useValidation()
const { paste } = useClipboardWithPaste()

const apiKey = shallowRef<string>(fetchedApiKey.value || '')

const pending = shallowRef<boolean>(false)

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
    await refresh()
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
    await refresh()
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
