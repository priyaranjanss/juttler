# Juttler — Multi-Agent AI Workforce Platform

Juttler coordinates an autonomous AI workforce: a Chief of Staff supervisor, specialist bot teammates, human approval gates for sensitive actions, reusable skills, scheduled routines, and a full audit trail.

**Stack:** React + Vite (frontend) · Express + Neon Postgres (backend) · Clerk auth · Upstash Redis (coming) · Gemini (bot replies)

## Architecture

```
juttler/
├── neon.ts              # Neon CLI config (branch policy)
├── .env.local           # Neon-managed variables (DATABASE_URL, NEON_BRANCH)
├── backend/
│   ├── db/                     # schema.sql + migrate.ts (run: npm run db:migrate)
│   └── src/
│       ├── server.ts            # entry: app setup, auth guard, router mounting
│       ├── config/              # db (Neon), aiClient (Gemini)
│       ├── middleware/auth.ts   # Bearer-token sessions, admin guard
│       ├── repositories/        # data access layer (one module per domain)
│       ├── routes/              # one Express router per domain
│       └── services/            # aiService, toolService
└── frontend/
    └── src/
        ├── router.tsx           # History-API routes (/login, /register, /admin, /workspace)
        ├── components/
        │   ├── auth/            # LoginPage, RegisterPage
        │   ├── admin/           # AdminShell (admin console)
        │   ├── workspace/       # UserShell (user workspace)
        │   └── ...              # dashboard, chat, bots, approvals, skills, routines, activity
        └── contexts/            # AppContext (session, data, toast)
```

## Getting Started

**Prerequisites:** Node.js 22+

### 1. Neon database

```bash
npm i -g neon@latest
neon login
neon skills -y          # installs agent skills in this repo
neon mcp -y             # installs MCP config for AI agents
neon link --project-id <your-project-id> --branch production -y
neon config init
neon deploy             # applies neon.ts policy to the branch
```

`neon deploy` pulls `DATABASE_URL` / `DATABASE_URL_UNPOOLED` into `.env.local` at the repo root. Then create the schema:

```bash
cd backend
npm run db:migrate      # applies db/schema.sql to Neon
```

### 2. Backend environment

Copy `backend/.env.example` to `backend/.env`, then pull the database credentials:

```bash
cp backend/.env.example backend/.env     # Windows: copy backend\.env.example backend\.env
neon env pull --file backend/.env        # writes DATABASE_URL & friends into it
```

Then paste your Gemini key into `GEMINI_API_KEY` in the same file.

### Environment files

Two env files, each holding the **other side's URL** — that's the whole link between frontend and backend:

| File | Variable | Value (dev) | Used for |
|---|---|---|---|
| `backend/.env` | `FRONTEND_URL` | `http://localhost:5173` | CORS — the origin the backend allows to call the API |
| `frontend/.env` | `VITE_BACKEND_URL` | `http://localhost:3000` | Inlined into the browser bundle — where API calls go |

The frontend calls the backend **directly** at `VITE_BACKEND_URL` (no proxy), and the backend answers only to origins matching `FRONTEND_URL`. (Vite requires the `VITE_` prefix for anything the browser sees.)

**Same-origin production:** when the backend serves the built frontend, build with `VITE_BACKEND_URL=""` (calls go to `/api` on the app's own origin) and leave `FRONTEND_URL` empty — no CORS needed.

Both files also carry their other keys — see `backend/.env.example` and `frontend/.env.example`. The backend's `DATABASE_URL` stays in `backend/.env`, refreshed with `neon env pull --file backend/.env`.

### How the pieces connect

```
browser ──fetch──▶ VITE_BACKEND_URL (:3000) ──▶ Express backend ──▶ Neon Postgres
                          ▲
              CORS allows only FRONTEND_URL (:5173)
```

The frontend never touches the database directly — only the backend holds `DATABASE_URL`.

### 3. Run

```bash
npm run dev             # backend :3000 + frontend :5173
```

- Frontend: http://localhost:5173 (proxies `/api` → :3000)
- **First registered user becomes admin** and lands on `/admin`; everyone after lands on `/workspace`.

### Vercel deployment

The frontend is a single-page app with client-side routes such as `/login` and
`/workspace/chat/:botId`. The Vercel rewrites in `vercel.json` (or
`frontend/vercel.json` when the Vercel project root is set to `frontend`) send
direct route requests back to the app entry point, so hard refreshes work.
Configure `VITE_BACKEND_URL` in Vercel to point to the deployed backend API.

## Database

All application state lives in Neon Postgres (`backend/db/schema.sql`): users, bots, conversations, messages, approvals, skills, routines, memories, activity logs, tool call logs, and global settings.

Re-apply schema changes with `npm run db:migrate` (idempotent — `CREATE TABLE IF NOT EXISTS`).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start backend + frontend together |
| `npm run db:migrate` | Apply `db/schema.sql` to Neon |
| `npm run lint` | TypeScript check (both projects) |
