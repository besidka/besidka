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
})
