export type SkillDetailTab = 'instructions' | 'files' | 'versions' | 'settings'

export type SkillCreateKind = 'blank' | 'command' | 'template'

export type SkillImportTab = 'upload' | 'paste' | 'github'

export type SkillNewAction
  = | 'blank'
    | 'command'
    | 'template'
    | 'upload'
    | 'paste'
    | 'github'
