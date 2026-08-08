import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renderEmailComponent: vi.fn(),
  send: vi.fn(async () => ({ messageId: 'm1' })),
}))

function stubRenderEmailComponent() {
  vi.stubGlobal('renderEmailComponent', mocks.renderEmailComponent)
}

function stubUseEmail() {
  vi.stubGlobal('useEmail', () => ({ send: mocks.send }))
}

async function importEmailTemplate() {
  return import('../../../server/utils/email-template')
}

describe('sendTemplateEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubRenderEmailComponent()
    stubUseEmail()
  })

  it('renders both the html and plain-text bodies with matching args',
    async () => {
      mocks.renderEmailComponent
        .mockResolvedValueOnce('<p>Hello</p>')
        .mockResolvedValueOnce('Hello')

      const { sendTemplateEmail } = await importEmailTemplate()

      await sendTemplateEmail({
        to: 'user@example.com',
        subject: 'Subject',
        template: 'ActionEmail',
        props: { heading: 'Hi' },
      })

      expect(mocks.renderEmailComponent).toHaveBeenCalledTimes(2)
      expect(mocks.renderEmailComponent).toHaveBeenNthCalledWith(
        1,
        'ActionEmail',
        { heading: 'Hi' },
      )
      expect(mocks.renderEmailComponent).toHaveBeenNthCalledWith(
        2,
        'ActionEmail',
        { heading: 'Hi' },
        { plainText: true },
      )
    })

  it('narrows a bare-string render result', async () => {
    mocks.renderEmailComponent
      .mockResolvedValueOnce('<p>Hello</p>')
      .mockResolvedValueOnce('Hello')

    const { sendTemplateEmail } = await importEmailTemplate()

    await sendTemplateEmail({
      to: 'user@example.com',
      subject: 'Subject',
      template: 'NoticeEmail',
      props: { body: 'Hi' },
    })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      html: '<p>Hello</p>',
      text: 'Hello',
    }))
  })

  it('narrows a { html, subject } render result to its html field',
    async () => {
      mocks.renderEmailComponent
        .mockResolvedValueOnce({ html: '<p>Hello</p>', subject: 'Subject' })
        .mockResolvedValueOnce({ html: 'Hello', subject: 'Subject' })

      const { sendTemplateEmail } = await importEmailTemplate()

      await sendTemplateEmail({
        to: 'user@example.com',
        subject: 'Subject',
        template: 'ActionEmail',
        props: { heading: 'Hi' },
      })

      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
        html: '<p>Hello</p>',
        text: 'Hello',
      }))
    })

  it('passes to, subject and from through to the email binding', async () => {
    mocks.renderEmailComponent
      .mockResolvedValueOnce('<p>Hello</p>')
      .mockResolvedValueOnce('Hello')

    const { sendTemplateEmail } = await importEmailTemplate()

    await sendTemplateEmail({
      to: 'user@example.com',
      subject: 'Subject',
      template: 'NoticeEmail',
      props: { body: 'Hi' },
      from: 'personalized',
    })

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      from: 'personalized',
    })
  })
})
