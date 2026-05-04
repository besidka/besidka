import { readFile } from 'node:fs/promises'

const packageJsonPath = new URL('../package.json', import.meta.url)
const packageJson = JSON.parse(
  await readFile(packageJsonPath, 'utf8'),
)

const nodeTypesVersion = packageJson.devDependencies?.['@types/node']

if (typeof nodeTypesVersion !== 'string') {
  throw new Error(
    'Missing @types/node in devDependencies.',
  )
}

const normalizedVersion = nodeTypesVersion.replace(/^[^0-9]*/, '')

if (!normalizedVersion.startsWith('24.')) {
  throw new Error(
    `@types/node must stay on Node 24, found ${nodeTypesVersion}.`,
  )
}
