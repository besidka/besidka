import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import type { EffectScope } from 'vue'
import {
  COMPOSER_COMMANDS_MAX_ROWS,
  useComposerCommands,
} from '../../../app/composables/composer-commands'
import { useComposerSkillInvocation } from '../../../app/composables/composer-skill-invocation'
import type { ComposerSkillItem } from '../../../app/composables/composer-skills'
import type { TextSnapshot } from '../../../app/composables/markdown-textarea'

const { featureState } = vi.hoisted(() => ({
  featureState: { isCommandsActive: true },
}))

mockNuxtImport('useFeature', () => {
  return (key: string) => {
    return ref({
      enabled: true,
      active: key === 'skills.commands' && featureState.isCommandsActive,
      variant: null,
    })
  }
})

const MEETING_NOTES: ComposerSkillItem = {
  id: 'skl1',
  name: 'Meeting notes',
  description: 'Turn a transcript into notes',
  version: 2,
  mode: 'ask',
  command: 'meeting-notes',
}

const WRITE: ComposerSkillItem = {
  id: 'skl2',
  name: 'Writing style',
  description: 'Write in my voice',
  version: 1,
  mode: 'auto',
  command: 'write',
}

const OFF_SKILL: ComposerSkillItem = {
  id: 'skl3',
  name: 'Off skill',
  description: 'Disabled',
  version: 1,
  mode: 'off',
  command: 'off-one',
}

const NO_COMMAND_SKILL: ComposerSkillItem = {
  id: 'skl4',
  name: 'No command',
  description: 'Menu only',
  version: 1,
  mode: 'auto',
  command: null,
}

const DEFAULT_ITEMS = [MEETING_NOTES, WRITE, OFF_SKILL, NO_COMMAND_SKILL]

interface SetupOptions {
  items?: ComposerSkillItem[]
  isAvailable?: boolean
}

interface KeyOptions {
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

let scope: EffectScope | null = null

function createKeyEvent(key: string, options: KeyOptions = {}) {
  const preventDefault = vi.fn()
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...options,
    preventDefault,
  } as unknown as KeyboardEvent

  return { event, preventDefault }
}

function createBeforeInputEvent(inputType: string, isComposing = false) {
  const preventDefault = vi.fn()
  const event = {
    inputType,
    isComposing,
    preventDefault,
  } as unknown as InputEvent

  return { event, preventDefault }
}

