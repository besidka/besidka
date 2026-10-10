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
 * every run.
 *
 * The last fully synced commit is recorded in the Docs index document. Each
 * run syncs every docs change between that commit and HEAD, so runs that
 * were skipped or cancelled are caught up; with no recorded commit (or one
 * that is not an ancestor of HEAD) it syncs everything.
 *
 * Runs from .github/workflows/linear-docs-sync.yml on pushes to main that
 * touch docs/**, or by hand:
 *   LINEAR_API_KEY=lin_api_... node scripts/linear-docs-sync.mjs --all
 *
 * Env:
 *   LINEAR_API_KEY  personal API key with write access (required)
 *   FULL_SYNC=true  same as --all
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

const apiKey = process.env.LINEAR_API_KEY

if (!apiKey) {
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

function render(path) {
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
  const title = `${folder ? `[${folder}] ` : ''}${heading}`.slice(0, 250)
  const banner = `> Synced from \`docs/${path}\` at `
    + `besidka/besidka@${shortSha}. Source of truth: `
    + `[GitHub](${githubUrl(path)}). `
    + 'Edits made here are overwritten on the next sync.'

  return { title, content: `${banner}\n\n${lines.join('\n').trim()}\n` }
}

function githubUrl(path) {
  return `${REPO_URL}/blob/main/docs/${path}`
}

async function upsert(path) {
  const { title, content } = render(path)
  const documentId = map.documents[path]

  try {
    if (documentId) {
      await request(UPDATE_MUTATION, {
        id: documentId,
        input: { title, content },
      })
      console.log(`updated  ${path}`)

      return
    }

    const data = await request(CREATE_MUTATION, {
      input: { title, content, teamId: map.teamId },
    })

    map.documents[path] = data.documentCreate.document.id
    console.log(`created  ${path}`)
  } catch (exception) {
    failures.push(path)
    console.log(`::error::${path}: ${exception.message}`)
  }
}

async function removeDocument(path) {
  const documentId = map.documents[path]

  if (!documentId) {
    return
  }

  try {
    await request(DELETE_MUTATION, { id: documentId })
    delete map.documents[path]
    console.log(`deleted  ${path}`)
  } catch (exception) {
    failures.push(path)
    console.log(`::error::${path}: ${exception.message}`)
  }
}

async function fetchDocumentUrls() {
  const entries = Object.entries(map.documents)
  const urls = {}

  for (let offset = 0; offset < entries.length; offset += 50) {
    const chunk = entries.slice(offset, offset + 50)
    const fields = chunk.map(([, documentId], index) => {
      return `d${index}: document(id: "${documentId}") { url }`
    })
    const data = await request(`query { ${fields.join(' ')} }`, {})

    chunk.forEach(([path], index) => {
      urls[path] = data[`d${index}`]?.url
    })
  }

  return urls
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
        const linearLink = urls[path]
          ? `[Linear doc](${urls[path]})`
          : '**not synced**'

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

async function request(query, variables, attempt = 1) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json().catch(() => ({}))
  const isRateLimited = response.status === 429
    || body.errors?.some((error) => {
      return error.extensions?.code === 'RATELIMITED'
    })

  if (isRateLimited && attempt < 4) {
    await new Promise(resolve => setTimeout(resolve, attempt * 15_000))

    return request(query, variables, attempt + 1)
  }

  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map(error => error.message).join('; ')

    throw new Error(message || `HTTP ${response.status}`)
  }

  return body.data
}

await main()
