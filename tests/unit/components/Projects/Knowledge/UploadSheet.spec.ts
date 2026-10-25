import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeSyncResult,
  KnowledgeSyncSummary,
  KnowledgeUploadEntry,
  KnowledgeUploadPhase,
} from '../../../../../app/types/project-knowledge.d'
import type { KnowledgePlanSummary } from '../../../../../app/utils/knowledge-upload-plan'
import UploadSheet from '../../../../../app/components/Projects/Knowledge/UploadSheet.client.vue'

enableAutoUnmount(afterEach)

const plan: KnowledgePlanSummary = {
  added: 12,
  skipped: 5,
  reasons: [
    { reason: 'ignored-path', label: 'ignored folders and files', count: 3 },
    { reason: 'binary', label: 'binary files', count: 2 },
  ],
}

function entry(
  key: string,
  status: KnowledgeUploadEntry['status'],
  error: string | null = null,
): KnowledgeUploadEntry {
  return {
    key,
    name: `${key}.md`,
    relativePath: `docs/${key}.md`,
    category: 'text',
    sizeBytes: 100,
    status,
    error,
  }
}

interface SheetOptions {
  phase?: KnowledgeUploadPhase
  plan?: KnowledgePlanSummary | null
  syncSummary?: KnowledgeSyncSummary | null
  syncResult?: KnowledgeSyncResult | null
  wasCancelled?: boolean
  entries?: KnowledgeUploadEntry[]
  progress?: {
    done: number
    total: number
    currentName: string | null
    bytesDone: number
    bytesTotal: number
  }
  error?: { message: string, why: string | undefined, status: number } | null
}

