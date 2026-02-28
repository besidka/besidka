<template>
  <section class="grid place-items-center gap-2 pt-4">
    <SvgoOpenai class="!size-16" />
    <h3 class="text-2xl font-bold">OpenAI</h3>
    <p>Manage your OpenAI API key here</p>
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
          placeholder="sk-proj-x-xxxx...-xxxx..."
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
              Get your API key from OpenAI:
              <NuxtLink
                to="https://platform.openai.com/api-keys"
                external
                target="_blank"
              >
                https://platform.openai.com/api-keys
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
} = await useFetch('/api/v1/profiles/keys/openai')

if (error.value) {
  // eslint-disable-next-line no-console
  console.warn('Failed to fetch OpenAI keys', error.value)
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
    await $fetch('/api/v1/profiles/keys/openai', {
      method: 'post',
      body: {
        apiKey: apiKey.value,
      },
    })
    await refresh()
    form.value?.resetValidation()
    useSuccessMessage('OpenAI API key updated successfully')
  } catch (exception) {
    useErrorMessage('Failed to update OpenAI API key')
    // eslint-disable-next-line no-console
    console.error('Failed to update OpenAI API key', exception)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update OpenAI API key',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

async function deleteKeys() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/openai', {
      method: 'delete',
    })
    await refresh()
    useSuccessMessage('OpenAI keys deleted successfully')
    apiKey.value = ''
    await nextTick()
    form.value?.resetValidation()
  } catch (exception) {
    useErrorMessage('Failed to delete OpenAI API key')
    // eslint-disable-next-line no-console
    console.error('Failed to delete OpenAI API key', exception)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete OpenAI API key',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}

async function onDeleteKeys() {
  const result = await useConfirm({
    text: 'Are you sure you want to delete your OpenAI API key?',
    actions: ['Confirm'],
  })

  if (!result) return

  await deleteKeys()
}
</script>
