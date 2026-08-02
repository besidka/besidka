<template>
  <section class="grid place-items-center gap-2 pt-4">
    <SvgoAnthropic class="!size-16" />
    <h3 class="text-2xl font-bold">Anthropic</h3>
    <p>Manage your Anthropic (Claude) API key here</p>
    <UiForm
      ref="form"
      class="w-full"
      @submit="updateKeys"
    >
      <UiFormFieldset>
        <UiFormInput
          ref="apiKeyInput"
          v-model="apiKey"
          autocomplete="off"
          type="password"
          label="API Key"
          placeholder="sk-ant-api03-xxxx...-xxxx..."
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
              Get your API key from Anthropic:
              <NuxtLink
                to="https://platform.claude.com/settings/workspaces/default/keys"
                external
                target="_blank"
              >
                https://platform.claude.com/settings/workspaces/default/keys
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
            @click="onDeleteKeys"
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
import UiForm from '~/components/ui/Form.vue'
import UiFormInput from '~/components/ui/Form/Input.vue'

const {
  data: fetchedApiKey,
  error,
  refresh,
} = await useFetch('/api/v1/profiles/keys/anthropic')

if (error.value) {
  // eslint-disable-next-line no-console
  console.warn('Failed to fetch Anthropic keys', error.value)
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

async function updateKeys() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/anthropic', {
      method: 'post',
      body: {
        apiKey: apiKey.value,
      },
    })
    await refresh()
    form.value?.resetValidation()
    useSuccessMessage('Anthropic API key updated successfully')
  } catch (exception) {
    useErrorMessage('Failed to update Anthropic API key')
    // eslint-disable-next-line no-console
    console.error('Failed to update Anthropic API key', exception)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update Anthropic API key',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

async function deleteKeys() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/anthropic', {
      method: 'delete',
    })
    await refresh()
    useSuccessMessage('Anthropic keys deleted successfully')
    apiKey.value = ''
    await nextTick()
    form.value?.resetValidation()
  } catch (exception) {
    useErrorMessage('Failed to delete Anthropic API key')
    // eslint-disable-next-line no-console
    console.error('Failed to delete Anthropic API key', exception)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete Anthropic API key',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

async function onDeleteKeys() {
  const result = await useConfirm({
    text: 'Are you sure you want to delete your Anthropic API key?',
    actions: ['Confirm'],
  })

  if (!result) return

  await deleteKeys()
}
</script>
