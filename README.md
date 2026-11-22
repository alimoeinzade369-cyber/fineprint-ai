# FinePrint AI

A Next.js 15 + Supabase + Gemini MVP for understanding contracts and documents before signing.

## Features
- Supabase email/password authentication
- User dashboard with a five-credit starter balance
- Paste text or upload PDF, PNG, JPG, WEBP, or TXT (15 MB max)
- Gemini 2.5 Flash analysis: risk score, plain-language summary, red flags, and recommended actions
- Scan history saved per user
- Server-side Gemini and Supabase service-role credentials

## Setup
1. Create a Supabase project.
2. In Supabase SQL Editor, run [supabase/schema.sql](supabase/schema.sql).
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; never expose it in browser code)
   - `GEMINI_API_KEY`
4. Install and run:
   ```bash
   npm install
   npm run dev
   ```
5. Open http://localhost:3000.

## Deploy
Import the repository into Vercel and add the same environment variables. Run the SQL schema in Supabase before using the app.

## Notes
- New accounts receive five credits through a database trigger.
- One successful scan consumes one credit.
- AI output is informational only and is not legal advice.
- Configure Supabase Auth email confirmation and production redirect URLs before launch.
- The current credit decrement is a basic compare-and-update; use a transactional Postgres RPC for production billing and high concurrency.
