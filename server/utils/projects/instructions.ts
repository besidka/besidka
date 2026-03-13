import type { UIMessage } from 'ai'
import type { ProjectMemoryStatus } from '#shared/types/projects.d'

interface ProjectInstructionsContext {
  name: string
  instructions: string | null
  memory?: string | null
  memoryStatus?: ProjectMemoryStatus | null
}

export function buildProjectInstructionsMessage(
  project: ProjectInstructionsContext | null,
): UIMessage | null {
  const instructions = project?.instructions?.trim()
  const memory = project?.memory?.trim()

  if (!project || (!instructions && !memory)) {
    return null
  }

  const sections = [`Current project: ${project.name}`]

  if (instructions) {
    sections.push('Project instructions:')
    sections.push(instructions)
  }

  if (memory && project.memoryStatus === 'ready') {
    sections.push('Project memory:')
    sections.push(memory)
  }

  sections.push(
    'Project instructions are the primary project-specific guidance for this chat.',
    'Project memory is secondary background context only. Use it when relevant, but do not overfit to it or let it override the current request.',
    'If project instructions and project memory conflict, follow project instructions.',
    'Use only the current project context for this response.',
    'If earlier messages imply different project-specific context, ignore them and follow the current project.',
  )

  return {
    id: crypto.randomUUID(),
    role: 'system',
    parts: [
      {
        type: 'text',
        text: sections.join('\n\n'),
      },
    ],
  }
}
