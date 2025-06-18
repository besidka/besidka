<template>
  <section class="grid place-items-center gap-2 pt-4">
    <SvgoGemini class="!w-24 !h-auto !mb-4" />
    <h3 class="text-2xl font-bold">Google AI Studio</h3>
    <p>Manage your Google AI Studio API key here</p>
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
            <NuxtLink
              to="https://aistudio.google.com/app/apikey"
              external
              target="_blank"
            >
              Get your API key from Google AI Studio: https://aistudio.google.com/app/apikey
            </NuxtLink>
          </template>
        </UiFormInput>
        <div class="max-md:grid md:flex md:place-content-end gap-2">
          <UiButton
            v-if="fetchedKeys?.apiKey"
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
import UiForm from '~/components/ui/Form.vue'
import UiFormInput from '~/components/ui/Form/Input.vue'

const { data: fetchedKeys, error, refresh } = await useFetch('/api/v1/profiles/keys/google')

if (error.value) {
  // eslint-disable-next-line no-console
  console.warn('Failed to fetch Google AI Studio keys')
}

const form = ref<InstanceType<typeof UiForm> | null>()
const apiKeyInput = ref<InstanceType<typeof UiFormInput> | null>()

const { Validation } = useValidation()
const { paste } = useClipboardWithPaste()

const apiKey = shallowRef<string>((fetchedKeys.value as any)?.apiKey || '')

const pending = shallowRef<boolean>(false)

async function pasteApiKey() {
  apiKey.value = await paste()
  await nextTick()
  apiKeyInput.value?.dispatchChange()
}

async function updateKey() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/google', {
      method: 'post',
      body: {
        apiKey: apiKey.value,
      },
    })
    await refresh()
    useSuccessMessage('Google AI Studio key updated successfully')
  } catch (exception) {
    useErrorMessage('Failed to update Google AI Studio key')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update Google AI Studio key',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

async function deleteKey() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/google', {
      method: 'delete',
    })
    await refresh()
    useSuccessMessage('Google AI Studio keys deleted successfully')
    apiKey.value = ''
    await nextTick()
    form.value?.resetValidation()
  } catch (exception) {
    useErrorMessage('Failed to delete Google AI Studio keys')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete Google AI Studio keys',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

function onDeleteKey() {
  useConfirmationModal(
    deleteKey,
    [],
    'Are you sure you want to delete your Google AI Studio key?',
  )
}
</script>
