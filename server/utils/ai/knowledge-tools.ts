export const PROJECT_KNOWLEDGE_TOOL_NAMES = [
  'search_project_knowledge',
  'read_project_knowledge',
] as const

export function isProjectKnowledgeToolName(toolName: string): boolean {
  return (PROJECT_KNOWLEDGE_TOOL_NAMES as readonly string[]).includes(toolName)
}
