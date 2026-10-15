# Handover

Written for whoever picks ShareMD up next. It covers what the system *is*, the
invariants that are load-bearing, and the traps that will waste your afternoon.

## What this is

Paste markdown, get an unlisted link that reads well. Documents are shared as
`/s/<slug|id>`; a group of them as a folder share, `/b/<slug|id>`. No accounts,
no signups, no tracking.

## The one idea everything rests on

**Authority is a capability token, never an identity.**

There are no users. When you share a doc, the server mints 32 random bytes,
scrypt-hashes them, and returns the plaintext exactly once. That token is the
only thing the system accepts as proof you may edit or delete that doc, and it
lives in your browser's `localStorage`.

This is why the product has no accounts, and it is why several features are
simpler than they look:

- Editing a doc needs its token. Nothing else does.
- A folder bundle's membership is proved by listing every member's token.
- A contributor receives a token for **their own new doc only** — which is the
  entire reason contributions are append-only. It is structural, not policy.

### Do not break these

1. **Never return a plaintext token twice.** Mint, hash, return once. Anything
   that re-exposes one is a leak.
2. **Never accept a token in a URL.** It leaks into history, bookmarks and
   `Referer`. Passwords made this mistake first — see below.
3. **A bundle applies exactly one gate.** `findGatedMember` in
   `src/lib/server/bundles.ts` rejects any member carrying its own password,
   expiry or view cap. A reader who unlocks the index and then meets a second
   lock inside it is the worst outcome this system can produce.
4. **Membership order is frozen** at creation (`position`). Contributions
   append. Nothing re-sorts.

## Passwords and the grant cookie

Passwords are scrypt: `scrypt$saltHex$hashHex`, N=16384, r=8, p=1, 32-byte key
(`src/lib/server/password.ts`). Compare with `timingSafeEqual` and return false
on anything malformed — never throw.

Unlocking used to put the password in `?pw=`. That is gone from **four** places,
not one, and all four had to change together:

| Surface | Route |
|---|---|
| Reader page | `/s/[id]/+page.svelte` |
| Reader page load | `/s/[id]/+page.server.ts` |
| Folder page | `/b/[id]/+page.svelte` |
| Folder page load | `/b/[id]/+page.server.ts` |
| Doc JSON API | `/api/docs/[id]/+server.ts` |
| Raw markdown download | `/s/[id]/raw/+server.ts` |

The unlock endpoints are `/api/docs/[id]/unlock` and `/api/bundles/[id]/unlock`.
They verify the password and answer with an HttpOnly cookie holding an HMAC
grant:

```
grant = HMAC-SHA256(passwordHash, "sharemd-grant:" + resourceId)
```

Keyed by the resource's **own** stored password hash. That gives three things
for free: no plaintext leaves the server, no extra env var must be deployed, and
changing the password invalidates every old grant because the key changes with
it. Cookie is `HttpOnly`, `SameSite=Lax`, `path=/`, and deliberately **has no
`maxAge`** — it dies with the browser.

When you add a new surface that reads gated content, read the grant cookie.
Note it was originally verified in page load *only*, which meant contributions
had no way to authorise a write until the endpoint was taught to check it too.

## Contributions

`POST /api/bundles/[id]/contribute`. Requires a password-gated bundle — an open
folder would accept writes from anyone who ever opened the link, which is spam,
not collaboration. Authorised by the grant cookie.

`DELETE /api/bundles/[id]/members/[docId]` lets the folder creator remove a
contribution using the **bundle's** token, and is deliberately scoped to
contributions only, so it can never reach a doc the creator put in themselves —
those stay managed in their Library.

`bundle_items.contributor_name` being null-vs-set is the only record of
provenance. Membership ceiling is 200 once contributions are in play
(`MAX_MEMBERS_WITH_CONTRIBUTIONS`); creation alone caps at 50.

## Data model

Four tables in `src/lib/server/db/schema.ts`: `documents`, `bundles`,
`bundle_items`, `rate_hits`.

`bundles` is deliberately column-for-column identical to `documents` minus the
three content columns, so a bundle reuses every hardened path — lazy expiry,
atomic view-take, scrypt hashing. If you add a gate to one, add it to both.

`bundle_items` has **no foreign key**. Deleting a doc drops its rows in
application code, which keeps cleanup identical whether or not the SQLite
connection has `foreign_keys` on (it is off by default, and Turso does not
assume otherwise).

Latest migration is `0006_folder_theme_contributions.sql`, adding
`bundles.theme` and `bundle_items.contributor_name`.

## Migrations and deploy ordering

`pnpm db:generate` writes `drizzle/NNNN_*.sql` plus a snapshot and a journal
entry — generate, never hand-write, or the snapshot desynchronises and the next
generate produces a bogus diff.

Production applies migrations on container boot via
`scripts/migrate.prod.mjs`, reading `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.

**The deploy order that matters: push first, then deploy.** A redeploy without
the migration in the image leaves the schema behind and folder pages error on
missing columns. This has bitten once already.

## The Library is client-only

`/library` has **no server load**. Everything comes from three `localStorage`
keys — `sharemd-shelf`, `sharemd-folders`, `sharemd-bundles` — each loaded in a
try/catch and each independently fault-isolated, so a corrupt bundle list cannot
cost you your delete tokens.

Consequences: design must work with zero data on first paint, and anything the
owner needs to know about a share's *live* state has to be fetched.

## Shared UI surface

The folder page and the Library deliberately share one visual language via
`src/lib/components/`: `fileSkin.ts`, `FileGlyph`, `DocTile`, `FileRow`,
`PaneHeader`, `StatusBar`, `SideRow`. Both pages import them.

If you add a surface, import from there rather than copying class strings. Two
copies of `border-line bg-surface` drift apart within a month, and the entire
point of the unification was that they never do.

The governing rule: **the container is typographic, the contents are boxed.**

## Traps

- **`pnpm check` is authoritative; the LSP in this workspace is not.** It
  reports stale errors against files that are correct, including imports that
  demonstrably exist. If check passes, it passes.
- **The dev rate limit is 20 requests/hour per IP** and will lock you out
  mid-test. For local work only: `sqlite3 local.db "delete from rate_hits;"`.
  Never do this against production.
- **`cp local.db` is not a valid backup under WAL** — the copy lacks recent
  commits. Someone lost time to exactly this. Stop the server or use
  `sqlite3 local.db ".backup out.db"`.
- **Tailwind class strings must be literal.** A concatenated class never reaches
  the scanner and the rule silently never generates — the feature looks present
  and does nothing.
- **Both `bun.lock` and `pnpm-lock.yaml` are committed.** pnpm is the tool in
  use. Mixing resolvers on one tree is a bad afternoon.
- `art/*.md` documents the generative cover system. Untouched by everything
  above and still accurate.

## Not built, on purpose

**Accounts.** Designed in `docs/account-sync-design.md`, deliberately not
implemented. Folder bundles solve "share many docs as one link" without any
identity system, and the capability model above does not need one. Read that doc
as a record of a rejected direction, not a plan.

Also absent: view tracking for a doc's reader, subfolders (a bundle is flat),
and any way for a server operator to see who contributed what beyond the
display name.