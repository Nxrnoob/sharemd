# ShareMD Security and UI/UX Comprehensive Audit

Date: 2026-10-16  
Target: ShareMD (SvelteKit 2, Svelte 5, Tailwind v4, SQLite/Turso via Drizzle ORM)  
Audited Modules:
- `src/routes/s/[id]/` (Document reader, server loader, and raw export)
- `src/routes/b/[id]/` (Folder view, server loader, and contribution interface)
- `src/routes/library/` (Browser-local file manager and shelf management)
- `src/routes/+page.svelte` (Landing page editor and share options)
- `src/routes/api/` (`upload`, `docs`, `bundles`, `runtime`)
- `src/lib/server/` (`bundles.ts`, `docs.ts`, `grants.ts`, `markdown.ts`, `rate-limit.ts`, `uploads.ts`, `doclinks.ts`)
- `src/lib/components/` (`FileRow.svelte`, `DocTile.svelte`, `SideRow.svelte`, `fileSkin.ts`, etc.)

---

## Part 1: Security Vulnerabilities and Access Control Flaws

### 1. [CRITICAL] Locked Folder Member Direct Access Bypass
- **Severity**: Critical
- **CWE**: CWE-284 (Improper Access Control), CWE-639 (Authorization Bypass Through User-Controlled Key)
- **Affected Files**:
  - `src/routes/s/[id]/+page.server.ts:22`
  - `src/routes/s/[id]/raw/+server.ts:23`
  - `src/routes/api/docs/[id]/+server.ts:30`
  - `src/lib/server/bundles.ts:183-201`
- **Vulnerability Mechanics**:
  When a folder is password-protected at `/b/[id]`, the folder password hash lives strictly in the `bundles` table (`bundles.passwordHash`). By architectural rule (`findGatedMember`), member documents are required to be completely ungated (`passwordHash: null`, `expiresAt: null`, `maxViews: null` in the `documents` table).
  The folder gate only guards the folder directory listing at `/b/[id]`. The individual reader route `/s/[id]`, raw download route `/s/[id]/raw`, and JSON API route `/api/docs/[id]` evaluate only the document row itself. They never query `bundle_items` to check whether the document belongs to a password-protected bundle, nor do they check for a bundle grant cookie.
- **Exploitation Impact**:
  Anyone who obtains or predicts the document ID (or strips `?from=...` from the reader link) gets full access to the document with zero password verification.
- **Remediation**:
  Connect document gating to bundle membership. When resolving a document in `resolveDoc` or `s/[id]/+page.server.ts`, check if it belongs to an active, password-gated bundle. If it does, require either the document's own grant or the parent bundle's unlock grant cookie (`sm_gate_<bundleId>`) before serving content.

---

### 2. [CRITICAL] Stored XSS via SVG Upload Leading to Total Capability Token Theft
- **Severity**: Critical
- **CWE**: CWE-79 (Cross-Site Scripting), CWE-434 (Unrestricted Upload of File with Dangerous Type)
- **Affected Files**:
  - `src/routes/api/upload/+server.ts:7-14`
  - `src/lib/server/uploads.ts:33`
  - `src/routes/u/[filename]/+server.ts:12-16`
