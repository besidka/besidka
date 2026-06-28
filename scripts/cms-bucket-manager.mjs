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
 *   upload    Ensure each asset exists locally (download the demo video from
 *             its source URL / generate captions if missing), validate videos,
 *             then PUT it into CMS_BUCKET. Objects that already persist in the
 *             target bucket are skipped.
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
 *   - demo.en.vtt     fake English captions
 *
 * Hover-preview thumbnails are NOT generated here; the player builds them on
 * the client at runtime via mediabunny's CanvasSink.
 *
 * ATTRIBUTION: "Big Buck Bunny" © Blender Foundation |
 * www.bigbuckbunny.org (CC BY 3.0)
 *
 * Usage:
 *   pnpm run cms:files:upload                       seed local R2 (default)
 *   pnpm run cms:files:upload --remote              upload to preview bucket
 *   pnpm run cms:files:upload --remote -e production   upload to prod bucket
 *
 *   pnpm run cms:files:download                     pull from local R2
 *   pnpm run cms:files:download --remote            pull from preview bucket
 *   pnpm run cms:files:download --remote -e production pull from prod bucket
 */

import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { execSync } from 'node:child_process'

import {
  Input,
  FilePathSource,
  MP4,
} from 'mediabunny'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FILES_DIR = join(ROOT, '.files')

// wrangler appends /v3 to --persist-to internally, so we pass .wrangler/state
// (not .wrangler/state/v3) to land in the right place.
const PERSIST_DIR = join(ROOT, '.wrangler', 'state')

const BASE_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264'

const VALID_ACTIONS = ['upload', 'download']
const VALID_ENVIRONMENTS = ['preview', 'production']

const CAPTIONS_CONTENT = `WEBVTT

00:00.000 --> 00:02.000
Welcome to Besidka — open-source AI chat.

00:02.000 --> 00:04.000
Switch freely between the latest GPT and Gemini models.

00:04.000 --> 00:06.000
Attach files stored in your own R2 bucket.

00:06.000 --> 00:08.000
Group related chats into Projects.

00:08.000 --> 00:10.000
Your keys, your costs, your data.
`

/**
 * Managed assets. `key` is both the local filename (in .files) and the R2
 * object key. `sourceUrl` (web download) or `content` (generated) tells upload
 * how to materialise a missing local copy. `kind: 'video'` enables validation.
 */
const ASSETS = [
  {
    key: 'demo.mp4',
    sourceUrl: `${BASE_URL}/720/Big_Buck_Bunny_720_10s_5MB.mp4`,
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo-360.mp4',
    sourceUrl: `${BASE_URL}/360/Big_Buck_Bunny_360_10s_1MB.mp4`,
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo-1080.mp4',
    sourceUrl: `${BASE_URL}/1080/Big_Buck_Bunny_1080_10s_5MB.mp4`,
    contentType: 'video/mp4',
    kind: 'video',
  },
  {
    key: 'demo.en.vtt',
    content: CAPTIONS_CONTENT,
    contentType: 'text/vtt; charset=utf-8',
    kind: 'captions',
  },
]

/**
 * Parse CLI args forwarded by pnpm.
 *
 *   <action>                 upload | download (first positional, required)
 *   --remote                 target remote R2 instead of local persisted R2
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

  return { action, remote, environment }
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

  return ['--local', `--persist-to="${PERSIST_DIR}"`]
}

async function downloadFromWeb(url, destination) {
  console.log(`\nDownloading ${url}`)
  console.log(`  → ${destination}`)

  await mkdir(dirname(destination), { recursive: true })

  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText}`,
    )
  }

  const fileStream = createWriteStream(destination)

  await pipeline(response.body, fileStream)

  const { size } = await stat(destination)

  console.log(`  ✓ Downloaded ${(size / 1024 / 1024).toFixed(2)} MB`)
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

  console.log('  Format:   MP4')
  console.log(`  Duration: ${duration !== null ? duration.toFixed(2) + 's' : 'unknown'}`)
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
}

/**
 * Materialise a missing local copy of an asset. Validates freshly fetched
 * videos. Existing files are left untouched (no re-download, no re-validate).
 */
