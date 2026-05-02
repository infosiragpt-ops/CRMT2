# WhatsApp Hub

Multi-user web platform for managing several real WhatsApp accounts from one operator console.

## What it does
- Each operator registers/logs in with username + password.
- Each operator can register multiple WhatsApp devices.
- Each device opens a real WhatsApp Web session through `whatsapp-web.js` (Puppeteer + headless Chromium) and shows a QR code to pair.
- Once paired, the operator can browse chats and send/receive messages in real time, three-pane WhatsApp-Web style.

## Architecture
Pnpm monorepo, two artifacts:
- `artifacts/whatsapp-hub` — React + Vite frontend served at `/` (wouter, React Query, shadcn/ui, socket.io-client).
- `artifacts/api-server` — Express + Socket.IO backend mounted at `/api` and `/socket.io`.

Shared:
- `lib/db` — Drizzle ORM schema + Postgres pool. Tables: `users`, `devices`. `user_sessions` is auto-created by `connect-pg-simple`.

### Backend
- `src/lib/auth.ts` — `express-session` with `connect-pg-simple` (Postgres-backed), session regenerated on login/register, `requireAuth` middleware.
- `src/lib/wa-manager.ts` — singleton WhatsApp client manager. Each device session has its own `whatsapp-web.js` Client with `LocalAuth` storing data under `WA_SESSIONS_DIR` (`.wa-sessions/`). Per-session start-promise mutex prevents duplicate clients on concurrent start. Pub/sub `subscribe(sessionId, listener)` for socket fanout.
- `src/lib/socket.ts` — Socket.IO server sharing the express session via `io.engine.use(sessionMiddleware)`. Per-socket subscription map prevents duplicate WA listener registration; cleanup on `disconnect` and explicit `unsubscribe-device`.
- `src/routes/auth.ts` — `/api/auth/register|login|logout|me`.
- `src/routes/devices.ts` — `/api/devices` CRUD + `/start`, `/logout`, `/chats`, `/chats/:chatId/messages` (GET/POST). All scoped by `userId` via `ownDevice()` helper.

CORS is restricted by `ALLOWED_ORIGINS` (or `REPLIT_DEV_DOMAIN`) with `credentials: true`. Same-origin requests (no `Origin` header) are always allowed.

### Frontend
- `src/App.tsx` — wouter router wrapped with `AuthProvider` + `SocketProvider`. Routes: `/login`, `/register`, `/devices`, `/devices/:sessionId/connect`, `/devices/:sessionId`.
- `src/lib/auth-context.tsx` — fetches `/api/auth/me` on mount; redirects accordingly.
- `src/lib/socket-context.tsx` — lazily creates a single socket.io connection once authenticated.

### Realtime events
Client emits `subscribe-device <sessionId>` after connecting. Server emits:
- `qr` — base64 PNG data URL of the WhatsApp pairing QR.
- `status` — `starting | qr | authenticated | ready | disconnected | auth_failure`.
- `message` — incoming/outgoing WhatsApp message.

## Environment
- `DATABASE_URL` — Postgres (provisioned).
- `SESSION_SECRET` — required for express-session.
- `PUPPETEER_EXECUTABLE_PATH` — path to system Chromium (Nix-installed; required for whatsapp-web.js).
- `PUPPETEER_SKIP_DOWNLOAD=1`.
- `WA_SESSIONS_DIR` — directory for `LocalAuth` session files (default `.wa-sessions/`).
- `ALLOWED_ORIGINS` (optional) — comma-separated list of allowed cross-origin frontends.

## Build notes
`artifacts/api-server/build.mjs` externalizes packages that can't be safely esbuild-bundled:
`whatsapp-web.js`, `qrcode-terminal`, `fluent-ffmpeg`, `connect-pg-simple` (loads `table.sql` at runtime), `express-session`.

## Languages
The user prefers Spanish for chat communication.
