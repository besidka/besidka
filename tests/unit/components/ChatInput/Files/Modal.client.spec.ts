import { defineComponent, h } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modal from '../../../../../app/components/ChatInput/Files/Modal.client.vue'
import { useSidePanel } from '../../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const scrollMocks = vi.hoisted(() => ({
  getScrollTop: vi.fn(() => 240),
  setScrollTop: vi.fn(),
}))

const SelectStub = defineComponent({
  name: 'ChatInputFilesModalSelect',
  props: {
    attachedIds: { type: Set, required: true },
    initialSource: { type: String, default: undefined },
    isImageInputSupported: { type: Boolean, default: true },
    resolveDelivery: { type: Function, default: undefined },
  },
  emits: ['attach', 'detach', 'deleted', 'preview'],
  setup(_props, { expose }) {
    expose({
      reset: vi.fn(),
      fetchFiles: vi.fn(async () => true),
      getScrollTop: scrollMocks.getScrollTop,
      setScrollTop: scrollMocks.setScrollTop,
    })

    return () => h('div', { 'data-testid': 'select-stub' })
  },
})

const UploadStub = defineComponent({
  name: 'ChatInputFilesModalUpload',
  props: {
    canAttachMediaType: { type: Function, default: undefined },
  },
  emits: ['upload'],
  setup() {
    return () => h('div', { 'data-testid': 'upload-stub' })
  },
})

const StorageUsageStub = defineComponent({
  name: 'ChatInputFilesModalStorageUsage',
  setup(_props, { expose }) {
    expose({ fetch: vi.fn() })

    return () => h('div')
  },
})

type ModalExposed = {
  open: (tab: 'select' | 'upload', source?: string) => void
  close: () => void
}

async function mountModal(props: Record<string, unknown> = {}) {
  return mountSuspended(Modal, {
    props: {
      attachedIds: new Set<string>(),
      ...props,
    },
    global: {
      stubs: {
        teleport: true,
        ChatInputFilesModalSelect: SelectStub,
        ChatInputFilesModalUpload: UploadStub,
        ChatInputFilesModalStorageUsage: StorageUsageStub,
      },
    },
  })
}

