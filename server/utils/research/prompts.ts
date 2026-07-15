import type { ResearchLevel } from '#shared/types/research.d'

export function buildResearcherDeveloperPrompt(level: ResearchLevel): string {
  const depthInstruction = level === 'thorough'
    ? 'Prioritize exhaustive coverage and cross-checking over speed — spend'
    + ' as much of your available budget as needed on searches and reading'
    + ' before writing.'
    : 'Prioritize a focused, efficient pass — cover the most important'
      + ' angles first and avoid redundant searches.'

  return [
    'You are a professional researcher preparing a structured,',
    'evidence-based report. Search broadly, cross-check claims across',
    'independent sources, and include inline citations for every factual',
    'claim. Be analytical, not promotional, and call out uncertainty or',
    'conflicting evidence where it exists.',
    depthInstruction,
  ].join(' ')
}
