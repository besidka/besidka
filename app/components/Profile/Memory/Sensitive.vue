<template>
  <ProfileSecuritySectionCard heading="Sensitive topics">
    <div class="grid gap-5">
      <label class="flex items-start justify-between gap-4 cursor-pointer">
        <span class="grid gap-1">
          <span class="font-bold">Allow sensitive topics in memory</span>
          <span
            id="memory-sensitive-description"
            class="text-sm text-base-content/70"
          >
            Off by default. When on, memory may keep special-category details
            you share, such as health or religion.
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle mt-1 shrink-0"
          aria-describedby="memory-sensitive-description"
          data-testid="memory-sensitive-toggle"
          :checked="settings.memoryIncludeSensitive"
          :disabled="isSaving"
          @change="onSensitiveChange"
        >
      </label>
      <div>
        <h3 class="text-sm font-bold">Never stored, even if you ask</h3>
        <ul
          class="mt-2 grid gap-1 sm:grid-cols-2"
          data-testid="memory-never-store-list"
        >
          <li
            v-for="kind in neverStoreKinds"
            :key="kind.id"
            class="flex items-center gap-2 text-sm text-base-content/70"
          >
            <Icon
              name="lucide:ban"
              size="14"
              class="shrink-0"
            />
            {{ kind.label }}
          </li>
        </ul>
      </div>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import type {
  MemorySensitiveCategory,
  MemorySettingsFields,
} from '#shared/types/memory.d'
import type { MemorySettingsSave } from '~/types/memory-settings.d'

const props = defineProps<{
  settings: MemorySettingsFields
  save: MemorySettingsSave
}>()

const sensitiveCategoryLabels: Record<MemorySensitiveCategory, string> = {
  'health': 'health',
  'religion-or-belief': 'religion or belief',
  'political-opinion': 'political opinion',
  'racial-or-ethnic-origin': 'racial or ethnic origin',
  'sex-life-or-orientation': 'sex life or orientation',
  'trade-union': 'trade union membership',
  'genetic': 'genetic data',
  'biometric': 'biometric data',
  'legal-dispute': 'legal disputes',
  'drugs': 'drugs',
}

const isSaving = shallowRef<boolean>(false)

const sensitiveCategoriesText = computed<string>(() => {
  return memorySensitiveCategories.map((category) => {
    return sensitiveCategoryLabels[category]
  }).join(', ')
})

async function confirmChange(nextValue: boolean) {
  if (nextValue) {
    return await useConfirm({
      text: 'Allow sensitive topics in memory?',
      subtitle: `Memory could then keep details about your `
        + `${sensitiveCategoriesText.value}. These are special-category `
        + 'data under GDPR Art. 9, so they are stored only with your explicit '
        + 'opt-in. You can turn this off any time.',
      alert: true,
      actions: ['Allow sensitive topics'],
      labelDecline: 'Cancel',
    })
  }

  return await useConfirm({
    text: 'Turn off sensitive topics?',
    subtitle: 'Every sensitive memory entry saved so far will be deleted. '
      + 'This cannot be undone.',
    alert: true,
    actions: ['Turn off and delete'],
    labelDecline: 'Cancel',
  })
}

function describeDeletedEntries(deletedCount: number): string {
  if (deletedCount === 0) {
    return 'No sensitive entries to delete.'
  }

  const noun = deletedCount === 1 ? 'entry' : 'entries'

  return `${deletedCount} sensitive ${noun} deleted.`
}

async function onSensitiveChange(event: Event) {
  const input = event.target as HTMLInputElement
  const nextValue = input.checked

  input.checked = !nextValue

  const confirmation = await confirmChange(nextValue)

  if (!confirmation) {
    return
  }

  isSaving.value = true

  const outcome = await props.save({ memoryIncludeSensitive: nextValue })

  isSaving.value = false

  if (!outcome.ok) {
    useErrorMessage(
      outcome.parsed.message || 'Failed to save memory settings.',
      outcome.parsed.why,
    )

    return
  }

  if (nextValue) {
    return
  }

  useInfoMessage(
    'Sensitive topics off',
    describeDeletedEntries(outcome.result.sensitiveEntriesDeleted ?? 0),
  )
}
</script>
