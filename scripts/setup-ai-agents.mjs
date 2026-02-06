import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.cwd()
const force = process.env.AI_LINK_FORCE === '1'

const links = [
  {
    kind: 'dir',
    link: '.claude/skills',
    target: '.ai/skills',
  },
  {
    kind: 'dir',
    link: '.cursor/rules',
    target: '.ai/rules',
  },
  {
    kind: 'dir',
    link: '.windsurf/rules',
    target: '.ai/rules',
  },
  {
    kind: 'file',
    link: '.github/copilot-instructions.md',
    target: 'AGENTS.md',
  },
  {
    kind: 'file',
    link: 'CLAUDE.md',
    target: 'AGENTS.md',
  },
]

function log(message) {
  process.stdout.write(`${message}\n`)
}

function resolvePath(relativePath) {
  return path.join(repositoryRoot, relativePath)
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath)

    return true
  } catch (exception) {
    if (exception instanceof Error && 'code' in exception) {
      if (exception.code === 'ENOENT') {
        return false
      }
    }

    throw exception
  }
}

async function isSymlinkTo(linkPath, targetPath) {
  const stat = await fs.lstat(linkPath)
  if (!stat.isSymbolicLink()) {
    return false
  }

  const linkTarget = await fs.readlink(linkPath)
  const resolvedLink = path.resolve(path.dirname(linkPath), linkTarget)
  const resolvedTarget = path.resolve(targetPath)

  return resolvedLink === resolvedTarget
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

async function createSymlink(linkPath, targetPath, kind) {
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  const linkType = kind === 'dir'
    ? (process.platform === 'win32' ? 'junction' : 'dir')
    : 'file'

  await fs.symlink(relativeTarget, linkPath, linkType)
}

async function ensureLink({ kind, link, target }) {
  const linkPath = resolvePath(link)
  const targetPath = resolvePath(target)

  await ensureDir(path.dirname(linkPath))

  if (await pathExists(linkPath)) {
    const correctSymlink = await isSymlinkTo(linkPath, targetPath)
    if (correctSymlink) {
      log(`OK ${link} already points to ${target}`)

      return
    }

    if (!force) {
      log(`WARN ${link} exists and is not a symlink. Skipping.`)

      return
    }

    await removePath(linkPath)
  }

  await createSymlink(linkPath, targetPath, kind)
  log(`LINK ${link} -> ${target}`)
}

async function main() {
  await ensureDir(resolvePath('.ai/rules'))

  for (const link of links) {
    await ensureLink(link)
  }
}

main().catch((exception) => {
  log(`ERROR Failed to create agent links: ${exception}`)
  process.exit(1)
})
