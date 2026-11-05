import { describe, expect, it } from 'vitest'
import {
  cleanClipboardHtml,
  domToPlainText,
  htmlToClipboardContent,
  isRangeInsideSelector,
  selectionRangesToClipboardContent,
} from '~/utils/clipboard-html'

const BASE_URL = 'https://besidka.com/chats/abc'
const PREAMBLE = '<meta charset="utf-8">'

function parse(html: string): HTMLElement {
  const container = document.createElement('div')

  container.innerHTML = html

  return container
}

function toBody(html: string): string {
  return cleanClipboardHtml(html, { baseUrl: BASE_URL })
    .replace(PREAMBLE, '')
}

function rangeAround(container: Node): Range {
  const range = document.createRange()

  range.selectNodeContents(container)

  return range
}

describe('cleanClipboardHtml', () => {
  it('returns an empty string for empty input', () => {
    expect(cleanClipboardHtml('')).toBe('')
    expect(cleanClipboardHtml('   ')).toBe('')
  })

  it('prefixes the output with a charset meta tag', () => {
    expect(cleanClipboardHtml('<p>Hi</p>')).toBe(`${PREAMBLE}<p>Hi</p>`)
  })

  it('removes Vue fragment comments', () => {
    expect(toBody('<!--[--><p>Hi</p><!--]-->')).toBe('<p>Hi</p>')
  })

  it('strips class, style, id and data attributes', () => {
    const html = '<p class="a" style="color:red" id="x" data-foo="1">'
      + 'Hi <strong class="b">there</strong></p>'

    expect(toBody(html)).toBe('<p>Hi <strong>there</strong></p>')
  })

  it('keeps semantic formatting tags', () => {
    const html = '<h2>T</h2><blockquote><p>Q</p></blockquote><hr>'
      + '<p><em>e</em> <i>i</i> <b>b</b> <del>d</del> <s>s</s> '
      + 'x<sup>2</sup> y<sub>1</sub> <code>c</code></p>'

    expect(toBody(html)).toBe(html)
  })

  it('keeps nested lists and the ordered list start', () => {
    const html = '<ol start="3"><li>a<ul><li>b</li></ul></li></ol>'

    expect(toBody(html)).toBe(html)
  })

  it('unwraps non-semantic containers', () => {
    expect(toBody('<div class="x"><span>Hi</span></div>')).toBe('Hi')
  })

  it('removes buttons, svg icons and hidden decoration', () => {
    const html = '<p>Hi<button>Copy</button><svg><path d="M0"/></svg>'
      + '<span aria-hidden="true">icon</span></p>'

    expect(toBody(html)).toBe('<p>Hi</p>')
  })

  it('removes elements marked to skip', () => {
    expect(toBody('<p>Hi</p><p class="js-clipboard-skip">Oops</p>'))
      .toBe('<p>Hi</p>')
  })

  it('reduces a highlighted code block to pre and code with text only', () => {
    const html = '<div class="mockup-browser">'
      + '<div class="js-clipboard-skip"><button>Copy</button></div>'
      + '<div><pre class="shiki"><code>'
      + '<span class="line"><span style="color:red">const</span> a = 1</span>\n'
      + '<span class="line">b()</span>\n</code></pre></div></div>'

    expect(toBody(html)).toBe(
      '<pre><code>const a = 1\nb()</code></pre>',
    )
  })

  it('escapes code content', () => {
    expect(toBody('<pre><code>&lt;div&gt; &amp;</code></pre>'))
      .toBe('<pre><code>&lt;div&gt; &amp;</code></pre>')
  })

  it('turns a mermaid diagram into its source in a code block', () => {
    const html = '<div class="mockup-browser" '
      + 'data-code-source="graph TD\n  A--&gt;B">'
      + '<div class="js-clipboard-skip"><button>Copy</button></div>'
      + '<div><div class="mermaid-diagram"><svg><g>A</g></svg></div></div>'
      + '</div>'

    expect(toBody(html)).toBe(
      '<pre><code>graph TD\n  A--&gt;B</code></pre>',
    )
  })

  it('ignores the code source attribute when useCodeSource is false', () => {
    const html = '<div data-code-source="whole">'
      + '<pre><code>part</code></pre></div>'

    expect(
      cleanClipboardHtml(html, { baseUrl: BASE_URL, useCodeSource: false })
        .replace(PREAMBLE, ''),
    ).toBe('<pre><code>part</code></pre>')
  })

  it('unwraps the table scroller and keeps the table structure', () => {
    const html = '<div class="table-scroller"><table class="table">'
      + '<thead><tr><th>A</th><th colspan="2" class="x">B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table></div>'

    expect(toBody(html)).toBe(
      '<table border="1" cellpadding="6" cellspacing="0">'
      + '<thead><tr><th>A</th><th colspan="2">B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>',
    )
  })

  it('keeps only the href on links and resolves relative links', () => {
    const html = '<a href="https://example.com/x" target="_blank" '
      + 'class="link" rel="noopener">ext</a> '
      + '<a href="/chats/xyz">internal</a>'

    expect(toBody(html)).toBe(
      '<a href="https://example.com/x">ext</a> '
      + '<a href="https://besidka.com/chats/xyz">internal</a>',
    )
  })

  it('unwraps links with unsafe or missing hrefs', () => {
    expect(toBody('<a href="javascript:alert(1)">x</a><a>y</a>'))
      .toBe('xy')
  })

  it('keeps allowed images and drops unusable ones', () => {
    const html = '<img src="/_ipx/a.png" alt="A" width="10" class="z">'
      + '<img src="javascript:alert(1)" alt="bad">'
      + '<img src="data:image/png;base64,AAAA" alt="D">'

    expect(toBody(html)).toBe(
      '<img src="https://besidka.com/_ipx/a.png" alt="A" width="10">'
      + '<img src="data:image/png;base64,AAAA" alt="D">',
    )
  })
})

