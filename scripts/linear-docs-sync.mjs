#!/usr/bin/env node

/**
 * Mirrors docs/**\/*.md into Linear team documents (team BES) so the docs
 * can be read and linked from Linear. The repo stays the source of truth:
 * every synced document starts with a banner pointing back to GitHub, and
 * edits made in Linear are overwritten on the next sync.
 *
 * docs/.linear-docs.json maps each docs path to its Linear document id. New
 * files get a new document and a new entry; renamed files keep their
 * document; deleted files delete their document (Linear keeps it in
 * "Recently deleted" for 30 days). The "Docs index" document is rebuilt on
 * every run and links every part of a split doc.
 *
 * Linear rejects document content above 250,000 characters with an
 * "Argument Validation Error" (inferred: the API does not document the limit
 * for documents; 226,338 characters synced and 259,849 failed, and Linear
 * caps other Markdown bodies at 250,000). A doc whose rendered content is
 * longer than MAX_DOCUMENT_CHARACTERS (240,000) is split at its top-level
 * headings into "<title> (part N of M)" documents. Its map entry is then an
 * ordered array of ids, one per part: part 1 keeps the id the single document
 * had, new parts are created, and parts that no longer exist are deleted.
 *
 * A failing document does not stop the others: failures are collected,
 * printed with Linear's validation details, and fail the job at the end.
 *
 * The last fully synced commit is recorded in the Docs index document. Each
 * run syncs every docs change between that commit and HEAD, so runs that
 * were skipped or canceled are caught up; with no recorded commit (or one
 * that is not an ancestor of HEAD) it syncs everything.
 *
 * Runs from .github/workflows/linear-docs-sync.yml on pushes to main that
 * touch docs/**, or by hand:
 *   LINEAR_API_KEY=lin_api_... node scripts/linear-docs-sync.mjs --all
 *   node scripts/linear-docs-sync.mjs --dry-run
 *
 * --dry-run prints the planned creates, updates and deletes of a full sync,
 * with part counts and sizes, without a key, without any request and without
 * writing the document map.
 *
 * Env:
 *   LINEAR_API_KEY  personal API key with write access (required unless
 *                   --dry-run)
 *   FULL_SYNC=true  same as --all
 *   DRY_RUN=true    same as --dry-run
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import {
  MAX_DOCUMENT_CHARACTERS,
  documentIds,
  partTitle,
  planDocumentParts,
  splitMarkdown,
  storeDocumentIds,
} from './linear-docs-split.mjs'
import { linearRequest } from './linear-request.mjs'

const ROOT = process.cwd()
const DOCS_DIR = join(ROOT, 'docs')
const MAP_FILE = join(DOCS_DIR, '.linear-docs.json')
const REPO_URL = 'https://github.com/besidka/besidka'
const API_URL = process.env.LINEAR_API_URL
  || 'https://api.linear.app/graphql'
const UPDATE_MUTATION = `mutation($id: String!, $input: DocumentUpdateInput!) {
  documentUpdate(id: $id, input: $input) { success }
}`
const CREATE_MUTATION = `mutation($input: DocumentCreateInput!) {
  documentCreate(input: $input) { success document { id } }
}`
const DELETE_MUTATION = `mutation($id: String!) {
  documentDelete(id: $id) { success }
}`

const TITLE_LIMIT = 250
const PART_TITLE_BASE_LIMIT = 230
const PART_BANNER_PLACEHOLDER_COUNT = 999
const PART_SEPARATOR_LENGTH = '\n\n'.length + '\n'.length

const apiKey = process.env.LINEAR_API_KEY
const dryRun = process.argv.includes('--dry-run')
  || process.env.DRY_RUN === 'true'

if (!apiKey && !dryRun) {
  console.log(
    '::warning::LINEAR_API_KEY is not set, skipping the Linear docs sync',
  )
  process.exit(0)
}

const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))
const commitSha = git('rev-parse', 'HEAD').trim()
const shortSha = commitSha.slice(0, 8)
const fullSync = process.argv.includes('--all')
  || process.env.FULL_SYNC === 'true'
const failures = []

async function main() {
  if (dryRun) {
    planDryRun()

    return
  }

  const syncedSha = fullSync ? null : await lastSyncedSha()

  if (syncedSha === commitSha) {
    console.log(`Already synced at ${shortSha}`)

    return
  }

  const changes = syncedSha ? changedDocs(syncedSha) : null

  if (changes === null) {
    console.log('Full sync of docs/')

    for (const path of Object.keys(map.documents)) {
      if (!existsSync(join(DOCS_DIR, path))) {
        await removeDocument(path)
      }
    }

    for (const path of listDocs()) {
      await upsert(path)
    }
  } else {
    console.log(`Syncing ${changes.length} changed file(s)`)

    for (const change of changes) {
      await applyChange(change)
    }
  }

  map.documents = Object.fromEntries(
    Object.entries(map.documents).sort(([first], [second]) => {
      return first.localeCompare(second)
    }),
  )
  writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`)

  await rebuildIndex(failures.length ? syncedSha : commitSha)

  if (failures.length) {
    console.log(
      `::error::${failures.length} document(s) failed: ${failures.join(', ')}`,
    )
    process.exit(1)
  }
}

async function applyChange(change) {
  if (change.status === 'D') {
    await removeDocument(change.path)

    return
  }

  if (change.status === 'R') {
    const previousId = map.documents[change.from]

    if (previousId && !map.documents[change.path]) {
      map.documents[change.path] = previousId
    }

    delete map.documents[change.from]
  }

  await upsert(change.path)
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function listDocs(directory = DOCS_DIR) {
  const paths = []

  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name)

    if (statSync(fullPath).isDirectory()) {
      paths.push(...listDocs(fullPath))
    } else if (name.endsWith('.md')) {
      paths.push(relative(DOCS_DIR, fullPath))
    }
  }

  return paths.sort()
}

/**
 * Returns [{ status: 'M'|'D'|'R', path, from? }] for docs/*.md files changed
 * since `before`, or null when a full sync is needed.
 */
