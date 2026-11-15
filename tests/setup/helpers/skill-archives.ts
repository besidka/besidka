import { strToU8, zipSync } from 'fflate'
import type { ZipOptions } from 'fflate'

export type ArchiveEntry = string | Uint8Array | [Uint8Array, ZipOptions]

const END_RECORD_SIGNATURE = 0x06054B50
const CENTRAL_RECORD_SIGNATURE = 0x02014B50

export function skillMarkdown(
  input: {
    name?: string
    description?: string
    extra?: string
    body?: string
  } = {},
): string {
  return [
    '---',
    `name: ${input.name ?? 'review-pr'}`,
    `description: ${input.description ?? 'Review a pull request carefully'}`,
    ...(input.extra ? [input.extra] : []),
    '---',
    input.body ?? '# Review\n\nRead the diff and list the risks.\n',
  ].join('\n')
}

export function buildArchive(
  entries: Record<string, ArchiveEntry>,
  options: ZipOptions = {},
): Uint8Array {
  const zippable: Record<string, [Uint8Array, ZipOptions] | Uint8Array> = {}

  for (const [name, entry] of Object.entries(entries)) {
    zippable[name] = typeof entry === 'string' ? strToU8(entry) : entry
  }

  return zipSync(zippable, options)
}

export function buildSymlinkArchive(): Uint8Array {
  const UNIX_SYMLINK_MODE = 0o120777

  return buildArchive({
    'skill/SKILL.md': skillMarkdown(),
    'skill/link.md': [
      strToU8('/etc/passwd'),
      { os: 3, attrs: UNIX_SYMLINK_MODE * 0x10000 },
    ],
  })
}

function findEndRecord(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === END_RECORD_SIGNATURE) {
      return offset
    }
  }

  throw new Error('No end record')
}

export function forgeCentralSizes(
  bytes: Uint8Array,
  entryName: string,
  sizes: { uncompressed?: number, compressed?: number },
): Uint8Array {
  const forged = bytes.slice()
  const view = new DataView(forged.buffer)
  const endOffset = findEndRecord(forged)
  const count = view.getUint16(endOffset + 10, true)
  let offset = view.getUint32(endOffset + 16, true)

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_RECORD_SIGNATURE) {
      throw new Error('Bad central record')
    }

    const nameLength = view.getUint16(offset + 28, true)
    const name = new TextDecoder().decode(
      forged.subarray(offset + 46, offset + 46 + nameLength),
    )

    if (name === entryName) {
      if (sizes.uncompressed !== undefined) {
        view.setUint32(offset + 24, sizes.uncompressed, true)
      }

      if (sizes.compressed !== undefined) {
        view.setUint32(offset + 20, sizes.compressed, true)
      }
    }

    offset += 46
      + nameLength
      + view.getUint16(offset + 30, true)
      + view.getUint16(offset + 32, true)
  }

  return forged
}

export function markAsZip64(bytes: Uint8Array): Uint8Array {
  const forged = bytes.slice()
  const view = new DataView(forged.buffer)
  const endOffset = findEndRecord(forged)

  view.setUint16(endOffset + 10, 0xFFFF, true)

  return forged
}

export function validSkillArchive(
  extraFiles: Record<string, ArchiveEntry> = {},
  markdown: string = skillMarkdown(),
): Uint8Array {
  return buildArchive({
    'review-pr/SKILL.md': markdown,
    'review-pr/references/checklist.md': '- Check tests\n',
    ...Object.fromEntries(
      Object.entries(extraFiles).map(([name, entry]) => {
        return [`review-pr/${name}`, entry]
      }),
    ),
  })
}
