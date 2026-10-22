#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CMS bucket manager.
 *
 * Moves CMS assets (videos, captions — images later) between the local
 * `.files` directory and the Cloudflare R2 bucket bound as CMS_BUCKET. Assets
 * are served from CMS_BUCKET via /videos/<name> in the app.
 *
 * Two actions:
 *
 *   upload    Preflight every asset first (videos must already be present in
 *             `.files` and are validated; the captions file is always copied
 *             from the committed scripts/cms-assets/demo.en.vtt), then PUT
 *             each into CMS_BUCKET. Objects that already exist in the target
 *             bucket are skipped unless --force is passed, which overwrites
 *             them. Overwriting production (--remote -e production --force)
 *             additionally requires --yes. An existence check that fails for
 *             any reason other than "key not found" aborts the run.
 *
 *   download  GET each asset from CMS_BUCKET into `.files`. Files already
 *             present locally are skipped.
 *
 * Default target is local persisted R2 (.wrangler/state). Pass --remote to hit
 * remote R2, and -e/--env to pick the environment (preview | production). The
 * bucket name is read from the CMS_BUCKET binding in wrangler.jsonc for the
 * selected environment, so it stays in sync with the config.
 *
 * Managed assets (bucket keys):
 *   - demo.mp4        720p — default quality
 *   - demo-360.mp4    360p
 *   - demo-1080.mp4   1080p
 *   - demo.en.vtt     English captions (scripts/cms-assets/demo.en.vtt)
 *
 * Optional assets: every `.files/key-guide-<provider id>.mp4` present, plus
 * its `-1080` and `-360` renditions, is uploaded too (uploads only; see
 * docs/key-guides.md). Absent ones are not an error.
 *
 * Hover-preview thumbnails are NOT generated here; the player builds them on
 * the client at runtime via mediabunny's CanvasSink.
 *
 * Usage:
 *   pnpm run cms:files:upload                       seed local R2 (default)
 *   pnpm run cms:files:upload --remote              upload to preview bucket
 *   pnpm run cms:files:upload --remote -e production   upload to prod bucket
 *   pnpm run cms:files:upload --remote --force      overwrite preview objects
 *   pnpm run cms:files:upload --remote -e production --force --yes
 *                                                   overwrite prod objects
 *
 *   pnpm run cms:files:download                     pull from local R2
 *   pnpm run cms:files:download --remote            pull from preview bucket
 *   pnpm run cms:files:download --remote -e production pull from prod bucket
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

import {
  Input,
  FilePathSource,
  MP4,
} from 'mediabunny'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FILES_DIR = join(ROOT, '.files')
const COMMITTED_ASSETS_DIR = join(ROOT, 'scripts', 'cms-assets')

// wrangler appends /v3 to --persist-to internally, so we pass .wrangler/state
// (not .wrangler/state/v3) to land in the right place.
const PERSIST_DIR = join(ROOT, '.wrangler', 'state')

const VALID_ACTIONS = ['upload', 'download']
const VALID_ENVIRONMENTS = ['preview', 'production']

const EXISTENCE_PROBE_BYTES = 64 * 1024
const NOT_FOUND_MESSAGE = 'The specified key does not exist'
const DOCS_HINT = 'docs/landing-studio.md ("Demo video player" section)'

/**
 * Managed assets. `key` is both the local filename (in .files) and the R2
 * object key. Videos are provided locally and must already exist in .files.
 * An asset with `committedSource` is always copied from scripts/cms-assets over
 * its local copy. `kind: 'video'` enables validation.
 */
const ASSETS = [
  {
    key: 'demo.mp4',
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo-360.mp4',
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo-1080.mp4',
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo.en.vtt',
    committedSource: join(COMMITTED_ASSETS_DIR, 'demo.en.vtt'),
    contentType: 'text/vtt; charset=utf-8',
    kind: 'captions',
  },
]

const KEY_GUIDE_VIDEO_PATTERN = /^key-guide-[a-z0-9]+(-1080|-360)?\.mp4$/

function discoverKeyGuideAssets() {
  if (!existsSync(FILES_DIR)) {
    return []
  }

  return readdirSync(FILES_DIR)
    .filter((name) => {
      return KEY_GUIDE_VIDEO_PATTERN.test(name)
    })
    .sort()
    .map((name) => {
      return { key: name, contentType: 'video/mp4', kind: 'video' }
    })
}

