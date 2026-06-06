export default defineEventHandler((event) => {
  const { baseUrl } = useRuntimeConfig().public
  const base = (baseUrl as string).replace(/\/$/, '')
  const now = new Date().toISOString().split('T')[0]

  const urls = [
    { loc: `${base}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${base}/signin`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${base}/signup`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${base}/terms`, priority: '0.4', changefreq: 'yearly' },
    { loc: `${base}/privacy`, priority: '0.4', changefreq: 'yearly' },
  ]

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(url => [
      '  <url>',
      `    <loc>${url.loc}</loc>`,
      `    <lastmod>${now}</lastmod>`,
      `    <changefreq>${url.changefreq}</changefreq>`,
      `    <priority>${url.priority}</priority>`,
      '  </url>',
    ].join('\n')),
    '</urlset>',
  ].join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')

  return xml
})
