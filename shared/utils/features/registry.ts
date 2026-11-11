import type { ProviderMeta } from '#shared/utils/provider-meta'

export type FeatureRole = 'admin' | 'tester'
export type FeatureStage = 'internal' | 'beta' | 'ga'
export type FeatureSpend = 'none' | 'foreground' | 'background'
export type FeatureOptIn = 'required' | 'none'
export type FeatureKeyKind = ProviderMeta['kind']

export interface FeatureRequirements {
  bindings: string[]
  keyKinds: FeatureKeyKind[]
}

export interface FeatureDefinition {
  key: string
  title: string
  description: string
  stage: FeatureStage
  available: boolean
  default: boolean
  allowRoles: FeatureRole[]
  spend: FeatureSpend
  optIn: FeatureOptIn
  requires: FeatureRequirements
  variants?: string[]
  exposeToClient: boolean
  parent?: string
}

export const FEATURE_ROLES: readonly FeatureRole[] = ['admin', 'tester']

export const RESERVED_FEATURE_OPT_IN_KEYS = ['experiments'] as const

export const EXPERIMENTS_OPT_IN_KEY = RESERVED_FEATURE_OPT_IN_KEYS[0]

type FeatureDefinitionInput
  = Pick<FeatureDefinition, 'key' | 'title' | 'description'>
    & Partial<Omit<FeatureDefinition, 'key' | 'title' | 'description'>>

function internalFeature<const Key extends string>(
  input: FeatureDefinitionInput & { key: Key },
): FeatureDefinition & { key: Key } {
  const spend = input.spend ?? 'none'
  const optIn = spend === 'none' ? input.optIn ?? 'none' : 'required'

  return {
    stage: 'internal',
    available: false,
    default: false,
    allowRoles: ['admin'],
    requires: { bindings: [], keyKinds: [] },
    exposeToClient: true,
    ...input,
    spend,
    optIn,
  }
}

