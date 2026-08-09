<template>
  <section class="grid place-items-center gap-2 pt-4">
    <ProviderIcon
      provider-id="cloudflare"
      class="!size-16"
    />
    <h3 class="text-2xl font-bold">{{ meta.label }}</h3>
    <p>Manage your {{ meta.label }} credentials here</p>
    <UiForm
      ref="form"
      class="w-full"
      @submit="updateCredentials"
    >
      <UiFormFieldset>
        <UiFormInput
          v-model="accountId"
          autocomplete="off"
          label="Account ID"
          placeholder="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
          :rules="[Validation.required()]"
          :disabled="pending"
        />
        <UiFormInput
          v-model="gatewayId"
          autocomplete="off"
          label="Gateway ID"
          placeholder="default"
          :disabled="pending"
          note="Optional — leave blank to use your account's default gateway"
        />
        <UiFormInput
          ref="apiKeyInput"
          v-model="apiKey"
          autocomplete="off"
          type="password"
          label="API Token"
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
              Create a Cloudflare API token scoped to "Workers AI - Read" and
              find your Account ID at:
              <NuxtLink
                :to="meta.dashboardUrl"
                external
                target="_blank"
              >
                {{ meta.dashboardLabel || meta.dashboardUrl }}
              </NuxtLink>
              . The token must be re-entered every time you save, even if
              you're only updating the Account ID or Gateway ID —
              {{ meta.label }} never sends a saved token back to the browser.
            </span>
          </template>
        </UiFormInput>
        <div class="max-md:grid md:flex md:place-content-end gap-2">
          <UiButton
            v-if="hasKey"
            mode="error"
            text="Delete"
            icon-name="lucide:trash"
            :disabled="pending"
            class="w-full"
            outline
            @click="onDeleteCredentials"
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
import { providerMeta } from '#shared/utils/provider-meta'
import UiForm from '~/components/ui/Form.vue'
import UiFormInput from '~/components/ui/Form/Input.vue'

interface CloudflareGatewayKeyResponse {
  accountId: string
  gatewayId: string
  hasKey: boolean
}

const meta = providerMeta.cloudflare!
const keyRoute = '/api/v1/profiles/keys/cloudflare-gateway'

const {
  data: fetchedCredentials,
  error,
  refresh,
} = await useFetch<CloudflareGatewayKeyResponse>(keyRoute)

if (error.value) {
  const parsedException = parseError(error.value)

  useErrorMessage(
    parsedException.message || `Failed to fetch ${meta.label} credentials`,
    parsedException.why,
  )
}

const form = ref<InstanceType<typeof UiForm> | null>()
const apiKeyInput = ref<InstanceType<typeof UiFormInput> | null>()

const { Validation } = useValidation()
const { paste } = useClipboardWithPaste()
const { refresh: refreshUserKeys } = useUserKeys()

const accountId = shallowRef<string>(
  fetchedCredentials.value?.accountId || '',
)
const gatewayId = shallowRef<string>(
  fetchedCredentials.value?.gatewayId || '',
)
const apiKey = shallowRef<string>('')
const hasKey = shallowRef<boolean>(fetchedCredentials.value?.hasKey ?? false)

const pending = shallowRef<boolean>(false)

async function pasteApiKey() {
  apiKey.value = await paste()
  await nextTick()
  apiKeyInput.value?.dispatchChange()
}

async function updateCredentials() {
  pending.value = true

  try {
    await $fetch(keyRoute, {
      method: 'post',
      body: {
        accountId: accountId.value,
        gatewayId: gatewayId.value || undefined,
        apiKey: apiKey.value,
      },
    })
    await refresh()
    await refreshUserKeys()
    hasKey.value = true
    apiKey.value = ''
    useSuccessMessage(`${meta.label} credentials updated successfully`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message
      || `Failed to update ${meta.label} credentials`,
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}

async function deleteCredentials() {
  pending.value = true

  try {
    await $fetch(keyRoute, {
      method: 'delete',
    })
    await refresh()
    await refreshUserKeys()
    useSuccessMessage(`${meta.label} credentials deleted successfully`)
    accountId.value = ''
    gatewayId.value = ''
    apiKey.value = ''
    hasKey.value = false
    await nextTick()
    form.value?.resetValidation()
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message
      || `Failed to delete ${meta.label} credentials`,
      parsedException.why,
    )
  } finally {
    pending.value = false
  }
}

async function onDeleteCredentials() {
  const result = await useConfirm({
    text: `Are you sure you want to delete your ${meta.label} credentials?`,
    actions: ['Confirm'],
  })

  if (!result) return

  await deleteCredentials()
}
</script>
