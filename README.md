# Reach Outreach Tool

A small outreach platform with a Vercel-ready React frontend, a Render-ready Express backend, Render PostgreSQL persistence, Gmail OAuth sending, open tracking, and delivery guardrails.

## Apps

- `frontend`: Vite + React + TypeScript. Deploy this folder to Vercel.
- `backend`: Express + TypeScript + PostgreSQL + Gmail API. Deploy this folder to Render.

## Backend Environment

Copy `backend/.env.example` to `backend/.env` for local development.

Required:

- `DATABASE_URL`: Render PostgreSQL connection string.
- `GOOGLE_CLIENT_ID`: Google OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web client secret.
- `GOOGLE_REDIRECT_URI`: Backend callback URL, for example `https://your-api.onrender.com/api/auth/google/callback`.
- `SESSION_SECRET`: Long random string for signed sessions.
- `TOKEN_ENCRYPTION_KEY`: Long random string used to encrypt Gmail refresh tokens.
- `FRONTEND_URL`: Vercel frontend URL.
- `BACKEND_PUBLIC_URL`: Public backend URL for tracking pixels and unsubscribe links.

Optional:

- `PORT`: Backend port. Render provides this automatically.
- `RUN_MIGRATIONS`: Set to `true` to run schema migrations on startup.
- `ENABLE_WORKER`: Set to `false` to disable the send scheduler.
- `CORS_ORIGINS`: Comma-separated list of allowed frontend origins.

## Google OAuth

Use a Google Cloud OAuth web client and request these scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`

`gmail.send` is the narrowest Gmail scope needed for sending. Public production apps using this sensitive scope may require Google OAuth verification.

## Render

Backend build command:

```bash
npm install && npm run build
```

Backend start command:

```bash
npm run migrate:prod && npm start
```

Set the root directory to `backend` if deploying only the backend service from the monorepo.

## Vercel

Frontend build command:

```bash
npm run build
```

Set the root directory to `frontend`, and configure:

- `VITE_API_URL`: Public Render backend URL.
