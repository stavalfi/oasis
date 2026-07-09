# IdentityHub - Frontend Design Document

The UI for reporting NHI findings as Jira tickets. This document covers the
frontend only. The backend is in [docs/backend-design.md](./backend-design.md).

## Contents

- [Stack](#stack)
- [Responsibilities and non-goals](#responsibilities-and-non-goals)
- [Routes and pages](#routes-and-pages)
- [Component tree](#component-tree)
- [Redux state](#redux-state)
- [Data flow](#data-flow)
  - [Draft persistence](#draft-persistence)
- [API calls](#api-calls)
- [Styling](#styling)
- [Loading and slow requests](#loading-and-slow-requests)
- [Form validation](#form-validation)
- [Error taxonomy](#error-taxonomy)
- [Intuitive interactions](#intuitive-interactions)
- [Product-thinking through-line](#product-thinking-through-line)

## Stack

- Runtime: the browser.
- Build: Vite bundles the React app into `frontend/dist`; the backend serves that
  build as static files on the same origin as the API. `bun run frontend:build`
  runs `vite build`; the backend launcher also runs it (and a `--watch` rebuild)
  on `bun run backend`. There is no separate `bun run frontend` dev server.
- UI: React + TypeScript.
- Combobox: `react-select` for every searchable picker (project, assignee, enum
  fields), with `match-sorter` for fuzzy matching, wrapped once in a shared
  `FuzzySelect` component. Its built-in loading state gives a spinner while
  options are still being fetched.
- State: Redux Toolkit (slices + async thunks).
- No Jira token ever reaches this layer. The frontend talks only to our backend
  and holds only an opaque session cookie (set by the backend, HttpOnly, so this
  code cannot even read it).

The frontend lives in the `frontend/` folder, alongside `backend/`.

```
frontend/src/
  pages/        one component per route (LoginPage, DashboardPage, ApiKeysPage).
  components/   shared UI (FuzzySelect, ProjectPicker, CreateFindingForm, RecentTicketsList).
  store/        Redux store, slices, and async thunks.
  client.ts     typed Hono RPC client (hc<AppType>) and the thin call wrappers.
  styles/       theme.css, the single global stylesheet.
  index.html    HTML shell; Vite's entry, links the Inter font and theme.css.
  main.tsx      entry point, loaded by index.html.
```

`AppType` is imported from the backend with a top-level `import type` (enforced
by the `import/consistent-type-specifier-style` = `prefer-top-level` lint rule).
Under `verbatimModuleSyntax`, the inline `import { type AppType }` form would
leave a side-effect import that drags the whole backend (redis, kysely, pg) into
the browser bundle; the top-level `import type` is erased entirely.

## Responsibilities and non-goals

Does:

- Start login (redirect to the backend), show logged-in state, log out.
- Pick a Jira project, submit the create-finding form.
- Show the 10 most recent app-created tickets for the selected project.
- Manage API keys (create, show once, revoke).

Does not:

- Talk to Atlassian directly.
- Store or see Jira tokens.
- Hold the client secret.

## Routes and pages

| Route                | Page          | Purpose                                     |
| -------------------- | ------------- | ------------------------------------------- |
| `/login`             | LoginPage     | Connect Jira button, starts OAuth           |
| `/`                  | DashboardPage | Project picker, create form, recent tickets |
| `/settings/api-keys` | ApiKeysPage   | Create and revoke API keys                  |

Unauthenticated access to any route other than `/login` redirects to `/login`.

## Component tree

```mermaid
flowchart TD
  App --> Header
  App --> Router
  Router --> LoginPage
  Router --> DashboardPage
  Router --> ApiKeysPage
  Header --> UserMenu
  DashboardPage --> ProjectPicker
  DashboardPage --> CreateFindingForm
  DashboardPage --> RecentTicketsList
  ApiKeysPage --> ApiKeyList
  ApiKeysPage --> CreateApiKeyDialog
```

## Redux state

One store, four slices.

```
authSlice
  status: loggedOut | loggingIn | loggedIn
  user:   { accountId, email, siteUrl } | null
  error:  string | null

projectsSlice
  list:               Project[]
  selectedProjectKey: string | null
  loading:            boolean
  error:              string | null

ticketsSlice
  recentByProjectKey: Record<projectKey, Ticket[]>
  creating:           boolean
  createError:        string | null

apiKeysSlice
  list:            ApiKey[]        // metadata only, never the secret
  newlyCreatedKey: string | null   // shown once, then cleared
  loading:         boolean         // true while the list is (re)fetching
  creating:        boolean
  error:           string | null
```

Async thunks: `fetchCurrentUser`, `logout`, `fetchProjects`, `selectProject`,
`createFinding`, `fetchRecentTickets`, `fetchApiKeys`, `createApiKey`,
`revokeApiKey`.

## Data flow

```mermaid
flowchart LR
  Component -->|dispatch thunk| Thunk
  Thunk -->|request via typed client| Backend
  Backend -->|json| Thunk
  Thunk -->|fulfilled or rejected| Slice
  Slice -->|new state| Store
  Store -->|useSelector| Component
```

Selecting a project dispatches `selectProject`, which sets
`selectedProjectKey` and triggers `fetchRecentTickets` for that project.
Creating a finding, on success, refreshes the recent tickets for the selected
project so the new ticket appears.

`CreateFindingForm` is built dynamically from the selected project's
`createmeta` (delivered with the project list). It always shows Title and
Description (both required, marked with a red `*`), adds every field the project
marks required, and adds a curated set of important optional fields when the
project exposes them (priority, labels, assignee, due date, components), each
labelled `(optional)`. Text fields render as inputs, date fields as a native date
picker (only a valid `yyyy-MM-dd` is submitted, so a stale draft value the picker
cannot display is never sent), enum fields as fuzzy-search `FuzzySelect`
comboboxes of their `allowedValues`, labels as a tag input, and the assignee
(user) field as a `FuzzySelect` of the project's assignable users (with a loading
spinner while they fetch). That list comes from `GET /api/projects/:key/assignees`,
fetched when the project is selected, so only a valid account is ever sent. Required fields must be filled; optional ones may be
left blank.

### Draft persistence

The form never loses the user's work. Field values are saved to `localStorage`
as the user types (debounced), keyed per project: `draft:finding:{projectKey}`.

- On mount or project switch, the form restores any saved draft for that project.
- On a successful create, the draft for that project is cleared.
- On a failed create, the draft stays, so the user can fix and retry without
  retyping (especially the description).
- Drafts are cleared on logout, so they do not linger on a shared machine.
- Only form input is stored (title, description, chosen field values). No tokens,
  session, or other secrets ever go to `localStorage`.

## API calls

All calls go through a typed Hono RPC client, `hc<AppType>(baseUrl)` from
`hono/client`, where `AppType` is imported from the backend. Request and response
types are inferred end to end with no codegen and no generated client, so a route
change is a compile error here. The client sends credentials (the session
cookie) with each request. Each thunk wraps one typed call.

| Call               | Method and path                              |
| ------------------ | -------------------------------------------- |
| fetchCurrentUser   | GET /api/me                                  |
| logout             | POST /auth/logout                            |
| fetchProjects      | GET /api/projects                            |
| fetchAssignees     | GET /api/projects/:key/assignees             |
| createFinding      | POST /api/tickets                            |
| fetchRecentTickets | GET /api/tickets?projectKey=...              |
| fetchApiKeys       | GET /api/api-keys                            |
| createApiKey       | POST /api/api-keys `{ name, expiresInDays }` |
| revokeApiKey       | DELETE /api/api-keys/:id                     |

Most calls are wrapped by a thunk; `fetchAssignees` is called directly from
`CreateFindingForm` (into local state) when the selected project changes, not via
a thunk.

A 401 from any call resets `authSlice` to `loggedOut` and redirects to
`/login`, which covers session expiry transparently.

## Styling

A single global stylesheet, `frontend/src/styles/theme.css`, linked from
`index.html`. Our own styling uses no CSS Modules and no CSS-in-JS: this is a Jira
tool, so the theme is built on the Atlassian Design System (ADS) language to feel
native to Jira. (The one exception is `react-select`, which ships its own
emotion-based styles for the comboboxes; it is scoped to those controls and left
largely at its defaults.)

- Design tokens: `:root` custom properties for the ADS neutral palette (`#172B4D`
  text, `#6B778C` subtle, `#DFE1E6` borders, `#FAFBFC` sunken inputs, `#F4F5F7`
  page), the brand blue `#0052CC`, and danger/success colours. Components
  reference the tokens, so the look is consistent and a change is one edit.
- Single light theme: white cards on a lightly tinted page, ADS elevation shadows
  for depth. There is no dark mode.
- Spacing on an 8px base grid; ADS-style 2px input borders that turn blue on
  focus; a custom select caret; lozenge-style ticket keys.
- Typography: Inter (a stand-in for Atlassian Sans), loaded via a Google Fonts
  `<link>` in `index.html`, with the ADS type scale (14px body, bold headings).

Responsive:

- Layout uses CSS Grid and Flexbox with `gap`; no fixed pixel widths for
  containers. Content reflows instead of overflowing.
- Fluid sizing with `clamp()` where it helps, plus a viewport breakpoint that
  collapses the dashboard's two columns into one on narrow screens.

Fast:

- The stylesheet is static CSS extracted into the Vite build, no runtime style
  engine and no style recalculation cost, unlike CSS-in-JS.
- No UI framework dependency to download; one small token-driven stylesheet keeps
  the CSS small.

## Loading and slow requests

Rate limiting is handled automatically on the backend (`ky` retries honoring
`Retry-After`), so the frontend never shows a rate-limit error. What the frontend
sees is simply a request that takes a little longer, and it makes that pleasant
rather than alarming.

- A slim global top progress bar animates while any request is in flight, so the
  app always feels responsive.
- The create button enters a pending state (spinner, disabled) on submit and
  stays there for the whole call, including any backend retry.
- Progressive reassurance, never an error while still working: if the call runs
  longer than a couple of seconds (backend is retrying), the button label
  softens to "Still creating..." instead of failing. No scary message appears
  while the request is pending.
- Every backend fetch shows an explicit loading indicator: the project and
  assignee comboboxes show react-select's built-in spinner while their options
  load, and the recent-tickets and API-key lists show a "Loading…" line on their
  first fetch (a background refresh keeps the previous list, so it never flickers).
- Only if the backend finally gives up (retries exhausted) does a calm,
  actionable message appear ("Jira is busy, please try again"), with the form
  still filled for a one-click retry.

## Form validation

Validation runs in two places with the same limits: live in the UI for feedback,
and authoritatively on the backend for safety. The limits come from the backend
(delivered with the field metadata on `GET /api/projects`), so the two sides
never drift.

Real-time UI validation:

- Validates as the user types (debounced), not only on submit.
- Elegant, colored feedback: a field is neutral until touched, turns a calm
  success color when valid, and a clear error color when invalid, with the
  message directly under the field.
- Title: required, non-empty after trim, max 255 characters. A live character
  counter (for example `240 / 255`) turns amber as it nears the limit and red
  when exceeded.
- Description: max length shown the same way with a counter.
- Required per-project fields (from createmeta) are marked with a required
  indicator and validated the same way.
- The submit button is disabled until the whole form is valid, and shows why it
  is disabled (a short summary) so the user is never stuck without knowing what
  is missing.
- Messages are specific and kind: "Title is required", "Title must be 255
  characters or fewer (currently 268)", not "invalid".

## Error taxonomy

Every error is classified so the message says what happened, whose fault it is,
and what to do next. The UI never shows a raw status code or JSON.

| Case                                    | Class          | Message and behavior                                                                                                                       |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Field invalid (length, required)        | Your input     | Inline, per field, live. Submit stays disabled.                                                                                            |
| Missing project-required field          | Your input     | Name the field: "Severity is required for this project."                                                                                   |
| Session expired (401)                   | Auto-recovered | No error shown. Silent redirect to re-login (see API calls).                                                                               |
| No permission / project gone (403/404)  | Rare race      | Should not happen (picker only lists creatable projects). If it does: "That project is no longer available", and refresh the project list. |
| Jira rejected a field value (400)       | Your input     | Jira's own reason, surfaced verbatim from the backend (e.g. "assignee: Please select a valid user"). Form stays filled.                    |
| Jira rate limited (429)                 | System, auto   | No error shown. Backend retries; UI shows the slow-request loading.                                                                        |
| Jira unreachable / network failed (502) | System, retry  | "We couldn't reach Jira. Please try again." Form stays filled.                                                                             |
| Unexpected (500)                        | System         | "Something went wrong on our side. Please try again."                                                                                      |

The split is deliberate: "your input" errors are fixable by the user and are
shown inline and immediately; "system" errors are not the user's fault and offer
a retry with their work preserved; some cases are handled automatically and show
no error at all.

The client reads the backend's `{ message }` on a failed response and shows it
verbatim, so a specific Jira reason reaches the user instead of a generic line.
Failures are also logged to the console; they are never silently swallowed.

## Intuitive interactions

- Loading states: skeletons while fetching projects and tickets; submit button
  disabled with a spinner while creating. Never a frozen-looking screen.
- Empty states: "No findings reported for this project yet" with a nudge to
  create one, not a blank area.
- Success feedback: after creating a ticket, a toast with the issue key and a
  direct link ("Created NHI-7 ->").
- Do not lose the user's work: on a failed create the form stays filled (also
  persisted to localStorage, see Draft persistence); the description is never
  wiped.
- Prevent double-submit: the button is disabled while pending so a slow network
  cannot create duplicate tickets.
- Recent tickets: clickable, open the Jira issue in a new tab (`target="_blank"`
  with `rel="noopener"`), showing title and relative time ("2 hours ago").
- Project picker: a `FuzzySelect` combobox over every project the user can create
  in (the backend pages through the whole workspace, so the list is complete and
  has no dead options). Typing fuzzy-matches project names or keys, and a spinner
  shows while the list is still loading.
- API key UX: creation takes a name and an "Expires in" choice (presets 1 day,
  30 days, or 12 months, plus a Custom number of days); the raw key is shown
  exactly once with a copy button and an explicit "you will not see this again"
  warning; revoke asks for confirmation (destructive action).
- Show context: the header shows which Jira site or workspace the user is
  connected to and who they are logged in as. Because the app is multi-tenant,
  the user must never be unsure whose Jira they are filing into.
- First-run guidance: a logged-in-but-nothing-yet state that explains the next
  step (pick a project, create a finding).

## Product-thinking through-line

Two things are the strongest evidence of product thinking, and the design leans
on both:

1. The error taxonomy above clearly separates user-fixable input errors from
   system or Jira errors, and words each one specifically. This is the most
   visible signal that the end-user experience was considered.
2. The unhappy paths are designed, not just the happy path: expired session, no
   permission, rate limiting, empty project, and failed create each have a
   defined behavior, so the app feels considered even when things go wrong.
