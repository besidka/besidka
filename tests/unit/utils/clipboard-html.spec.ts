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
const SPACER = '<div><br></div>'

const OWNER_MESSAGE_HTML = '<!--[-->'
  + '<p>Dobry wieczór,</p>'
  + '<p>Przesyłam stan liczników za październik:</p>'
  + '<ul class="list"><li>Prąd: 3597 kWh (+155)</li>'
  + '<li>Woda zimna: 48.3 m³ (+2.8)</li></ul>'
  + '<p>Załączam potwierdzenie płatności za wynajem mieszkania '
  + 'za listopad:</p>'
  + '<ul><li>4200 zł — miesięczna opłata</li>'
  + '<li>858 zł — czynsz</li></ul>'
  + '<p>Razem: <strong>5458 zł</strong></p><!--]-->'

const OWNER_CLIPBOARD_HTML = '<meta charset="utf-8">'
  + '<div style="font-size: 12px">'
  + '<div>Dobry wieczór,</div><div><br></div>'
  + '<div>Przesyłam stan liczników za październik:</div>'
  + '<ul style="margin: 0"><li>Prąd: 3597 kWh (+155)</li>'
  + '<li>Woda zimna: 48.3 m³ (+2.8)</li></ul><div><br></div>'
  + '<div>Załączam potwierdzenie płatności za wynajem mieszkania '
  + 'za listopad:</div>'
  + '<ul style="margin: 0"><li>4200 zł — miesięczna opłata</li>'
  + '<li>858 zł — czynsz</li></ul><div><br></div>'
  + '<div>Razem: <b>5458 zł</b></div></div>'

function wrap(inner: string): string {
  return `<div style="font-size: 12px">${inner}</div>`
}

function parse(html: string): HTMLElement {
  const container = document.createElement('div')

  container.innerHTML = html

  return container
}

function toBody(html: string): string {
  return cleanClipboardHtml(html, { baseUrl: BASE_URL })
    .replace(PREAMBLE, '')
}

