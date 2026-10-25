export interface MemoryProjectOption {
  id: string
  name: string
  memoryStatus: string
}

export function useMemoryProjects() {
  const { data, pending } = useLazyFetch('/api/v1/projects', {
    key: 'memory-scope-projects',
    query: { limit: 100 },
  })

  const projects = computed<MemoryProjectOption[]>(() => {
    if (!data.value) {
      return []
    }

    return [...data.value.pinned, ...data.value.projects].map((project) => {
      return {
        id: project.id,
        name: project.name,
        memoryStatus: project.memoryStatus,
      }
    })
  })

  const isLoading = computed<boolean>(() => {
    return pending.value && !data.value
  })

  return {
    projects,
    isLoading,
  }
}