- **Vulnerability Mechanics**:
  1. `/api/upload` permits `image/svg+xml` files up to 5MB from unauthenticated clients.
  2. The raw buffer is written directly to disk without XML sanitization or stripping `<script>` and inline event handlers (`onload`, `onerror`).
  3. `/u/[filename]` serves the file with `Content-Type: image/svg+xml`, omitting `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, or `Content-Disposition: attachment`.
- **Exploitation Impact**:
  An attacker uploads an SVG containing a JavaScript payload. When an owner or viewer opens the direct image link on the same domain, JavaScript executes with origin privileges. It reads `localStorage['sharemd-shelf']` and `localStorage['sharemd-bundles']` and exfiltrates every plaintext capability token, allowing the attacker to wipe (`DELETE /api/docs/[id]`), overwrite (`PUT /api/docs/[id]`), or take down every bundle on the account.
- **Remediation**:
  Remove `image/svg+xml` from permitted upload formats, or run all uploaded SVGs through server-side XML sanitization. Serve all user uploads with `Content-Disposition: attachment` (or inline with `Content-Security-Policy: sandbox; default-src 'none'`) and `X-Content-Type-Options: nosniff`.

---

### 3. [HIGH] Contributed Document Capability Abuse and Orphaned Membership DoS
- **Severity**: High
- **CWE**: CWE-284 (Improper Access Control), CWE-400 (Uncontrolled Resource Consumption)
- **Affected Files**:
  - `src/routes/api/bundles/[id]/contribute/+server.ts:68-88`
  - `src/lib/server/bundles.ts:257-275, 327`
  - `src/routes/api/docs/[id]/+server.ts:150`
- **Vulnerability Mechanics**:
  1. **Anonymous Lock-out**: In `/b/[id]`, the contributor name is optional. If left blank, `contributorName` is stored as `null`. In `src/lib/server/bundles.ts`, `listContributedMembers` queries `contributorName IS NOT NULL`, and `removeContributedMember` aborts if `!item.contributorName`. Any anonymous contribution is completely invisible to the bundle owner's management modal and impossible for the bundle owner to remove.
  2. **Contributor Token Abuse**: A contributor receives a full document `deleteToken`. They can call `PUT /api/docs/[id]` to set an independent password, view cap, or expiration on that doc, breaking the parent bundle's single-gate invariant for all other folder recipients.
- **Remediation**:
  Track contribution status using an explicit boolean column on `bundle_items` rather than checking `contributorName IS NOT NULL`. Ensure the bundle owner can delete any contribution regardless of display name. Reject or restrict `PUT /api/docs/[id]` mutations (such as adding passwords or view limits) on documents that belong to bundles.

---

### 4. [MEDIUM] Post-Bundle Invariant Violation via Document Options
- **Severity**: Medium
- **CWE**: CWE-284 (Improper Access Control)
- **Affected Files**:
  - `src/routes/api/docs/[id]/+server.ts:150-180`
  - `src/lib/server/bundles.ts:183`
- **Vulnerability Mechanics**:
  Bundle creation verifies that all members are ungated at creation (`findGatedMember`). However, after a bundle is published, the document owner can open the Library options modal and add a password, expiry, or max views limit to an existing member doc. The document update endpoint (`PUT /api/docs/[id]`) does not check whether the document is part of a bundle.
- **Exploitation Impact**:
  Visitors who unlock the bundle encounter a locked or expired screen when clicking the member tile, violating the invariant that one gate governs the entire share.
- **Remediation**:
  Add a membership check in `PUT /api/docs/[id]`. Prevent setting independent passwords, view limits, or expiration on documents that are currently bundled.

---

### 5. [MEDIUM] Metadata Leaks on Locked Documents and Folders
- **Severity**: Medium
- **CWE**: CWE-200 (Exposure of Sensitive Information)
- **Affected Files**:
  - `src/routes/s/[id]/+page.server.ts:35-50`
  - `src/routes/b/[id]/+page.server.ts:36-46`
  - `src/lib/server/doclinks.ts:100-106`
- **Vulnerability Mechanics**:
  When a document or folder is password-locked, the server empties the markdown and HTML body, but still includes `title`, `slug`, and `views` in the server data.
- **Exploitation Impact**:
  The document title and view count are rendered in the HTML `<title>`, `<meta property="og:title">`, and browser tabs. Internal doclink references also resolve and display the title of locked target documents in the Table of Contents rail. Anyone who has the link discovers the confidential title without the password.
- **Remediation**:
  Obfuscate or mask titles (for example "Locked Document") in `<title>` and OpenGraph tags when `passwordRequired: true`.

---

### 6. [MEDIUM] Asymmetric Slug Collisions and System Route Hijacking
- **Severity**: Medium
- **CWE**: CWE-20 (Improper Input Validation), CWE-1022
- **Affected Files**:
  - `src/routes/api/docs/+server.ts:54`
  - `src/routes/api/bundles/+server.ts:107`
  - `src/lib/server/doclinks.ts:70`
- **Vulnerability Mechanics**:
  1. `POST /api/bundles` checks both `documents` and `bundles` for slug collisions, but `POST /api/docs` and `PUT /api/docs/[id]` check only `documents`. A document can take a slug matching an existing bundle.
  2. Neither endpoint enforces a reserved keyword list (`library`, `api`, `b`, `s`, `raw`, `admin`). A document named `raw` or `library` hijacks relative markdown links in `doclinks.ts`.
- **Remediation**:
  Unify slug collision checks across documents and bundles. Add a strict reserved route word list.

---

### 7. [MEDIUM] Rate-Limiting Race Condition and Global Bucket Starvation
- **Severity**: Medium
- **CWE**: CWE-362 (Race Condition), CWE-770 (Allocation of Resources Without Limits)
- **Affected Files**:
  - `src/lib/server/rate-limit.ts:25-35`
  - `src/routes/api/bundles/[id]/members/+server.ts`
- **Vulnerability Mechanics**:
  1. `checkRateLimit` executes a non-atomic read, compare, and update cycle (`SELECT`, then `UPDATE rate_hits SET count = next`), allowing concurrent bursts to bypass the 20 requests/hour limit.
  2. A single global 20 requests/hour bucket per IP is shared across document creation, editing, deleting, unlock attempts, and image uploads. An author who edits 5 times and uploads 15 images gets locked out from unlocking docs or managing their library.
  3. `POST /api/bundles/[id]/members` lacks rate-limiting entirely.
- **Remediation**:
  Use an atomic SQL update (`UPDATE rate_hits SET count = count + 1 WHERE ...`). Separate heavy operations (unlock attempts, document creation) into distinct rate-limiting buckets so normal editing does not trigger lockouts.

---

### 8. [LOW] View-Limit Bypass on Raw Downloads
- **Severity**: Low
- **CWE**: CWE-284 (Improper Access Control)
- **Affected Files**:
  - `src/routes/s/[id]/raw/+server.ts:23-28`
- **Vulnerability Mechanics**:
  The raw download route checks `gateDoc(row, null)`, but never calls `takeView(row.id)`.
- **Exploitation Impact**:
  A document with `maxViews: 1` can be downloaded indefinitely through the `/raw` endpoint without consuming its view budget.
- **Remediation**:
  Call `await takeView(row.id)` in the raw download handler.

---

### 9. [LOW] Markdown Sanitizer CSS Injection and External Link Rel Bypasses
- **Severity**: Low
- **CWE**: CWE-1021, CWE-601
- **Affected Files**:
  - `src/lib/server/markdown.ts:180, 228`
  - `src/lib/components/Mermaid.svelte:85`
- **Vulnerability Mechanics**:
  1. `allowedAttributes: { '*': ['style', ...] }` allows the `style` attribute globally without configuring `allowedStyles`, permitting arbitrary inline CSS (full-screen clickjacking overlays or position fixed masking).
  2. `transformTags` only enforces `rel="noopener noreferrer"` on `http://` and `https://`, leaving protocol-relative links (`//evil.com`) unprotected.
  3. `Mermaid.svelte` injects generated SVG output directly via `wrap.innerHTML = svg` without secondary sanitization.
