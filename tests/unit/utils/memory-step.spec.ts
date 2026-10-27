import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  canUndoMemoryStep,
  formatMemoryEntryCount,
  getMemoryCategoryLabel,
  getMemoryStepData,
} from '../../../app/utils/memory-step'
import { SEARCH_STEP_FALLBACK_ERROR } from '../../../app/utils/search-step'

function part(value: Record<string, unknown>): UIMessage['parts'][number] {
  return value as UIMessage['parts'][number]
}

const listedEntry = {
  id: 'entry-1',
  handle: 'topics/gardening',
  scope: 'account',
  category: 'topics',
  title: 'Gardening',
  description: 'Grows tomatoes',
  body: 'Long body that the chip must never carry',
}

describe('getMemoryStepData', () => {
  it('returns null for tools that are not memory tools', () => {
    expect(getMemoryStepData(part({
      type: 'tool-web_search_brave',
      state: 'output-available',
    }))).toBeNull()
    expect(getMemoryStepData(part({ type: 'text', text: 'hi' }))).toBeNull()
  })

  it('reads memory_list entries without bodies', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_list',
      state: 'output-available',
      input: {},
      output: {
        notice: 'data',
        entries: [
          listedEntry,
          { ...listedEntry, id: 'entry-2', scope: 'project', title: 'Plan' },
        ],
      },
    }))

    expect(data).toEqual({
      toolName: 'memory_list',
      state: 'done',
      entries: [
        {
          id: 'entry-1',
          title: 'Gardening',
          category: 'topics',
          scope: 'account',
        },
        {
          id: 'entry-2',
          title: 'Plan',
          category: 'topics',
          scope: 'project',
        },
      ],
      action: undefined,
      entryId: undefined,
      previous: undefined,
      errorReason: '',
    })
    expect(JSON.stringify(data)).not.toContain('Long body')
  })

  it('reads a single memory_read entry', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_read',
      state: 'output-available',
      output: { notice: 'data', entry: listedEntry },
    }))

    expect(data?.toolName).toBe('memory_read')
    expect(data?.entries).toEqual([{
      id: 'entry-1',
      title: 'Gardening',
      category: 'topics',
      scope: 'account',
    }])
    expect(data?.entryId).toBeUndefined()
  })

  it('reads a created memory_write with the entry id', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-available',
      output: {
        notice: 'saved',
        action: 'created',
        entry: {
          id: 'entry-9',
          handle: 'people/anna',
          scope: 'account',
          category: 'people',
          title: 'Anna',
          description: 'Sister',
        },
      },
    }))

    expect(data?.action).toBe('created')
    expect(data?.entryId).toBe('entry-9')
    expect(data?.previous).toBeUndefined()
    expect(data?.entries[0]?.title).toBe('Anna')
  })

  it('parses previous for an updated memory_write', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-available',
      output: {
        notice: 'saved',
        action: 'updated',
        entry: {
          id: 'entry-9',
          scope: 'project',
          category: 'areas',
          title: 'Work',
          description: 'New',
        },
        previous: {
          category: 'areas',
          title: 'Job',
          description: 'Old',
          body: 'Old body',
          sensitivity: 'special',
          sensitiveCategory: 'health',
        },
      },
    }))

    expect(data?.action).toBe('updated')
    expect(data?.previous).toEqual({
      category: 'areas',
      title: 'Job',
      description: 'Old',
      body: 'Old body',
      sensitivity: 'special',
      sensitiveCategory: 'health',
    })
  })

  it('keeps a null sensitiveCategory and drops unknown sensitivity values',
    () => {
      const data = getMemoryStepData(part({
        type: 'tool-memory_write',
        state: 'output-available',
        output: {
          action: 'updated',
          entry: {
            id: 'entry-9',
            scope: 'account',
            category: 'areas',
            title: 'Work',
          },
          previous: {
            category: 'areas',
            title: 'Job',
            description: 'Old',
            body: 'Old body',
            sensitivity: 'bogus',
            sensitiveCategory: null,
          },
        },
      }))

      expect(data?.previous).toEqual({
        category: 'areas',
        title: 'Job',
        description: 'Old',
        body: 'Old body',
        sensitiveCategory: null,
      })
    })

  it('ignores a malformed previous and previous on a created write', () => {
    const malformed = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-available',
      output: {
        action: 'updated',
        entry: { id: 'e', category: 'areas', title: 'Work' },
        previous: { category: 'areas', title: 'Job' },
      },
    }))
    const created = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-available',
      output: {
        action: 'created',
        entry: { id: 'e', category: 'areas', title: 'Work' },
        previous: {
          category: 'areas',
          title: 'Job',
          description: 'd',
          body: 'b',
        },
      },
    }))

    expect(malformed?.previous).toBeUndefined()
    expect(created?.previous).toBeUndefined()
  })

  it('reads the removed entry of memory_forget without an entry id', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_forget',
      state: 'output-available',
      output: {
        notice: 'removed',
        removed: {
          id: 'entry-3',
          handle: 'topics/chess',
          scope: 'account',
          category: 'topics',
          title: 'Chess',
        },
      },
    }))

    expect(data?.toolName).toBe('memory_forget')
    expect(data?.entries[0]?.title).toBe('Chess')
    expect(data?.entryId).toBeUndefined()
    expect(data?.action).toBeUndefined()
  })

  it('maps pending, preliminary and failed states', () => {
    expect(getMemoryStepData(part({
      type: 'tool-memory_list',
      state: 'input-available',
    }))?.state).toBe('pending')
    expect(getMemoryStepData(part({
      type: 'tool-memory_list',
      state: 'input-streaming',
    }))?.state).toBe('pending')
    expect(getMemoryStepData(part({
      type: 'tool-memory_list',
      state: 'output-available',
      preliminary: true,
      output: { entries: [listedEntry] },
    }))).toMatchObject({ state: 'pending', entries: [] })

    const failed = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-error',
      errorText: JSON.stringify({
        message: 'Memory limit reached',
        why: 'At most 200 entries.',
      }),
    }))

    expect(failed?.state).toBe('failed')
    expect(failed?.errorReason).toBe(
      'Memory limit reached At most 200 entries.',
    )
    expect(failed?.entries).toEqual([])
  })

  it('falls back to a generic reason when the error text is unreadable',
    () => {
      const failed = getMemoryStepData(part({
        type: 'tool-memory_forget',
        state: 'output-denied',
      }))

      expect(failed?.state).toBe('failed')
      expect(failed?.errorReason).toBe(SEARCH_STEP_FALLBACK_ERROR)
    })

  it('tolerates malformed outputs', () => {
    const outputs: unknown[] = [
      null,
      'text',
      [],
      { entries: 'nope' },
      { entries: [null, 3, {}, { title: 'x' }, { title: ' ', category: 'topics' }] },
      { entries: [{ title: 'Bad', category: 'unknown-category' }] },
      { entry: [] },
    ]

    for (const output of outputs) {
      for (const type of ['tool-memory_list', 'tool-memory_read']) {
        const data = getMemoryStepData(part({
          type,
          state: 'output-available',
          output,
        }))

        expect(data?.state).toBe('done')
        expect(data?.entries).toEqual([])
      }
    }
  })

  it('defaults an unknown scope to account and trims ids and titles', () => {
    const data = getMemoryStepData(part({
      type: 'tool-memory_read',
      state: 'output-available',
      output: {
        entry: {
          id: '  e1  ',
          scope: 'weird',
          category: 'profile',
          title: '  Me  ',
        },
      },
    }))

    expect(data?.entries[0]).toEqual({
      id: 'e1',
      title: 'Me',
      category: 'profile',
      scope: 'account',
    })
  })

  it('reads dynamic-tool parts by tool name', () => {
    const data = getMemoryStepData(part({
      type: 'dynamic-tool',
      toolName: 'memory_forget',
      state: 'input-available',
    }))

    expect(data?.toolName).toBe('memory_forget')
    expect(data?.state).toBe('pending')
  })
})