function changedDocs(before) {
  let output

  try {
    git('merge-base', '--is-ancestor', before, commitSha)
    output = git('diff', '--name-status', '-M', before, commitSha, '--', 'docs')
  } catch {
    return null
  }

  const changes = []

  for (const line of output.split('\n').filter(Boolean)) {
    const [rawStatus, firstPath, secondPath] = line.split('\t')
    const status = rawStatus[0]
    const path = toDocPath(secondPath ?? firstPath)
    const isMarkdown = path.endsWith('.md')
      || (status === 'R' && firstPath.endsWith('.md'))

    if (!isMarkdown) {
      continue
    }

    if (status === 'R') {
      changes.push({ status, from: toDocPath(firstPath), path })
    } else {
      changes.push({ status: status === 'D' ? 'D' : 'M', path })
    }
  }

  return changes
}

function toDocPath(path) {
  return path.replace(/^docs\//, '')
}

function readDoc(path) {
  const lines = readFileSync(join(DOCS_DIR, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const headingIndex = lines.slice(0, 15).findIndex((line) => {
    return line.startsWith('# ')
  })
  let heading = ''

  if (headingIndex !== -1) {
    heading = lines[headingIndex].slice(2).trim()
    lines.splice(headingIndex, 1)
  }

  if (!heading) {
    heading = path
      .split('/')
      .pop()
      .replace(/\.md$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/^./, character => character.toUpperCase())
  }

  const folder = path.includes('/')
    ? path.slice(0, path.lastIndexOf('/'))
    : ''

  return {
    title: `${folder ? `[${folder}] ` : ''}${heading}`,
    body: lines.join('\n').trim(),
  }
}

function banner(path, index = 0, count = 1) {
  const part = count > 1 ? ` (part ${index + 1} of ${count})` : ''

  return `> Synced from \`docs/${path}\`${part} at `
    + `besidka/besidka@${shortSha}. Source of truth: `
    + `[GitHub](${githubUrl(path)}). `
    + 'Edits made here are overwritten on the next sync.'
}

function render(path) {
  const { title, body } = readDoc(path)

  return {
    title: title.slice(0, TITLE_LIMIT),
    content: `${banner(path)}\n\n${body}\n`,
  }
}

/**
 * Renders a doc as one Linear document, or as parts of at most
 * MAX_DOCUMENT_CHARACTERS each (banner included) when it is too long.
 */
function renderParts(path) {
  const single = render(path)

  if (single.content.length <= MAX_DOCUMENT_CHARACTERS) {
    return [single]
  }

  const { title, body } = readDoc(path)
  const bannerLength = banner(
    path,
    PART_BANNER_PLACEHOLDER_COUNT - 1,
    PART_BANNER_PLACEHOLDER_COUNT,
  ).length
  const chunks = splitMarkdown(
    body,
    MAX_DOCUMENT_CHARACTERS - bannerLength - PART_SEPARATOR_LENGTH,
  )
  const baseTitle = title.slice(0, PART_TITLE_BASE_LIMIT)

  return chunks.map((chunk, index) => {
    return {
      title: partTitle(baseTitle, index, chunks.length),
      content: `${banner(path, index, chunks.length)}\n\n${chunk.trim()}\n`,
    }
  })
}

function describePart(path, index, count) {
  return count > 1 ? `${path} (part ${index + 1} of ${count})` : path
}

function githubUrl(path) {
  return `${REPO_URL}/blob/main/docs/${path}`
}

async function upsert(path) {
  const parts = renderParts(path)
  const { ids, removed } = planDocumentParts(map.documents[path], parts.length)

  try {
    for (const [index, part] of parts.entries()) {
      const label = describePart(path, index, parts.length)
      const input = { title: part.title, content: part.content }

      if (ids[index]) {
        await request(UPDATE_MUTATION, { id: ids[index], input })
        console.log(`updated  ${label}`)

        continue
      }

      const data = await request(CREATE_MUTATION, {
        input: { ...input, teamId: map.teamId },
      })

      ids[index] = data.documentCreate.document.id
      map.documents[path] = storeDocumentIds(ids.filter(Boolean))
      console.log(`created  ${label}`)
    }

    while (removed.length) {
      await request(DELETE_MUTATION, { id: removed[0] })
      removed.shift()
      map.documents[path] = storeDocumentIds([...ids, ...removed])
      console.log(`deleted  ${path} (a part that no longer exists)`)
    }

    map.documents[path] = storeDocumentIds(ids)
  } catch (exception) {
    failures.push(path)
    console.log(`::error::${path}: ${exception.message}`)
  }
}

async function removeDocument(path) {
  const ids = documentIds(map.documents[path])

  if (!ids.length) {
    return
  }

  try {
    while (ids.length) {
      await request(DELETE_MUTATION, { id: ids[0] })
      ids.shift()
    }

    delete map.documents[path]
    console.log(`deleted  ${path}`)
  } catch (exception) {
    map.documents[path] = storeDocumentIds(ids)
    failures.push(path)
    console.log(`::error::${path}: ${exception.message}`)
  }
}

function planDryRun() {
  console.log(
    'Dry run: no requests are sent and the document map is not written. '
    + `Documents over ${MAX_DOCUMENT_CHARACTERS} characters are split.`,
  )

  for (const path of Object.keys(map.documents)) {
    if (!existsSync(join(DOCS_DIR, path))) {
      const count = documentIds(map.documents[path]).length

      console.log(`would delete  ${path} (${count} document(s))`)
    }
  }

  for (const path of listDocs()) {
    const parts = renderParts(path)
    const { ids, removed } = planDocumentParts(
      map.documents[path],
      parts.length,
    )

    parts.forEach((part, index) => {
      const action = ids[index] ? 'update' : 'create'
      const label = describePart(path, index, parts.length)

      console.log(
        `would ${action}  ${label} (${part.content.length} characters)`,
      )
    })

    for (const documentId of removed) {
      console.log(`would delete  ${path} part document ${documentId}`)
    }
  }
}

async function fetchDocumentUrls() {
  const entries = Object.entries(map.documents).flatMap(([path, entry]) => {
    return documentIds(entry).map((documentId, index) => {
      return { path, index, documentId }
    })
  })
  const urls = {}

  for (let offset = 0; offset < entries.length; offset += 50) {
    const chunk = entries.slice(offset, offset + 50)
    const fields = chunk.map(({ documentId }, index) => {
      return `d${index}: document(id: "${documentId}") { url }`
    })
    const data = await request(`query { ${fields.join(' ')} }`, {})

    chunk.forEach(({ path, index: partIndex }, index) => {
      urls[path] ??= []
      urls[path][partIndex] = data[`d${index}`]?.url
    })
  }

  return urls
}

function linearLinks(partUrls = []) {
  if (!partUrls.length) {
    return '**not synced**'
  }

  if (partUrls.length === 1) {
    return partUrls[0] ? `[Linear doc](${partUrls[0]})` : '**not synced**'
  }

  return partUrls.map((url, index) => {
    const label = `part ${index + 1} of ${partUrls.length}`

    return url ? `[Linear ${label}](${url})` : `**${label} not synced**`
  }).join(' · ')
}

async function lastSyncedSha() {
  try {
    const data = await request(
      'query($id: String!) { document(id: $id) { content } }',
      { id: map.indexDocumentId },
    )
    const match = data.document?.content?.match(
      /besidka\/commit\/([0-9a-f]{40})/,
    )

    return match?.[1] ?? null
  } catch (exception) {
    console.log(`::warning::Could not read the docs index: ${exception.message}`)

    return null
  }
}

async function rebuildIndex(syncedSha) {
  try {
    const urls = await fetchDocumentUrls()
    const groups = new Map()

    for (const path of listDocs()) {
      const folder = path.includes('/')
        ? path.slice(0, path.lastIndexOf('/'))
        : ''

      groups.set(folder, [...(groups.get(folder) ?? []), path])
    }

    const lines = [
      'Index of the engineering docs in the repo\'s `docs/` folder, synced '
      + 'automatically on every push to main. The repo is the source of '
      + 'truth; edit docs there.',
      '',
      syncedSha
        ? `Last sync: [${syncedSha.slice(0, 8)}]`
        + `(${REPO_URL}/commit/${syncedSha})`
        : 'Last sync had failures; the next run re-syncs everything.',
    ]

    for (const folder of [...groups.keys()].sort()) {
      const heading = folder ? `docs/${folder}/` : 'docs/ (root)'

      lines.push('', `## ${heading}`, '')

      for (const path of groups.get(folder)) {
        const { title } = render(path)
        const linearLink = linearLinks(urls[path])

        lines.push(
          `- **${title}** — \`${path}\` · ${linearLink} · `
          + `[GitHub](${githubUrl(path)})`,
        )
      }
    }

    await request(UPDATE_MUTATION, {
      id: map.indexDocumentId,
      input: { content: `${lines.join('\n')}\n` },
    })
    console.log('updated  docs index')
  } catch (exception) {
    failures.push('docs index')
    console.log(`::error::docs index: ${exception.message}`)
  }
}

function request(query, variables) {
  return linearRequest({ apiUrl: API_URL, apiKey, query, variables })
}

await main()
