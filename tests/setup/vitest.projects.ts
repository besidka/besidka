export const NODE_PROJECT_NAME = 'node'
export const NUXT_PROJECT_NAME = 'nuxt'

export const nodeSpecDirectories: readonly string[] = [
  'tests/unit/assets',
  'tests/unit/config',
  'tests/unit/content',
  'tests/unit/db',
  'tests/unit/middleware',
  'tests/unit/providers',
  'tests/unit/scripts',
  'tests/unit/server',
  'tests/unit/utils',
  'tests/unit/workers',
  'tests/integration/api',
  'tests/integration/server',
]

export const nuxtSpecDirectories: readonly string[] = [
  'tests/unit/components',
  'tests/unit/composables',
  'tests/unit/layouts',
  'tests/unit/pages',
  'tests/unit/plugins',
  'tests/unit/service-worker',
  'tests/integration/pages',
]

export const nuxtSpecExceptions: readonly string[] = [
  'tests/unit/utils/auth.spec.ts',
  'tests/unit/utils/diagram-export-drawio.spec.ts',
  'tests/unit/utils/diagram-export-fonts.spec.ts',
  'tests/unit/utils/diagram-export-png.spec.ts',
  'tests/unit/utils/diagram-export-svg.spec.ts',
  'tests/unit/utils/diagram-export-theme.spec.ts',
  'tests/unit/utils/diagram-fonts.spec.ts',
  'tests/unit/utils/key-guide-video.spec.ts',
  'tests/integration/api/chats-message-id-stream.spec.ts',
  'tests/integration/server/assistant-files.spec.ts',
  'tests/integration/server/email-templates.spec.ts',
  'tests/integration/server/file-retention.spec.ts',
]

const SPEC_FILES_GLOB = '**/*.spec.ts'

function toSpecGlobs(directories: readonly string[]): string[] {
  return directories.map((directory) => {
    return `${directory}/${SPEC_FILES_GLOB}`
  })
}

export const nodeProjectInclude = toSpecGlobs(nodeSpecDirectories)

export const nodeProjectExclude = [...nuxtSpecExceptions]

export const nuxtProjectInclude = [
  ...toSpecGlobs(nuxtSpecDirectories),
  ...nuxtSpecExceptions,
]
