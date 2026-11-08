export const PRODUCTION_FRAME_ANCESTORS = [
  'https://besidka.com',
  'https://*.chernenko.workers.dev',
]

export const DEVELOPMENT_FRAME_ANCESTORS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
]

export function createContentSecurityPolicy({ dev = false } = {}) {
  const frameAncestors = dev
    ? [...PRODUCTION_FRAME_ANCESTORS, ...DEVELOPMENT_FRAME_ANCESTORS]
    : PRODUCTION_FRAME_ANCESTORS

  return [
    'sandbox allow-scripts',
    'default-src \'none\'',
    'script-src \'self\' \'unsafe-inline\' blob:',
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' data: blob:',
    'font-src \'self\' data:',
    'media-src data: blob:',
    'connect-src \'none\'',
    'form-action \'none\'',
    'frame-src \'none\'',
    'base-uri \'none\'',
    'webrtc \'block\'',
    `frame-ancestors ${frameAncestors.join(' ')}`,
  ].join('; ')
}

export function createHeadersFile({ dev = false } = {}) {
  return [
    '/*',
    `  Content-Security-Policy: ${createContentSecurityPolicy({ dev })}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Cross-Origin-Resource-Policy: cross-origin',
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '/v1/index.html',
    '  Cache-Control: no-cache',
    '',
    '/v1/THIRD_PARTY_NOTICES.txt',
    '  Cache-Control: no-cache',
    '  Content-Type: text/plain; charset=utf-8',
    '',
    '/v1/assets/*',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n')
}