- **Remediation**:
  Restrict or drop `style` in `allowedAttributes`, enforce `allowProtocolRelative: false`, and sanitize Mermaid SVG output before DOM injection.

---

## Part 2: UI Inconsistencies and Feature Parity Gaps

### 1. Complete Absence of Document Creation in `/library`
- **Current Behavior**: `/library` is the file manager, yet it has no button, dropzone, or modal to write or upload a document.
- **Friction**: The only links ("Share your first doc", "Share a new doc") hardcode `href="/"`. They do not pass the active folder context (`/?folder=<id>`). Even if they did, `/` does not read query parameters to pre-select a folder. To add a doc to a folder from the library, users must navigate away, open `/`, expand "Link options", find the folder dropdown, re-select their folder, and share.
- **Remediation**: Add a prominent "New Document" button and a markdown file dropzone directly within `/library` (both in the sidebar and the main pane). Clicking "New Document" inside a folder must automatically bind the document to that folder.

---

### 2. Feature Parity Matrix: Landing Page Editor (`/`) vs Folder Creation (`/b/[id]`)

| Feature | Landing Page (`/`) | Folder Contribution (`/b/[id]`) | Library (`/library`) |
|---|---|---|---|
| **Entry Point Availability** | Always available | Only if folder is password-protected | Completely missing |
| **Custom Slug** | Validated input with live clash check | Missing (`slug: null` hardcoded) | Missing |
| **Password Gate** | Configurable with 4-char min | Missing (`passwordHash: null`) | Missing |
| **Expiry Gate** | 1h, 1d, 7d, 30d, Never | Missing (`expiresAt: null`) | Missing |
| **Max Views Limit** | Numeric cap input | Missing (`maxViews: null`) | Missing |
| **File Drag and Drop** | Dashed dropzone with `DragGhost` animation | Missing (manual typing only) | Missing (drag only moves existing rows) |
| **Auto Title Detection** | Inferred from `# Heading` or filename | Missing (hard requirement to type title) | Missing |
| **Draft Persistence** | Auto-saves to `sharemd-draft` with toast | Missing (cleared on tab switch or reload) | Missing |
| **Character and Size Meter** | Live KB progress bar with 512KB warning | Plain textarea with zero indicators | Missing |
| **Editor Tab Key** | Indents/outdents 2 spaces | Blurs textarea (browser default) | Missing |
| **Keyboard Shortcut** | `Cmd+Enter` / `Ctrl+Enter` submits | Shortcut does nothing | Missing |
| **Image Upload Tray** | Paste/drop image, inserts markdown, thumbnail tray | Completely missing | Missing |
| **Themed Share URL** | Auto-generates `?theme=` and copies | Saves raw path, no theme, no auto-copy | Missing |

