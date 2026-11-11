import { Inflate, Unzlib } from 'fflate'
import { VALIDATION_LIMITS } from './rules.ts'
import type { ZipEntry } from './zip.ts'

export type InflateResult
  = | { ok: true, data: Uint8Array }
    | { ok: false, code: string, detail: string }

class InflateCapExceeded extends Error {}

/**
 * Inflates one entry through the streaming decoder with a running byte cap
 * equal to the declared size, pushing slices of 4 KiB. Declared sizes can be
 * forged (a patched archive can declare 200 MiB as 1 KiB), so the cap is what
 * stops a bomb and a length that differs from the declaration is rejected.
 */
export function inflateEntry(
  archive: Uint8Array,
  entry: ZipEntry,
): InflateResult {
  const raw = archive.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  )

  if (entry.method === 0) {
    return { ok: true, data: raw.slice() }
  }

  const output = new Uint8Array(entry.uncompressedSize)
  let written = 0

  try {
    const inflater = new Inflate((chunk) => {
      if (written + chunk.length > entry.uncompressedSize) {
        throw new InflateCapExceeded()
      }

      output.set(chunk, written)
      written += chunk.length
    })

    for (
      let start = 0;
      start < raw.length;
      start += VALIDATION_LIMITS.inflateSliceBytes
    ) {
      const end = Math.min(
        start + VALIDATION_LIMITS.inflateSliceBytes,
        raw.length,
      )

      inflater.push(raw.subarray(start, end), end === raw.length)
    }

    if (raw.length === 0) {
      inflater.push(new Uint8Array(0), true)
    }
  } catch (exception) {
    if (exception instanceof InflateCapExceeded) {
      return {
        ok: false,
        code: 'zip_size_mismatch',
        detail: `Entry ${entry.name.slice(0, 80)} inflates beyond its declared size`,
      }
    }

    return {
      ok: false,
      code: 'zip_corrupt',
      detail: `Entry ${entry.name.slice(0, 80)} is not valid deflate data`,
    }
  }

  if (written !== entry.uncompressedSize) {
    return {
      ok: false,
      code: 'zip_size_mismatch',
      detail: `Entry ${entry.name.slice(0, 80)} inflated to ${written}, declared ${entry.uncompressedSize}`,
    }
  }

  return { ok: true, data: output }
}

/**
 * Same streaming cap for a raw zlib stream inside a PDF (object streams and
 * metadata), without a declared size: `maxBytes` is the bound.
 */
export function inflateZlibCapped(
  raw: Uint8Array,
  maxBytes: number,
): InflateResult {
  const chunks: Uint8Array[] = []
  let written = 0

  try {
    const inflater = new Unzlib((chunk) => {
      written += chunk.length

      if (written > maxBytes) {
        throw new InflateCapExceeded()
      }

      chunks.push(chunk.slice())
    })
    for (
      let start = 0;
      start < raw.length;
      start += VALIDATION_LIMITS.inflateSliceBytes
    ) {
      const end = Math.min(
        start + VALIDATION_LIMITS.inflateSliceBytes,
        raw.length,
      )

      inflater.push(raw.subarray(start, end), end === raw.length)
    }
  } catch (exception) {
    if (exception instanceof InflateCapExceeded) {
      return { ok: false, code: 'pdf_inflate_limit', detail: 'Stream inflates beyond the cap' }
    }

    return { ok: false, code: 'pdf_malformed', detail: 'Invalid Flate stream' }
  }

  const data = new Uint8Array(written)
  let offset = 0

  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }

  return { ok: true, data }
}
