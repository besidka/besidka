export function withOriginResource(
  metadata: Record<string, unknown>,
  origin: string,
): Record<string, unknown> {
  return { ...metadata, resource: origin }
}
