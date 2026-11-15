import { OFFICE_MEDIA_TYPES } from '#shared/utils/office-files'

export const XLS_CONVERT_MAX_INPUT_BYTES = 20 * 1024 * 1024
export const XLS_CONVERT_TIMEOUT_MS = 30_000
export const XLS_CONVERT_MAX_ROWS = 100_000

export const XLS_CONVERTED_NOTE = 'Converted from .xls'
export const XLS_CONVERTED_NOTE_DESCRIPTION
  = 'Converted to .xlsx in your browser before upload. Formulas keep '
    + 'their last calculated values. Styles, charts and macros are not kept.'

export const CFB_SIGNATURE: readonly number[] = [
  0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1,
]

export const XLSX_MEDIA_TYPE = OFFICE_MEDIA_TYPES.xlsx

export function isXlsFile(file: Pick<File, 'name'>): boolean {
  return file.name.toLowerCase().endsWith('.xls')
}

export function hasCfbSignature(bytes: Uint8Array): boolean {
  if (bytes.length < CFB_SIGNATURE.length) {
    return false
  }

  return CFB_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

export async function readsAsCfb(file: Blob): Promise<boolean> {
  try {
    const head = await file.slice(0, CFB_SIGNATURE.length).arrayBuffer()

    return hasCfbSignature(new Uint8Array(head))
  } catch (exception) {
    void exception

    return false
  }
}

export function getConvertedXlsxName(fileName: string): string {
  return `${fileName.replace(/\.xls$/i, '')}.xlsx`
}