function toLayout(html: string): string {
  return toBody(html)
    .replace(/^<div style="font-size: 12px">/, '')
    .replace(/<\/div>$/, '')
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
    expect(cleanClipboardHtml('<p>Hi</p>'))
      .toBe(`${PREAMBLE}${wrap('<div>Hi</div>')}`)
  })

  it('produces the exact Apple Mail style markup for a message', () => {
    expect(cleanClipboardHtml(OWNER_MESSAGE_HTML, { baseUrl: BASE_URL }))
      .toBe(OWNER_CLIPBOARD_HTML)
  })

  it('removes Vue fragment comments', () => {
    expect(toBody('<!--[--><p>Hi</p><!--]-->'))
      .toBe(wrap('<div>Hi</div>'))
  })

  it('strips class, style, id and data attributes', () => {
    const html = '<p class="a" style="color:red" id="x" data-foo="1">'
      + 'Hi <strong class="b">there</strong></p>'

    expect(toBody(html)).toBe(wrap('<div>Hi <b>there</b></div>'))
  })

  it('keeps inline formatting tags and maps strong and em to b and i', () => {
    const html = '<p><strong>s</strong> <em>e</em> <i>i</i> <b>b</b> '
      + '<del>d</del> <s>s</s> x<sup>2</sup> y<sub>1</sub> '
      + '<code>c</code></p>'

    expect(toBody(html)).toBe(wrap(
      '<div><b>s</b> <i>e</i> <i>i</i> <b>b</b> <del>d</del> <s>s</s> '
      + 'x<sup>2</sup> y<sub>1</sub> <code>c</code></div>',
    ))
  })

  it('keeps nested lists with a zero margin and the ordered list start', () => {
    const html = '<ol start="3"><li>a<ul><li>b</li></ul></li></ol>'

    expect(toLayout(html)).toBe(
      '<ol start="3" style="margin: 0"><li>a'
      + '<ul style="margin: 0"><li>b</li></ul></li></ol>',
    )
  })

  it('unwraps paragraphs inside loose list items', () => {
    const html = '<ul><li><p>a</p><p>b</p><ul><li><p>c</p></li></ul></li>'
      + '<li><p>d</p></li></ul>'

    expect(toLayout(html)).toBe(
      '<ul style="margin: 0"><li>a<br>b'
      + '<ul style="margin: 0"><li>c</li></ul></li><li>d</li></ul>',
    )
  })

  it('unwraps non-semantic containers', () => {
    expect(toBody('<div class="x"><span>Hi</span></div>')).toBe('Hi')
  })

  it('separates consecutive paragraphs with a spacer line', () => {
    expect(toLayout('<p>One</p><p>Two</p><p>Three</p>')).toBe(
      `<div>One</div>${SPACER}<div>Two</div>${SPACER}<div>Three</div>`,
    )
  })

  it('hangs a list directly under the paragraph before it', () => {
    expect(toLayout('<p>Intro</p><ul><li>a</li></ul>')).toBe(
      '<div>Intro</div><ul style="margin: 0"><li>a</li></ul>',
    )
  })

  it('puts a spacer after a list and before a list that follows a list', () => {
    expect(toLayout('<ul><li>a</li></ul><p>After</p>')).toBe(
      `<ul style="margin: 0"><li>a</li></ul>${SPACER}<div>After</div>`,
    )
    expect(toLayout('<ul><li>a</li></ul><ol><li>b</li></ol>')).toBe(
      `<ul style="margin: 0"><li>a</li></ul>${SPACER}`
      + '<ol style="margin: 0"><li>b</li></ol>',
    )
  })

  it('puts a spacer before a list that has no paragraph before it', () => {
    expect(toLayout('<h2>T</h2><ul><li>a</li></ul>')).toBe(
      `<div><b>T</b></div>${SPACER}<ul style="margin: 0"><li>a</li></ul>`,
    )
  })

  it('renders headings as bold lines without heading sizes', () => {
    expect(toLayout('<h1>Big <em>one</em></h1><p>Text</p><h3>Small</h3>'))
      .toBe(
        `<div><b>Big <i>one</i></b></div>${SPACER}<div>Text</div>${SPACER}`
        + '<div><b>Small</b></div>',
      )
  })

  it('indents blockquotes with a margin and lays out their content', () => {
    expect(toLayout('<p>Before</p><blockquote><p>Q1</p><p>Q2</p>'
      + '</blockquote><p>After</p>')).toBe(
      `<div>Before</div>${SPACER}`
      + '<blockquote style="margin: 0 0 0 1em">'
      + `<div>Q1</div>${SPACER}<div>Q2</div></blockquote>`
      + `${SPACER}<div>After</div>`,
    )
  })

  it('keeps horizontal rules between spaced blocks', () => {
    expect(toLayout('<p>a</p><hr><p>b</p>')).toBe(
      `<div>a</div>${SPACER}<hr>${SPACER}<div>b</div>`,
    )
  })

  it('wraps loose text next to blocks in a line', () => {
    expect(toLayout('tail <strong>x</strong><p>Para</p>')).toBe(
      `<div>tail <b>x</b></div>${SPACER}<div>Para</div>`,
    )
  })

  it('removes buttons, svg icons and hidden decoration', () => {
    const html = '<p>Hi<button>Copy</button><svg><path d="M0"/></svg>'
      + '<span aria-hidden="true">icon</span></p>'

    expect(toBody(html)).toBe(wrap('<div>Hi</div>'))
  })

  it('removes elements marked to skip', () => {
    expect(toBody('<p>Hi</p><p class="js-clipboard-skip">Oops</p>'))
      .toBe(wrap('<div>Hi</div>'))
  })

  it('reduces a highlighted code block to pre and code with text only', () => {
    const html = '<div class="mockup-browser">'
      + '<div class="js-clipboard-skip"><button>Copy</button></div>'
      + '<div><pre class="shiki"><code>'
      + '<span class="line"><span style="color:red">const</span> a = 1</span>\n'
      + '<span class="line">b()</span>\n</code></pre></div></div>'

    expect(toBody(html)).toBe(
      wrap('<pre style="margin: 0"><code>const a = 1\nb()</code></pre>'),
    )
  })

  it('escapes code content', () => {
    expect(toBody('<pre><code>&lt;div&gt; &amp;</code></pre>'))
      .toBe(wrap(
        '<pre style="margin: 0"><code>&lt;div&gt; &amp;</code></pre>',
      ))
  })

  it('turns a mermaid diagram into its source in a code block', () => {
    const html = '<div class="mockup-browser" '
      + 'data-code-source="graph TD\n  A--&gt;B">'
      + '<div class="js-clipboard-skip"><button>Copy</button></div>'
      + '<div><div class="mermaid-diagram"><svg><g>A</g></svg></div></div>'
      + '</div>'

    expect(toBody(html)).toBe(wrap(
      '<pre style="margin: 0"><code>graph TD\n  A--&gt;B</code></pre>',
    ))
  })

  it('ignores the code source attribute when useCodeSource is false', () => {
    const html = '<div data-code-source="whole">'
      + '<pre><code>part</code></pre></div>'

    expect(
      cleanClipboardHtml(html, { baseUrl: BASE_URL, useCodeSource: false })
        .replace(PREAMBLE, ''),
    ).toBe(wrap('<pre style="margin: 0"><code>part</code></pre>'))
  })

  it('unwraps the table scroller and keeps the table structure', () => {
    const html = '<div class="table-scroller"><table class="table">'
      + '<thead><tr><th>A</th><th colspan="2" class="x">B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table></div>'

    expect(toBody(html)).toBe(wrap(
      '<table border="1" cellpadding="6" cellspacing="0">'
      + '<thead><tr><th>A</th><th colspan="2">B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>',
    ))
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

  it('renders links as the url when the text is the url itself', () => {
    const html = '<a href="https://example.com/a">example.com/a</a> and '
      + '<a href="https://www.example.com/b">https://example.com/b</a> and '
      + '<a href="https://example.com/c">the docs</a>'

    expect(domToPlainText(parse(html))).toBe(
      'https://example.com/a and https://www.example.com/b and '
      + 'the docs (https://example.com/c)',
    )
  })

  it('keeps a label that is only part of the url', () => {
    const html = '<a href="https://example.com/docs">docs</a>'

    expect(domToPlainText(parse(html)))
      .toBe('docs (https://example.com/docs)')
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
      `${PREAMBLE}${wrap(
        '<ul style="margin: 0"><li><b>a</b></li><li>b</li></ul>',
      )}`,
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
      `${PREAMBLE}${wrap(`<div>A <b>bold</b></div>${SPACER}<div>B</div>`)}`,
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
      `${PREAMBLE}${wrap(
        '<ul style="margin: 0"><li>one</li><li>two</li></ul>',
      )}`,
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

    expect(content.html).toBe(
      `${PREAMBLE}${wrap(
        '<ol start="2" style="margin: 0"><li>two</li><li>three</li></ol>',
      )}`,
    )
    expect(content.text).toBe('2. two\n3. three')
  })

  it('lays out a selection that spans a paragraph and its list', () => {
    const container = parse(
      '<p>Intro</p><ul><li>a</li><li>b</li></ul><p>Razem <strong>5</strong></p>',
    )
    const content = selectionRangesToClipboardContent([rangeAround(container)])

    expect(content.html).toBe(`${PREAMBLE}${wrap(
      '<div>Intro</div><ul style="margin: 0"><li>a</li><li>b</li></ul>'
      + `${SPACER}<div>Razem <b>5</b></div>`,
    )}`)
    expect(content.text).toBe('Intro\n\n- a\n- b\n\nRazem 5')
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
      `${PREAMBLE}${wrap('<pre style="margin: 0"><code>a = 1\nb = 2</code></pre>')}`,
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
