# CLAUDE.md

## Project Overview

EasySchematic is a browser-based AV signal flow diagram tool for designing audio/video system hook-ups. It targets broadcast, live production, and AV integration professionals.

- **Main app** is a client-side React SPA. Schematic data lives in browser localStorage.
- **API + database** (`api/`) powers the community device template library — Hono on Cloudflare Workers with D1 (SQLite).
- **Devices site** (`devices/`) is a separate SPA for browsing, submitting, and moderating device templates.
- **No tests** — this is a rapid-development tool project, not a library.

## Tech Stack

- React 19 + TypeScript (strict)
- @xyflow/react v12 (React Flow) — canvas, nodes, edges, handles
- Zustand v5 — global state (single store at `src/store.ts`)
- Tailwind CSS v4 (via PostCSS plugin)
- Vite 8

## Build, Run & Deploy

```bash
npm install
npm run dev        # dev server on localhost:5173
npm run build      # tsc + vite build → dist/
npx tsc --noEmit   # type-check without emitting
```

**Deployment:** Cloudflare Workers (static assets) via GitHub integration. Pushes to `master` auto-deploy.
- Worker name: `easyschematic` → `https://easyschematic.dylan-uremovich.workers.dev/`
- Config: `wrangler.toml` (static asset worker, serves `dist/`)
- Build pipeline: Cloudflare builds with `npm run build`, deploys with `npx wrangler deploy --no-experimental-autoconfig`
- Version display: `v{package.json version} ({git short hash})` shown in DeviceLibrary sidebar, baked in at build time via Vite `define` in `vite.config.ts`

## Architecture

### Key Files

- `src/store.ts` — Zustand store. All app state: nodes, edges, undo/redo stacks, custom templates, clipboard, localStorage persistence.
- `src/types.ts` — Core types: `SchematicNode`, `ConnectionEdge`, `DeviceData`, `Port`, `SignalType`.
- `src/App.tsx` — Main component. `SchematicCanvas` wraps ReactFlow with all event handlers. `PrintTitleBlock` shown only during print.
- `src/deviceLibrary.ts` — Built-in device templates (cameras, switchers, converters, etc.).
- `src/components/DeviceNode.tsx` — Device node renderer. Ports rendered as React Flow Handles with signal-type colors.
- `src/components/RoomNode.tsx` — Room container node (resizable, dashed border).
- `src/components/OffsetEdge.tsx` — Custom edge component with parallel-edge nesting, node avoidance, and manual waypoint drag handles.
- `src/components/EdgeContextMenu.tsx` — Right-click context menu for edges: Add Handle, Remove Handle, Reset Route.
- `src/components/DeviceEditor.tsx` — Slide-out panel for editing device properties, ports, drag-and-drop port reordering.
- `src/components/DeviceLibrary.tsx` — Left sidebar with searchable device template list.
- `src/dxfExport.ts` — DXF R12 export. Reads handle positions from React Flow internals and edge paths from DOM SVG.
- `src/exportUtils.ts` — PNG/SVG export via html-to-image.
- `src/printUtils.ts` — Print dialog logic (viewport manipulation, @page CSS injection).
- `src/snapUtils.ts` — Snap-to-alignment guide computation.
- `src/alignUtils.ts` — Multi-selection alignment operations.

### Important Patterns

**Zustand selectors must return primitives.** Returning objects/arrays/Sets from `useSchematicStore((state) => ...)` causes infinite re-renders (white screen) because `Object.is` comparison always returns false. Split into multiple selectors returning numbers/strings/booleans, or serialize to a string.

**Edge routing:** `OffsetEdge` reads pre-computed routes from `store.routedEdges`. Routes are computed by `routeAllEdges()` in `src/edgeRouter.ts` using A* pathfinding (`src/pathfinding.ts`). Parallel edges sharing endpoints are grouped and offset in X to nest without overlapping. Routes freeze during drag (`isDragging` flag) and recompute on drop. Route recomputation is triggered by changes to `edgeDigest` in App.tsx — this digest must include any edge data fields that affect routing (e.g., `manualWaypoints` length).