async function ensureLocalAsset(asset, filePath) {
  if (existsSync(filePath)) {
    console.log(`\nUsing local ${asset.key}`)

    return
  }

  await mkdir(dirname(filePath), { recursive: true })

  if (asset.sourceUrl) {
    await downloadFromWeb(asset.sourceUrl, filePath)
  } else if (asset.content) {
    await writeFile(filePath, asset.content, 'utf8')
    console.log(`\n✓ Generated ${filePath}`)
  } else {
    throw new Error(
      `Cannot materialise "${asset.key}": no sourceUrl or content`,
    )
  }

  if (asset.kind === 'video') {
    await validateVideo(filePath)
  }
}

/**
 * Probe whether an object already exists in the bucket. There is no `head` in
 * the wrangler CLI, so this streams the object to a discarded pipe and treats
 * a zero exit code as "exists".
 */
function objectExists(bucketName, key, remote) {
  const command = [
    'npx wrangler r2 object get',
    `${bucketName}/${key}`,
    '--pipe',
    ...locationFlags(remote),
  ].join(' ')

  try {
    execSync(command, { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] })

    return true
  } catch {
    return false
  }
}

function putObject(bucketName, asset, filePath, remote) {
  const target = remote ? 'remote' : 'local'

  console.log(`\nUploading "${bucketName}/${asset.key}" (${target})...`)

  const command = [
    'npx wrangler r2 object put',
    `${bucketName}/${asset.key}`,
    `--file="${filePath}"`,
    `--content-type="${asset.contentType}"`,
    ...locationFlags(remote),
  ].join(' ')

  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
    console.log(`  ✓ Uploaded ${asset.key}`)

    return true
  } catch (exception) {
    console.error(
      `  ✗ Upload failed for ${asset.key}:`,
      exception instanceof Error ? exception.message : String(exception),
    )
    console.log('\n  You can retry manually:')
    console.log(`    ${command}`)

    return false
  }
}

function getObject(bucketName, key, filePath, remote) {
  const target = remote ? 'remote' : 'local'

  console.log(`\nDownloading "${bucketName}/${key}" (${target})...`)
  console.log(`  → ${filePath}`)

  const command = [
    'npx wrangler r2 object get',
    `${bucketName}/${key}`,
    `--file="${filePath}"`,
    ...locationFlags(remote),
  ].join(' ')

  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
    console.log(`  ✓ Downloaded ${key}`)

    return true
  } catch (exception) {
    console.error(
      `  ✗ Download failed for ${key}:`,
      exception instanceof Error ? exception.message : String(exception),
    )
    console.log('\n  You can retry manually:')
    console.log(`    ${command}`)

    return false
  }
}

async function runUpload(bucketName, remote) {
  let hasFailures = false

  for (const asset of ASSETS) {
    const filePath = join(FILES_DIR, asset.key)

    await ensureLocalAsset(asset, filePath)

    if (objectExists(bucketName, asset.key, remote)) {
      console.log(`\nSkipping ${asset.key} (already in ${bucketName})`)

      continue
    }

    const wasUploaded = putObject(bucketName, asset, filePath, remote)

    if (!wasUploaded) {
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
  const { action, remote, environment } = parseArgs(process.argv)
  const bucketName = remote
    ? resolveBucketName(environment)
    : resolveBucketName('preview')

  console.log('CMS bucket manager')
  console.log('==================')
  console.log(`Action:      ${action}`)
  console.log(`Target:      ${remote ? `remote (${environment})` : 'local'}`)
  console.log(`Bucket:      ${bucketName} (CMS_BUCKET)`)

  if (action === 'upload') {
    const succeeded = await runUpload(bucketName, remote)

    if (!succeeded) {
      console.error('\nOne or more uploads failed.')
      process.exitCode = 1

      return
    }
  } else {
    const succeeded = await runDownload(bucketName, remote)

    if (!succeeded) {
      console.error('\nOne or more downloads failed.')
      process.exitCode = 1

      return
    }
  }

  console.log(`\n✓ Done (${action} → ${bucketName}).`)
}

main().catch((exception) => {
  console.error('\nFatal error:', exception)
  process.exit(1)
})
