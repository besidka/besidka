# Besidka — AI Chat

Bring Your API Keys and Pay for What You Use.

![image](https://github.com/user-attachments/assets/70052da1-d72d-4980-b96a-2ece3edbf3d8)

My detailed post in Twitter about the process of development:<br>
https://x.com/besidka_ai/status/1946685763183133001

## Project

Project board is available [here](https://github.com/orgs/besidka/projects/2).

## How to try?

1. You are welcome to visit the production site [www.besidka.com](https://www.besidka.com).
2. Please choose any option of authentication such as Google sign in, GitHub sign in or more common way of the Email + Password flow.
3. When you are authorized, please put your API keys there: [www.besidka.com/profile/keys](https://www.besidka.com/profile/keys).
4. You are welcome to start a new chat: [https://www.besidka.com/chats/new](https://www.besidka.com/chats/new)

## Tech stack

- [Nuxt (Vue + Nitro + Cloudflare workers)](https://nuxt.com/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Better Auth](https://www.better-auth.com/)
- [Resend](https://resend.com/)
- [Daisy UI](https://daisyui.com/)
- [Vercel AI SDK](https://ai-sdk.dev/docs)

## Features

- [x] **PINK**. _Dark/light themes supported_
- [x] Chat with Various LLMs
- [x] Authentication (Email + Password, Google, GitHub)
- [x] Browser Friendly. Easy to Try
- [x] Syntax Highlighting. Beautiful code formatting and highlighting
- [x] Resumable Streams. Continue generation after page refresh
- [x] Bring Your Own Key. _Securely stored in a database_
- [x] Web search. _Get real-time information from the web_

## Local installation

Pay your attention that the project is designed to run on Cloudflare Workers. It requires additional steps to run it via Cloudflare Workers preview or deploy to the production environment.

The steps below are for local development only for the quick start and check.

### Prerequisites

- [Bun.sh](https://bun.sh/)
  
### Steps

Clone the repository.

```bash
git clone git@github.com:besidka/besidka.git
```

Go to the project directory. Install the dependencies.

```bash
cd besidka
bun install
```

Copy wrangler and ENV related files.
```bash
cp .dev.vars.example .dev.vars
cp wrangler.jsonc.example wrangler.jsonc
```

Generate environment types for the project.
```bash
bun run cf-typegen
```

Prepare drizzle migrations.
```bash
# Expected output is .drizzle/migrations/*.sql
bun run db:generate
```

Apply the migrations to the D1 database.
```bash
# Expected output is .wrangler/state/v3/d1/*.sqlite
bunx wrangler d1 migrations apply besidka
```

Start the development server.
```bash
bun run dev
```

1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Sign up [http://localhost:3000/signup](http://localhost:3000/signup). Please use the Email + Password flow because you don't have prepared API keys for Google and GitHub OAuth yet. In development mode you don't need to wait for email confirmation. You have to be automatically redirected to the home page as a customer already.
3. Put your own API keys here: [http://localhost:3000/profile/keys](http://localhost:3000/profile/keys)
4. You are welcome to start a new chat: [http://localhost:3000/chats/new](http://localhost:3000/chats/new)

## Security

### Snyk code checking repository

- [Snyk](https://snyk.io/) is a tool for finding and fixing vulnerabilities in your code.

```bash
# Total issues: 0
snyk code test
```

![image](https://github.com/user-attachments/assets/f09e09a5-dcbb-4278-9855-8cc51b07ffbf)

## Preview

### Light theme

![image](https://github.com/user-attachments/assets/0ef49eea-e137-4776-a4bd-501b2ba04a6d)
![image](https://github.com/user-attachments/assets/d16e7438-b3b8-4388-a3a3-974c3d4a8dcc)

### Dark theme

![image](https://github.com/user-attachments/assets/60ee3540-de47-4b79-9fcc-dc5af63fe036)
![image](https://github.com/user-attachments/assets/5392c051-af3c-4c10-861f-470350a6975e)