function setup(options: SetupOptions = {}) {
  const element = document.createElement('textarea')
  const textarea = shallowRef<HTMLTextAreaElement | null>(element)
  const text = ref<string>('')
  const items = ref<ComposerSkillItem[]>(options.items ?? DEFAULT_ITEMS)
  const isAvailable = ref<boolean>(options.isAvailable ?? true)
  const invocation = useComposerSkillInvocation()
  const insertText = vi.fn((replacement: string, snapshot?: TextSnapshot) => {
    const start = snapshot?.start ?? element.selectionStart
    const end = snapshot?.end ?? element.selectionEnd
    const value = snapshot?.value ?? element.value
    const caret = start + replacement.length

    element.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`
    element.setSelectionRange(caret, caret)
    element.dispatchEvent(new Event('input'))
  })

  document.body.appendChild(element)
  scope = effectScope()

  const commands = scope.run(() => {
    return useComposerCommands({
      textarea,
      text,
      items,
      isAvailable,
      insertText,
    })
  })!

  element.addEventListener('input', () => {
    text.value = element.value
    commands.refresh()
  })

  function type(value: string, caret: number = value.length) {
    element.value = value
    element.setSelectionRange(caret, caret)
    element.dispatchEvent(new Event('input'))
  }

  function moveCaret(start: number, end: number = start) {
    element.setSelectionRange(start, end)
    commands.refresh()
  }

  return {
    element,
    text,
    items,
    isAvailable,
    invocation,
    insertText,
    commands,
    type,
    moveCaret,
  }
}

beforeEach(() => {
  featureState.isCommandsActive = true
  useComposerSkillInvocation().clear()
})

afterEach(() => {
  scope?.stop()
  scope = null
  useComposerSkillInvocation().clear()
  document.body.innerHTML = ''
})

describe('useComposerCommands picker', () => {
  it('lists only enabled skills that have a command, sorted by command', () => {
    const { commands, type } = setup()

    type('/')

    expect(commands.matches.value.map((command) => {
      return command.command
    })).toEqual(['meeting-notes', 'write'])
    expect(commands.matches.value[0]).toEqual({
      skillId: 'skl1',
      command: 'meeting-notes',
      name: 'Meeting notes',
      description: 'Turn a transcript into notes',
      version: 2,
      mode: 'ask',
    })
  })

  it('opens after a slash and filters while typing', () => {
    const { commands, type } = setup()

    expect(commands.isOpen.value).toBe(false)

    type('/')

    expect(commands.isOpen.value).toBe(true)
    expect(commands.trigger.value).toEqual({ start: 0, query: '' })
    expect(commands.matches.value).toHaveLength(2)

    type('/me')

    expect(commands.isOpen.value).toBe(true)
    expect(commands.trigger.value).toEqual({ start: 0, query: 'me' })
    expect(commands.matches.value.map((command) => {
      return command.command
    })).toEqual(['meeting-notes'])
  })

  it('closes when the trigger goes away', () => {
    const { commands, type } = setup()

    type('/me')
    type('/me ')

    expect(commands.isOpen.value).toBe(false)
    expect(commands.trigger.value).toBeNull()
  })

  it('does not open for a slash inside a word, a URL or a code span', () => {
    const { commands, type } = setup()

    type('and/or')
    expect(commands.isOpen.value).toBe(false)

    type('https://x.com')
    expect(commands.isOpen.value).toBe(false)

    type('```\n/')
    expect(commands.isOpen.value).toBe(false)

    type('say `a /m')
    expect(commands.isOpen.value).toBe(false)
  })

  it('does not open for a range selection', () => {
    const { commands, type, moveCaret } = setup()

    type('/me')
    moveCaret(0, 3)

    expect(commands.trigger.value).toBeNull()
    expect(commands.isOpen.value).toBe(false)
  })

  it('caps the rows at the maximum', () => {
    const manyItems: ComposerSkillItem[] = Array.from(
      { length: COMPOSER_COMMANDS_MAX_ROWS + 3 },
      (_, index) => {
        return {
          ...WRITE,
          id: `skl-many-${index}`,
          command: `skill-${String(index).padStart(2, '0')}`,
        }
      },
    )
    const { commands, type } = setup({ items: manyItems })

    type('/')

    expect(commands.matches.value).toHaveLength(COMPOSER_COMMANDS_MAX_ROWS)
  })

  it('moves the active row with the arrows and wraps around', () => {
    const { commands, type } = setup()

    type('/')

    expect(commands.activeIndex.value).toBe(0)

    const down = createKeyEvent('ArrowDown')

    expect(commands.onKeydown(down.event)).toBe(true)
    expect(down.preventDefault).toHaveBeenCalledTimes(1)
    expect(commands.activeIndex.value).toBe(1)

    expect(commands.onKeydown(createKeyEvent('ArrowDown').event)).toBe(true)
    expect(commands.activeIndex.value).toBe(0)

    const up = createKeyEvent('ArrowUp')

    expect(commands.onKeydown(up.event)).toBe(true)
    expect(up.preventDefault).toHaveBeenCalledTimes(1)
    expect(commands.activeIndex.value).toBe(1)
  })

  it('resets the active row when the query changes', () => {
    const { commands, type } = setup()

    type('/')
    commands.onKeydown(createKeyEvent('ArrowDown').event)

    expect(commands.activeIndex.value).toBe(1)

    type('/w')

    expect(commands.activeIndex.value).toBe(0)
  })

  it('picks the active row on Enter through insertText', () => {
    const { commands, type, insertText, text } = setup()

    type('/me')

    const enter = createKeyEvent('Enter')

    expect(commands.onKeydown(enter.event)).toBe(true)
    expect(enter.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('/meeting-notes ', {
      start: 0,
      end: 3,
      value: '/me',
    })
    expect(text.value).toBe('/meeting-notes ')
    expect(commands.isOpen.value).toBe(false)
  })

  it('picks the active row on Tab', () => {
    const { commands, type, insertText } = setup()

    type('/')
    commands.onKeydown(createKeyEvent('ArrowDown').event)

    const tab = createKeyEvent('Tab')

    expect(commands.onKeydown(tab.event)).toBe(true)
    expect(tab.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('/write ', {
      start: 0,
      end: 1,
      value: '/',
    })
  })

  it('replaces only the typed slash word in the middle of a message', () => {
    const { commands, type, insertText, text } = setup()

    type('Hi /me')
    commands.onKeydown(createKeyEvent('Enter').event)

    expect(insertText).toHaveBeenCalledWith('/meeting-notes ', {
      start: 3,
      end: 6,
      value: 'Hi /me',
    })
    expect(text.value).toBe('Hi /meeting-notes ')
  })

  it('does not add a second space when one already follows the caret', () => {
    const { commands, type, insertText, element, text } = setup()

    type('Hi /me there', 6)
    commands.onKeydown(createKeyEvent('Enter').event)

    expect(insertText).toHaveBeenCalledWith('/meeting-notes', {
      start: 3,
      end: 6,
      value: 'Hi /me there',
    })
    expect(text.value).toBe('Hi /meeting-notes there')
    expect(element.selectionStart).toBe(18)
    expect(element.selectionEnd).toBe(18)
  })

  it('picks a clicked row through pick', () => {
    const { commands, type, insertText } = setup()

    type('/')

    const second = commands.matches.value[1]!

    commands.pick(second)

    expect(insertText).toHaveBeenCalledWith('/write ', {
      start: 0,
      end: 1,
      value: '/',
    })
    expect(commands.trigger.value).toBeNull()
  })

  it('does nothing for pickActive when there are no matches', () => {
    const { commands, type, insertText } = setup()

    type('/zzz')
    commands.pickActive()

    expect(insertText).not.toHaveBeenCalled()
  })

  it('takes Enter while open so it never sends', () => {
    const { commands, type } = setup()

    type('/')

    const enter = createKeyEvent('Enter')

    expect(commands.isOpen.value).toBe(true)
    expect(commands.onKeydown(enter.event)).toBe(true)
    expect(enter.preventDefault).toHaveBeenCalled()
  })

  it('takes Enter in the empty state without inserting anything', () => {
    const { commands, type, insertText } = setup({ items: [] })

    type('/')

    const enter = createKeyEvent('Enter')

    expect(commands.hasNoCommands.value).toBe(true)
    expect(commands.isOpen.value).toBe(true)
    expect(commands.matches.value).toEqual([])
    expect(commands.onKeydown(enter.event)).toBe(true)
    expect(enter.preventDefault).toHaveBeenCalledTimes(1)
    expect(commands.onKeydown(createKeyEvent('ArrowDown').event)).toBe(true)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('leaves Enter alone when the picker is closed', () => {
    const { commands, type } = setup()

    type('hello')

    const enter = createKeyEvent('Enter')

    expect(commands.isOpen.value).toBe(false)
    expect(commands.onKeydown(enter.event)).toBe(false)
    expect(enter.preventDefault).not.toHaveBeenCalled()
  })

  it('leaves Enter with a modifier to the caller', () => {
    const { commands, type } = setup()

    type('/')

    const enter = createKeyEvent('Enter', { ctrlKey: true })

    expect(commands.onKeydown(enter.event)).toBe(false)
    expect(enter.preventDefault).not.toHaveBeenCalled()
  })

  it('closes on Escape, keeps the text and stays closed on the same slash', () => {
    const { commands, type, element } = setup()

    type('/me')

    const escape = createKeyEvent('Escape')

    expect(commands.onKeydown(escape.event)).toBe(true)
    expect(escape.preventDefault).toHaveBeenCalledTimes(1)
    expect(commands.isOpen.value).toBe(false)
    expect(element.value).toBe('/me')

    type('/mee')

    expect(commands.isOpen.value).toBe(false)
    expect(commands.trigger.value).toEqual({ start: 0, query: 'mee' })
  })

  it('reopens once the trigger start changes', () => {
    const { commands, type } = setup()

    type('/me')
    commands.onKeydown(createKeyEvent('Escape').event)
    type('/me hello /')

    expect(commands.trigger.value).toEqual({ start: 10, query: '' })
    expect(commands.isOpen.value).toBe(true)
  })

  it('reopens on the same start after the trigger was gone', () => {
    const { commands, type } = setup()

    type('/me')
    commands.onKeydown(createKeyEvent('Escape').event)
    type('hello')
    type('/')

    expect(commands.isOpen.value).toBe(true)
  })

  it('does not take Escape while closed', () => {
    const { commands, type } = setup()

    type('hello')

    const escape = createKeyEvent('Escape')

    expect(commands.onKeydown(escape.event)).toBe(false)
    expect(escape.preventDefault).not.toHaveBeenCalled()
  })

  it('stays closed when no command matches the query', () => {
    const { commands, type } = setup()

    type('/zzz')

    expect(commands.matches.value).toEqual([])
    expect(commands.hasNoCommands.value).toBe(false)
    expect(commands.isOpen.value).toBe(false)
    expect(commands.onKeydown(createKeyEvent('Enter').event)).toBe(false)
  })

  it('opens with the empty state when there are no commands at all', () => {
    const { commands, type } = setup({ items: [NO_COMMAND_SKILL] })

    type('/')

    expect(commands.hasNoCommands.value).toBe(true)
    expect(commands.isOpen.value).toBe(true)
  })

  it('treats skills that are all off as no commands', () => {
    const { commands, type } = setup({ items: [OFF_SKILL] })

    type('/')

    expect(commands.hasNoCommands.value).toBe(true)
    expect(commands.isOpen.value).toBe(true)
  })

  it('follows the skills list when it changes', () => {
    const { commands, type, items } = setup({ items: [] })

    type('/')

    expect(commands.hasNoCommands.value).toBe(true)

    items.value = [WRITE]

    expect(commands.hasNoCommands.value).toBe(false)
    expect(commands.matches.value).toHaveLength(1)
  })
})

describe('useComposerCommands IME and line-break input', () => {
  it('ignores a keydown that is composing', () => {
    const { commands, type, insertText } = setup()

    type('/')

    const enter = createKeyEvent('Enter', { isComposing: true })

    expect(commands.onKeydown(enter.event)).toBe(false)
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('ignores a keydown with the IME key code 229', () => {
    const { commands, type, insertText } = setup()

    type('/')

    const enter = createKeyEvent('Enter', { keyCode: 229 })

    expect(commands.onKeydown(enter.event)).toBe(false)
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('closes the picker for the whole composition window', () => {
    const { commands, type, insertText } = setup()

    type('/')
    commands.onCompositionStart()

    expect(commands.isOpen.value).toBe(false)

    const enter = createKeyEvent('Enter')

    expect(commands.onKeydown(enter.event)).toBe(false)
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(commands.onKeydown(createKeyEvent('ArrowDown').event)).toBe(false)
    expect(insertText).not.toHaveBeenCalled()

    commands.onCompositionEnd()

    expect(commands.isOpen.value).toBe(true)
    expect(commands.onKeydown(createKeyEvent('Enter').event)).toBe(true)
  })

  it('consumes an insertLineBreak beforeinput while open and picks', () => {
    const { commands, type, insertText } = setup()

    type('/me')

    const lineBreak = createBeforeInputEvent('insertLineBreak')

    expect(commands.onBeforeInput(lineBreak.event)).toBe(true)
    expect(lineBreak.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('/meeting-notes ', {
      start: 0,
      end: 3,
      value: '/me',
    })
  })

  it('consumes an insertParagraph beforeinput while open', () => {
    const { commands, type, insertText } = setup()

    type('/')

    const paragraph = createBeforeInputEvent('insertParagraph')

    expect(commands.onBeforeInput(paragraph.event)).toBe(true)
    expect(paragraph.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledTimes(1)
  })

  it('consumes the line break in the empty state without inserting', () => {
    const { commands, type, insertText } = setup({ items: [] })

    type('/')

    const lineBreak = createBeforeInputEvent('insertLineBreak')

    expect(commands.onBeforeInput(lineBreak.event)).toBe(true)
    expect(lineBreak.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('ignores a line-break beforeinput while closed', () => {
    const { commands, type, insertText } = setup()

    type('hello')

    const lineBreak = createBeforeInputEvent('insertLineBreak')

    expect(commands.onBeforeInput(lineBreak.event)).toBe(false)
    expect(lineBreak.preventDefault).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('ignores other input types and composing line breaks', () => {
    const { commands, type, insertText } = setup()

    type('/')

    const typed = createBeforeInputEvent('insertText')
    const composing = createBeforeInputEvent('insertLineBreak', true)

    expect(commands.onBeforeInput(typed.event)).toBe(false)
    expect(commands.onBeforeInput(composing.event)).toBe(false)
    expect(typed.preventDefault).not.toHaveBeenCalled()
    expect(composing.preventDefault).not.toHaveBeenCalled()
    expect(insertText).not.toHaveBeenCalled()
  })
})

describe('useComposerCommands token and Backspace', () => {
  it('finds the token and exposes it as active once it is a text tile', () => {
    const { commands, type } = setup()

    type('Please /meeting-notes this')

    expect(commands.token.value).toEqual({
      start: 7,
      end: 21,
      command: 'meeting-notes',
    })
    expect(commands.activeToken.value).toEqual(commands.token.value)
  })

  it('deletes only the name on Backspace right after the token', () => {
    const { commands, type, insertText, text } = setup()

    type('/meeting-notes')

    const backspace = createKeyEvent('Backspace')

    expect(commands.onKeydown(backspace.event)).toBe(true)
    expect(backspace.preventDefault).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('', {
      start: 1,
      end: 14,
      value: '/meeting-notes',
    })
    expect(text.value).toBe('/')
    expect(commands.trigger.value).toEqual({ start: 0, query: '' })
    expect(commands.isOpen.value).toBe(true)
  })

  it('deletes the name of a token in the middle of a message', () => {
    const { commands, type, text } = setup()

    type('Please /meeting-notes this', 21)
    commands.onKeydown(createKeyEvent('Backspace').event)

    expect(text.value).toBe('Please / this')
  })

  it('does not take Backspace when the caret is elsewhere', () => {
    const { commands, type, moveCaret, insertText } = setup()

    type('/meeting-notes')
    moveCaret(5)

    const backspace = createKeyEvent('Backspace')

    expect(commands.onKeydown(backspace.event)).toBe(false)
    expect(backspace.preventDefault).not.toHaveBeenCalled()

    type('/meeting-notes x', 16)

    expect(commands.onKeydown(createKeyEvent('Backspace').event)).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('does not take Backspace over a range selection', () => {
    const { commands, type, moveCaret } = setup()

    type('/meeting-notes')
    moveCaret(10, 14)

    expect(commands.onKeydown(createKeyEvent('Backspace').event)).toBe(false)
  })

  it('does not take Backspace with a modifier or Shift', () => {
    const { commands, type } = setup()

    type('/meeting-notes')

    expect(commands.onKeydown(
      createKeyEvent('Backspace', { metaKey: true }).event,
    )).toBe(false)
    expect(commands.onKeydown(
      createKeyEvent('Backspace', { altKey: true }).event,
    )).toBe(false)
    expect(commands.onKeydown(
      createKeyEvent('Backspace', { shiftKey: true }).event,
    )).toBe(false)
  })

  it('does not take Backspace when the token is not the active tile', () => {
    const { commands, type, invocation, insertText } = setup()

    type('/meeting-notes')
    invocation.set({ skillId: 'skl2', name: 'Writing style', version: 1 })

    expect(commands.activeToken.value).toBeNull()
    expect(commands.onKeydown(createKeyEvent('Backspace').event)).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('does not take Backspace after a plain word', () => {
    const { commands, type } = setup()

    type('hello')

    expect(commands.onKeydown(createKeyEvent('Backspace').event)).toBe(false)
  })
})

describe('useComposerCommands tile sync', () => {
  it('sets a text invocation as soon as a token matches', () => {
    const { type, invocation } = setup()

    type('/meeting-notes')

    expect(invocation.invocation.value).toEqual({
      skillId: 'skl1',
      name: 'Meeting notes',
      version: 2,
      source: 'text',
    })
  })

  it('does not set an invocation for a partial name', () => {
    const { type, invocation } = setup()

    type('/meeting')
    type('/meeting-notes-x')

    expect(invocation.invocation.value).toBeNull()
  })

  it('clears a text invocation when the token is erased', () => {
    const { type, invocation } = setup()

    type('/meeting-notes')

    expect(invocation.invocation.value?.source).toBe('text')

    type('/meeting-note')

    expect(invocation.invocation.value).toBeNull()
  })

  it('clears the text invocation when the whole text is emptied', () => {
    const { type, invocation } = setup()

    type('Please /meeting-notes')
    type('')

    expect(invocation.invocation.value).toBeNull()
  })

  it('leaves a menu invocation alone when the token is erased', () => {
    const { type, invocation } = setup()

    type('/meeting-notes')
    invocation.invocation.value = {
      skillId: 'skl1',
      name: 'Meeting notes',
      version: 2,
      source: 'menu',
    }
    type('')

    expect(invocation.invocation.value).toEqual({
      skillId: 'skl1',
      name: 'Meeting notes',
      version: 2,
      source: 'menu',
    })
  })

  it('leaves a menu invocation alone while there is no token', () => {
    const { type, invocation } = setup()

    invocation.set({ skillId: 'skl2', name: 'Writing style', version: 1 })
    type('hello')
    type('hello world')

    expect(invocation.invocation.value).toEqual({
      skillId: 'skl2',
      name: 'Writing style',
      version: 1,
      source: 'menu',
    })
  })

  it('replaces a menu invocation when a token is typed', () => {
    const { type, invocation } = setup()

    invocation.set({ skillId: 'skl2', name: 'Writing style', version: 1 })
    type('/meeting-notes')

    expect(invocation.invocation.value).toEqual({
      skillId: 'skl1',
      name: 'Meeting notes',
      version: 2,
      source: 'text',
    })
  })

  it('switches the tile when the token becomes another command', () => {
    const { type, invocation } = setup()

    type('/meeting-notes')
    type('/write')

    expect(invocation.invocation.value).toEqual({
      skillId: 'skl2',
      name: 'Writing style',
      version: 1,
      source: 'text',
    })
  })

  it('keeps a menu pick of another skill made while a token is typed', () => {
    const { commands, type, invocation } = setup()

    type('x /meeting-notes y')
    invocation.set({ skillId: 'skl2', name: 'Writing style', version: 1 })

    expect(invocation.invocation.value?.source).toBe('menu')
    expect(invocation.invocation.value?.skillId).toBe('skl2')
    expect(commands.activeToken.value).toBeNull()
    expect(commands.stripFromText('x /meeting-notes y')).toBe(
      'x /meeting-notes y',
    )
  })

  it('does not tile a command that is switched off', () => {
    const { type, invocation } = setup({ items: [OFF_SKILL] })

    type('/off-one')

    expect(invocation.invocation.value).toBeNull()
  })

  it('follows the first token only', () => {
    const { commands, type, invocation } = setup()

    type('/write one /meeting-notes')

    expect(commands.token.value?.command).toBe('write')
    expect(invocation.invocation.value?.skillId).toBe('skl2')
  })
})

describe('useComposerCommands stripping and removal', () => {
  it('strips only the active token from the text', () => {
    const { commands, type, text } = setup()

    type('Please /meeting-notes this')

    expect(commands.stripFromText(text.value)).toBe('Please this')
  })

  it('strips the first token and keeps a later command as plain text', () => {
    const { commands, type, text } = setup()

    type('/write one /meeting-notes')

    expect(commands.stripFromText(text.value)).toBe('one /meeting-notes')
  })

  it('returns the text unchanged when there is no active token', () => {
    const { commands, type, text } = setup()

    type('Please /unknown this')

    expect(commands.stripFromText(text.value)).toBe('Please /unknown this')
  })

  it('removes the token and its trailing blanks through insertText', () => {
    const { commands, type, insertText, text } = setup()

    type('Please /meeting-notes   this')
    commands.removeToken()

    expect(insertText).toHaveBeenCalledWith('', {
      start: 7,
      end: 24,
      value: 'Please /meeting-notes   this',
    })
    expect(text.value).toBe('Please this')
  })

  it('removes a token at the end without trailing blanks', () => {
    const { commands, type, insertText } = setup()

    type('/write')
    commands.removeToken()

    expect(insertText).toHaveBeenCalledWith('', {
      start: 0,
      end: 6,
      value: '/write',
    })
  })

  it('removes nothing without an active token', () => {
    const { commands, type, insertText } = setup()

    type('hello')
    commands.removeToken()

    expect(insertText).not.toHaveBeenCalled()
  })

  it('removes nothing when the token is not the active tile', () => {
    const { commands, type, invocation, insertText } = setup()

    type('/meeting-notes')
    invocation.set({ skillId: 'skl2', name: 'Writing style', version: 1 })
    commands.removeToken()

    expect(insertText).not.toHaveBeenCalled()
  })
})

describe('useComposerCommands availability', () => {
  it('does nothing with the flag off', () => {
    featureState.isCommandsActive = false

    const { commands, type, invocation } = setup()

    type('/')

    expect(commands.isEnabled.value).toBe(false)
    expect(commands.isOpen.value).toBe(false)
    expect(commands.trigger.value).toBeNull()
    expect(commands.hasNoCommands.value).toBe(false)

    type('/meeting-notes')

    expect(commands.token.value).toBeNull()
    expect(commands.activeToken.value).toBeNull()
    expect(invocation.invocation.value).toBeNull()
    expect(commands.stripFromText('/meeting-notes hi')).toBe(
      '/meeting-notes hi',
    )
    expect(commands.onKeydown(createKeyEvent('Enter').event)).toBe(false)
    expect(commands.onKeydown(createKeyEvent('Backspace').event)).toBe(false)
  })

  it('does nothing when the model does not support skills', () => {
    const { commands, type, invocation, insertText } = setup({
      isAvailable: false,
    })

    type('/')

    expect(commands.isEnabled.value).toBe(false)
    expect(commands.isOpen.value).toBe(false)
    expect(commands.hasNoCommands.value).toBe(false)

    type('/meeting-notes')

    expect(commands.token.value).toBeNull()
    expect(invocation.invocation.value).toBeNull()
    expect(commands.stripFromText('/meeting-notes hi')).toBe(
      '/meeting-notes hi',
    )
    expect(commands.onKeydown(createKeyEvent('Enter').event)).toBe(false)
    expect(commands.onBeforeInput(
      createBeforeInputEvent('insertLineBreak').event,
    )).toBe(false)

    commands.removeToken()

    expect(insertText).not.toHaveBeenCalled()
  })

  it('does not leave the empty state open with the flag off', () => {
    featureState.isCommandsActive = false

    const { commands, type } = setup({ items: [] })

    type('/')

    expect(commands.hasNoCommands.value).toBe(false)
    expect(commands.isOpen.value).toBe(false)
  })

  it('closes the picker and clears the tile when the model changes', async () => {
    const { commands, type, isAvailable, invocation } = setup()

    type('/')

    expect(commands.isOpen.value).toBe(true)

    isAvailable.value = false
    await nextTick()

    expect(commands.trigger.value).toBeNull()
    expect(commands.isOpen.value).toBe(false)

    isAvailable.value = true
    type('/meeting-notes')
    isAvailable.value = false

    expect(invocation.invocation.value).toBeNull()
  })

  it('reset closes the picker without dismissing', () => {
    const { commands, type } = setup()

    type('/me')
    commands.reset()

    expect(commands.trigger.value).toBeNull()
    expect(commands.isOpen.value).toBe(false)

    commands.refresh()

    expect(commands.isOpen.value).toBe(true)
  })
})