**Manual edge routing:** Users can add waypoint handles to edges via right-click context menu. `ConnectionData.manualWaypoints` stores user-placed points. The router splits manual edges into legs (source→h1, h1→h2, ..., hN→target) and A* routes each leg with per-leg stub control (`noSourceStub`/`noTargetStub`) and direction constraints (`freeStartDir`/`freeEndDir`, `excludeStartDir`/`excludeEndDir`). Manual edges route first in the sort order and are exempt from Phase 2/3 re-routing. Direction look-ahead at each handle prevents doubling back by reserving the ideal exit direction.

**Routing sort order:** Manual edges first → grouped by signal type (most-common type first) → smallest Y-range first → top-to-bottom. Signal type grouping creates visual "lanes." Smallest-Y-range-first prevents fan-out crossing from shared sources.

**Port grid alignment:** DeviceNode has a 9px spacer (`pt-[9px]`) between header and port rows. Math: 1px (node border) + 40px (header h-10) + 9px (spacer) + 10px (half of h-5 port row) = 60px ≡ 0 mod 20. All port handle centers land on the 20px grid.

**Bidirectional ports** have two handles: `{portId}-in` (target/left) and `{portId}-out` (source/right). Only one side can be connected at a time.

**Handle-based reconnection:** Dragging from a connected handle removes the old edge (`onConnectStart`), lets the user draw a new connection, and restores the old edge if cancelled (`onConnectEnd`). Uses `pendingUndoSnapshot` for clean single-step undo.

**Node parenting:** Device nodes can be parented to room nodes. `getAbsPos()` resolves absolute position by adding parent offset. `reparentNode()` handles drop-into-room and drag-out-of-room.

**DXF export** reads actual handle positions from `getInternalNode().internals.handleBounds` and edge SVG paths from the DOM. Layer names use `-` separator for Vectorworks class hierarchy (e.g., `EasySchematic-Connections-SDI`).

### Signal Types

Defined in `src/types.ts` as `SignalType` union. Each has a CSS custom property color (`--color-sdi`, etc.) in `src/theme.css` and an ACI color mapping in `src/dxfExport.ts`.

## Style Conventions

- Functional components with `memo()` where appropriate
- CSS via Tailwind utility classes with CSS custom properties for theming
- No class components, no CSS modules, no styled-components
- Callbacks use `useCallback` when passed as props to ReactFlow
- Direct store access via `useSchematicStore.getState()` in event handlers (avoids stale closures)

## API (`api/`)

Hono REST API on Cloudflare Workers with D1 (SQLite) for the community device template database.

### Build & Deploy

```bash
cd api
npm install
npx wrangler dev              # local dev server
npx wrangler deploy            # deploy to Cloudflare
npx wrangler d1 execute easyschematic_db --remote --file=migrations/XXXX.sql  # apply migration
```

**Deployment:** Cloudflare Worker (`easyschematic-api`), auto-deploys on push to `master`.
- Domain: `api.easyschematic.live`
- Database: D1 `easyschematic-db` (ID `26615646-10b7-4af7-86ed-c5f57d1b4243`)
- Migrations: `api/migrations/` (numbered SQL files, applied manually via `wrangler d1 execute`)
- Seed data: `api/seed/` (SQL scripts for backfilling data)

### Key Files

- `api/src/index.ts` — All route handlers (templates CRUD, submissions, auth, users, contributors)
- `api/src/db.ts` — `TemplateRow`/`TemplateInput`/`TemplateOutput` types, `templateToRow()`/`rowToTemplate()` transforms
- `api/src/validate.ts` — `validateTemplate()` — input validation for template data
- `api/src/auth.ts` — Magic link auth, session middleware, role checks (contributor/moderator/admin)
- `api/src/rateLimiter.ts` — Token-bucket rate limiting stored in D1

### Auth & Roles

- **Magic link email auth** via Resend (`/auth/login` → `/auth/verify`)
- Sessions stored in D1 with 30-day TTL, delivered via `HttpOnly` cookie
- Roles: `contributor` (default), `moderator` (approve/reject submissions), `admin` (user management)

### Template Lifecycle