/**
 * Parse CLI args forwarded by pnpm.
 *
 *   <action>                 upload | download (first positional, required)
 *   --remote                 target remote R2 instead of local persisted R2
 *   --force                  upload even when the object already exists in the
 *                            target bucket (overwrite); default is to skip
 *   --yes                    confirm overwriting production
 *                            (--remote -e production --force)
 *   -e / --env <name>        environment (preview | production)
 *   -e=<name> / --env=<name> inline form of the above
 */
function parseArgs(argv) {
  const args = argv.slice(2)
  const action = args.find((arg) => {
    return !arg.startsWith('-')
  })

  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(
      `Missing or unknown action "${action ?? ''}".`
      + ` Use one of: ${VALID_ACTIONS.join(', ')}`,
    )
  }

  const remote = args.includes('--remote')
  const force = args.includes('--force')
  const yes = args.includes('--yes')

  if (action === 'download' && (force || yes)) {
    throw new Error('--force and --yes only apply to the upload action')
  }

  let environment = 'preview'

  const inlineEnv = args.find((arg) => {
    return arg.startsWith('-e=') || arg.startsWith('--env=')
  })

  if (inlineEnv) {
    environment = inlineEnv.split('=')[1]
  } else {
    const flagIndex = args.findIndex((arg) => {
      return arg === '-e' || arg === '--env'
    })

    if (flagIndex !== -1 && args[flagIndex + 1]) {
      environment = args[flagIndex + 1]
    }
  }

  if (!VALID_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `Unknown environment "${environment}".`
      + ` Use one of: ${VALID_ENVIRONMENTS.join(', ')}`,
    )
  }

  return { action, remote, force, yes, environment }
}

/**
 * Read the CMS_BUCKET bucket name from wrangler.jsonc for the given
 * environment. "preview" uses the top-level config; "production" uses the
 * env.production block. Strips JSONC comments and trailing commas first.
 */
function resolveBucketName(environment) {
  const raw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
  const stripped = raw
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1')
  const config = JSON.parse(stripped)

  const scope = environment === 'production'
    ? config.env?.production
    : config

  const bucket = scope?.r2_buckets?.find((entry) => {
    return entry.binding === 'CMS_BUCKET'
  })

  if (!bucket) {
    throw new Error(
      `No CMS_BUCKET bucket configured for environment "${environment}"`
      + ' in wrangler.jsonc',
    )
  }

  return bucket.bucket_name
}

/**
 * Build the wrangler storage-location flags shared by get/put. Local R2 needs
 * --local plus a persistence directory; remote R2 just needs --remote.
 */
function locationFlags(remote) {
  if (remote) {
    return ['--remote']
  }

  return ['--local', `--persist-to=${PERSIST_DIR}`]
}

async function validateVideo(filePath) {
  console.log('\nValidating video with mediabunny...')

  const source = new FilePathSource(filePath)
  const input = new Input({ formats: [MP4], source })

  const canRead = await input.canRead()

  if (!canRead) {
    input.dispose()
    throw new Error('File is not a readable MP4')
  }

  const duration = await input.getDurationFromMetadata()
  const videoTracks = await input.getVideoTracks()
  const audioTracks = await input.getAudioTracks()
  const primaryVideo = await input.getPrimaryVideoTrack()
  const primaryAudio = await input.getPrimaryAudioTrack()

  const videoCodec = primaryVideo ? await primaryVideo.getCodec() : null
  const audioCodec = primaryAudio ? await primaryAudio.getCodec() : null

  const { size } = await stat(filePath)

  const durationLabel = duration !== null
    ? `${duration.toFixed(2)}s`
    : 'unknown'

  console.log('  Format:   MP4')
  console.log(`  Duration: ${durationLabel}`)
  console.log(`  Size:     ${(size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  Video:    ${videoTracks.length} track(s) — codec: ${videoCodec ?? 'unknown'}`)
  console.log(`  Audio:    ${audioTracks.length} track(s) — codec: ${audioCodec ?? 'unknown'}`)

  if (primaryVideo) {
    const width = primaryVideo.displayWidth
    const height = primaryVideo.displayHeight

    if (width && height) {
      console.log(`  Dims:     ${width}×${height}`)
    }
  }

  const videoCodecStr = String(videoCodec ?? '').toLowerCase()
  const audioCodecStr = String(audioCodec ?? '').toLowerCase()
  const isH264 = videoCodecStr.includes('h264')
    || videoCodecStr.includes('avc')
  const isAac = audioCodecStr.includes('aac')
    || audioTracks.length === 0

  if (!isH264) {
    console.warn(
      `  ⚠ Video codec "${videoCodec}" is not H.264.`
      + ' Browser compatibility may be reduced.',
    )
  } else {
    console.log('  ✓ H.264 video confirmed')
  }

  if (!isAac && audioTracks.length > 0) {
    console.warn(
      `  ⚠ Audio codec "${audioCodec}" is not AAC.`
      + ' Browser compatibility may be reduced.',
    )
  } else if (audioTracks.length > 0) {
    console.log('  ✓ AAC audio confirmed')
  }

  input.dispose()

  return { size, durationLabel }
}

