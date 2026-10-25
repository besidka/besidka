<template>
  <ProfileSecuritySectionCard heading="Memory controls">
    <div class="grid gap-5">
      <label class="flex items-start justify-between gap-4 cursor-pointer">
        <span class="grid gap-1">
          <span class="font-bold">Search and reference chats</span>
          <span
            id="memory-chat-search-description"
            class="text-sm text-base-content/70"
          >
            Lets the assistant look up and quote your past chats when relevant.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle mt-1 shrink-0"
          aria-describedby="memory-chat-search-description"
          data-testid="memory-chat-search-toggle"
          :checked="settings.chatSearchEnabled"
          :disabled="isSaving"
          @change="onChatSearchChange"
        >
      </label>
      <label class="flex items-start justify-between gap-4 cursor-pointer">
        <span class="grid gap-1">
          <span class="font-bold">Generate memory from chats</span>
          <span
            id="memory-generation-description"
            class="text-sm text-base-content/70"
          >
            Saves lasting facts and preferences from your chats. Runs on your
            own API key, with the model you choose below.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle mt-1 shrink-0"
          aria-describedby="memory-generation-description"
          data-testid="memory-generation-toggle"
          :checked="settings.memoryEnabled"
          :disabled="isSaving"
          @change="onGenerationChange"
        >
      </label>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import type { MemorySettingsFields } from '#shared/types/memory.d'
import type { MemorySettingsSave } from '~/types/memory-settings.d'

const props = defineProps<{
  settings: MemorySettingsFields
  save: MemorySettingsSave
}>()

const isSaving = shallowRef<boolean>(false)

async function saveToggle(
  patch: Partial<MemorySettingsFields>,
  input: HTMLInputElement,
  nextValue: boolean,
) {
  input.checked = !nextValue
  isSaving.value = true

  const outcome = await props.save(patch)

  isSaving.value = false

  if (outcome.ok) {
    return
  }

  useErrorMessage(
    outcome.parsed.message || 'Failed to save memory settings.',
    outcome.parsed.why,
  )
}

async function onChatSearchChange(event: Event) {
  const input = event.target as HTMLInputElement

  await saveToggle({ chatSearchEnabled: input.checked }, input, input.checked)
}

async function onGenerationChange(event: Event) {
  const input = event.target as HTMLInputElement

  await saveToggle({ memoryEnabled: input.checked }, input, input.checked)
}
</script>
