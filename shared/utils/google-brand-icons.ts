export const GOOGLE_BRAND_COLLECTION = 'google-brand'
export const GOOGLE_DRIVE_ICON = `${GOOGLE_BRAND_COLLECTION}:drive`
export const GOOGLE_DOCS_ICON = `${GOOGLE_BRAND_COLLECTION}:docs`
export const GOOGLE_SHEETS_ICON = `${GOOGLE_BRAND_COLLECTION}:sheets`
export const GOOGLE_SLIDES_ICON = `${GOOGLE_BRAND_COLLECTION}:slides`
export const GOOGLE_GMAIL_ICON = 'logos:google-gmail'
export const GOOGLE_CALENDAR_ICON = 'logos:google-calendar'
export const GOOGLE_G_ICON = 'logos:google-icon'

const MULTICOLOR_BRAND_PREFIXES = ['logos:', `${GOOGLE_BRAND_COLLECTION}:`]

export function isMulticolorBrandIcon(name: string | undefined): boolean {
  if (!name) {
    return false
  }

  return MULTICOLOR_BRAND_PREFIXES.some((prefix) => {
    return name.startsWith(prefix)
  })
}
