import { describe, expect, it } from 'vitest'
import {
  matchToolIndexEntries,
  TOOL_INDEX_PREFETCH_MAX,
  toolNameTokens,
} from '~~/server/utils/ai/tool-index-prefetch'
import type { ToolIndexEntry } from '~~/server/utils/ai/tool-index'

function entry(name: string): ToolIndexEntry {
  return {
    name,
    sourceKey: name.startsWith('besidka__') ? 'besidka' : 'notion',
    sourceTitle: name.startsWith('besidka__') ? 'Besidka' : 'Notion',
    description: '',
    toolClass: 'write',
    bytes: 100,
  }
}

const ENTRIES = [
  'besidka__delete_files',
  'besidka__delete_chats',
  'besidka__delete_project',
  'besidka__delete_project_knowledge_items',
  'besidka__rename_file',
  'besidka__create_file',
  'besidka__list_files',
  'besidka__share_artifact',
  'besidka__add_project_note',
  'besidka__move_chats_to_project',
  'mcp__notion__notion-delete-pages',
  'mcp__notion__notion-create-pages',
  'mcp__notion__notion-search',
].map(entry)

function match(text: string) {
  return matchToolIndexEntries(text, ENTRIES)
}

describe('toolNameTokens', () => {
  it('drops the namespace and makes plurals singular', () => {
    expect(toolNameTokens('besidka__delete_files')).toEqual(['delete', 'file'])
    expect(toolNameTokens('mcp__notion__notion-delete-pages'))
      .toEqual(['notion', 'delete', 'page'])
    expect(toolNameTokens('mcp__x__deleteIssues')).toEqual(['delete', 'issue'])
  })
})

describe('matchToolIndexEntries', () => {
  it('finds delete_files from the owner\'s Ukrainian request', () => {
    expect(match('Видали файл kyiv-chestnut-leaf.jpg з моїх файлів'))
      .toEqual(['besidka__delete_files'])
  })

  it.each([
    ['delete kyiv-chestnut-leaf.jpg from my files'],
    ['Please remove that file'],
    ['Удали файл report.pdf'],
    ['Usuń plik raport.pdf'],
    ['Lösche die Datei bitte'],
    ['видаліть, будь ласка, цей файл'],
  ])('finds delete_files for %s', (text) => {
    expect(match(text)[0]).toBe('besidka__delete_files')
  })

  it('matches other actions and things', () => {
    expect(match('rename the file to cover.png'))
      .toEqual(['besidka__rename_file'])
    expect(match('Перейменуй файл на cover.png'))
      .toEqual(['besidka__rename_file'])
    expect(match('delete my old chats')).toEqual(['besidka__delete_chats'])
    expect(match('видали сторінку в Notion'))
      .toEqual(['mcp__notion__notion-delete-pages'])
    expect(match('додай нотатку до проєкту'))
      .toEqual(['besidka__add_project_note'])
  })

  it('needs both an action and a thing, and skips read tools', () => {
    expect(match('what files do I have?')).toEqual([])
    expect(match('delete it')).toEqual([])
    expect(match('search Notion for the plan')).toEqual([])
    expect(match('')).toEqual([])
  })

  it('does not read a short stem inside a longer word', () => {
    expect(match('what is the address of this file?')).toEqual([])
  })

  it(`returns at most ${TOOL_INDEX_PREFETCH_MAX} names, closest first`,
    () => {
      const names = match(
        'delete the files, chats, project, project knowledge and pages',
      )

      expect(names).toHaveLength(TOOL_INDEX_PREFETCH_MAX)
      expect(names).toEqual([
        'besidka__delete_chats',
        'besidka__delete_files',
        'besidka__delete_project',
      ])
    })
})
