import {
  encodeBase64Utf8,
  escapeXmlAttribute,
} from '~/utils/diagram-export-encoding'

const DRAWIO_CREATE_URL: string = 'https://app.diagrams.net/#create='
const DRAWIO_MERMAID_VERSION: string = '12'
const DRAWIO_DIAGRAM_ID: string = 'besidka-diagram'
const DRAWIO_IMAGE_STYLE: string
  = 'shape=image;noLabel=1;verticalAlign=top;imageAspect=1;editIcon=1;'
    + 'groupPadding=10;'

export function buildMermaidMarkdown(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\`\n`
}

export function buildDrawioOpenUrl(source: string): string {
  const payload = JSON.stringify({ type: 'mermaid', data: source })

  return `${DRAWIO_CREATE_URL}${encodeURIComponent(payload)}`
}

export function buildDrawioClipboardXml(
  source: string,
  standaloneSvg: string,
  width: number,
  height: number,
): string {
  const mermaidData = escapeXmlAttribute(JSON.stringify({
    data: source,
    config: null,
    version: DRAWIO_MERMAID_VERSION,
  }))
  const imageStyle
    = `${DRAWIO_IMAGE_STYLE}image=data:image/svg+xml,`
      + `${encodeBase64Utf8(standaloneSvg)};`
  const geometry
    = `<mxGeometry x="0" y="0" width="${Math.round(width)}"`
      + ` height="${Math.round(height)}" as="geometry"/>`

  return '<mxGraphModel><root>'
    + '<mxCell id="0"/><mxCell id="1" parent="0"/>'
    + `<UserObject label="" mermaidData="${mermaidData}" id="2">`
    + `<mxCell style="${imageStyle}" vertex="1" parent="1">`
    + `${geometry}</mxCell></UserObject>`
    + '</root></mxGraphModel>'
}

export function buildDrawioFile(
  source: string,
  standaloneSvg: string,
  width: number,
  height: number,
): string {
  const model = buildDrawioClipboardXml(source, standaloneSvg, width, height)

  return `<mxfile host="besidka"><diagram id="${DRAWIO_DIAGRAM_ID}"`
    + ` name="Diagram">${model}</diagram></mxfile>`
}
