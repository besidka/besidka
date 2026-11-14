export interface SkillFileTreeRow {
  key: string
  type: 'directory' | 'file'
  name: string
  path: string
  depth: number
  bytes: number
}

/**
 * A flat, indented list of the skill's files with a row for every folder
 * above them, sorted so folders and files of one folder stay together and
 * `SKILL.md` leads. Flat on purpose: it renders as one `menu` list and as the
 * options of a `select` on small screens.
 */
export function buildSkillFileTreeRows(
  files: Array<{ path: string, bytes: number }>,
): SkillFileTreeRow[] {
  const rows: SkillFileTreeRow[] = []
  const seenDirectories = new Set<string>()
  const sorted = [...files].sort((left, right) => {
    if (left.path === 'SKILL.md') {
      return -1
    }

    if (right.path === 'SKILL.md') {
      return 1
    }

    return left.path.localeCompare(right.path)
  })

  for (const file of sorted) {
    const segments = file.path.split('/')

    segments.slice(0, -1).forEach((segment, index) => {
      const directoryPath = segments.slice(0, index + 1).join('/')

      if (seenDirectories.has(directoryPath)) {
        return
      }

      seenDirectories.add(directoryPath)
      rows.push({
        key: `directory:${directoryPath}`,
        type: 'directory',
        name: segment,
        path: directoryPath,
        depth: index,
        bytes: 0,
      })
    })

    rows.push({
      key: `file:${file.path}`,
      type: 'file',
      name: segments.at(-1) ?? file.path,
      path: file.path,
      depth: segments.length - 1,
      bytes: file.bytes,
    })
  }

  return rows
}
