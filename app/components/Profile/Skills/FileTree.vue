<template>
  <div
    class="grid gap-2"
    data-testid="skill-file-tree"
  >
    <label class="sm:hidden">
      <span class="sr-only">File</span>
      <select
        v-model="selected"
        class="select select-sm w-full max-sm:min-h-11"
        data-testid="skill-file-select"
      >
        <option
          v-for="file in fileRows"
          :key="file.key"
          :value="file.path"
        >
          {{ describeOption(file.path) }}
        </option>
      </select>
    </label>
    <ul
      class="menu menu-sm max-sm:hidden w-full rounded-box bg-base-200 p-1"
      aria-label="Files"
    >
      <template
        v-for="row in rows"
        :key="row.key"
      >
        <li
          v-if="row.type === 'directory'"
          class="menu-title"
          :style="{ paddingLeft: `${row.depth * 0.75}rem` }"
        >
          <span class="flex items-center gap-1">
            <Icon name="lucide:folder" size="14" aria-hidden="true" />
            {{ row.name }}
          </span>
        </li>
        <li
          v-else
          :style="{ paddingLeft: `${row.depth * 0.75}rem` }"
        >
          <button
            type="button"
            class="justify-between gap-2"
            :class="{ 'menu-active': row.path === selected }"
            :aria-current="row.path === selected ? 'true' : undefined"
            data-testid="skill-file-tree-item"
            @click="selected = row.path"
          >
            <span class="flex min-w-0 items-center gap-1">
              <Icon name="lucide:file-text" size="14" aria-hidden="true" />
              <span class="truncate">{{ row.name }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-1 text-xs opacity-70">
              <span
                v-if="badges[row.path]"
                class="badge badge-soft badge-xs"
                data-testid="skill-file-tree-badge"
              >
                {{ badges[row.path] }}
              </span>
              <span
                v-if="flagged[row.path]"
                class="badge badge-warning badge-xs"
                data-testid="skill-file-tree-flagged"
              >
                {{ flagged[row.path] }}
                <span class="sr-only">highlighted</span>
              </span>
              {{ formatFileSize(row.bytes) }}
            </span>
          </button>
        </li>
      </template>
    </ul>

    <div
      v-if="isEditable"
      class="grid gap-2"
      data-testid="skill-file-tools"
    >
      <div class="grid grid-cols-3 gap-1">
        <button
          type="button"
          class="btn btn-sm btn-ghost gap-1 px-1 max-sm:min-h-11"
          :disabled="!!formMode"
          data-testid="skill-file-add"
          @click="openForm('add')"
        >
          <Icon name="lucide:file-plus" size="14" aria-hidden="true" />
          Add file
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost gap-1 px-1 max-sm:min-h-11"
          :disabled="!canRename || !!formMode"
          data-testid="skill-file-rename"
          @click="openForm('rename')"
        >
          <Icon name="lucide:pencil" size="14" aria-hidden="true" />
          Rename
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost gap-1 px-1 max-sm:min-h-11"
          :disabled="!canDelete || !!formMode"
          data-testid="skill-file-delete"
          @click="emit('delete')"
        >
          <Icon name="lucide:trash-2" size="14" aria-hidden="true" />
          Delete
        </button>
      </div>

      <form
        v-if="formMode"
        class="grid gap-1 rounded-box border border-base-300 p-2"
        novalidate
        data-testid="skill-file-form"
        @submit.prevent="submitForm"
        @keydown.esc.stop.prevent="closeForm"
      >
        <label
          for="skill-file-path"
          class="text-xs font-medium"
        >
          {{ formMode === 'add' ? 'New file path' : 'New path for this file' }}
        </label>
        <input
          id="skill-file-path"
          ref="pathInputRef"
          v-model="path"
          type="text"
          class="input input-sm w-full font-mono max-sm:min-h-11"
          :class="{ 'input-error': !!pathError }"
          placeholder="references/guide.md"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          aria-describedby="skill-file-path-help"
          :aria-invalid="pathError ? 'true' : undefined"
          data-testid="skill-file-path"
        >
        <p
          id="skill-file-path-help"
          class="min-h-4 text-xs"
          :class="pathError ? 'text-error' : 'text-base-content/70'"
          :role="pathError ? 'alert' : undefined"
          data-testid="skill-file-path-help"
        >
          {{ pathError || PATH_HELP }}
        </p>
        <div class="flex justify-end gap-1">
          <button
            type="button"
            class="btn btn-sm btn-ghost max-sm:min-h-11"
            data-testid="skill-file-form-cancel"
            @click="closeForm"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-sm btn-accent max-sm:min-h-11"
            :disabled="!canSubmit"
            data-testid="skill-file-form-submit"
          >
            {{ formMode === 'add' ? 'Add' : 'Rename' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const PATH_HELP = 'A relative path, for example references/guide.md.'

const props = withDefaults(defineProps<{
  files: Array<{ path: string, bytes: number }>
  flagged?: Record<string, number>
  badges?: Record<string, string>
  isEditable?: boolean
  canRename?: boolean
  canDelete?: boolean
  validatePath?: (path: string, mode: 'add' | 'rename') => string | null
}>(), {
  flagged: () => ({}),
  badges: () => ({}),
  isEditable: false,
  canRename: false,
  canDelete: false,
  validatePath: () => null,
})

const emit = defineEmits<{
  add: [path: string]
  rename: [path: string]
  delete: []
}>()

const selected = defineModel<string>({ required: true })

const pathInputRef = useTemplateRef<HTMLInputElement>('pathInputRef')
const formMode = shallowRef<'add' | 'rename' | null>(null)
const path = shallowRef<string>('')

const rows = computed(() => {
  return buildSkillFileTreeRows(props.files)
})

const fileRows = computed(() => {
  return rows.value.filter(row => row.type === 'file')
})

const isUnchangedRename = computed<boolean>(() => {
  return formMode.value === 'rename' && path.value === selected.value
})

const canSubmit = computed<boolean>(() => {
  return !!formMode.value
    && !!path.value
    && !pathError.value
    && !isUnchangedRename.value
})

const pathError = computed<string>(() => {
  if (!formMode.value || !path.value) {
    return ''
  }

  if (isUnchangedRename.value) {
    return ''
  }

  return props.validatePath(path.value, formMode.value) ?? ''
})

function describeOption(filePath: string): string {
  const badge = props.badges[filePath]

  return badge ? `${filePath} (${badge})` : filePath
}

async function openForm(mode: 'add' | 'rename') {
  formMode.value = mode
  path.value = mode === 'rename' ? selected.value : ''

  await nextTick()
  pathInputRef.value?.focus()
  pathInputRef.value?.select()
}

function closeForm() {
  formMode.value = null
  path.value = ''
}

function submitForm() {
  if (!canSubmit.value) {
    return
  }

  if (formMode.value === 'add') {
    emit('add', path.value)
  } else {
    emit('rename', path.value)
  }

  closeForm()
}

watch(selected, () => {
  if (formMode.value === 'rename') {
    closeForm()
  }
})
</script>
