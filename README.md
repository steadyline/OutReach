# Reach Outreach Tool

A small outreach platform with a Vercel-ready React frontend, a Render-ready Express backend, PostgreSQL persistence, Gmail OAuth sending, open tracking, and delivery guardrails.

## Apps

- `frontend`: Vite + React + TypeScript. Deploy this folder to Vercel.
- `backend`: Express + TypeScript + PostgreSQL + Gmail API. Deploy this folder to Render.

## Backend Environment

Copy `backend/.env.example` to `backend/.env` for local development.

Required:

- `DATABASE_URL`: PostgreSQL connection string. For Supabase, use the Session Pooler URL from the Supabase project Connect panel.
- `GOOGLE_CLIENT_ID`: Google OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web client secret.
- `GOOGLE_REDIRECT_URI`: Backend callback URL, for example `https://your-api.onrender.com/api/auth/google/callback`.
- `SESSION_SECRET`: Long random string for signed sessions.
- `TOKEN_ENCRYPTION_KEY`: Long random string used to encrypt Gmail refresh tokens.
- `FRONTEND_URL`: Vercel frontend URL.
- `BACKEND_PUBLIC_URL`: Public backend URL for tracking pixels and unsubscribe links.

The production API will not start until all required variables above are set in Render. Database migrations only need `DATABASE_URL`, but the running outreach app needs Gmail OAuth and session/token secrets.

Optional:

- `PORT`: Backend port. Render provides this automatically.
- `DATABASE_POOL_MAX`: Maximum backend Postgres connections. Keep this small for Supabase, for example `5`.
- `RUN_MIGRATIONS`: Set to `true` to run schema migrations on startup.
- `ENABLE_WORKER`: Set to `false` to disable the send scheduler.
- `CORS_ORIGINS`: Comma-separated list of allowed frontend origins.

## Supabase Database

Create a Supabase project, then open the project dashboard and click **Connect**.

For the Render backend, use the **Session Pooler** connection string as `DATABASE_URL`. This is the best fit for a long-lived Node/Express service. Supabase documents Transaction Pooler mode as useful for serverless/edge workloads, while Session Pooler or direct connections are better for long-lived application servers. Source: https://supabase.com/docs/guides/database/connecting-to-postgres

Use the connection string in Render like:

```env
DATABASE_URL=postgres://postgres.your-project-ref:your-password@aws-0-your-region.pooler.supabase.com:5432/postgres
DATABASE_POOL_MAX=5
```

Do not put Supabase service-role keys in the frontend. This app connects to Supabase only from the backend using the Postgres connection string.

## Google OAuth

Use a Google Cloud OAuth web client and request these scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`

`gmail.send` is the narrowest Gmail scope needed for sending. Public production apps using this sensitive scope may require Google OAuth verification.

## Render Backend

Backend build command:

```bash
npm install --include=dev && npm run build
```

Backend start command:

```bash
npm run migrate:prod && npm start
```

Set the root directory to `backend` if deploying only the backend service from the monorepo.

Do not set `NODE_ENV=production` as a Render environment variable before the build. If it is set during install, Render may skip build-time dev dependencies like TypeScript and `@types/node`.

## Vercel

Frontend build command:

```bash
npm run build
```

Set the root directory to `frontend`, and configure:

- `VITE_API_URL`: Public Render backend URL.
