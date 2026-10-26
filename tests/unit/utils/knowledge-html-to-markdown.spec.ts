import { describe, expect, it } from 'vitest'
import { htmlToKnowledgeMarkdown } from '~/utils/knowledge-html-to-markdown'

const docxLikeHtml = [
  '<h1>Quarterly Report</h1>',
  '<p>Revenue grew <strong>12%</strong> and <em>costs</em> held.</p>',
  '<h2>Highlights</h2>',
  '<ul><li>First item</li><li>Second item</li></ul>',
  '<ol><li>Step one</li><li>Step two</li></ol>',
  '<table>',
  '<tr><td>Region</td><td>Sales</td></tr>',
  '<tr><td>EMEA</td><td>40</td></tr>',
  '</table>',
  '<p>Read the <a href="https://example.com/spec">spec</a> first.</p>',
].join('')

describe('htmlToKnowledgeMarkdown', () => {
  it('converts a DOCX-like document to Markdown', () => {
    const markdown = htmlToKnowledgeMarkdown(docxLikeHtml)

    expect(markdown).toContain('# Quarterly Report')
    expect(markdown).toContain('## Highlights')
    expect(markdown).toContain('**12%**')
    expect(markdown).toContain('*costs*')
    expect(markdown).toContain('-   First item')
    expect(markdown).toContain('1.  Step one')
    expect(markdown).toContain('[spec](https://example.com/spec)')
  })

  it('renders tables as GFM tables', () => {
    const markdown = htmlToKnowledgeMarkdown(docxLikeHtml)

    expect(markdown).toContain('| Region | Sales |')
    expect(markdown).toContain('| --- | --- |')
    expect(markdown).toContain('| EMEA | 40 |')
  })

  it('promotes the first row to the header and escapes pipes', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<table><tr><td>A | B</td><td></td></tr>'
      + '<tr><td><strong>x</strong></td><td>y<br>z</td><td>extra</td></tr>'
      + '</table>',
    )

    expect(markdown).toBe([
      '| A \\| B |  |  |',
      '| --- | --- | --- |',
      '| **x** | y z | extra |',
    ].join('\n'))
  })

  it('supports strikethrough and task list items', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p><del>old</del> new</p>'
      + '<ul><li><input type="checkbox" checked> done</li>'
      + '<li><input type="checkbox"> todo</li></ul>',
    )

    expect(markdown).toContain('~old~')
    expect(markdown).toMatch(/\[x\]\s+done/)
    expect(markdown).toMatch(/\[ \]\s+todo/)
  })

  it('keeps only the alt text of images', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p>Chart: <img src="data:image/png;base64,AAAA" alt="Sales chart"></p>'
      + '<p><img src=""></p>',
    )

    expect(markdown).toBe('Chart: Sales chart')
    expect(markdown).not.toContain('data:')
  })

  it('uses fenced code blocks', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<pre><code>const answer = 42</code></pre>',
    )

    expect(markdown).toBe('```\nconst answer = 42\n```')
  })

  it('collapses excess blank lines and removes NUL characters', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p>one</p><p></p><p></p><p></p><p>t\u0000wo</p>',
    )

    expect(markdown).not.toMatch(/\n{3,}/)
    expect(markdown).not.toContain('\u0000')
    expect(markdown).toContain('one')
    expect(markdown).toContain('two')
  })

  it('returns an empty string for markup without content', () => {
    expect(htmlToKnowledgeMarkdown('<p></p><p>  </p>')).toBe('')
  })

  it.each([
    ['http', 'http://example.com/a'],
    ['https', 'https://example.com/a?x=1'],
    ['mailto', 'mailto:team@example.com'],
    ['tel', 'tel:+380441234567'],
    ['uppercase scheme', 'HTTPS://example.com/a'],
    ['anchor', '#section-2'],
    ['absolute path', '/docs/spec'],
    ['relative path', 'docs/spec.html'],
    ['protocol-relative', '//example.com/a'],
  ])('keeps %s links', (_label, href) => {
    const markdown = htmlToKnowledgeMarkdown(`<p><a href="${href}">go</a></p>`)

    expect(markdown).toBe(`[go](${href})`)
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['mixed case', 'JaVaScRiPt:alert(1)'],
    ['tab inside the scheme', 'java&#9;script:alert(1)'],
    ['newline inside the scheme', 'java&#10;script:alert(1)'],
    ['leading whitespace', '&#32;&#1;javascript:alert(1)'],
    ['data', 'data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/a'],
  ])('keeps only the text of %s links', (_label, href) => {
    const markdown = htmlToKnowledgeMarkdown(
      `<p>Open <a href="${href}">the report</a> now</p>`,
    )

    expect(markdown).toBe('Open the report now')
  })

  it('applies the link allow-list inside table cells', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<table><tr><td><a href="javascript:x()">bad</a></td>'
      + '<td><a href="https://example.com">good</a></td></tr></table>',
    )

    expect(markdown).toContain('| bad | [good](https://example.com) |')
    expect(markdown).not.toContain('javascript')
  })

  it('keeps links without an href as plain text', () => {
    expect(htmlToKnowledgeMarkdown('<p><a name="top">anchor</a></p>'))
      .toBe('anchor')
  })

  it('escapes parentheses and spaces in allowed link targets', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p><a href="https://example.com/a (b)">wiki</a></p>',
    )

    expect(markdown).toBe('[wiki](https://example.com/a%20\\(b\\))')
  })

  it('makes image alt text single-line and free of markdown', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p><img alt="Line one&#10;## Heading [x](javascript:y) `code` *bold*">'
      + '</p>',
    )

    expect(markdown).not.toContain('\n')
    expect(markdown).not.toMatch(/[[\]()`*#]/)
    expect(markdown).toContain('Line one')
    expect(markdown).toContain('Heading')
  })

  it('caps image alt text at 120 characters', () => {
    const markdown = htmlToKnowledgeMarkdown(
      `<p><img alt="${'a'.repeat(500)}"></p>`,
    )

    expect(markdown).toBe('a'.repeat(120))
  })

  it('strips control characters from image alt text', () => {
    const markdown = htmlToKnowledgeMarkdown(
      '<p><img alt="a&#1;b&#8232;c"></p>',
    )

    expect(markdown).toBe('a b c')
  })
})
