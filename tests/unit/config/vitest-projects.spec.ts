import { existsSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  nodeProjectExclude,
  nodeProjectInclude,
  nodeSpecDirectories,
  nuxtProjectInclude,
  nuxtSpecDirectories,
  nuxtSpecExceptions,
} from '../../setup/vitest.projects'

const repositoryRoot = `${process.cwd()}/`
const specRoots = ['tests/unit', 'tests/integration']

function listChildren(relativeDirectory: string) {
  return readdirSync(`${repositoryRoot}${relativeDirectory}`, {
    withFileTypes: true,
  })
}

describe('vitest project selection', () => {
  it('classifies every top-level spec directory exactly once', () => {
    const classified = [...nodeSpecDirectories, ...nuxtSpecDirectories]
    const actual = specRoots.flatMap((specRoot) => {
      return listChildren(specRoot)
        .filter(entry => entry.isDirectory())
        .map(entry => `${specRoot}/${entry.name}`)
    })

    expect(new Set(classified).size).toBe(classified.length)
    expect([...classified].sort()).toEqual(actual.sort())
  })

  it('has no spec files outside the classified directories', () => {
    const strayFiles = specRoots.flatMap((specRoot) => {
      return listChildren(specRoot)
        .filter(entry => entry.isFile() && entry.name.endsWith('.spec.ts'))
        .map(entry => `${specRoot}/${entry.name}`)
    })

    expect(strayFiles).toEqual([])
  })

  it('lists only nuxt exceptions that exist inside a node directory', () => {
    expect(new Set(nuxtSpecExceptions).size).toBe(nuxtSpecExceptions.length)

    for (const exception of nuxtSpecExceptions) {
      const isFile = existsSync(`${repositoryRoot}${exception}`)
        && statSync(`${repositoryRoot}${exception}`).isFile()
      const isInNodeDirectory = nodeSpecDirectories.some((directory) => {
        return exception.startsWith(`${directory}/`)
      })

      expect(isFile, `${exception} does not exist`).toBe(true)
      expect(
        isInNodeDirectory,
        `${exception} is not inside a node directory`,
      ).toBe(true)
    }
  })

  it('keeps every exception out of the node project and in the nuxt one', () => {
    expect(nodeProjectExclude).toEqual(nuxtSpecExceptions)

    for (const exception of nuxtSpecExceptions) {
      expect(nuxtProjectInclude).toContain(exception)
      expect(nodeProjectInclude).not.toContain(exception)
    }
  })
})
