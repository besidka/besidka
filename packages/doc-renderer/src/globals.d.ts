declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean, ignoreBOM?: boolean },
  )
  decode(input?: Uint8Array, options?: { stream?: boolean }): string
}

declare class URL {
  constructor(input: string, base?: string)
  readonly protocol: string
}

declare function btoa(data: string): string

declare class Blob {
  arrayBuffer(): Promise<ArrayBuffer>
}
