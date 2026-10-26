import { describe, expect, it } from 'vitest'
import { diffMemoryInstructLines } from '../../../app/utils/memory-instruct-diff'

describe('diffMemoryInstructLines', () => {
  it('marks replaced, added and kept lines in reading order', () => {
    expect(diffMemoryInstructLines(
      '- Lives in Warsaw\n- Speaks Polish',
      '- Lives in Kraków\n- Speaks Polish\n- Learns Czech',
    )).toEqual([
      { type: 'removed', text: '- Lives in Warsaw' },
      { type: 'added', text: '- Lives in Kraków' },
      { type: 'same', text: '- Speaks Polish' },
      { type: 'added', text: '- Learns Czech' },
    ])
  })

  it('ignores blank lines and handles empty sides', () => {
    expect(diffMemoryInstructLines('', '- New\n\n')).toEqual([
      { type: 'added', text: '- New' },
    ])
    expect(diffMemoryInstructLines('- Old\n', '')).toEqual([
      { type: 'removed', text: '- Old' },
    ])
  })
})