describe('canUndoMemoryStep', () => {
  const created = getMemoryStepData(part({
    type: 'tool-memory_write',
    state: 'output-available',
    output: {
      action: 'created',
      entry: { id: 'e', category: 'areas', title: 'Work' },
    },
  }))

  it('allows undoing a done created write', () => {
    expect(created && canUndoMemoryStep(created)).toBe(true)
  })

  it('requires previous for an updated write', () => {
    const withoutPrevious = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-available',
      output: {
        action: 'updated',
        entry: { id: 'e', category: 'areas', title: 'Work' },
      },
    }))

    expect(withoutPrevious && canUndoMemoryStep(withoutPrevious))
      .toBe(false)
  })

  it('never offers undo for other tools, pending or failed writes', () => {
    const forget = getMemoryStepData(part({
      type: 'tool-memory_forget',
      state: 'output-available',
      output: { removed: { id: 'e', category: 'areas', title: 'Work' } },
    }))
    const pending = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'input-available',
    }))
    const failed = getMemoryStepData(part({
      type: 'tool-memory_write',
      state: 'output-error',
    }))

    expect(forget && canUndoMemoryStep(forget)).toBe(false)
    expect(pending && canUndoMemoryStep(pending)).toBe(false)
    expect(failed && canUndoMemoryStep(failed)).toBe(false)
  })
})

describe('formatMemoryEntryCount', () => {
  it('pluralises the entry count', () => {
    expect(formatMemoryEntryCount(0)).toBe('No entries')
    expect(formatMemoryEntryCount(1)).toBe('1 entry')
    expect(formatMemoryEntryCount(3)).toBe('3 entries')
  })
})

describe('getMemoryCategoryLabel', () => {
  it('labels known categories and passes unknown ones through', () => {
    expect(getMemoryCategoryLabel('preferences')).toBe('Preferences')
    expect(getMemoryCategoryLabel('mystery')).toBe('mystery')
  })
})
