# ShareMD

Paste markdown, get an unlisted link that reads well. No accounts, zero tracking, nothing in your way.

## Run it locally

```sh
bun install
bun run db:migrate
bun run dev
```

## What it does

- **Clean reading**: Renders GitHub Flavored Markdown, Shiki syntax highlighting for any programming language on demand, server-side LaTeX math via KaTeX (`$E=mc^2$`), GitHub callout alerts (`> [!NOTE]`), tables, Mermaid diagrams, and task lists.
- **Unlisted by default**: Links are private and unlisted. No signups, no analytics trackers, no indexing.
- **Link options**:
  - Custom slugs (`/s/my-project-proposal`)
  - Password protection (scrypt hashed)
  - Auto-expiration (1 hour, 1 day, 1 week, 1 month)
  - Max view limits (burn after reading, with link-crawler bot protection for Slack, Discord, iMessage, and Twitter previews)
- **Silent Library**: Documents shared from your browser stay recorded in your local **Library** (top bar). You can edit them in place or delete them whenever you want without an account.
- **Visitor Forking**: Anyone receiving a link can click **Fork** to copy the raw markdown into a fresh draft, or click **Copy MD** to copy the source directly.
- **Draft Autosave & Clear all**: Unsaved work automatically persists in `localStorage` so refreshing or crashing never loses words. A two-step **Clear all** button wipes the editor safely.
- **13 Themes**:
  - Dark: Monochrome (default), Nxr (AMOLED), Dracula, Catppuccin Mocha, Nord, GitHub Dark, Monokai, Tokyo Night, Gruvbox Dark.
  - Light: GitHub Light, Gruvbox Light, Solarized Light, Catppuccin Latte.
  - Tri-color swatches with native code block backgrounds per theme.
- **Keyboard shortcuts**:
  - `Tab` / `Shift+Tab`: Indent or outdent two spaces
  - `Cmd+Enter` / `Ctrl+Enter`: Share or save doc
  - `Esc`: Close popups and guide
- **Clean printing**: Built-in `@media print` stylesheet strips navigation, TOCs, and UI chrome, printing high-contrast text on white paper.
- **Accurate downloads**: Downloaded markdown files save with clean filenames derived from the document's title.

## Stack

- **Framework**: SvelteKit 5 (Runes) + Bun + Vite
- **Styling**: Tailwind CSS v4 + Tailwind Typography
- **Database**: SQLite via `better-sqlite3` + Drizzle ORM (configured in WAL mode with indexes on `created_at` and `expires_at`)
- **Markdown & Math**: `marked` + `isomorphic-dompurify` + `shiki` + `katex` + `mermaid`
- **Typography**: Self-hosted Sentient serif + system monospace, zero external CDN requests

## Deploy (Dokploy / Docker)

```sh
docker compose up -d --build
```

SQLite database lives at `/data/local.db`. Mount a persistent volume at `/data` (`sharemd-data:/data`). Database migrations run on container boot automatically.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `/data/local.db` (local dev: `./local.db` via `.env`) | SQLite file path |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Server bind host and port |