1. Community user submits via `/submissions` (validated, stored as JSON)
2. Moderator reviews at `/submissions/pending`, approves or rejects
3. Approval creates/updates the template in the `templates` table
4. Admin can also CRUD templates directly via `/templates` with bearer token auth

## Devices Site (`devices/`)

Separate Vite + React SPA for browsing and managing the community device template library.

### Build & Deploy

```bash
cd devices
npm install
npm run dev        # dev server on localhost:5174
npm run build      # vite build → devices/dist/
```

**Deployment:** Cloudflare Worker (`easyschematic-devices`), auto-deploys on push to `master`.
- Domain: `devices.easyschematic.live`

### Key Files

- `devices/src/api.ts` — API client (fetch wrappers for all endpoints)
- `devices/src/App.tsx` — Hash router, layout, auth state
- `devices/src/pages/BrowsePage.tsx` — Searchable device template grid
- `devices/src/pages/DeviceDetailPage.tsx` — Device detail view with port tables, reference URL link
- `devices/src/pages/SubmitPage.tsx` — Community submission form (new device or edit suggestion)
- `devices/src/pages/ReviewQueuePage.tsx` — Moderator queue
- `devices/src/pages/ReviewDetailPage.tsx` — Side-by-side diff for edit submissions
- `devices/src/pages/AdminEditorPage.tsx` — Direct admin CRUD (bearer token auth)
- `devices/src/pages/AdminUsersPage.tsx` — User role/ban management
- `devices/src/pages/ProfilePage.tsx` — User profile with submission stats
- `devices/src/pages/ContributorsPage.tsx` — Hall of fame (top contributors)

### Shared Types

Imports `DeviceTemplate`, `Port`, `SignalType`, etc. from `../src/types.ts` (the main app's types). The `DeviceTemplate` interface is the contract between all three projects.

## Docs Site (`docs/`)

Separate Vite project with its own `package.json`, `tsconfig.json`, and `wrangler.toml`. Shares components from the main app's `src/` via direct imports (e.g., `../../../../src/components/DeviceNode`).

### Build & Deploy

```bash
cd docs
npm install
npm run dev        # dev server
npm run build      # vite build → docs/dist/
```

**Deployment:** Separate Cloudflare Worker (`easyschematic-docs`), auto-deploys from `docs/` directory on push to `master`.
- Domain: `docs.easyschematic.live` (main app is `easyschematic.live`)

### Shim Architecture

The docs can't import the main app's store, edgeRouter, etc. directly — they have side effects and singleton assumptions. A Vite plugin (`docs/vite-alias-plugin.mjs`) intercepts imports and redirects them to lightweight shims:

| Main app module | Shim | Why |
|----------------|------|-----|
| `src/store.ts` | `storeShim.ts` | Context-based store instead of singleton; each demo gets isolated state |
| `src/signalColors.ts` | `signalColorsShim.ts` | No runtime signal color overrides in docs |
| `src/migrations.ts` | `migrationsShim.ts` | No schema migration needed |
| `src/alignUtils.ts` | `alignUtilsShim.ts` | No multi-select alignment in demos |

**Not shimmed** (use real implementations): `edgeRouter.ts`, `pathfinding.ts`, `snapUtils.ts`, all components.

### Demo Canvases

`DemoCanvas.tsx` wraps ReactFlow with the same behavioral settings as the real app:
- A* edge routing via real `edgeRouter.ts` + `OffsetEdge` component
- Grid snapping (`snapToGrid`, `snapGrid=[20,20]`)
- `isDragging` freeze (routes don't recompute mid-drag)
- `enforceMinSpacing()` on drop
- Middle-mouse-only panning (`panOnDrag={[1]}`)

Demo data lives in `docs/src/data/` — node positions must be multiples of 20 (grid-aligned).

### Shared CSS

`docs/src/index.css` imports `../../src/theme.css` for signal color variables. If new CSS variables are added to `theme.css`, they're automatically available in docs.

### User-Facing Terminology

Docs use AV-industry terms exclusively — never React Flow internals:
- **device** (not "node"), **connection** (not "edge"), **port** (not "handle")
- **room** (not "room node"), **canvas** (for the workspace)
- "resize handle" is fine — it's a standard UI term, not React Flow jargon
