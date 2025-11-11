# Besidka — AI Chat

Bring Your API Keys and Pay for What You Use.

<img width="400" alt="og-image" src="https://github.com/user-attachments/assets/ce429ef9-f98d-40fa-9288-2c991346cdd2" />

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
- [x] Thinking (Reasoning). _Breaking down a problem into steps to provide more accurate responses_

## Local installation

Pay your attention that the project is designed to run on Cloudflare Workers. It requires additional steps to run it via Cloudflare Workers preview or deploy to the production environment.

The steps below are for local development only for the quick start and check.

### Prerequisites

- [PNPM](https://pnpm.io/)
  
### Steps

Clone the repository.

```bash
git clone git@github.com:besidka/besidka.git
```

Go to the project directory. Install the dependencies.

```bash
cd besidka
pnpm install
```

Copy wrangler and ENV related files.
```bash
cp .dev.vars.example .dev.vars
cp wrangler.jsonc.example wrangler.jsonc
```

Generate environment types for the project.
```bash
pnpm run cf-typegen
```

Prepare drizzle migrations.
```bash
# Expected output is .drizzle/migrations/*.sql
pnpm run db:generate
```

Apply the migrations to the D1 database.
```bash
# Expected output is .wrangler/state/v3/d1/*.sqlite
pnpx wrangler d1 migrations apply besidka
```

Start the development server.
```bash
pnpm run dev
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

<img width="400" alt="image" src="https://github.com/user-attachments/assets/4ab122b3-bf06-4012-b9b3-fcc6ada029c5" />


## Preview

<table>
  <thead>
    <tr>
      <th colspan="2">
        Light theme
      </td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <img width="2070" height="1836" alt="image" src="https://github.com/user-attachments/assets/f656ba5c-7f7d-45ec-b43f-7b956df7a9f8" />
      </td>
      <td>
        <img width="748" height="1638" alt="image" src="https://github.com/user-attachments/assets/88b40b26-7126-43fe-91f0-3566ffbd656d" />
      </td>
    </tr>
  </tbody>
    <thead>
    <tr>
      <th colspan="2">
        Dark theme
      </td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <img width="2080" height="1832" alt="image" src="https://github.com/user-attachments/assets/455dc66e-ee43-49b3-bfbc-2e9192ba3d9e" />
      </td>
      <td>
        <img width="750" height="1642" alt="image" src="https://github.com/user-attachments/assets/5d39986b-3f03-44f1-9f75-9182472dc8a9" />
      </td>
    </tr>
  </tbody>
</table>
