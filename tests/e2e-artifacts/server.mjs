#!/usr/bin/env node

/* eslint-disable no-console */

import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HOST_PORT = Number(process.env.ARTIFACTS_HOST_PORT || 8789)
export const OUTSIDE_PORT = Number(process.env.ARTIFACTS_OUTSIDE_PORT || 8790)

const testsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(testsDirectory, '..', '..')
const requireFromRuntime = createRequire(
  path.join(repositoryRoot, 'workers', 'artifacts-runtime', 'package.json'),
)
const { build } = requireFromRuntime('esbuild')
const outsideRequests = []

const HOST_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Artifacts runtime harness</title></head>',
  '<body><script type="module" src="/host.js"></script></body>',
  '</html>',
].join('\n')

const OUTSIDE_PAGE = [
  '<!doctype html><title>outside</title><script>',
  `fetch('http://127.0.0.1:${OUTSIDE_PORT}/beacon-from-outside-page').catch(() => {})`,
  '</script>',
].join('')

async function bundleHarness() {
  const result = await build({
    entryPoints: [path.join(testsDirectory, 'harness', 'host.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    absWorkingDir: repositoryRoot,
    nodePaths: [path.join(repositoryRoot, 'workers', 'artifacts-runtime', 'node_modules')],
  })

  return result.outputFiles[0].text
}

const harnessScript = await bundleHarness()

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${HOST_PORT}`)

  if (url.pathname === '/host.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(harnessScript)

    return
  }

  if (url.pathname === '/__outside-requests') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(outsideRequests))

    return
  }

  if (url.pathname === '/__outside-requests/reset') {
    outsideRequests.length = 0
    response.writeHead(204)
    response.end()

    return
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(HOST_HTML)
}).listen(HOST_PORT, '127.0.0.1', () => {
  console.log(`Artifacts harness host on http://127.0.0.1:${HOST_PORT}`)
})

createServer((request, response) => {
  outsideRequests.push(request.url ?? '/')
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'access-control-allow-origin': '*',
  })
  response.end(OUTSIDE_PAGE)
}).listen(OUTSIDE_PORT, '127.0.0.1', () => {
  console.log(`Outside origin recorder on http://127.0.0.1:${OUTSIDE_PORT}`)
})
