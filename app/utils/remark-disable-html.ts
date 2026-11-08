interface MicromarkExtension {
  disable: {
    null: string[]
  }
}

interface ProcessorData {
  micromarkExtensions?: MicromarkExtension[]
}

interface ProcessorWithData {
  data: () => ProcessorData
}

export function remarkDisableHtml(this: ProcessorWithData) {
  const data = this.data()
  const extensions = data.micromarkExtensions ?? []

  extensions.push({ disable: { null: ['htmlFlow', 'htmlText'] } })
  data.micromarkExtensions = extensions
}
