import nunitoCyrillic400 from '@fontsource/nunito/files/nunito-cyrillic-400-normal.woff2'
import nunitoCyrillic700 from '@fontsource/nunito/files/nunito-cyrillic-700-normal.woff2'
import nunitoCyrillicExt400 from '@fontsource/nunito/files/nunito-cyrillic-ext-400-normal.woff2'
import nunitoCyrillicExt700 from '@fontsource/nunito/files/nunito-cyrillic-ext-700-normal.woff2'
import nunitoLatin400 from '@fontsource/nunito/files/nunito-latin-400-normal.woff2'
import nunitoLatin700 from '@fontsource/nunito/files/nunito-latin-700-normal.woff2'
import nunitoLatinExt400 from '@fontsource/nunito/files/nunito-latin-ext-400-normal.woff2'
import nunitoLatinExt700 from '@fontsource/nunito/files/nunito-latin-ext-700-normal.woff2'

export interface DesignFontFace {
  weight: number
  unicodeRange: string
  url: string
}

export const DESIGN_FONT_FAMILY = 'Nunito'

const UNICODE_RANGES = {
  cyrillicExt: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  latinExt: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
}

function nunitoFaces(
  unicodeRange: string,
  regularUrl: string,
  boldUrl: string,
): DesignFontFace[] {
  return [
    { weight: 400, unicodeRange, url: regularUrl },
    { weight: 700, unicodeRange, url: boldUrl },
  ]
}

export const NUNITO_FONT_FACES: readonly DesignFontFace[] = [
  ...nunitoFaces(
    UNICODE_RANGES.cyrillicExt,
    nunitoCyrillicExt400,
    nunitoCyrillicExt700,
  ),
  ...nunitoFaces(UNICODE_RANGES.cyrillic, nunitoCyrillic400, nunitoCyrillic700),
  ...nunitoFaces(UNICODE_RANGES.latinExt, nunitoLatinExt400, nunitoLatinExt700),
  ...nunitoFaces(UNICODE_RANGES.latin, nunitoLatin400, nunitoLatin700),
]

export function renderFontFaces(
  fontFaces: readonly DesignFontFace[],
): string {
  return fontFaces.map((fontFace) => {
    return [
      '@font-face {',
      `  font-family: '${DESIGN_FONT_FAMILY}';`,
      '  font-style: normal;',
      '  font-display: swap;',
      `  font-weight: ${fontFace.weight};`,
      `  src: url('${fontFace.url}') format('woff2');`,
      `  unicode-range: ${fontFace.unicodeRange};`,
      '}',
    ].join('\n')
  }).join('\n')
}
