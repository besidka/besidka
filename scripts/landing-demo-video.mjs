#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Landing page demo video prep script.
 *
 * Downloads the Big Buck Bunny placeholder video (CC-BY, Blender Foundation
 * https://www.blender.org/about/projects/), validates it as H.264/AAC MP4
 * using mediabunny core (no FFmpeg, no @mediabunny/server), and seeds the
 * local R2_LANDING bucket for development.
 *
 * ATTRIBUTION: "Big Buck Bunny" © Blender Foundation |
 * www.bigbuckbunny.org (CC BY 3.0)
 *
 * Usage:
 *   pnpm exec node scripts/landing-demo-video.mjs
 *
 * Remote upload (after the owner creates the remote bucket):
 *   npx wrangler r2 object put besidka-landing-preview/demo.mp4 \
 *     --file=.videos/demo.mp4
 *   npx wrangler r2 object put besidka-landing/demo.mp4 \
 *     --file=.videos/demo.mp4 --env production
 */

import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
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
const VIDEO_PATH = join(VIDEO_DIR, 'demo.mp4')

const VIDEO_URL
  = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4'

const LOCAL_BUCKET = 'besidka-landing-preview'

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

async function seedLocalR2(filePath) {
  console.log(`\nSeeding local R2 bucket "${LOCAL_BUCKET}"...`)

  // wrangler appends /v3 to --persist-to internally, so we pass
  // .wrangler/state (not .wrangler/state/v3) to land in the right place.
  const persistDir = join(ROOT, '.wrangler', 'state')

  const command = [
    'npx wrangler r2 object put',
    `${LOCAL_BUCKET}/demo.mp4`,
    `--file="${filePath}"`,
    '--local',
    `--persist-to="${persistDir}"`,
  ].join(' ')

  console.log(`  Running: ${command}`)

  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
    console.log('  ✓ Local R2 seeded successfully')
  } catch (exception) {
    console.error(
      '  ✗ Local R2 seed failed:',
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
  console.log('Preview environment:')
  console.log('  npx wrangler r2 object put besidka-landing-preview/demo.mp4 \\')
  console.log('    --file=.videos/demo.mp4')
  console.log()
  console.log('Production environment:')
  console.log('  npx wrangler r2 object put besidka-landing/demo.mp4 \\')
  console.log('    --file=.videos/demo.mp4 --env production')
  console.log()
  console.log('Attribution: Big Buck Bunny © Blender Foundation (CC BY 3.0)')
  console.log('  https://www.bigbuckbunny.org')
}

async function main() {
  console.log('Landing demo video setup')
  console.log('========================')

  const skipDownload = existsSync(VIDEO_PATH)

  if (skipDownload) {
    console.log(`\nUsing cached video at ${VIDEO_PATH}`)
  } else {
    await downloadVideo(VIDEO_URL, VIDEO_PATH)
  }

  await validateVideo(VIDEO_PATH)
  await seedLocalR2(VIDEO_PATH)
  printRemoteInstructions()

  console.log('\n✓ Done. pnpm run dev should now serve /videos/demo.mp4')
}

main().catch((exception) => {
  console.error('\nFatal error:', exception)
  process.exit(1)
})
