export interface MemoryProjectOption {
  id: string
  name: string
}

export function useMemoryProjects() {
  const { data } = useLazyFetch('/api/v1/projects', {
    key: 'memory-scope-projects',
    query: { limit: 100 },
  })

  const projects = computed<MemoryProjectOption[]>(() => {
    if (!data.value) {
      return []
    }

    return [...data.value.pinned, ...data.value.projects].map((project) => {
      return { id: project.id, name: project.name }
    })
  })

  function getProjectName(projectId: string | null): string | null {
    if (!projectId) {
      return null
    }

    const project = projects.value.find((candidate) => {
      return candidate.id === projectId
    })

    return project?.name ?? null
  }

  return {
    projects,
    getProjectName,
  }
}
