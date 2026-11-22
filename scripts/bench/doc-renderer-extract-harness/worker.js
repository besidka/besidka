export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const format = url.searchParams.get('format')
    const bytes = new Uint8Array(await request.arrayBuffer())
    const result = await env.RENDERER.extract({ format, bytes })

    return Response.json({
      status: result.status,
      errorCode: result.errorCode,
      truncated: result.truncated,
      stats: result.stats,
      textLength: result.text.length,
    })
  },
}
