export type RenderErrorCode
  = | 'invalid_spec'
    | 'missing_asset'
    | 'unsupported_image'
    | 'image_too_large'
    | 'assets_too_large'
    | 'font_missing'
    | 'page_limit'
    | 'render_failed'
    | 'validation_failed'

export class RenderError extends Error {
  readonly code: RenderErrorCode

  constructor(code: RenderErrorCode, message: string) {
    super(message)
    this.name = 'RenderError'
    this.code = code
  }
}
