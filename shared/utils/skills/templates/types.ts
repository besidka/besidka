export interface SkillTemplateFile {
  path: string
  content: string
}

export interface SkillTemplate {
  id: string
  title: string
  summary: string
  name: string
  description: string
  modelInvocable: boolean
  command: string | null
  argumentHint: string | null
  files: SkillTemplateFile[]
}
