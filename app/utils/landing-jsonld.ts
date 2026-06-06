export function buildSoftwareApplicationLd(input: {
  baseUrl: string
  siteName: string
  description: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    'name': 'Besidka',
    'description': input.description,
    'url': input.baseUrl,
    'applicationCategory': 'CommunicationApplication',
    'operatingSystem': 'Web',
    'offers': {
      '@type': 'Offer',
      'price': '0',
      'priceCurrency': 'USD',
    },
    'codeRepository': 'https://github.com/besidka/besidka',
    'softwareVersion': 'latest',
  }
}

export function buildOrganizationLd(input: {
  baseUrl: string
  siteName: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    'name': 'Besidka',
    'url': input.baseUrl,
    'logo': `${input.baseUrl}/web-app-manifest-512x512.png`,
    'sameAs': [
      'https://github.com/besidka/besidka',
      'https://x.com/besidka_ai',
    ],
  }
}

export function buildFaqPageLd(faqs: Array<{
  question: string
  answer: string
}>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': faqs.map(faq => ({
      '@type': 'Question',
      'name': faq.question,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': faq.answer,
      },
    })),
  }
}