---

### 3. Library UX and Architecture Friction

1. **The Synchronization Trap (Local Folders vs Shared Bundles)**:
   - "Folders" exist only as client-side tags in the owner's `localStorage['sharemd-folders']`.
   - "Shared Bundles" are static, immutable snapshots frozen on the server at share time.
   - If an owner adds a doc to their local folder tomorrow, the shared link does not update. If a teammate adds a doc via the shared link, it does not appear in the owner's local folder view (it only shows up in a separate "Added to this folder" sub-modal). This defies standard file manager expectations (Google Drive, Dropbox, Notion).
2. **Accidental Instant Folder Deletion**:
   - In `src/routes/library/+page.svelte:424`, clicking "Delete" on a folder immediately deletes the folder with zero confirmation, zero modal dialog, and zero undo capability. A single misclick destroys folder groupings.
3. **Desktop-Only Drag and Drop**:
   - Dragging documents into sidebar folders uses the HTML5 Drag and Drop API, which does not fire on iOS Safari or Android Chrome. Mobile users are stuck using a tiny `<select>` dropdown inside each row.
   - There is no multi-select (no Shift-click or Cmd-click) to move multiple documents at once.
4. **Header Disconnect**:
   - When a folder in the sidebar is selected, the main pane's `<h1>` stays frozen as "Shared from this browser". The active folder name only appears in a tiny status bar tally at the bottom.
5. **No Sorting, Search, or Filtering**:
   - As an author reaches the 100-document shelf ceiling, there is no search bar, date sort, view count sort, or tag filtering.

---

### 4. Component Divergence and Design Tokens

1. **`FileRow.svelte` (Library) vs `DocTile.svelte` (Folder)**:
   - `FileRow` is locked to a horizontal list layout; `DocTile` is locked to a vertical card grid.
   - `FileRow` displays URL path and relative date, but hides reading time and contributor provenance. `DocTile` displays reading time and contributor name, but hides creation date and link path.
   - Users cannot toggle between list and grid views in either surface.
