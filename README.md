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

### Prerequisites

- [Bun.sh](https://bun.sh/)
- [Cloudflare account](https://dash.cloudflare.com/)
- [Cloudflare D1 database](https://developers.cloudflare.com/d1/getting-started/) requires a credit card in your acconunt even if you are using a free plan. You can use the [free tier](https://www.cloudflare.com/products/d1/) of D1 database.
- [Cloudflare KV storage](https://developers.cloudflare.com/kv/)
  
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

Prepare drizzle migrations.
```bash
# Expected output is .drizzle/migrations/*.sql
bun run db:generate
```

Create a new D1 database and KV storage for Cloudflare.
::code-content
```bash
# The names of D1 and KV could be shorter but for a case if not only me submitted Cloudflare workers.
bunx wrangler d1 create serhii-chernenko-chat
bunx wrangler kv namespace create serhii-chernenko-chat
```

Get the `database_id` from the output and set it in the `.env.local` file as `DB_ID`.
```bash
cp .env.example .env.local
```

Build the project to generate a `wrangler.json` file.
```bash
# Expected output is .output/server/wrangler.json
bun run build
```

Copy the auto-generated `wrangler.json` file to the root directory. Because it will be removed when `bun run dev` runs.
```bash
cp .output/server/wrangler.json wrangler.json
```

Apply the migrations to the D1 database.
```bash
# Expected output is .wrangler/state/v3/d1/*.sqlite
bunx wrangler d1 migrations apply serhii-chernenko-chat
```

Generate environment types for the project. Optional but recommended.
```bash
bun run cf-typegen
```

Start the development server.
```bash
bun run dev
```

1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Sign up [http://localhost:3000/signup](http://localhost:3000/signup). In development mode you don't need to wait for email confirmation. You have to be automatically redirected to the home page as a customer already.
3. Put your own API keys here: [http://localhost:3000/profile/keys](http://localhost:3000/profile/keys)
4. You are welcome to start a new chat: [http://localhost:3000/chats/new](http://localhost:3000/chats/new)

## Preview

### Light theme

![image](https://github.com/user-attachments/assets/1460e9f6-7f68-4cb6-933f-0651d6af00ce)
![image](https://github.com/user-attachments/assets/f80a2f07-52f9-4738-9992-5e0062263444)

### Dark theme

![image](https://github.com/user-attachments/assets/0152dfff-9d83-4333-8b9d-54b31fc51461)
![image](https://github.com/user-attachments/assets/cc49a94f-34bd-469d-adda-106d94c3e041)





