#!/usr/bin/env node

/**
 * Fails when the public MCP surface changed without a higher
 * MCP_SERVER_VERSION. Compares the working tree with the merge base of
 * origin/main: config/mcp-surface.json (tools, schemas, scopes, annotations,
 * server text) and every server.json field except `version`. A file that does
 * not exist on the base counts as a new baseline, not as a change. See
 * "When to publish again" in docs/mcp-marketplaces.md.
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

export function checkMcpVersion({ base, head }) {
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

  if (base.version === null) {
    return {
      ok: true,
      changes,
      message: 'MCP_SERVER_VERSION is new on this branch.',
    }
  }

  if (compareVersions(head.version, base.version) > 0) {
    return {
      ok: true,
      changes,
      message: `MCP_SERVER_VERSION went from ${base.version} to `
        + `${head.version}.`,
    }
  }

  const { level: suggestedLevel, reasons } = suggestBump(
    surfaceChanged ? base.surface : null,
    surfaceChanged ? head.surface : null,
  )
  const lines = [
    'The MCP surface changed but MCP_SERVER_VERSION did not increase '
    + `(base ${base.version}, head ${head.version}).`,
    ...changes.map((change) => {
      return `  - ${change}`
    }),
    ...reasons.map((reason) => {
      return `    ${reason}`
    }),
    `Suggested bump: ${suggestedLevel} `
    + `(${bumpVersion(base.version, suggestedLevel)}). Major for a removed `
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

function readBaseFile(mergeBase, path) {
  try {
    return git(['show', `${mergeBase}:${path}`])
  } catch {
    return null
  }
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
  let mergeBase

  try {
    mergeBase = git(['merge-base', baseRef, 'HEAD'])
  } catch {
    console.error(
      `Could not find the merge base with ${baseRef}. Fetch it with `
      + `"git fetch origin main" and make sure the checkout has history.`,
    )
    process.exit(2)
  }

  const result = checkMcpVersion({
    base: readSnapshot((path) => {
      return readBaseFile(mergeBase, path)
    }),
    head: readSnapshot(readHeadFile),
  })

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