async function mountSheet(options: SheetOptions = {}) {
  const wrapper = await mountSuspended(UploadSheet, {
    props: {
      phase: options.phase ?? 'preview',
      plan: options.plan === undefined ? plan : options.plan,
      syncSummary: options.syncSummary ?? null,
      syncResult: options.syncResult ?? null,
      wasCancelled: options.wasCancelled ?? false,
      entries: options.entries ?? [],
      progress: options.progress ?? {
        done: 0,
        total: 0,
        currentName: null,
        bytesDone: 0,
        bytesTotal: 0,
      },
      error: options.error ?? null,
      open: false,
    },
    global: {
      stubs: { Teleport: true },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountSheet>>

function byTestId(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-testid="${id}"]`)
}

function missing(wrapper: Wrapper, id: string): boolean {
  return !wrapper.find(`[data-testid="${id}"]`).exists()
}

describe('Projects/Knowledge/UploadSheet', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('dialog', () => {
    it('opens a dialog named by its heading', async () => {
      const wrapper = await mountSheet()
      const heading = byTestId(wrapper, 'knowledge-upload-heading')

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      expect(heading.element.tagName).toBe('H3')
      expect(wrapper.get('dialog').attributes('aria-labelledby'))
        .toBe(heading.attributes('id'))
    })

    it('labels the close button as Hide while uploading', async () => {
      const preview = await mountSheet()
      const running = await mountSheet({ phase: 'running' })

      expect(byTestId(preview, 'knowledge-upload-close')
        .attributes('aria-label')).toBe('Close')
      expect(byTestId(running, 'knowledge-upload-close')
        .attributes('aria-label')).toBe('Hide')
    })
  })

  describe('planning', () => {
    it('shows a busy skeleton and a Cancel button', async () => {
      const wrapper = await mountSheet({ phase: 'planning', plan: null })

      expect(byTestId(wrapper, 'knowledge-upload-planning')
        .attributes('aria-busy')).toBe('true')

      await byTestId(wrapper, 'knowledge-upload-cancel').trigger('click')

      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
  })

  describe('preview', () => {
    it('says how many files are added and skipped, and why', async () => {
      const wrapper = await mountSheet()

      expect(byTestId(wrapper, 'knowledge-upload-preview-summary').text())
        .toBe('12 files will be added, 5 skipped.')
      expect(wrapper.findAll('[data-testid="knowledge-upload-reasons"] li')
        .map(item => item.text())).toEqual([
        'ignored folders and files: 3',
        'binary files: 2',
      ])
    })

    it('uses singular wording and omits the skipped clause', async () => {
      const wrapper = await mountSheet({
        plan: { added: 1, skipped: 0, reasons: [] },
      })

      expect(byTestId(wrapper, 'knowledge-upload-preview-summary').text())
        .toBe('1 file will be added.')
      expect(missing(wrapper, 'knowledge-upload-reasons')).toBe(true)
      expect(byTestId(wrapper, 'knowledge-upload-start').text())
        .toBe('Add 1 file')
    })

    it('starts and cancels', async () => {
      const wrapper = await mountSheet()

      expect(byTestId(wrapper, 'knowledge-upload-start').text())
        .toBe('Add 12 files')

      await byTestId(wrapper, 'knowledge-upload-start').trigger('click')
      await byTestId(wrapper, 'knowledge-upload-cancel').trigger('click')

      expect(wrapper.emitted('start')).toHaveLength(1)
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('cannot start when nothing would be added', async () => {
      const wrapper = await mountSheet({
        plan: { added: 0, skipped: 3, reasons: [] },
      })

      expect(byTestId(wrapper, 'knowledge-upload-start').classes())
        .toContain('btn-disabled')
    })

    it('describes a folder sync instead of a plain add', async () => {
      const wrapper = await mountSheet({
        syncSummary: {
          added: 2,
          replaced: 1,
          removed: 3,
          unchanged: 9,
          plan,
        },
      })

      expect(byTestId(wrapper, 'knowledge-upload-sync').text())
        .toBe('2 new, 1 to check, 3 missing, 9 unchanged.')
      expect(missing(wrapper, 'knowledge-upload-preview-summary')).toBe(true)
      expect(byTestId(wrapper, 'knowledge-upload-start').text())
        .toBe('Sync folder')
    })

    it('cannot sync a folder with no changes', async () => {
      const wrapper = await mountSheet({
        syncSummary: {
          added: 0,
          replaced: 0,
          removed: 0,
          unchanged: 4,
          plan,
        },
      })

      expect(byTestId(wrapper, 'knowledge-upload-start').classes())
        .toContain('btn-disabled')
    })
  })

  describe('running', () => {
    const progress = {
      done: 3,
      total: 12,
      currentName: 'docs/big.pdf',
      bytesDone: 10,
      bytesTotal: 100,
    }
    const entries = [
      entry('a', 'ready'),
      entry('b', 'extracting'),
      entry('c', 'uploading-original'),
      entry('d', 'queued'),
    ]

    it('shows a progress bar with its value and the current file', async () => {
      const wrapper = await mountSheet({
        phase: 'running',
        progress,
        entries,
      })
      const bar = byTestId(wrapper, 'knowledge-upload-progress')

      expect(bar.element.tagName).toBe('PROGRESS')
      expect(bar.classes()).toContain('progress')
      expect(bar.attributes('value')).toBe('3')
      expect(bar.attributes('max')).toBe('12')
      expect(bar.attributes('aria-valuenow')).toBe('3')
      expect(bar.attributes('aria-valuemax')).toBe('12')
      expect(bar.attributes('aria-valuetext')).toBe('3 of 12 files')
      expect(bar.attributes('aria-label')).toBe('Upload progress')
      expect(byTestId(wrapper, 'knowledge-upload-current').text()
        .replace(/\s+/g, ' ')).toBe('3 of 12 · docs/big.pdf')
      expect(byTestId(wrapper, 'knowledge-upload-current')
        .attributes('role')).toBe('status')
    })

    it('lists the status of every file', async () => {
      const wrapper = await mountSheet({
        phase: 'running',
        progress,
        entries,
      })

      expect(wrapper.findAll('[data-testid="knowledge-upload-entry"]')
        .map(row => row.findAll('span').map(span => span.text())))
        .toEqual([
          ['docs/a.md', 'Added'],
          ['docs/b.md', 'Reading…'],
          ['docs/c.md', 'Uploading original…'],
          ['docs/d.md', 'Waiting'],
        ])
    })

    it('cancels the running upload', async () => {
      const wrapper = await mountSheet({ phase: 'running', progress })

      await byTestId(wrapper, 'knowledge-upload-cancel').trigger('click')

      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('never divides by zero before the total is known', async () => {
      const wrapper = await mountSheet({ phase: 'running' })

      expect(byTestId(wrapper, 'knowledge-upload-progress')
        .attributes('max')).toBe('1')
    })
  })

  describe('finished', () => {
    it('summarizes what was added, with no text, duplicates and failures',
      async () => {
        const wrapper = await mountSheet({
          phase: 'done',
          entries: [
            entry('a', 'ready'),
            entry('b', 'ready'),
            entry('c', 'no-text'),
            entry('d', 'skipped-duplicate'),
            entry('e', 'failed', 'too-large'),
          ],
        })

        expect(byTestId(wrapper, 'knowledge-upload-heading').text())
          .toBe('Files added')
        expect(byTestId(wrapper, 'knowledge-upload-added').text())
          .toBe('3 files added')
        expect(byTestId(wrapper, 'knowledge-upload-no-text').text())
          .toBe('1 with no text found')
        expect(byTestId(wrapper, 'knowledge-upload-duplicates').text())
          .toBe('1 already added, skipped')
        expect(byTestId(wrapper, 'knowledge-upload-failed').text())
          .toBe('1 failed')
      })

    it('offers a retry for failed files only', async () => {
      const failed = await mountSheet({
        phase: 'done',
        entries: [entry('e', 'failed', 'binary')],
      })
      const clean = await mountSheet({
        phase: 'done',
        entries: [entry('a', 'ready')],
      })

      await byTestId(failed, 'knowledge-upload-retry').trigger('click')

      expect(failed.emitted('retry')).toHaveLength(1)
      expect(missing(clean, 'knowledge-upload-retry')).toBe(true)
    })

    it('closes from Done', async () => {
      const wrapper = await mountSheet({
        phase: 'done',
        entries: [entry('a', 'ready')],
      })

      await byTestId(wrapper, 'knowledge-upload-done').trigger('click')

      expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    })

    it('says so when the upload was cancelled', async () => {
      const wrapper = await mountSheet({
        phase: 'done',
        wasCancelled: true,
        entries: [entry('a', 'ready')],
      })

      expect(byTestId(wrapper, 'knowledge-upload-cancelled').text())
        .toContain('cancelled')
    })

    it('shows the folder sync result', async () => {
      const wrapper = await mountSheet({
        phase: 'done',
        syncSummary: {
          added: 1,
          replaced: 0,
          removed: 0,
          unchanged: 5,
          plan,
        },
        entries: [entry('a', 'ready')],
      })

      expect(byTestId(wrapper, 'knowledge-upload-sync-result').text())
        .toBe('1 new, 0 to check, 0 missing, 5 unchanged.')
    })

    it('summarises the real sync result with its notices', async () => {
      const wrapper = await mountSheet({
        phase: 'done',
        syncSummary: {
          added: 1,
          replaced: 4,
          removed: 2,
          unchanged: 0,
          plan,
        },
        syncResult: {
          uploaded: 1,
          skippedAsDuplicate: 3,
          kept: 2,
          removed: 0,
          unchanged: 1,
          unchangedUnknown: 3,
          couldNotRemove: 0,
          notices: ['2 files kept under their old name — they look like '
            + 'renamed copies.'],
        },
        entries: [entry('a', 'ready')],
      })

      expect(byTestId(wrapper, 'knowledge-upload-sync-result').text())
        .toBe('Folder synced: 1 new, 4 unchanged, 0 removed.')
      expect(byTestId(wrapper, 'knowledge-upload-sync-notices').text())
        .toContain('2 files kept under their old name')
    })

    it('shows a run-stopping error as an alert', async () => {
      const wrapper = await mountSheet({
        phase: 'error',
        error: {
          message: 'Not enough storage space for this upload.',
          why: 'You are over your quota',
          status: 413,
        },
        entries: [entry('a', 'ready')],
      })
      const alert = byTestId(wrapper, 'knowledge-upload-error')

      expect(byTestId(wrapper, 'knowledge-upload-heading').text())
        .toBe('Could not add files')
      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('Not enough storage space')
      expect(alert.text()).toContain('You are over your quota')
    })
  })

  describe('per-file messages', () => {
    async function messageFor(
      status: KnowledgeUploadEntry['status'],
      error: string | null,
    ) {
      const wrapper = await mountSheet({
        phase: 'done',
        entries: [entry('a', status, error)],
      })

      return byTestId(wrapper, 'knowledge-upload-entry').text()
    }

    it.each([
      ['ios-update-required', 'Update iOS to extract PDFs, or add it as a PDF for models that read PDFs.'],
      ['too-large', 'This file is too large to read.'],
      ['too-many-pages', 'This PDF has too many pages to read'],
      ['binary', 'This looks like a binary file, not text.'],
      ['not-utf8', 'This file is not valid UTF-8 text.'],
      ['unsupported', 'This file type is not supported.'],
    ])('explains the %s failure', async (code, message) => {
      expect(await messageFor('failed', code)).toContain(message)
    })

    it('falls back to a readable message for an unknown code', async () => {
      expect(await messageFor('failed', 'brand-new'))
        .toContain('Besidka could not read this file.')
    })

    it('says no text was found for a scan', async () => {
      expect(await messageFor('no-text', null)).toContain('No text found')
    })

    it('says the iOS update is needed for a PDF that cannot be read',
      async () => {
        expect(await messageFor('no-text', 'ios-update-required'))
          .toContain('Update iOS to extract PDFs')
      })
  })
})