/**
 * Make sure a validated local copy of an asset exists. Videos are never
 * fetched or generated: a missing one fails with an actionable error. Assets
 * with a committed source are always copied over their local copy so a stale
 * `.files` entry can never be uploaded.
 */
async function prepareLocalAsset(asset) {
  const filePath = join(FILES_DIR, asset.key)

  if (asset.committedSource) {
    await mkdir(dirname(filePath), { recursive: true })
    await copyFile(asset.committedSource, filePath)
    console.log(`\n✓ Copied ${asset.committedSource} → ${filePath}`)
  } else if (!existsSync(filePath)) {
    throw new Error(
      `Missing video ".files/${asset.key}".`
      + ` Render or copy the file into .files/${asset.key} and retry;`
      + ` see ${DOCS_HINT}.`,
    )
  } else {
    console.log(`\nUsing local ${asset.key}`)
  }

  if (asset.kind === 'video') {
    const { size, durationLabel } = await validateVideo(filePath)

    return { asset, filePath, size, durationLabel }
  }

  const { size } = await stat(filePath)

  return { asset, filePath, size, durationLabel: '-' }
}

/**
 * Probe whether an object exists without downloading it. wrangler has no
 * `info`/`head` command, so this starts `r2 object get --pipe`, treats a
 * clean exit or the first 64 KiB of object data as "exists" and kills the
 * child before a large transfer completes (wrangler prints a stray newline
 * to stdout on failure, so a single byte proves nothing). Only the exact
 * "key does not exist" error means absent; any other failure rejects so the
 * run aborts instead of overwriting blindly.
 */
function objectExists(bucketName, key, remote) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'wrangler',
        'r2',
        'object',
        'get',
        `${bucketName}/${key}`,
        '--pipe',
        ...locationFlags(remote),
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
    )

    let stderr = ''
    let receivedBytes = 0
    let isSettled = false

    function settle(callback) {
      if (isSettled) {
        return
      }

      isSettled = true
      callback()
    }

    child.stdout.on('data', (chunk) => {
      receivedBytes += chunk.length

      if (receivedBytes < EXISTENCE_PROBE_BYTES) {
        return
      }

      settle(() => {
        child.kill('SIGKILL')
        resolve(true)
      })
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (exception) => {
      settle(() => {
        reject(exception)
      })
    })

    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve(true)

          return
        }

        if (stderr.includes(NOT_FOUND_MESSAGE)) {
          resolve(false)

          return
        }

        reject(new Error(
          `Could not determine whether "${bucketName}/${key}" exists`
          + ` (wrangler exit ${code}). Refusing to continue.\n`
          + stderr.trim(),
        ))
      })
    })
  })
}

