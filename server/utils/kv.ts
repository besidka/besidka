export function useKV() {
  const { KV } = useEvent().context.cloudflare.env

  if (!KV) {
    throw createError(`KV not found in ENV: KV`)
  }

  return KV
}
