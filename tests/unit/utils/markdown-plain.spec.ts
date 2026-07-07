import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from '../../../shared/utils/markdown-plain'

describe('markdownToPlainText', () => {
  it('strips heading markers and keeps the text on its own line', () => {
    expect(markdownToPlainText('# Title')).toBe('Title')
    expect(markdownToPlainText('### Subtitle')).toBe('Subtitle')
    expect(markdownToPlainText('Intro\n## Section\nBody'))
      .toBe('Intro\nSection\nBody')
  })

  it('converts bold markers to plain text', () => {
    expect(markdownToPlainText('**bold**')).toBe('bold')
    expect(markdownToPlainText('__bold__')).toBe('bold')
    expect(markdownToPlainText('**A** and **B** on one line'))
      .toBe('A and B on one line')
  })

  it('converts italic markers to plain text', () => {
    expect(markdownToPlainText('*italic*')).toBe('italic')
    expect(markdownToPlainText('_italic_')).toBe('italic')
    expect(markdownToPlainText('This is *italic* mid-sentence'))
      .toBe('This is italic mid-sentence')
  })

  it('does not touch underscores inside words or URLs', () => {
    expect(markdownToPlainText('my_file_name.txt')).toBe('my_file_name.txt')
    expect(markdownToPlainText('http://example.com/some_page_here'))
      .toBe('http://example.com/some_page_here')
    expect(markdownToPlainText('snake_case_variable'))
      .toBe('snake_case_variable')
  })

  it('does not touch a leading unordered list bullet', () => {
    expect(markdownToPlainText('* Item one')).toBe('* Item one')
    expect(markdownToPlainText('- Item with *emphasis* inline'))
      .toBe('- Item with emphasis inline')
  })

  it('converts strikethrough markers to plain text', () => {
    expect(markdownToPlainText('~~removed~~ text stays'))
      .toBe('removed text stays')
  })

  it('converts inline code to plain text', () => {
    expect(markdownToPlainText('Use `npm install` to set up'))
      .toBe('Use npm install to set up')
  })

  it('keeps fenced code block content verbatim and drops the fence', () => {
    const markdown = [
      '```js',
      'const value = 1',
      'const other = 2',
      '```',
    ].join('\n')

    expect(markdownToPlainText(markdown))
      .toBe('const value = 1\nconst other = 2')
  })

  it('does not apply emphasis or link rules inside fenced code', () => {
    const markdown = [
      '```',
      '**not bold** and [not a link](https://example.com)',
      '```',
    ].join('\n')

    expect(markdownToPlainText(markdown)).toBe(
      '**not bold** and [not a link](https://example.com)',
    )
  })

  it('outputs just the url when the link text is the domain', () => {
    expect(
      markdownToPlainText('([example.com](https://example.com/docs))'),
    ).toBe('(https://example.com/docs)')
  })

  it('outputs "text (url)" when the text is not the domain', () => {
    expect(
      markdownToPlainText('[Read more](https://blog.example.com/post)'),
    ).toBe('Read more (https://blog.example.com/post)')
  })

  it('converts images to a bare url', () => {
    expect(
      markdownToPlainText('![diagram](https://example.com/diagram.png)'),
    ).toBe('https://example.com/diagram.png')
  })

  it('strips blockquote prefixes, including nested ones', () => {
    expect(markdownToPlainText('> A quoted line')).toBe('A quoted line')
    expect(markdownToPlainText('> > Double quoted')).toBe('Double quoted')
  })

  it('removes horizontal rules and collapses the surrounding blank lines', () => {
    expect(markdownToPlainText('Above\n\n---\n\nBelow')).toBe('Above\n\nBelow')
    expect(markdownToPlainText('Above\n***\nBelow')).toBe('Above\nBelow')
    expect(markdownToPlainText('Above\n___\nBelow')).toBe('Above\nBelow')
  })

  it('preserves ordered and unordered list markers exactly', () => {
    const markdown = [
      '1. First step',
      '2. Second step',
      '- Top level bullet',
      '  - Nested bullet',
    ].join('\n')

    expect(markdownToPlainText(markdown)).toBe(markdown)
  })

  it('leaves dot-parenthesis numbered lines untouched', () => {
    expect(markdownToPlainText('1) Alternate numbering style'))
      .toBe('1) Alternate numbering style')
  })

  it('collapses 3 or more consecutive newlines to 2', () => {
    expect(markdownToPlainText('A\n\n\n\nB')).toBe('A\n\nB')
  })

  it('trims leading and trailing whitespace', () => {
    expect(markdownToPlainText('\n\n  Hello  \n\n')).toBe('Hello')
  })

  it('converts a realistic chat message end to end', () => {
    const markdown = [
      '# Release Notes',
      '',
      'Here is a **bold** intro with some *italic* text.',
      '',
      '## Highlights',
      '',
      '- **New feature**: adds support for exports',
      '  - Nested detail with a link ([example.com](https://example.com/docs))',
      '- Second item with `inline code` sample',
      '',
      '---',
      '',
      '1. First step',
      '2. Second step',
      '1) Alternate numbering style untouched',
      '',
      '> A blockquote note',
      '',
      'Read more at [Our blog](https://blog.example.com/post) for details.',
    ].join('\n')

    const expected = [
      'Release Notes',
      '',
      'Here is a bold intro with some italic text.',
      '',
      'Highlights',
      '',
      '- New feature: adds support for exports',
      '  - Nested detail with a link (https://example.com/docs)',
      '- Second item with inline code sample',
      '',
      '1. First step',
      '2. Second step',
      '1) Alternate numbering style untouched',
      '',
      'A blockquote note',
      '',
      'Read more at Our blog (https://blog.example.com/post) for details.',
    ].join('\n')

    expect(markdownToPlainText(markdown)).toBe(expected)
  })
})
