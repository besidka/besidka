import { defineEventHandler } from 'nuxt/server'
import { MCP_SERVER_CARD_PATH } from '~~/config/mcp-server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

export default defineEventHandler((event) => {
  const origin = getSiteOrigin(event)
  const hostname = getSiteHostname(event)

  applyResponseHeaders(event, {
    'content-type': 'application/ai-catalog+json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })

  return JSON.stringify({
    specVersion: '1.0',
    host: {
      displayName: 'Besidka',
      identifier: getSiteDidWebIdentifier(event),
    },
    entries: [
      {
        identifier: `urn:air:${hostname}:skills:index`,
        displayName: 'Besidka agent skills',
        type: 'application/json',
        url: `${origin}/.well-known/agent-skills/index.json`,
        representativeQueries: [
          'How do I get an API key and add it to Besidka?',
          'What is Besidka and which AI providers does it support?',
          'How does bring-your-own-key billing work in Besidka?',
        ],
      },
      {
        identifier: `urn:air:${hostname}:docs:llms-txt`,
        displayName: 'Besidka llms.txt',
        type: 'text/plain',
        url: `${origin}/llms.txt`,
        representativeQueries: [
          'Which public pages does Besidka have?',
          'Where is the Besidka guide for getting a Claude API key?',
          'How does memory work in Besidka?',
        ],
      },
      {
        identifier: `urn:air:${hostname}:mcp:besidka`,
        displayName: 'Besidka MCP server',
        type: 'application/json',
        url: `${origin}${MCP_SERVER_CARD_PATH}`,
        representativeQueries: [
          'Which models does Besidka support and what do they cost?',
          'Which AI providers and gateways does Besidka connect to?',
          'How do I get an API key for Anthropic, OpenAI or Google?',
          'What does the Besidka privacy policy say about my data?',
        ],
      },
    ],
  }, null, 2)
})