describe('domToPlainText', () => {
  it('separates paragraphs with a blank line', () => {
    expect(domToPlainText(parse('<p>One</p><p>Two</p>')))
      .toBe('One\n\nTwo')
  })

  it('renders bold and inline code as plain text', () => {
    expect(domToPlainText(parse('<p>a <strong>b</strong> <code>c</code></p>')))
      .toBe('a b c')
  })

  it('renders unordered lists with dash markers', () => {
    expect(domToPlainText(parse('<ul><li>a</li><li>b</li></ul>')))
      .toBe('- a\n- b')
  })

  it('renders ordered lists with numbering and honours start', () => {
    expect(domToPlainText(parse('<ol start="3"><li>a</li><li>b</li></ol>')))
      .toBe('3. a\n4. b')
    expect(domToPlainText(parse('<ol><li>a</li><li>b</li></ol>')))
      .toBe('1. a\n2. b')
  })

  it('indents nested lists under their parent item', () => {
    const html = '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>'

    expect(domToPlainText(parse(html))).toBe('- a\n  - b\n  - c\n- d')
  })

  it('indents nested ordered lists by the marker width', () => {
    const html = '<ol><li>a<ul><li>b</li></ul></li></ol>'

    expect(domToPlainText(parse(html))).toBe('1. a\n   - b')
  })

  it('keeps code blocks verbatim', () => {
    const html = '<p>Run:</p><pre><code>a  b\n  c\n</code></pre>'

    expect(domToPlainText(parse(html))).toBe('Run:\n\na  b\n  c')
  })

  it('renders tables as pipe separated rows', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>'

    expect(domToPlainText(parse(html))).toBe('A | B\n1 | 2')
  })

  it('renders links as the url when the text is part of it', () => {
    const html = '<a href="https://example.com/a">example.com</a> and '
      + '<a href="https://example.com/b">the docs</a>'

    expect(domToPlainText(parse(html)))
      .toBe('https://example.com/a and the docs (https://example.com/b)')
  })

  it('renders blockquotes with a prefix and headings as text', () => {
    expect(domToPlainText(parse('<h1>Title</h1><blockquote><p>q</p></blockquote>')))
      .toBe('Title\n\n> q')
  })

  it('renders line breaks and horizontal rules', () => {
    expect(domToPlainText(parse('<p>a<br>b</p><hr><p>c</p>')))
      .toBe('a\nb\n\n---\n\nc')
  })

  it('collapses insignificant whitespace between blocks', () => {
    expect(domToPlainText(parse('<p>a\n   b</p>\n<p>c</p>')))
      .toBe('a b\n\nc')
  })
})

