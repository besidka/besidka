#!/usr/bin/env node

/* eslint-disable no-console */

import { CONNECTOR_PRESETS } from '../config/connectors-catalog.ts'

const PROBE_TIMEOUT_MS = 15_000
const ACCEPTED_STATUSES = new Set([200, 401, 405])
const PROBE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'besidka-preset-check', version: '1.0.0' },
  },
})

export function isAcceptableProbe(status, headers) {
  if (!ACCEPTED_STATUSES.has(status)) {
    return false
  }

  const contentType = headers.get('content-type') ?? ''
  const hasJsonOrEventStream = contentType.includes('json')
    || contentType.includes('text/event-stream')
  const hasChallenge = headers.has('www-authenticate')

  return status === 405 || hasJsonOrEventStream || hasChallenge
}

export async function probePreset(preset, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(preset.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'user-agent': 'Besidka-Connectors-PresetCheck/1.0',
      },
      body: PROBE_BODY,
    })

    await response.body?.cancel()

    return {
      id: preset.id,
      url: preset.url,
      status: response.status,
      ok: isAcceptableProbe(response.status, response.headers),
    }
  } catch (exception) {
    return {
      id: preset.id,
      url: preset.url,
      status: 0,
      ok: false,
      error: exception instanceof Error ? exception.message : String(exception),
    }
  }
}

async function main() {
  const results = []

  for (const preset of CONNECTOR_PRESETS) {
    results.push(await probePreset(preset))
  }

  for (const result of results) {
    if (result.ok) {
      console.log(`ok       ${result.id} ${result.url} -> ${result.status}`)

      continue
    }

    const detail = result.error ?? `status ${result.status}`

    console.log(`::warning title=Connector preset ${result.id}::`
      + `${result.url} answered unexpectedly (${detail})`)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
