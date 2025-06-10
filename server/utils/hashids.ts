import Hashids from 'hashids'

const hashids = new Hashids(
  process.env.HASHIDS_SECRET || 'secret',
  16,
)

export function encodeId(id: number): string {
  return hashids.encode(id)
}

export function decodeId(publicId: string): number {
  const [id] = hashids.decode(publicId)

  return Number(id)
}
