export function useResearchLink() {
  const { allowExternalLinks, setAllowExternalLinks } = useUserSetting()

  async function openResearchLink(url: string): Promise<void> {
    if (allowExternalLinks.value) {
      window.open(url, '_blank', 'noopener,noreferrer')

      return
    }

    const label = formatResearchLinkLabel(url)
    const result = await useConfirm({
      text: `Open ${label}?`,
      subtitle: 'You are about to leave and open an external website. Make sure you trust this source before continuing.',
      actions: ['Open', 'Open always'],
      labelDecline: 'Close',
    })

    if (!result) return

    if (result.index === 1) {
      const alsoConfirmed = await useConfirm({
        text: 'Always open external links?',
        subtitle: 'All future links will open without asking. You can reset this in Settings.',
        actions: ['Yes, always'],
        labelDecline: 'No, just this once',
      })

      if (alsoConfirmed) {
        void setAllowExternalLinks(true)
      }
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return { openResearchLink }
}
