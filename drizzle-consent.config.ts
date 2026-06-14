import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/consent/schema.ts',
  out: '.drizzle/migrations-consent',
  casing: 'snake_case',
})
