# Project Technical Overview & Guidelines

## Core Stack

- **Runtime:** PNPM (for fast, efficient JavaScript/TypeScript package management and execution)
- **Framework:** Nuxt 4, leveraging Nitro for server-side rendering and API routes
- **Database:** Cloudflare D1 (SQLite-based), accessed via Drizzle ORM with repository pattern
- **KV:** Cloudflare KV storage for caching and quick data access
- **Authentication:** Better Auth for secure, flexible user management
- **Email:** Resend for transactional email services
- **AI Integration:** Vercel AI SDK for LLM interactions, with support for resumable streams and web search
- **Testing:** Vitest for unit tests, Cypress for end-to-end and component tests
- **Styling:** Tailwind CSS v4 and DaisyUI v5 for consistent, component-based UI
- **CI/CD:** GitHub Actions for automated testing and deployment