const featureList = [
  internalFeature({
    key: 'artifacts',
    title: 'Artifacts',
    description: 'Interactive documents and apps rendered next to the chat.',
    available: true,
  }),
  internalFeature({
    key: 'artifacts.react',
    title: 'React artifacts',
    description: 'Artifacts written as React components.',
    parent: 'artifacts',
    available: true,
  }),
  internalFeature({
    key: 'artifacts.storage',
    title: 'Artifact storage',
    description: 'Artifacts that keep their own data between visits.',
    parent: 'artifacts',
  }),
  internalFeature({
    key: 'artifacts.llm-bridge',
    title: 'Artifacts that call a model',
    description: 'Artifacts that ask a model questions with your API keys.',
    spend: 'foreground',
    requires: { bindings: [], keyKinds: ['provider'] },
    parent: 'artifacts',
  }),
  internalFeature({
    key: 'artifacts.share',
    title: 'Shared artifacts',
    description: 'Public links to an artifact.',
    parent: 'artifacts',
  }),
  internalFeature({
    key: 'artifacts.mcp',
    title: 'Artifacts over MCP',
    description: 'Artifact tools on the MCP server.',
    exposeToClient: false,
    parent: 'artifacts',
  }),
  internalFeature({
    key: 'documents',
    title: 'Documents',
    description: 'Generate downloadable documents from a chat.',
  }),
  internalFeature({
    key: 'documents.pdf',
    title: 'PDF documents',
    description: 'Generate PDF files.',
    parent: 'documents',
  }),
  internalFeature({
    key: 'documents.docx',
    title: 'Word documents',
    description: 'Generate DOCX files.',
    parent: 'documents',
  }),
  internalFeature({
    key: 'documents.xlsx',
    title: 'Spreadsheets',
    description: 'Generate XLSX files.',
    parent: 'documents',
  }),
  internalFeature({
    key: 'documents.pptx',
    title: 'Presentations',
    description: 'Generate PPTX files.',
    parent: 'documents',
  }),
  internalFeature({
    key: 'documents.mcp',
    title: 'Documents over MCP',
    description: 'Document tools on the MCP server.',
    exposeToClient: false,
    parent: 'documents',
  }),
  internalFeature({
    key: 'code-execution',
    title: 'Code execution',
    description: 'Run code in a sandbox from a chat.',
  }),
  internalFeature({
    key: 'code-execution.files',
    title: 'Code execution with files',
    description: 'Give the sandbox your chat files.',
    parent: 'code-execution',
  }),
  internalFeature({
    key: 'code-execution.skills',
    title: 'Skills in code execution',
    description: 'Run skill scripts in the sandbox.',
    parent: 'code-execution',
  }),
  internalFeature({
    key: 'research.custom',
    title: 'Custom research',
    description: 'Multi-step research on any model with your API keys.',
    spend: 'foreground',
    requires: { bindings: [], keyKinds: ['provider'] },
  }),
  internalFeature({
    key: 'research.custom.max',
    title: 'Custom research, maximum depth',
    description: 'Longer custom research runs.',
    spend: 'foreground',
    requires: { bindings: [], keyKinds: ['provider'] },
    parent: 'research.custom',
  }),
  internalFeature({
    key: 'research.export',
    title: 'Research export',
    description: 'Export a research report as a file.',
  }),
  internalFeature({
    key: 'research.mcp',
    title: 'Research over MCP',
    description: 'Research tools on the MCP server.',
    exposeToClient: false,
  }),
  internalFeature({
    key: 'connectors',
    title: 'Connectors',
    description: 'Connect remote MCP servers and apps to your chats.',
  }),
  internalFeature({
    key: 'connectors.oauth',
    title: 'Connectors with sign-in',
    description: 'Connectors that sign in with OAuth.',
    parent: 'connectors',
  }),
  internalFeature({
    key: 'connectors.registry',
    title: 'Connector directory',
    description: 'Pick connectors from a directory.',
    parent: 'connectors',
  }),
  internalFeature({
    key: 'connectors.native',
    title: 'Built-in connectors',
    description: 'Connectors built into Besidka.',
    parent: 'connectors',
  }),
  internalFeature({
    key: 'google.drive',
    title: 'Google Drive',
    description: 'Attach files from Google Drive.',
  }),
  internalFeature({
    key: 'google.calendar',
    title: 'Google Calendar',
    description: 'Read your Google Calendar in a chat.',
    parent: 'google.drive',
  }),
  internalFeature({
    key: 'google.byo',
    title: 'Your own Google client',
    description: 'Connect Google with your own OAuth client.',
    parent: 'google.drive',
  }),
  internalFeature({
    key: 'google.gmail',
    title: 'Gmail',
    description: 'Read Gmail in a chat through your own Google client.',
    parent: 'google.drive',
  }),
  internalFeature({
    key: 'skills',
    title: 'Skills',
    description: 'Reusable instructions the model loads when it needs them.',
  }),
  internalFeature({
    key: 'skills.import-url',
    title: 'Import skills from a link',
    description: 'Add a skill from a URL.',
    parent: 'skills',
  }),
  internalFeature({
    key: 'skills.scripts',
    title: 'Skill scripts',
    description: 'Skills that ship scripts.',
    parent: 'skills',
  }),
  internalFeature({
    key: 'ui.side-panel-demo',
    title: 'Side panel demo',
    description: 'A demo of the right-hand side panel.',
    available: true,
  }),
] as const

export type FeatureKey = typeof featureList[number]['key']

export const FEATURE_REGISTRY = Object.fromEntries(
  featureList.map((definition) => {
    return [definition.key, definition]
  }),
) as Readonly<Record<FeatureKey, FeatureDefinition>>

export const FEATURE_KEYS = featureList.map((definition) => {
  return definition.key
}) as readonly FeatureKey[]

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURE_REGISTRY, value)
}

export function getFeatureDefinition(
  key: string,
): FeatureDefinition | undefined {
  return isFeatureKey(key) ? FEATURE_REGISTRY[key] : undefined
}
