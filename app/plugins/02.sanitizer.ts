import sanitizeHtml from 'sanitize-html'

export default defineNuxtPlugin(() => {
  return {
    provide: {
      sanitizeHtml(html: string) {
        return sanitizeHtml(html, {
          allowedTags: [],
          allowedAttributes: {},
          disallowedTagsMode: 'recursiveEscape',
        })
      },
    },
  }
})
