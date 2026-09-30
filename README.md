# ShareMD

Paste markdown, get an unlisted link that reads well. Thats the whole app.

## Run it

```sh
bun install
bun run db:migrate
bun run dev
```

Share flow: paste text or drop a `.md` file on `/` -> get `/s/<id>`. Append `?theme=nxr` (or any theme) and the link carries that theme with it.

## What it does

- Renders GFM properly (tables, task lists, code blocks with Shiki highlighting), sanitized so shared links cant run scripts
- 10 themes, monochrome default, switcher in the header
- Reader has TOC rail + floating TOC, progress bar, read time, back to top, header hides on scroll
- Rate limited uploads (20/hr per IP), 512KB cap per doc

## Stack

SvelteKit 5 + Bun + Drizzle + SQLite (better-sqlite3). Fonts are self-hosted Fontsource, zero external requests.

## Deploy (Dokploy)

```sh
docker compose up -d --build
```

DB lives at `/data/local.db`, so mount a volume there (`sharemd-data:/data`). Migrations run on boot, nothing manual needed. Single replica is fine, the rate limiter is in-memory.

## Env

| Var | Default | What |
|---|---|---|
| `DATABASE_PATH` | `/data/local.db` (local dev: `./local.db` via `.env`) | SQLite file |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server bind |

Copy `.env.example` to `.env` for local dev.
