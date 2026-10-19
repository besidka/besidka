import { describe, expect, it } from 'vitest'
import {
  getClosedFencedBlocks,
  isFencedBlockClosed,
} from '~/utils/markdown-fences'

describe('getClosedFencedBlocks', () => {
  it('returns the content of a closed block', () => {
    const markdown = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nOutro'

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual([
      'flowchart LR\n  A --> B',
    ])
  })

  it('ignores an unclosed trailing block', () => {
    const markdown = '```mermaid\nflowchart LR\n  A --> B'

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual([])
  })

  it('returns closed blocks and skips the unclosed one after them', () => {
    const markdown = '```mermaid\nA\n```\n\n```mermaid\nB'

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual(['A'])
  })

  it('supports tilde fences and does not mix them with backticks', () => {
    expect(getClosedFencedBlocks('~~~mermaid\nA\n~~~', 'mermaid'))
      .toEqual(['A'])
    expect(getClosedFencedBlocks('~~~mermaid\nA\n```', 'mermaid'))
      .toEqual([])
    expect(getClosedFencedBlocks('```mermaid\nA\n~~~', 'mermaid'))
      .toEqual([])
  })

  it('accepts a longer closing fence and rejects a shorter one', () => {
    expect(getClosedFencedBlocks('```mermaid\nA\n`````', 'mermaid'))
      .toEqual(['A'])
    expect(getClosedFencedBlocks('````mermaid\nA\n```', 'mermaid'))
      .toEqual([])
  })

  it('does not treat a closing fence with trailing text as closing', () => {
    expect(getClosedFencedBlocks('```mermaid\nA\n``` text', 'mermaid'))
      .toEqual([])
  })

  it('matches the language case-insensitively on the first info word', () => {
    expect(getClosedFencedBlocks('```Mermaid title\nA\n```', 'mermaid'))
      .toEqual(['A'])
    expect(getClosedFencedBlocks('```mermaidx\nA\n```', 'mermaid'))
      .toEqual([])
    expect(getClosedFencedBlocks('```js\nA\n```', 'mermaid'))
      .toEqual([])
  })

  it('treats other languages as opaque', () => {
    const markdown = [
      '````markdown',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '````',
    ].join('\n')

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual([])
  })

  it('handles blockquote prefixes', () => {
    const markdown = '> ```mermaid\n> flowchart LR\n>   A --> B\n> ```'

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual([
      'flowchart LR\n  A --> B',
    ])
  })

  it('handles indented fences and strips the fence indentation', () => {
    const markdown = '- item\n\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```'

    expect(getClosedFencedBlocks(markdown, 'mermaid')).toEqual([
      'flowchart LR\n  A --> B',
    ])
  })

  it('handles a fence opened on a list marker line', () => {
    expect(
      getClosedFencedBlocks(
        '- ```mermaid\n  flowchart LR\n    A --> B\n  ```',
        'mermaid',
      ),
    ).toEqual(['flowchart LR\n  A --> B'])
    expect(
      getClosedFencedBlocks(
        '1. ```mermaid\n   flowchart LR\n   ```',
        'mermaid',
      ),
    ).toEqual(['flowchart LR'])
    expect(
      getClosedFencedBlocks('- ```mermaid\n  A', 'mermaid'),
    ).toEqual([])
  })

  it('handles CRLF line endings', () => {
    expect(getClosedFencedBlocks('```mermaid\r\nA\r\n```', 'mermaid'))
      .toEqual(['A'])
  })

  it('ignores inline triple backticks that are not a fence', () => {
    expect(getClosedFencedBlocks('use ```mermaid``` inline', 'mermaid'))
      .toEqual([])
  })
})

describe('isFencedBlockClosed', () => {
  const closed = '```mermaid\nflowchart LR\n  A --> B\n```'

  it('is true when the rendered code equals a closed block', () => {
    expect(isFencedBlockClosed(closed, 'mermaid', 'flowchart LR\n  A --> B'))
      .toBe(true)
  })

  it('ignores whitespace differences and trailing backticks', () => {
    expect(isFencedBlockClosed(closed, 'mermaid', 'flowchartLR\nA-->B``'))
      .toBe(true)
  })

  it('matches a blockquoted fence', () => {
    expect(
      isFencedBlockClosed(
        '> ```mermaid\n> flowchart LR\n>   A --> B\n> ```',
        'mermaid',
        'flowchart LR\n  A --> B',
      ),
    ).toBe(true)
  })

  it('matches an indented list item fence', () => {
    expect(
      isFencedBlockClosed(
        '- item\n\n  ```mermaid\n  flowchart LR\n    A --> B\n  ```',
        'mermaid',
        'flowchart LR\n  A --> B',
      ),
    ).toBe(true)
  })

  it('matches a fence opened on a list marker line', () => {
    expect(
      isFencedBlockClosed(
        '- ```mermaid\n  flowchart LR\n    A --> B\n  ```',
        'mermaid',
        'flowchart LR\n  A --> B',
      ),
    ).toBe(true)
  })

  it('does not treat a lagging arrow as the closed arrow', () => {
    expect(
      isFencedBlockClosed(
        '```mermaid\nflowchart LR\n  A -->\n```',
        'mermaid',
        'flowchart LR\n  A --',
      ),
    ).toBe(false)
    expect(
      isFencedBlockClosed(
        '```mermaid\nflowchart LR\n  A --> B\n```',
        'mermaid',
        'flowchart LR\n  A --',
      ),
    ).toBe(false)
  })

  it('is false while the fence is still open', () => {
    const streaming = '```mermaid\nflowchart LR\n  A --> B'

    expect(isFencedBlockClosed(streaming, 'mermaid', 'flowchart LR\n  A --> B'))
      .toBe(false)
  })

  it('is false when the rendered code lags behind a closed block', () => {
    expect(isFencedBlockClosed(closed, 'mermaid', 'flowchart LR\n  A'))
      .toBe(false)
    expect(isFencedBlockClosed(closed, 'mermaid', 'flowchart LR'))
      .toBe(false)
  })

  it('is false when the rendered code is longer than the closed block', () => {
    expect(
      isFencedBlockClosed(closed, 'mermaid', 'flowchart LR\n  A --> B\n  B --> C'),
    ).toBe(false)
  })
})