describe('ChatInput/Files/Modal.client', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the bottom sheet on mobile and grows the box from sm and lg', async () => {
    const wrapper = await mountModal()
    const dialog = wrapper.get('[data-testid="files-modal"]')
    const box = wrapper.get('[data-testid="files-modal-box"]')

    expect(dialog.classes()).toEqual(expect.arrayContaining([
      'modal',
      'modal-bottom',
      'sm:modal-middle',
    ]))
    expect(box.classes()).toEqual(expect.arrayContaining([
      'modal-box',
      'flex',
      'flex-col',
      'max-w-2xl',
      'max-h-[80vh]',
      'sm:max-w-3xl',
      'lg:max-w-5xl',
      'sm:h-[85vh]',
      'sm:max-h-[85vh]',
    ]))
  })

  it('opens the Select tab on the requested source', async () => {
    const wrapper = await mountModal()
    const exposed = wrapper.vm as unknown as ModalExposed

    exposed.open('select', 'project')
    await wrapper.vm.$nextTick()

    const select = wrapper.findComponent(SelectStub)

    expect(select.exists()).toBe(true)
    expect(select.props('initialSource')).toBe('project')
    expect(select.classes()).toEqual(expect.arrayContaining([
      'flex-1',
      'min-h-0',
    ]))
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
  })

  it('hands the delivery resolver to the Select tab', async () => {
    const resolveDelivery = vi.fn(() => ({ delivery: 'native' }))
    const wrapper = await mountModal({ resolveDelivery })
    const exposed = wrapper.vm as unknown as ModalExposed

    exposed.open('select')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(SelectStub).props('resolveDelivery'))
      .toBe(resolveDelivery)
  })

  it('keeps the text status of an attached Office file', async () => {
    const wrapper = await mountModal()
    const exposed = wrapper.vm as unknown as ModalExposed

    exposed.open('select')
    await wrapper.vm.$nextTick()
    wrapper.findComponent(SelectStub).vm.$emit('attach', [{
      id: 'file-1',
      storageKey: 'file-1.xlsx',
      name: 'Budget.xlsx',
      size: 10,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      source: 'assistant',
      textStatus: 'ready',
      textBytes: 300 * 1024,
      textTruncated: true,
      textOmittedMedia: 2,
      textOmittedCharts: 1,
    }])

    expect(wrapper.emitted('attach')![0]![0]).toEqual([{
      id: 'file-1',
      storageKey: 'file-1.xlsx',
      name: 'Budget.xlsx',
      size: 10,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      textStatus: 'ready',
      textBytes: 300 * 1024,
      textTruncated: true,
      textOmittedMedia: 2,
      textOmittedCharts: 1,
    }])
  })

  it('defaults the Select tab to uploaded files', async () => {
    const wrapper = await mountModal()
    const exposed = wrapper.vm as unknown as ModalExposed

    exposed.open('select')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(SelectStub).props('initialSource'))
      .toBe('upload')
  })

  it('lets the Upload tab fill the fixed-height box from sm', async () => {
    const wrapper = await mountModal()
    const exposed = wrapper.vm as unknown as ModalExposed

    exposed.open('upload')
    await wrapper.vm.$nextTick()

    const upload = wrapper.findComponent(UploadStub)

    expect(upload.exists()).toBe(true)
    expect(upload.classes()).toEqual(expect.arrayContaining([
      'sm:flex-1',
      'sm:min-h-0',
    ]))
    expect(wrapper.findComponent(SelectStub).exists()).toBe(false)
  })

  describe('document preview', () => {
    const documentFile = {
      id: 'file-1',
      storageKey: 'plan-1.docx',
      name: 'Plan.docx',
      size: 2048,
      type: 'application/vnd.openxmlformats-officedocument'
        + '.wordprocessingml.document',
      source: 'assistant' as const,
      createdAt: '2026-07-15T12:00:00.000Z',
      documentId: 'doc-1',
    }

    beforeEach(() => {
      useSidePanel().close()
    })

    afterEach(() => {
      useSidePanel().close()
    })

    async function openSelectTab() {
      const wrapper = await mountModal()
      const exposed = wrapper.vm as unknown as ModalExposed

      exposed.open('select')
      await wrapper.vm.$nextTick()

      Object.defineProperty(
        wrapper.get('[data-testid="files-modal"]').element,
        'open',
        { value: true, configurable: true },
      )

      return wrapper
    }

    it('closes the dialog and opens the document in the side panel',
      async () => {
        const wrapper = await openSelectTab()

        wrapper.findComponent(SelectStub).vm.$emit('preview', documentFile)
        await wrapper.vm.$nextTick()

        const panel = useSidePanel()

        expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce()
        expect(panel.viewKey.value).toBe('document:doc-1')
        expect(panel.title.value).toBe('Plan')
        expect(panel.currentView.value?.props).toEqual({
          documentId: 'doc-1',
          format: 'docx',
          title: 'Plan',
          viewUrl: '/files/plan-1.docx',
          downloadUrl: '/files/plan-1.docx?download=1',
        })
      })

    describe('returning from the preview', () => {
      async function previewDocument() {
        const wrapper = await openSelectTab()

        wrapper.findComponent(SelectStub).vm.$emit('preview', documentFile)
        await wrapper.vm.$nextTick()
        await wrapper.get('[data-testid="files-modal"]').trigger('close')

        return wrapper
      }

      beforeEach(() => {
        scrollMocks.setScrollTop.mockClear()
        scrollMocks.getScrollTop.mockClear()
      })

      it('keeps the Select tab and its state while the preview shows',
        async () => {
          const wrapper = await previewDocument()

          expect(wrapper.findComponent(SelectStub).exists()).toBe(true)
          expect(scrollMocks.getScrollTop).toHaveBeenCalledOnce()
        })

      it('reopens the file manager at the same scroll when the preview closes',
        async () => {
          const wrapper = await previewDocument()

          Object.defineProperty(
            wrapper.get('[data-testid="files-modal"]').element,
            'open',
            { value: false, configurable: true },
          )
          useSidePanel().close()
          await flushPromises()

          expect(HTMLDialogElement.prototype.showModal)
            .toHaveBeenCalledTimes(2)
          expect(scrollMocks.setScrollTop).toHaveBeenCalledWith(240)
          expect(wrapper.findComponent(SelectStub).exists()).toBe(true)
        })

      it('stays closed and drops the kept state when another view takes the panel',
        async () => {
          const wrapper = await previewDocument()

          useSidePanel().open({ viewKey: 'other', title: 'Other' })
          await flushPromises()
          await wrapper.get('[data-testid="files-modal"]').trigger('close')

          expect(HTMLDialogElement.prototype.showModal)
            .toHaveBeenCalledOnce()
          expect(wrapper.findComponent(SelectStub).exists()).toBe(false)
        })

      it('resets the kept state when the file manager is opened afresh',
        async () => {
          const wrapper = await previewDocument()
          const exposed = wrapper.vm as unknown as ModalExposed

          useSidePanel().close()
          Object.defineProperty(
            wrapper.get('[data-testid="files-modal"]').element,
            'open',
            { value: false, configurable: true },
          )
          await flushPromises()

          expect(scrollMocks.setScrollTop).toHaveBeenCalledOnce()

          exposed.open('select', 'assistant')
          await wrapper.vm.$nextTick()

          expect(wrapper.findComponent(SelectStub).props('initialSource'))
            .toBe('assistant')
        })
    })

    it('ignores a file without a document id', async () => {
      const wrapper = await openSelectTab()

      wrapper.findComponent(SelectStub).vm.$emit('preview', {
        ...documentFile,
        documentId: null,
      })
      await wrapper.vm.$nextTick()

      expect(useSidePanel().isOpen.value).toBe(false)
      expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled()
    })
  })
})
