#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Landing page demo video prep script.
 *
 * Downloads the Big Buck Bunny placeholder video (CC-BY, Blender Foundation
 * https://www.blender.org/about/projects/) at three resolutions, validates
 * each as H.264/AAC MP4 using mediabunny core (no FFmpeg, no @mediabunny/
 * server), writes a fake English caption track, and seeds the local
 * R2_LANDING bucket for development.
 *
 * Assets produced (served from R2_LANDING via /videos/<name>):
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
 *   pnpm run landing:video
 *
 * Remote upload (after the owner creates the remote bucket):
 *   npx wrangler r2 object put besidka-landing-preview/demo.mp4 \
 *     --file=.videos/demo.mp4
 *   npx wrangler r2 object put besidka-landing/demo.mp4 \
 *     --file=.videos/demo.mp4 --env production
 */

import { createWriteStream, existsSync } from 'node:fs'
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
const VIDEO_DIR = join(ROOT, '.videos')

const BASE_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264'

const LOCAL_BUCKET = 'besidka-landing-preview'

/**
 * Resolution variants. All three are 10s clips of the same content so quality
 * switching swaps resolution without changing the footage.
 */
const VIDEO_SOURCES = [
  {
    file: 'demo.mp4',
    url: `${BASE_URL}/720/Big_Buck_Bunny_720_10s_5MB.mp4`,
    size: 720,
    contentType: 'video/mp4',
  },
  {
    file: 'demo-360.mp4',
    url: `${BASE_URL}/360/Big_Buck_Bunny_360_10s_1MB.mp4`,
    size: 360,
    contentType: 'video/mp4',
  },
  {
    file: 'demo-1080.mp4',
    url: `${BASE_URL}/1080/Big_Buck_Bunny_1080_10s_5MB.mp4`,
    size: 1080,
    contentType: 'video/mp4',
  },
]

const CAPTIONS_FILE = 'demo.en.vtt'
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

async function downloadVideo(url, destination) {
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

async function writeCaptions(filePath) {
  console.log('\nWriting fake English captions...')

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, CAPTIONS_CONTENT, 'utf8')

  console.log(`  ✓ Wrote ${filePath}`)
}

function seedLocalR2(key, filePath, contentType) {
  console.log(`\nSeeding local R2 "${LOCAL_BUCKET}/${key}"...`)

  // wrangler appends /v3 to --persist-to internally, so we pass
  // .wrangler/state (not .wrangler/state/v3) to land in the right place.
  const persistDir = join(ROOT, '.wrangler', 'state')

  const command = [
    'npx wrangler r2 object put',
    `${LOCAL_BUCKET}/${key}`,
    `--file="${filePath}"`,
    `--content-type="${contentType}"`,
    '--local',
    `--persist-to="${persistDir}"`,
  ].join(' ')

  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
    console.log(`  ✓ Seeded ${key}`)
  } catch (exception) {
    console.error(
      `  ✗ Local R2 seed failed for ${key}:`,
      exception instanceof Error ? exception.message : String(exception),
    )
    console.log('\n  You can retry manually:')
    console.log(`    ${command}`)
  }
}

function printRemoteInstructions() {
  console.log('\n─────────────────────────────────────────────────')
  console.log('REMOTE UPLOAD (run once the remote bucket exists)')
  console.log('─────────────────────────────────────────────────')
  console.log()
  console.log('For each asset (demo.mp4, demo-360.mp4, demo-1080.mp4,')
  console.log('demo.en.vtt), upload to both environments:')
  console.log()
  console.log('  npx wrangler r2 object put besidka-landing-preview/<name> \\')
  console.log('    --file=.videos/<name>')
  console.log()
  console.log('  npx wrangler r2 object put besidka-landing/<name> \\')
  console.log('    --file=.videos/<name> --env production')
  console.log()
  console.log('Attribution: Big Buck Bunny © Blender Foundation (CC BY 3.0)')
  console.log('  https://www.bigbuckbunny.org')
}

async function main() {
  console.log('Landing demo video setup')
  console.log('========================')

  for (const source of VIDEO_SOURCES) {
    const destination = join(VIDEO_DIR, source.file)

    if (existsSync(destination)) {
      console.log(`\nUsing cached ${source.file}`)
    } else {
      await downloadVideo(source.url, destination)
    }

    await validateVideo(destination)
    seedLocalR2(source.file, destination, source.contentType)
  }

  const captionsPath = join(VIDEO_DIR, CAPTIONS_FILE)

  await writeCaptions(captionsPath)
  seedLocalR2(CAPTIONS_FILE, captionsPath, 'text/vtt; charset=utf-8')

  printRemoteInstructions()

  console.log('\n✓ Done. pnpm run dev should now serve /videos/demo.mp4')
}

main().catch((exception) => {
  console.error('\nFatal error:', exception)
  process.exit(1)
})
