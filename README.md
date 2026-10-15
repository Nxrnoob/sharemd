# ShareMD

Paste markdown, get an unlisted link that reads well. No accounts, zero tracking, nothing in your way.

## Run it locally

```sh
pnpm install
pnpm db:migrate   # apply drizzle/*.sql to ./local.db
pnpm dev          # http://localhost:5173
```

Or `./app.sh`, which pins the dev server to **5201**. Use that if something
else already owns 5173 — in this workspace lumiere does, and its service worker
will happily serve its cached shell to your ShareMD tab and produce baffling
hydration errors that are not your code. If ShareMD misbehaves oddly on 5173,
check for a stray service worker before debugging anything else.

`bun.lock` also exists and `bun run db:migrate` works, but `pnpm` is the
in-use toolchain. If you mix them you get two resolvers disagreeing about the
same tree — pick one.

`pnpm db:migrate` is idempotent; drizzle tracks what it has applied.

## What it does

### Reading

- **Clean rendering**: GitHub Flavored Markdown, Shiki syntax highlighting for
  any language on demand, server-side LaTeX via KaTeX (`$E=mc^2$`), GitHub
  callout alerts (`> [!NOTE]`), tables, Mermaid diagrams and task lists.
- **13 themes**: dark — Monochrome (default), Nxr (AMOLED), Dracula, Catppuccin
  Mocha, Nord, GitHub Dark, Monokai, Tokyo Night, Gruvbox Dark; light — GitHub
  Light, Gruvbox Light, Solarized Light, Catppuccin Latte.
- **Session theme overrides**: append `?theme=<id>` to any reader or folder
  link. Applies for that visit only and never overwrites the reader's saved
  preference.
- **Keyboard**: `Tab` / `Shift+Tab` indent and outdent, `Cmd/Ctrl+Enter`
  shares, `Esc` closes popups.
- **Clean printing** and title-derived `.md` download filenames.

### Sharing a doc

- **Unlisted by default.** No signups, no trackers, no indexing.
- **Link options**: custom slug, password (scrypt), expiry
  (1 h / 1 d / 7 d / 30 d), and max-view limits — the last with crawler
  detection so Slack, Discord and Twitter previews do not burn a read.
- **Editable after the fact.** The Library has per-doc **Options** for changing
  the password (including removing it), slug, expiry and view cap. You never
  have to delete and re-upload a doc to loosen it.
- **Passwords never appear in a URL.** Unlocking POSTs the password once and the
  server answers with an HttpOnly session cookie holding an HMAC grant — no
  password in the address bar, history, bookmarks or `Referer`.

### Sharing a folder

A bundle is one link covering several docs.

- **One gate governs the whole share.** The server refuses to bundle a member
  that already carries its own password, expiry or view cap, because a reader
  unlocking the index and then hitting a second lock inside it is the worst
  outcome. Unsharing a bundle leaves every doc working at its own link.
- **Optional theme.** Pin a colourway on the folder page; readers can still
  override it with `?theme=`.
- **Contributions.** A password-holder may add their own doc to the folder.
  Append-only by construction — the only mutation path is a per-doc capability
  token, and a contributor receives one for their own doc alone. They cannot
  edit or delete anyone else's, and neither can the folder creator. The
  creator can remove a contribution via their bundle token.
- **Member order is frozen** at creation — the creator's ordering is never
  disturbed by later additions.

### Your Library

Client-only, `localStorage`, no account and no server load. Docs shared from
this browser, the folders you file them in, and every folder link you have sent.

- **One surface**: the Library and the folder page share the same components
  (`src/lib/components/FileRow.svelte`, `DocTile`, `PaneHeader`, `StatusBar`,
  `SideRow`), so the owner and the reader never see two different products.
- **Re-copy any link** without re-sharing; the exact URL you sent, theme
  parameter included, is stored at share time.
- **Forget** drops a folder link from your list only — it keeps working for
  anyone holding it. Deleting a share is a separate, deliberate act.
- Drag a doc onto a folder to file it.

## Stack

- **Framework**: SvelteKit 2 + Svelte 5 (runes) + Vite
- **Styling**: Tailwind CSS v4 + Tailwind Typography
- **Database**: SQLite via `@libsql/client` + Drizzle ORM. Turso in production,
  a local `local.db` in development.
- **Markdown & Math**: `marked`, `isomorphic-dompurify`, `shiki`, `katex`,
  `mermaid`
- **Typography**: self-hosted Sentient serif + system monospace, no external CDN

## Migrations

| Script | What it does |
|---|---|
| `pnpm db:generate` | Diffs the schema and writes a new `drizzle/NNNN_*.sql` + snapshot |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:push` | Pushes the schema directly, skipping migration files |
| `pnpm db:studio` | Opens Drizzle Studio |

Production applies migrations on container boot via `scripts/migrate.prod.mjs`,
which reads the Turso env vars and runs the same `drizzle/` folder. **Deploy the
code that contains the migration** — a redeploy without it leaves the schema
behind and folder pages will error on missing columns.

## Deploy (Docker / Dokploy)

```sh
docker compose up -d --build
```

SQLite lives at `/data/local.db`; mount a persistent volume there. Migrations
run automatically before the server starts.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TURSO_DATABASE_URL` | — | Turso database URL. When set, Turso is used |
| `TURSO_AUTH_TOKEN` | — | Turso auth token |
| `DATABASE_PATH` | `./local.db` local, `/data/local.db` in Docker | SQLite file path, used when Turso is unset |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server bind host and port |

## Not built

Accounts are designed but not implemented — see
[docs/account-sync-design.md](docs/account-sync-design.md). The product
deliberately ships without them; folder bundles cover the "share many docs as
one link" case without any identity system.