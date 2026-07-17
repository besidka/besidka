function encodeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default defineEventHandler((event) => {
  const { baseUrl } = useRuntimeConfig().public
  const base = (baseUrl as string).replace(/\/$/, '')

  const urls = [
    { loc: `${base}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${base}/privacy`, priority: '0.4', changefreq: 'yearly' },
    { loc: `${base}/terms`, priority: '0.4', changefreq: 'yearly' },
  ]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(url => [
      '  <url>',
      `    <loc>${encodeXml(url.loc)}</loc>`,
      `    <changefreq>${url.changefreq}</changefreq>`,
      `    <priority>${url.priority}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
  ].join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return xml
})