2. **Button Tokens and Radius Inconsistencies**:
   - Sidebar buttons (`railBtn`) use borderless `text-[11px]`. Row buttons (`FILE_CONTROL`) use bordered `text-[13px]`.
   - `DeleteDocButton` is wrapped in an extra manual bordered `<span>` inside `FileRow` because its internal style does not match sibling `FILE_CONTROL` elements.
   - The UI alternates between sharp unrounded borders (`border border-line bg-surface`), `rounded-xs` (image tray), and `rounded-sm` (`fileSkin.ts`).
3. **StatusBar Discrepancies**:
   - Separators in `/library` use single-spaced dots (` · `), while `/b/[id]` uses double-spaced dots (`  ·  `).

---

### 5. Reader and Editor Lifecycle Gaps

1. **Theme Stripping on Slug Updates**:
   - When an owner shares a document, the active theme is saved in `shelf.url` (`/s/slug?theme=nord`).
   - When the owner edits the slug in the Library Settings modal, `updateShelfSlug` rewrites `url` to `/s/${newSlug}`, silently stripping the `?theme=` parameter. Subsequent copies of the link lose the theme.
2. **Missing Actions in Reader View**:
   - When an owner views their document at `/s/[id]`, they see an "Edit" button, but no "Delete" button and no "Link Options" dialog. They are forced to return to `/library`, scan through rows, and open the options popover.
3. **Three Conflicting Options Modals**:
   - Landing uses an anchored dropdown popover.
   - Library doc settings uses a centered fixed backdrop modal.
   - Library folder share uses a third separate modal with different fields.

---

## Part 3: Phased Execution Plan

### Phase 1: Critical Security Remediations
1. **Enforce Bundle Gate Inheritance on Documents**:
   - In `resolveDoc` and `src/routes/s/[id]/+page.server.ts`, query `bundle_items` to check if a document is part of any active password-gated bundle.
   - Check whether the visitor holds the parent bundle's unlock grant cookie (`sm_gate_<bundleId>`). If not, require unlocking the parent bundle.
   - Mirror this check on `/s/[id]/raw` and `/api/docs/[id]`.
2. **Remediate SVG Upload Stored XSS**:
   - Drop `image/svg+xml` from `/api/upload` allowed formats, or sanitize with a strict XML parser.
   - Serve `/u/[filename]` with `Content-Disposition: attachment` (or `Content-Security-Policy: sandbox; default-src 'none'`) and `X-Content-Type-Options: nosniff`.
3. **Fix Contributed Document Provenance and Permissions**:
   - Add a dedicated boolean flag on `bundle_items` to denote contributions.
   - Ensure the bundle owner can delete any contribution regardless of whether a contributor name was entered.
   - Restrict `PUT /api/docs/[id]` on bundled documents to prevent adding conflicting gates.
4. **Remediate Rate-Limiting Race Condition and Bucket Collisions**:
   - Use atomic SQL updates in `checkRateLimit`.
   - Separate unlock attempts and creation from normal library editing.

### Phase 2: Document Creation Parity and Library Ingestion
1. **Enable In-Library Document Creation**:
   - Add a "New Document" button in `/library` with folder pre-selection.
   - Add drag-and-drop file upload directly onto the Library view and sidebar folders.
2. **Folder Contribution Parity**:
   - Add drag-and-drop file upload and dropzone to `/b/[id]`.
   - Add markdown size/progress meter, Tab indentation, and `Cmd+Enter` shortcuts to the contribution form.
   - Enable draft persistence in `localStorage`.

### Phase 3: Library UX and Component Modernization
1. **Folder Safety**:
   - Add a two-step confirmation or modal dialog before deleting folders in `/library`.
2. **View Mode Unification**:
   - Provide a List vs Grid toggle across both `/library` and `/b/[id]`.
   - Align `FileRow` and `DocTile` metadata to show both reading time, path, and date.
3. **Reader View Completeness**:
   - Add owner Delete and Link Options affordances directly inside `/s/[id]`.
