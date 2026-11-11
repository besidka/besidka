import bold from '../../../packages/doc-renderer/fonts/NotoSans-Bold.ttf'
import italic from '../../../packages/doc-renderer/fonts/NotoSans-Italic.ttf'
import regular from '../../../packages/doc-renderer/fonts/NotoSans-Regular.ttf'

export const documentFonts = {
  regular: new Uint8Array(regular),
  bold: new Uint8Array(bold),
  italic: new Uint8Array(italic),
}
