# Domov na varno

Post-discharge home recovery monitoring - hackathon prototype (Ixtlan Team challenge). Core engine, SQLite storage and REST API; the UI is built separately (Lovable).

All clinical numbers are **demo values, not clinically validated**. All patients are fictional.

## Run the server

Node.js 22.19 or later.

```sh
cd server
npm ci
npm run build
npm start          # http://localhost:3000
```

Environment variables: `PORT` (default 3000), `DATABASE_PATH` (default `domov.db`; delete it to re-seed), `LOG_LEVEL`, `LLM_PROVIDER` (`fake` default, or `anthropic` with `ANTHROPIC_API_KEY` and optional `LLM_MODEL`).

To reach it from a hosted web app: `cloudflared tunnel --url http://localhost:3000`.

## Contents

- `openapi.yaml` - the API contract (OpenAPI 3.0.3).
- `UI_GUIDE.md` - what the frontend must implement against it.
- `server/` - the TypeScript server (Fastify, `node:sqlite`), with its unit tests (`npx vitest run`).
- `server-conformance-tests/` - black-box conformance tests T1-T16.
- `*.plain`, `template/`, `tests/`, `resources/` - the ***plain specification the code is regenerated from with [turri](https://turri.dev), in build order: `protocols` → `triage` → `checkins` → `alerts` → `reports` → `chat` → `api`.
- `config.turri.yaml`, `test_scripts/` - turri's build settings and test runners.
