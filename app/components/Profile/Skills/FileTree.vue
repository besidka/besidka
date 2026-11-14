<template>
  <div data-testid="skill-file-tree">
    <label class="sm:hidden">
      <span class="sr-only">File</span>
      <select
        v-model="selected"
        class="select select-sm w-full"
        data-testid="skill-file-select"
      >
        <option
          v-for="file in fileRows"
          :key="file.key"
          :value="file.path"
        >
          {{ file.path }}
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
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  files: Array<{ path: string, bytes: number }>
  flagged?: Record<string, number>
}>(), {
  flagged: () => ({}),
})

const selected = defineModel<string>({ required: true })

const rows = computed(() => {
  return buildSkillFileTreeRows(props.files)
})

const fileRows = computed(() => {
  return rows.value.filter(row => row.type === 'file')
})
</script>
