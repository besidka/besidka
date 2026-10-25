<template>
  <select
    class="select select-sm w-full max-w-full sm:w-auto sm:min-w-48"
    aria-label="Memory scope"
    data-testid="memory-scope-select"
    :value="selectedValue"
    @change="onChange"
  >
    <option :value="ACCOUNT_VALUE">Account</option>
    <option
      v-for="project in projectOptions"
      :key="project.id"
      :value="project.id"
    >
      {{ project.name }}
    </option>
  </select>
</template>

<script setup lang="ts">
const ACCOUNT_VALUE = 'account'

const props = defineProps<{
  projectId: string | null
}>()

const emit = defineEmits<{
  change: [projectId: string | null]
}>()

const { projects } = useMemoryProjects()

const selectedValue = computed<string>(() => {
  return props.projectId ?? ACCOUNT_VALUE
})

const projectOptions = computed(() => {
  const isUnlisted = !!props.projectId && !projects.value.some((project) => {
    return project.id === props.projectId
  })

  if (!isUnlisted || !props.projectId) {
    return projects.value
  }

  return [...projects.value, { id: props.projectId, name: 'Project' }]
})

function onChange(event: Event) {
  const { value } = event.target as HTMLSelectElement

  emit('change', value === ACCOUNT_VALUE ? null : value)
}
</script>
