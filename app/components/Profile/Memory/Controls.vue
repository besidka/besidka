<template>
  <ProfileSecuritySectionCard heading="Memory controls">
    <div class="grid gap-5">
      <div class="grid gap-4">
        <label class="flex items-start justify-between gap-4 cursor-pointer">
          <span class="grid gap-1">
            <span
              id="memory-enabled-title"
              class="font-bold"
            >Use memory</span>
            <span
              id="memory-enabled-description"
              class="text-sm text-base-content/70"
            >
              Lets the assistant use what it remembers about you, and save
              things when you ask it to remember.
            </span>
          </span>
          <input
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="memory-enabled-title"
            aria-describedby="memory-enabled-description"
            data-testid="memory-enabled-toggle"
            :checked="settings.memoryEnabled"
            :disabled="isSaving"
            @change="onMemoryEnabledChange"
          >
        </label>
        <label
          class="ms-6 flex items-start justify-between gap-4 border-s ps-4"
          :class="settings.memoryEnabled ? 'cursor-pointer' : 'opacity-60'"
        >
          <span class="grid gap-1">
            <span
              id="memory-generation-title"
              class="font-bold"
            >Generate memory from chats</span>
            <span
              id="memory-generation-description"
              class="text-sm text-base-content/70"
            >
              Saves lasting facts and preferences from your chats. Runs on
              your own API key, with the model you choose below.
            </span>
            <span
              v-if="settings.memoryEnabled"
              id="memory-generation-project-note"
              class="text-sm text-base-content/60"
              data-testid="memory-generation-project-note"
            >
              This setting covers your account memory. Project memory updates
              automatically unless you turn it off in the project.
            </span>
            <span
              v-if="!settings.memoryEnabled"
              id="memory-generation-hint"
              class="text-sm text-base-content/70"
              data-testid="memory-generation-hint"
            >
              Turn on Use memory to generate memory from chats.
            </span>
          </span>
          <input
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="memory-generation-title"
            :aria-describedby="generationDescribedBy"
            data-testid="memory-generation-toggle"
            :checked="settings.memoryExtractionEnabled"
            :disabled="isSaving || !settings.memoryEnabled"
            @change="onGenerationChange"
          >
        </label>
      </div>
      <label class="flex items-start justify-between gap-4 cursor-pointer">
        <span class="grid gap-1">
          <span
            id="memory-chat-search-title"
            class="font-bold"
          >Search and reference chats</span>
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
          aria-labelledby="memory-chat-search-title"
          aria-describedby="memory-chat-search-description"
          data-testid="memory-chat-search-toggle"
          :checked="settings.chatSearchEnabled"
          :disabled="isSaving"
          @change="onChatSearchChange"
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

const generationDescribedBy = computed<string>(() => {
  const ids = ['memory-generation-description']

  if (props.settings.memoryEnabled) {
    ids.push('memory-generation-project-note')
  } else {
    ids.push('memory-generation-hint')
  }

  return ids.join(' ')
})

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

async function onMemoryEnabledChange(event: Event) {
  const input = event.target as HTMLInputElement

  await saveToggle({ memoryEnabled: input.checked }, input, input.checked)
}

async function onGenerationChange(event: Event) {
  const input = event.target as HTMLInputElement

  await saveToggle(
    { memoryExtractionEnabled: input.checked },
    input,
    input.checked,
  )
}
</script>