describe('htmlToClipboardContent', () => {
  it('returns cleaned html and plain text together', () => {
    const content = htmlToClipboardContent(
      '<!--[--><ul class="x"><li><strong>a</strong></li><li>b</li></ul>',
      { baseUrl: BASE_URL },
    )

    expect(content.html).toBe(
      `${PREAMBLE}<ul><li><strong>a</strong></li><li>b</li></ul>`,
    )
    expect(content.text).toBe('- a\n- b')
  })

  it('returns empty content for empty input', () => {
    expect(htmlToClipboardContent('')).toEqual({ html: '', text: '' })
  })
})

describe('selectionRangesToClipboardContent', () => {
  it('keeps plain text selections exact', () => {
    const container = parse('<p class="x">Hello big world</p>')
    const textNode = container.querySelector('p')!.firstChild!
    const range = document.createRange()

    range.setStart(textNode, 5)
    range.setEnd(textNode, 10)

    const content = selectionRangesToClipboardContent([range])

    expect(content.text).toBe(' big ')
    expect(content.html).toBe(`${PREAMBLE} big `)
  })

  it('cleans formatting inside a selection', () => {
    const container = parse(
      '<p class="x" style="color:red">A <strong class="s">bold</strong></p>'
      + '<p>B</p>',
    )
    const content = selectionRangesToClipboardContent(
      [rangeAround(container)],
      { baseUrl: BASE_URL },
    )

    expect(content.html).toBe(
      `${PREAMBLE}<p>A <strong>bold</strong></p><p>B</p>`,
    )
    expect(content.text).toBe('A bold\n\nB')
  })

  it('wraps list items selected across items in their list', () => {
    const container = parse('<ul><li>one</li><li>two</li><li>three</li></ul>')
    const list = container.querySelector('ul')!
    const range = document.createRange()

    range.setStart(list.children[0]!.firstChild!, 0)
    range.setEnd(list.children[1]!.firstChild!, 3)

    const content = selectionRangesToClipboardContent([range])

    expect(content.html).toBe(
      `${PREAMBLE}<ul><li>one</li><li>two</li></ul>`,
    )
    expect(content.text).toBe('- one\n- two')
  })

  it('numbers ordered list items from the first selected item', () => {
    const container = parse('<ol><li>one</li><li>two</li><li>three</li></ol>')
    const list = container.querySelector('ol')!
    const range = document.createRange()

    range.setStart(list.children[1]!.firstChild!, 0)
    range.setEnd(list.children[2]!.firstChild!, 5)

    const content = selectionRangesToClipboardContent([range])

    expect(content.text).toBe('2. two\n3. three')
  })

  it('renders a selection inside a code block as a code block', () => {
    const container = parse(
      '<pre><code><span class="line">a = 1</span>\n'
      + '<span class="line">b = 2</span></code></pre>',
    )
    const code = container.querySelector('code')!
    const range = document.createRange()

    range.setStart(code.querySelector('span')!.firstChild!, 0)
    range.setEnd(code.querySelectorAll('span')[1]!.firstChild!, 5)

    const content = selectionRangesToClipboardContent([range])

    expect(content.html).toBe(
      `${PREAMBLE}<pre><code>a = 1\nb = 2</code></pre>`,
    )
    expect(content.text).toBe('a = 1\nb = 2')
  })

  it('renders a one-line selection inside code as inline code', () => {
    const container = parse('<pre><code><span>foo(bar)</span></code></pre>')
    const textNode = container.querySelector('span')!.firstChild!
    const range = document.createRange()

    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)

    const content = selectionRangesToClipboardContent([range])

    expect(content.html).toBe(`${PREAMBLE}<code>foo</code>`)
    expect(content.text).toBe('foo')
  })
})

describe('isRangeInsideSelector', () => {
  it('matches ranges inside the selector and rejects others', () => {
    const container = parse(
      '<div class="js-message-text"><p>in</p></div><p>out</p>',
    )
    const inside = document.createRange()
    const outside = document.createRange()

    inside.selectNodeContents(container.querySelector('p')!)
    outside.selectNodeContents(container.lastElementChild!)

    expect(isRangeInsideSelector(inside, '.js-message-text')).toBe(true)
    expect(isRangeInsideSelector(outside, '.js-message-text')).toBe(false)
  })
})
