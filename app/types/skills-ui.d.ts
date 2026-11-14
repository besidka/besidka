export type SkillDetailTab = 'instructions' | 'files' | 'versions' | 'settings'

export type SkillCreateKind = 'skill' | 'template'

export type SkillImportTab = 'upload' | 'paste' | 'github'

export type SkillNewAction
  = | 'skill'
    | 'template'
    | 'upload'
    | 'paste'
    | 'github'
