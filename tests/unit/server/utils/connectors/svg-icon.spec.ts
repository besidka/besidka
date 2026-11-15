import { describe, expect, it } from 'vitest'
import { isSafeSvgIcon } from '~~/server/utils/connectors/svg-icon'

const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
  + '<defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/>'
  + '</linearGradient></defs>'
  + '<path d="M0 0h24v24H0z" fill="url(#a)"/>'
  + '<circle cx="12" cy="12" r="4" style="fill:#000"/></svg>'

function svgWith(inner: string, rootAttributes = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttributes}>${inner}</svg>`
}

describe('isSafeSvgIcon', () => {
  it('accepts plain shapes, gradients and local url references', () => {
    expect(isSafeSvgIcon(SAFE_SVG)).toBe(true)
  })

  it('accepts an XML declaration and comments before the root', () => {
    expect(isSafeSvgIcon(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->${SAFE_SVG}`,
    )).toBe(true)
  })

  it('accepts a byte order mark and leading whitespace', () => {
    expect(isSafeSvgIcon(`${String.fromCharCode(0xFEFF)}\n  ${SAFE_SVG}`))
      .toBe(true)
  })

  it.each([
    ['a script element', svgWith('<script>alert(1)</script>')],
    ['a self-closing script', svgWith('<script src="https://evil.example/x.js"/>')],
    ['a style element', svgWith('<style>@import url(https://evil.example)</style>')],
    ['foreignObject', svgWith('<foreignObject><div/></foreignObject>')],
    ['an image element', svgWith('<image href="https://evil.example/a.png"/>')],
    ['a use element', svgWith('<use href="#a"/>')],
    ['an anchor', svgWith('<a href="javascript:alert(1)"><path d="M0 0"/></a>')],
    ['an animation', svgWith('<animate attributeName="href" to="javascript:x"/>')],
    ['a text element', svgWith('<text>hi</text>')],
    ['an onload handler', svgWith('<path d="M0 0"/>', 'onload="alert(1)"')],
    ['an onclick handler in any case', svgWith('<path d="M0 0" OnClick="x()"/>')],
    ['an external href on a gradient', svgWith(
      '<linearGradient xlink:href="https://evil.example/g.svg#a"/>',
    )],
    ['a javascript value', svgWith('<path d="M0 0" fill="javascript:alert(1)"/>')],
    ['a data value', svgWith('<path d="M0 0" fill="url(data:image/svg+xml;base64,AAAA)"/>')],
    ['an external url reference', svgWith('<path d="M0 0" fill="url(https://evil.example/a)"/>')],
    ['an external url in style', svgWith('<path d="M0 0" style="fill:url(https://evil.example/a)"/>')],
    ['an @import in style', svgWith('<path d="M0 0" style="@import x"/>')],
    ['an entity in an attribute', svgWith('<path d="M0 0" fill="&#106;avascript:x"/>')],
    ['a DOCTYPE', `<!DOCTYPE svg [<!ENTITY x "y">]>${SAFE_SVG}`],
    ['an ENTITY', `<!ENTITY x "y">${SAFE_SVG}`],
    ['CDATA', svgWith('<![CDATA[<script>x</script>]]>')],
    ['a processing instruction', svgWith('<?php echo 1 ?>')],
    ['a foreign namespace', svgWith('<path d="M0 0" xmlns="http://www.w3.org/1999/xhtml"/>')],
    ['xml:base', svgWith('<path d="M0 0" xml:base="https://evil.example/"/>')],
    ['a stray angle bracket', svgWith('<path d="M0 0"/> < <path/>')],
    ['HTML', '<html><body></body></html>'],
    ['a non-svg root', '<div><svg/></div>'],
    ['empty input', ''],
  ])('rejects %s', (_label, source) => {
    expect(isSafeSvgIcon(source)).toBe(false)
  })

  it('rejects a document with more than 2000 elements', () => {
    expect(isSafeSvgIcon(svgWith('<g/>'.repeat(2001)))).toBe(false)
    expect(isSafeSvgIcon(svgWith('<g/>'.repeat(1000)))).toBe(true)
  })

  it('is linear on a long run of unterminated attributes', () => {
    const hostile = svgWith(`<path ${'a="'.repeat(20000)}`)
    const startedAt = Date.now()

    expect(isSafeSvgIcon(hostile)).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })
})
