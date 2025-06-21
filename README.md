# AI Chat

Bring your own API keys and pay only for what you used.

## How to try?

1. You are welcome to visit the production site [www.chernenko.chat](https://www.chernenko.chat).
2. Please choose any option of authentication such as Google sign in, GitHub sign in or more common way of the Email + Password flow.
3. When you are authorized, please put your API keys there: [www.chernenko.chat/profile/keys](https://www.chernenko.chat/profile/keys).
4. You are welcome to start a new chat: [https://www.chernenko.chat/chats/new](https://www.chernenko.chat/chats/new)

# Info
The idea is a part of hackathon (cloneathon) initiated by [Theo Browne](https://github.com/t3dotgg). More details are [here](https://x.com/theo/status/1934398749008392655).

My detailed post in Twitter about the process of development:<br>
https://x.com/serhiichernenko/status/1935438276447424733

## Tech stack

- [Nuxt (Vue + Nitro + Cloudflare workers)](https://nuxt.com/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Better Auth](https://www.better-auth.com/)
- [Resend](https://resend.com/)
- [Daisy UI](https://daisyui.com/)
- [Vercel AI SDK](https://ai-sdk.dev/docs)

## Hackathon Requirements 

### Core requirements

- [x] Chat with Various LLMs
- [x] Authentication & Sync
- [x] Browser Friendly
- [x] Easy to Try
- [x] **PINK** 

### Bonus requirements

- [x] Syntax Highlighting. Beautiful code formatting and highlighting
- [x] Resumable Streams. Continue generation after page refresh. _Partially implemented. If the last message was from a user, a new response sends again on page reloading_.
- [x] Bring Your Own Key. _Securely stored in a database_

## Spent time on MVP

- Project installation and basic preparation: **3 hours**
- Authentication: **16 hours**
- Basic UI: **3 hours**
- Syntax highlighting: **2,5 hours**
- Main navigation: **1,5 hours**
- General chats functionality: **25 hours**
- API keys storing: **2,5 hours**
- Adding Google AI Studio provider: **1 hour**
- History page: **0,5 hours**
- Polishing + deployment via Cloudflare Workers: **4 hours**

Total: **59 hours**

## Local installation

Pay your attention that the project is designed to run on Cloudflare Workers. It requires additional steps to run it via Cloudflare Workers preview or deploy to the production environment.

The steps below are for local development only for the quick start and check.

### Prerequisites

- [Bun.sh](https://bun.sh/)
  
### Steps

Clone the repository.

```bash
git clone git@github.com:serhii-chernenko/chat.git
```

Go to the project directory. Install the dependencies.

```bash
cd chat
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
bunx wrangler d1 migrations apply chat
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

![image](https://github.com/user-attachments/assets/b65d51e1-f394-4287-bddd-e6119fc620a4)

## Preview

### Light theme

![image](https://github.com/user-attachments/assets/1460e9f6-7f68-4cb6-933f-0651d6af00ce)
![image](https://github.com/user-attachments/assets/f80a2f07-52f9-4738-9992-5e0062263444)

### Dark theme

![image](https://github.com/user-attachments/assets/0152dfff-9d83-4333-8b9d-54b31fc51461)
![image](https://github.com/user-attachments/assets/cc49a94f-34bd-469d-adda-106d94c3e041)





