<template>
  <div class="inline-block">
    <details
      ref="dropdownRef"
      class="dropdown dropdown-end max-sm:hidden"
      :class="isFlippedUp ? 'dropdown-top' : 'dropdown-bottom'"
      @toggle="updatePlacement"
    >
      <summary
        class="btn btn-primary btn-sm"
        data-testid="skills-new-trigger"
      >
        <Icon name="lucide:plus" size="16" aria-hidden="true" />
        New
      </summary>
      <div
        class="dropdown-content z-50 w-64"
        :class="isFlippedUp ? 'pb-2' : 'pt-2'"
        data-testid="skills-new-menu"
      >
        <ul class="menu menu-sm bg-base-100 rounded-box shadow-lg w-64 p-1">
          <li
            v-for="item in items"
            :key="item.action"
          >
            <button
              type="button"
              :data-testid="`skills-new-${item.action}`"
              @click="onSelect(item.action)"
            >
              <Icon
                :name="item.icon"
                size="14"
                aria-hidden="true"
              />
              {{ item.label }}
            </button>
          </li>
        </ul>
      </div>
    </details>

    <button
      type="button"
      class="btn btn-primary btn-sm sm:hidden"
      data-testid="skills-new-sheet-trigger"
      @click="openSheet"
    >
      <Icon name="lucide:plus" size="16" aria-hidden="true" />
      New
    </button>
    <dialog
      ref="sheetRef"
      class="js-skills-new-sheet modal modal-bottom"
      :aria-labelledby="sheetTitleId"
      data-testid="skills-new-sheet"
    >
      <div class="modal-box pb-[max(1.5rem,var(--sab))]">
        <h2
          :id="sheetTitleId"
          class="mb-2 text-lg font-bold"
        >
          New skill
        </h2>
        <ul class="menu w-full p-0">
          <li
            v-for="item in items"
            :key="item.action"
          >
            <button
              type="button"
              class="min-h-11"
              :data-testid="`skills-new-sheet-${item.action}`"
              @click="onSelect(item.action)"
            >
              <Icon
                :name="item.icon"
                size="18"
                aria-hidden="true"
              />
              {{ item.label }}
            </button>
          </li>
        </ul>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import type { SkillNewAction } from '~/types/skills-ui.d'

interface NewMenuItem {
  action: SkillNewAction
  label: string
  icon: string
}

const props = withDefaults(defineProps<{
  canImportFromUrl?: boolean
}>(), {
  canImportFromUrl: false,
})

const emit = defineEmits<{
  select: [action: SkillNewAction]
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const sheetRef = useTemplateRef<HTMLDialogElement>('sheetRef')
const { isFlippedUp, updatePlacement } = useDropdownPlacement(dropdownRef)
const sheetTitleId = useId()

const items = computed<NewMenuItem[]>(() => {
  const menuItems: NewMenuItem[] = [
    { action: 'blank', label: 'Blank skill', icon: 'lucide:file-plus' },
    { action: 'command', label: 'Blank command', icon: 'lucide:square-slash' },
    {
      action: 'template',
      label: 'From a template',
      icon: 'lucide:layout-template',
    },
    {
      action: 'upload',
      label: 'Upload .zip or .skill',
      icon: 'lucide:upload',
    },
    { action: 'paste', label: 'Paste SKILL.md', icon: 'lucide:clipboard-paste' },
  ]

  if (props.canImportFromUrl) {
    menuItems.push({
      action: 'github',
      label: 'From GitHub',
      icon: 'lucide:github',
    })
  }

  return menuItems
})

onClickOutside(dropdownRef, closeDropdown)

function closeDropdown() {
  if (dropdownRef.value?.open) {
    dropdownRef.value.open = false
  }
}

function openSheet() {
  sheetRef.value?.showModal()
}

function onSelect(action: SkillNewAction) {
  closeDropdown()

  if (sheetRef.value?.open) {
    sheetRef.value.close()
  }

  emit('select', action)
}
</script>
