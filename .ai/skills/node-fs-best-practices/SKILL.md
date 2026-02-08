---
name: node-fs-best-practices
description: Node.js filesystem best practices. Use when reviewing or writing code that uses node:fs, especially to avoid wasteful sync reads, incorrect existsSync+statSync checks, or manual recursive deletes.
---

# Node.js fs best practices

## Goals

- Avoid loading entire files into memory when only a slice is needed
- Avoid redundant and racy filesystem existence checks
- Prefer correct, efficient recursive delete APIs

## Preferred patterns

### Read a file slice without loading everything

Avoid `readFileSync(path).slice(0, max)`.

Use streaming or partial reads instead:

```ts
import { createReadStream } from 'node:fs'

function readHead(path: string, maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = createReadStream(path, { start: 0, end: maxBytes - 1 })

    stream.on('data', (chunk) => {
      chunks.push(chunk)
    })
    stream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    stream.on('error', reject)
  })
}
```

If you already have a file descriptor, use `fs.read` with an explicit buffer and length.

### Check existence by handling stat errors

Avoid `existsSync(path)` followed by `statSync(path)`.

Prefer a single `stat` call and handle errors:

```ts
import { stat } from 'node:fs/promises'

async function getStat(path: string) {
  try {
    return await stat(path)
  } catch (exception) {
    if (
      exception instanceof Error
      && 'code' in exception
      && (exception as { code?: string }).code === 'ENOENT'
    ) {
      return null
    }

    throw exception
  }
}
```

This avoids TOCTOU races and covers permission errors correctly.

### Delete directories recursively

Avoid manual `readdirSync(...).map(...unlinkSync...)` loops.

Use the built-in recursive delete:

```ts
import { rm } from 'node:fs/promises'

await rm(path, { recursive: true, force: true })
```

## Review checklist

- No `readFileSync(...).slice(...)` for partial reads
- No `existsSync` before `stat` or `lstat`
- No manual recursive delete loops when `rm(..., { recursive: true })` fits
- Prefer async (`node:fs/promises`) APIs in server code to avoid blocking
