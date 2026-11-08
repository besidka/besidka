#!/usr/bin/env node

/**
 * Fails when the public MCP surface changed without a higher
 * MCP_SERVER_VERSION. Compares the working tree with the merge base of
 * origin/main: config/mcp-surface.json (tools, schemas, scopes, annotations,
 * server text) and every server.json field except `version`. A file that does
 * not exist on the base counts as a new baseline, not as a change. When
 * something changed, the version must be strictly greater than both the merge
 * base version and the version at the current origin/main tip, so two open
 * pull requests cannot claim the same version. Exit 1 means a missing bump;
 * exit 2 means the guard could not run (git error, unreadable HEAD version).
 * See "When to publish again" in docs/mcp-marketplaces.md.
 *
 * Usage:
 *   pnpm run mcp:version-guard [--base=origin/main]
 */

/* eslint-disable no-console */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SURFACE_PATH = 'config/mcp-surface.json'

export const SERVER_JSON_PATH = 'server.json'

export const SERVER_CONFIG_PATH = 'config/mcp-server.ts'

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const SERVER_VERSION_DECLARATION
  = /export const MCP_SERVER_VERSION = '([^']+)'/

const LEVEL_ORDER = ['patch', 'minor', 'major']

export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version ?? '')

  if (!match) {
    throw new Error(`"${version}" is not a plain MAJOR.MINOR.PATCH version`)
  }

  return match.slice(1).map(Number)
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)

  for (const [index, leftPart] of leftParts.entries()) {
    if (leftPart !== rightParts[index]) {
      return leftPart > rightParts[index] ? 1 : -1
    }
  }

  return 0
}

export function readServerVersion(configSource) {
  return SERVER_VERSION_DECLARATION.exec(configSource ?? '')?.[1] ?? null
}

export function isEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function withoutVersion(serverManifest) {
  const manifest = { ...serverManifest }

  delete manifest.version

  return manifest
}

function higherLevel(left, right) {
  return LEVEL_ORDER.indexOf(left) >= LEVEL_ORDER.indexOf(right)
    ? left
    : right
}

function describeToolLevel(baseTool, headTool, reasons) {
  const baseProperties = baseTool.inputSchema?.properties ?? {}
  const headProperties = headTool.inputSchema?.properties ?? {}
  const baseRequired = baseTool.inputSchema?.required ?? []
  const headRequired = headTool.inputSchema?.required ?? []
  let level = 'patch'

  for (const property of Object.keys(baseProperties)) {
    if (!(property in headProperties)) {
      reasons.push(`${headTool.name}: input "${property}" removed or renamed`)
      level = 'major'
    }
  }

  for (const property of headRequired) {
    if (!baseRequired.includes(property)) {
      reasons.push(`${headTool.name}: input "${property}" is now required`)
      level = 'major'
    }
  }

  if (!isEqualJson(baseTool.requiredScopes, headTool.requiredScopes)) {
    reasons.push(`${headTool.name}: required scopes changed`)
    level = 'major'
  }

  for (const property of Object.keys(headProperties)) {
    if (!(property in baseProperties)) {
      reasons.push(`${headTool.name}: optional input "${property}" added`)
      level = higherLevel(level, 'minor')
    }
  }

  if (!isEqualJson(baseTool.annotations, headTool.annotations)) {
    reasons.push(`${headTool.name}: annotations changed`)
    level = higherLevel(level, 'minor')
  }

  if (!isEqualJson(baseTool, headTool) && reasons.length === 0) {
    reasons.push(`${headTool.name}: text or schema details changed`)
  }

  return level
}

export function suggestBump(baseSurface, headSurface) {
  const reasons = []
  let level = 'patch'

  if (!baseSurface || !headSurface) {
    return { level, reasons }
  }

  const baseTools = new Map(baseSurface.tools.map((tool) => {
    return [tool.name, tool]
  }))
  const headTools = new Map(headSurface.tools.map((tool) => {
    return [tool.name, tool]
  }))

  for (const name of baseTools.keys()) {
    if (!headTools.has(name)) {
      reasons.push(`tool "${name}" removed`)
      level = 'major'
    }
  }

  for (const [name, headTool] of headTools) {
    const baseTool = baseTools.get(name)

    if (!baseTool) {
      reasons.push(`tool "${name}" added`)
      level = higherLevel(level, 'minor')

      continue
    }

    const toolReasons = []
    const toolLevel = describeToolLevel(baseTool, headTool, toolReasons)

    reasons.push(...toolReasons)
    level = higherLevel(level, toolLevel)
  }

  if (!isEqualJson(baseSurface.server, headSurface.server)) {
    reasons.push('server name, title or description changed')
  }

  return { level, reasons }
}

