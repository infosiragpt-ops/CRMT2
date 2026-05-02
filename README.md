# CRMT2

CRMT2 is a TypeScript monorepo for a CRM and WhatsApp multi-device workspace. It includes an API server, a Vite frontend, shared database schema code, generated API clients, and a legacy `waticketsaast20` application tree.

## Project Structure

- `artifacts/api-server`: backend API service.
- `artifacts/whatsapp-hub`: main web client.
- `lib/db`: shared database schema and Drizzle setup.
- `lib/api-spec`, `lib/api-client-react`, `lib/api-zod`: OpenAPI and generated client utilities.
- `scripts`: workspace scripts.
- `waticketsaast20`: legacy/full-stack WhatsApp ticketing code.

## Local Development

Requirements:

- Node.js
- pnpm
- PostgreSQL
- Google Chrome or Chromium for WhatsApp session automation

Setup:

```bash
pnpm install
cp .env.example .env
```

Edit `.env` for your local database, ports, session secret, and Chrome path.

Run the API and web client:

```bash
pnpm run dev:api
pnpm run dev:web
```

Useful commands:

```bash
pnpm run typecheck
pnpm run build
pnpm run db:push
```

## Security Notes

Do not commit runtime credentials or browser/session data. The repository ignores `.env`, `.wa-sessions/`, API uploads, and WhatsApp web cache folders. Use `.env.example` as the template for local configuration.

## License

This project is released under the MIT License. See `LICENSE`.
