<template>
  <section class="grid place-items-center gap-2 pt-4">
    <SvgoOpenai class="!size-16" />
    <h3 class="text-2xl font-bold">OpenAI</h3>
    <p>Manage your OpenAI project and API keys here</p>
    <UiForm
      class="w-full"
      @submit="updateKeys"
    >
      <UiFormFieldset>
        <UiFormInput
          ref="projectIdInput"
          v-model="keys.projectId"
          autocomplete="off"
          type="password"
          label="Project ID"
          placeholder="proj_xxxx..."
          :rules="[Validation.required()]"
          :disabled="pending"
        >
          <template #labelBefore>
            <Icon
              name="lucide:folder-key"
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
              @click="pasteProjectId"
            />
          </template>
          <template #noteAfter>
            <NuxtLink
              to="https://platform.openai.com/settings/organization/projects"
              external
              target="_blank"
            >
              Get your Project ID from OpenAI: https://platform.openai.com/settings/organization/projects
            </NuxtLink>
          </template>
        </UiFormInput>
        <UiFormInput
          ref="apiKeyInput"
          v-model="keys.apiKey"
          autocomplete="off"
          type="password"
          label="API Key"
          placeholder="sk-proj-xxxx...-xxxx..."
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
              to="https://platform.openai.com/api-keys"
              external
              target="_blank"
            >
              Get your API keys from OpenAI: https://platform.openai.com/api-keys
            </NuxtLink>
          </template>
        </UiFormInput>
        <div class="md:grid md:place-content-end">
          <UiButton
            type="submit"
            text="Save"
            :disabled="pending"
            class="w-full"
          />
        </div>
      </UiFormFieldset>
    </UiForm>
  </section>
</template>
<script setup lang="ts">
import UiFormInput from '~/components/ui/Form/Input.vue'

const { data: fetchedKeys } = await useFetch('/api/v1/profiles/keys/openai')

const projectIdInput = ref<InstanceType<typeof UiFormInput> | null>()
const apiKeyInput = ref<InstanceType<typeof UiFormInput> | null>()

const { Validation } = useValidation()
const { paste } = useClipboardWithPaste()

const keys = shallowReactive<{
  projectId: string
  apiKey: string
}>({
  projectId: (fetchedKeys.value as any)?.projectId || '',
  apiKey: (fetchedKeys.value as any)?.apiKey || '',
})

const pending = shallowRef<boolean>(false)

async function pasteProjectId() {
  keys.projectId = await paste()
  await nextTick()
  projectIdInput.value?.dispatchChange()
}

async function pasteApiKey() {
  keys.apiKey = await paste()
  await nextTick()
  apiKeyInput.value?.dispatchChange()
}

async function updateKeys() {
  pending.value = true

  try {
    await $fetch('/api/v1/profiles/keys/openai', {
      method: 'post',
      body: keys,
    })
    useSuccessMessage('OpenAI keys updated successfully')
  } catch (exception) {
    useErrorMessage('Failed to update OpenAI keys')
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update OpenAI keys',
      data: exception,
    })
  } finally {
    pending.value = false
  }
}
</script>