function runWrangler(args) {
  return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

function describeCommand(args) {
  return ['pnpm exec wrangler', ...args].join(' ')
}

function putObject(bucketName, asset, filePath, remote) {
  const target = remote ? 'remote' : 'local'

  console.log(`\nUploading "${bucketName}/${asset.key}" (${target})...`)

  const args = [
    'r2',
    'object',
    'put',
    `${bucketName}/${asset.key}`,
    `--file=${filePath}`,
    `--content-type=${asset.contentType}`,
    ...locationFlags(remote),
  ]

  try {
    runWrangler(args)
    console.log(`  ✓ Uploaded ${asset.key}`)

    return true
  } catch (exception) {
    console.error(
      `  ✗ Upload failed for ${asset.key}:`,
      exception instanceof Error ? exception.message : String(exception),
    )
    console.log('\n  You can retry manually:')
    console.log(`    ${describeCommand(args)}`)

    return false
  }
}

function getObject(bucketName, key, filePath, remote) {
  const target = remote ? 'remote' : 'local'

  console.log(`\nDownloading "${bucketName}/${key}" (${target})...`)
  console.log(`  → ${filePath}`)

  const args = [
    'r2',
    'object',
    'get',
    `${bucketName}/${key}`,
    `--file=${filePath}`,
    ...locationFlags(remote),
  ]

  try {
    runWrangler(args)
    console.log(`  ✓ Downloaded ${key}`)

    return true
  } catch (exception) {
    console.error(
      `  ✗ Download failed for ${key}:`,
      exception instanceof Error ? exception.message : String(exception),
    )
    console.log('\n  You can retry manually:')
    console.log(`    ${describeCommand(args)}`)

    return false
  }
}

function printUploadPlan(prepared) {
  console.log('\nAssets to overwrite:')

  for (const { asset, size, durationLabel } of prepared) {
    const megabytes = (size / 1024 / 1024).toFixed(2)

    console.log(`  - ${asset.key}  ${megabytes} MB  duration ${durationLabel}`)
  }
}

async function runUpload(bucketName, { remote, force, yes, environment }) {
  const prepared = []

  for (const asset of [...ASSETS, ...discoverKeyGuideAssets()]) {
    prepared.push(await prepareLocalAsset(asset))
  }

  const isProductionOverwrite = remote
    && environment === 'production'
    && force

  if (isProductionOverwrite && !yes) {
    printUploadPlan(prepared)
    console.error(
      '\nRefusing to overwrite production objects without --yes.'
      + ' Re-run with --yes to confirm.',
    )

    return false
  }

  const pending = []

  for (const entry of prepared) {
    if (!force && await objectExists(bucketName, entry.asset.key, remote)) {
      console.log(
        `\nSkipping ${entry.asset.key}`
        + ` (already in ${bucketName}; use --force)`,
      )

      continue
    }

    pending.push(entry)
  }

  let hasFailures = false

  for (const { asset, filePath } of pending) {
    if (!putObject(bucketName, asset, filePath, remote)) {
      hasFailures = true
    }
  }

  return !hasFailures
}

async function runDownload(bucketName, remote) {
  await mkdir(FILES_DIR, { recursive: true })
  let hasFailures = false

  for (const asset of ASSETS) {
    const filePath = join(FILES_DIR, asset.key)

    if (existsSync(filePath)) {
      console.log(`\nSkipping ${asset.key} (already in .files)`)

      continue
    }

    const wasDownloaded = getObject(
      bucketName,
      asset.key,
      filePath,
      remote,
    )

    if (!wasDownloaded) {
      hasFailures = true
    }
  }

  return !hasFailures
}

async function main() {
  const options = parseArgs(process.argv)
  const { action, remote, force, environment } = options
  const bucketName = remote
    ? resolveBucketName(environment)
    : resolveBucketName('preview')

  console.log('CMS bucket manager')
  console.log('==================')
  console.log(`Action:      ${action}`)
  console.log(`Target:      ${remote ? `remote (${environment})` : 'local'}`)
  console.log(`Bucket:      ${bucketName} (CMS_BUCKET)`)

  if (action === 'upload') {
    console.log(`Overwrite:   ${force ? 'yes (--force)' : 'no'}`)
  }

  const succeeded = action === 'upload'
    ? await runUpload(bucketName, options)
    : await runDownload(bucketName, remote)

  if (!succeeded) {
    console.error(`\nOne or more ${action}s failed.`)
    process.exitCode = 1

    return
  }

  console.log(`\n✓ Done (${action} → ${bucketName}).`)
}

main().catch((exception) => {
  console.error('\nFatal error:', exception instanceof Error
    ? exception.message
    : exception)
  process.exit(1)
})