export function bumpVersion(version, level) {
  const [major, minor, patch] = parseVersion(version)

  if (level === 'major') {
    return `${major + 1}.0.0`
  }

  if (level === 'minor') {
    return `${major}.${minor + 1}.0`
  }

  return `${major}.${minor}.${patch + 1}`
}

export function checkMcpVersion({ base, head, main = null }) {
  parseVersion(head.version)

  const changes = []
  const surfaceChanged = base.surface !== null
    && !isEqualJson(base.surface, head.surface)

  if (surfaceChanged) {
    changes.push(`${SURFACE_PATH} changed`)
  }

  const serverManifestChanged = base.serverManifest !== null
    && !isEqualJson(
      withoutVersion(base.serverManifest),
      withoutVersion(head.serverManifest),
    )

  if (serverManifestChanged) {
    changes.push(`${SERVER_JSON_PATH} changed beyond its version`)
  }

  if (changes.length === 0) {
    return { ok: true, changes, message: 'No MCP surface change.' }
  }

  const knownVersions = [base.version, main?.version].filter((version) => {
    return version !== null && version !== undefined
  })

  if (knownVersions.length === 0) {
    return {
      ok: true,
      changes,
      message: 'MCP_SERVER_VERSION is new on this branch.',
    }
  }

  const floorVersion = knownVersions.reduce((highest, version) => {
    return compareVersions(version, highest) > 0 ? version : highest
  })

  if (compareVersions(head.version, floorVersion) > 0) {
    return {
      ok: true,
      changes,
      message: `MCP_SERVER_VERSION went from ${floorVersion} to `
        + `${head.version}.`,
    }
  }

  const { level: suggestedLevel, reasons } = suggestBump(
    surfaceChanged ? base.surface : null,
    surfaceChanged ? head.surface : null,
  )
  const mainIsAhead = main?.version != null
    && compareVersions(main.version, base.version ?? '0.0.0') > 0
  const header = mainIsAhead
    ? `The MCP surface changed and main is already at ${main.version}; bump `
    + `above it (head ${head.version}, merge base ${base.version}).`
    : 'The MCP surface changed but MCP_SERVER_VERSION did not increase '
      + `(base ${base.version}, head ${head.version}).`
  const lines = [
    header,
    ...changes.map((change) => {
      return `  - ${change}`
    }),
    ...reasons.map((reason) => {
      return `    ${reason}`
    }),
    `Suggested bump: ${suggestedLevel} `
    + `(${bumpVersion(floorVersion, suggestedLevel)}). Major for a removed `
    + 'tool, a removed or renamed input or a new required input; minor for '
    + 'an added tool or an added optional input; patch for text-only '
    + 'changes.',
    `Set MCP_SERVER_VERSION in ${SERVER_CONFIG_PATH} and the version in `
    + `${SERVER_JSON_PATH} and plugins/besidka. Merging then publishes it `
    + 'to the MCP Registry.',
  ]

  return { ok: false, changes, message: lines.join('\n') }
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function readFileAtRevision(revision, path, runGit = git) {
  const listing = runGit(['ls-tree', '--name-only', revision, '--', path])

  if (listing === '') {
    return null
  }

  return runGit(['show', `${revision}:${path}`])
}

function parseJsonOrNull(source) {
  return source === null ? null : JSON.parse(source)
}

function readHeadFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

export function readSnapshot(readFile) {
  return {
    surface: parseJsonOrNull(readFile(SURFACE_PATH)),
    serverManifest: parseJsonOrNull(readFile(SERVER_JSON_PATH)),
    version: readServerVersion(readFile(SERVER_CONFIG_PATH)),
  }
}

function main() {
  const baseArgument = process.argv
    .find((argument) => {
      return argument.startsWith('--base=')
    })
    ?.slice('--base='.length)
  const baseRef = baseArgument || 'origin/main'
  let result

  try {
    const mergeBase = git(['merge-base', baseRef, 'HEAD'])

    result = checkMcpVersion({
      base: readSnapshot((path) => {
        return readFileAtRevision(mergeBase, path)
      }),
      head: readSnapshot(readHeadFile),
      main: {
        version: readServerVersion(
          readFileAtRevision(baseRef, SERVER_CONFIG_PATH),
        ),
      },
    })
  } catch (exception) {
    console.error(
      `::error::The MCP version guard could not run: ${exception.message}`,
    )
    console.error(
      `Fetch the base with "git fetch origin main", make sure the checkout `
      + 'has history, and check that config/mcp-server.ts declares '
      + 'MCP_SERVER_VERSION as a plain MAJOR.MINOR.PATCH string.',
    )
    process.exit(2)
  }

  if (!result.ok) {
    console.error(`::error::${result.message.split('\n')[0]}`)
    console.error(result.message)
    process.exit(1)
  }

  console.log(result.message)
}

const isEntryPoint = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntryPoint) {
  main()
}
