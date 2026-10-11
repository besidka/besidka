#!/usr/bin/env node

/**
 * Post-deploy IndexNow submission (Bing, Yandex, Seznam, Naver, ...).
 *
 * Reads the deployed sitemap, keeps same-host URLs, verifies the key file the
 * Worker serves at /indexnow-key.txt, and POSTs the URL list to
 * api.indexnow.org. A no-op when INDEXNOW_KEY is unset, so forks and
 * unconfigured deploys pass. See docs/seo.md → "IndexNow".
 *
 * Usage:
 *   INDEXNOW_KEY=... node scripts/indexnow-submit.mjs --all
 *   INDEXNOW_KEY=... node scripts/indexnow-submit.mjs \
 *     --changed-files=changed-files.txt
 *
 * Env:
 *   INDEXNOW_KEY       required to submit; unset → skip with exit 0
 *   SITE_URL           default https://besidka.com
 *   INDEXNOW_ENDPOINT  default https://api.indexnow.org/indexnow
 */

/* eslint-disable no-console */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_SITE_URL = 'https://besidka.com'
export const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow'
export const KEY_FILE_PATH = '/indexnow-key.txt'
export const MAX_URLS_PER_REQUEST = 10_000

const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/

// Paths whose change can alter an indexable page. Anything else (server
// handlers, chat UI, tests) cannot change what a crawler sees on the public
// pages, so a deploy touching only those does not resubmit unchanged URLs.
const INDEXABLE_CHANGE_PATTERNS = [
  /^content\//,
  /^app\/pages\/(?!chats\/|profile\/|\(auth\)\/)/,
  /^app\/components\/(content|landing|prose)\//,
  /^app\/components\/(LegalDocument|LandingFooter|LandingHeader)\.vue$/,
  /^app\/layouts\/(landing|legal)\.vue$/,
]

export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

export function hasIndexableChange(changedFiles) {
  return changedFiles.some((file) => {
    return INDEXABLE_CHANGE_PATTERNS.some((pattern) => {
      return pattern.test(file)
    })
  })
}

export function extractLocs(xml) {
  const locs = []

  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    locs.push(match[1].replaceAll('&amp;', '&'))
  }

  return locs
}

export function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/.test(xml)
}

export function filterSameHostUrls(urls, siteUrl) {
  const { host } = new URL(siteUrl)
  const unique = new Set()

  for (const url of urls) {
    let parsed

    try {
      parsed = new URL(url)
    } catch {
      continue
    }

    if (parsed.host !== host) {
      continue
    }

    unique.add(parsed.href)
  }

  return [...unique]
}

export function buildPayload({ siteUrl, key, urls }) {
  const site = new URL(siteUrl)

  return {
    host: site.host,
    key,
    keyLocation: new URL(KEY_FILE_PATH, site).href,
    urlList: urls.slice(0, MAX_URLS_PER_REQUEST),
  }
}

/**
 * 200/202 are accepted. 400/403/422 mean the request or the key setup is
 * wrong and must fail loudly; 429 and 5xx are IndexNow-side and only warn,
 * so an outage on their end never turns a successful deploy red.
 */
export function classifyResponseStatus(status) {
  if (status === 200 || status === 202) {
    return 'ok'
  }

  if (status === 429 || status >= 500) {
    return 'transient'
  }

  return 'error'
}

function readArgument(name) {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => {
    return value === `--${name}` || value.startsWith(prefix)
  })

  if (!argument) {
    return undefined
  }

  return argument === `--${name}` ? true : argument.slice(prefix.length)
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'besidka-indexnow-ci' },
  })

  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status}`)
  }

  return await response.text()
}

async function collectSitemapUrls(siteUrl) {
  const rootXml = await fetchText(new URL('/sitemap.xml', siteUrl).href)

  if (!isSitemapIndex(rootXml)) {
    return extractLocs(rootXml)
  }

  const urls = []

  for (const childSitemap of extractLocs(rootXml)) {
    urls.push(...extractLocs(await fetchText(childSitemap)))
  }

  return urls
}

async function main() {
  const key = process.env.INDEXNOW_KEY?.trim()

  if (!key) {
    console.log('INDEXNOW_KEY is not set; skipping IndexNow submission.')

    return 0
  }

  if (!isValidKey(key)) {
    console.error(
      '::error::INDEXNOW_KEY must be 8-128 characters of a-z, A-Z, 0-9 or "-".',
    )

    return 1
  }

  const changedFilesPath = readArgument('changed-files')

  if (typeof changedFilesPath === 'string') {
    const changedFiles = readFileSync(changedFilesPath, 'utf-8')
      .split('\n')
      .filter(Boolean)

    if (!hasIndexableChange(changedFiles)) {
      console.log('No indexable page changed in this deploy; skipping.')

      return 0
    }
  } else if (readArgument('all') !== true) {
    console.error('::error::Pass --all or --changed-files=<path>.')

    return 1
  }

  const siteUrl = process.env.SITE_URL || DEFAULT_SITE_URL
  const endpoint = process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT
  const keyLocation = new URL(KEY_FILE_PATH, siteUrl).href

  let servedKey

  try {
    servedKey = (await fetchText(keyLocation)).trim()
  } catch (exception) {
    console.error(
      `::error::Could not read the key file at ${keyLocation}: `
      + `${exception instanceof Error ? exception.message : exception}. `
      + 'Set NUXT_INDEXNOW_KEY on the production Worker to the same value '
      + 'as the INDEXNOW_KEY secret.',
    )

    return 1
  }

  if (servedKey !== key) {
    console.error(
      `::error::${keyLocation} does not match INDEXNOW_KEY. Set `
      + 'NUXT_INDEXNOW_KEY on the production Worker to the same value.',
    )

    return 1
  }

  let sitemapUrls

  try {
    sitemapUrls = await collectSitemapUrls(siteUrl)
  } catch (exception) {
    console.error(
      '::error::Could not read the deployed sitemap: '
      + `${exception instanceof Error ? exception.message : exception}`,
    )

    return 1
  }

  const urls = filterSameHostUrls(sitemapUrls, siteUrl)

  if (!urls.length) {
    console.log('::warning::Sitemap contained no same-host URLs; skipping.')

    return 0
  }

  const payload = buildPayload({ siteUrl, key, urls })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  const outcome = classifyResponseStatus(response.status)

  if (outcome === 'ok') {
    console.log(
      `IndexNow accepted ${payload.urlList.length} URL(s) `
      + `(HTTP ${response.status}):\n${payload.urlList.join('\n')}`,
    )

    return 0
  }

  const body = await response.text()

  if (outcome === 'transient') {
    console.log(
      `::warning::IndexNow returned HTTP ${response.status}; not retrying. `
      + body,
    )

    return 0
  }

  console.error(`::error::IndexNow rejected the submission with HTTP ${response.status}. ${body}`)

  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
