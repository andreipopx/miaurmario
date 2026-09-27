# Contributing to Miaurmario

Miaurmario is a small, opinionated project with one maintainer. Bug reports and
pull requests are welcome; so is forking it and taking it somewhere else, which
is how this project itself started.

Before you build something large, open an issue first. The product has a fairly
specific point of view — Spanish first, mobile first, a cat with opinions — and
it is kinder to find out early that a feature does not fit than after you have
written it.

## Getting it running

See [Quick start](README.md#quick-start) in the README for the Docker route.
For working on the code directly:

```bash
git clone https://github.com/andreipopx/miaurmario.git
cd miaurmario
cp .env.example .env          # then fill in what you need
```

You need Docker, **Node 24** and **Python 3.11** — those are the versions CI
uses, and the frontend will not typecheck on older TypeScript toolchains.

The usual loop is Postgres and Redis in Docker, and the app processes on the
host:

```bash
docker compose up -d postgres redis

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-test.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Worker (separate shell, same venv)
arq app.workers.worker.WorkerSettings

# Frontend (separate shell)
cd frontend
npm ci
npm run dev
```

Optional install hooks so the checks run before you commit:

```bash
pip install pre-commit && pre-commit install
```

## Branching

Branch off `main`. Name the branch for what it does:

- `feat/<thing>` — new behaviour
- `fix/<thing>` — a bug
- `docs/<thing>`, `chore/<thing>`, `test/<thing>`, `refactor/<thing>`

Longer efforts are assembled on an integration branch (`integ/vN`) and merged
into `main` in one go. You do not need to do that for a single change.

Never push to `main` directly.

## Checks that must pass

CI (`.github/workflows/ci.yml`) runs all of these on every pull request. Run
them locally before you push — they are quick, and the frontend build is the one
that catches the most.

```bash
# Backend (from backend/)
ruff check .
ruff format --check .
pytest

# Migrations (from the repo root)
python backend/scripts/check_migration_heads.py

# Frontend (from frontend/)
npm run lint
npx tsc --noEmit
npm test
npm run build
```

There is no `npm run typecheck` script. Use `npx tsc --noEmit`, which is what
CI and the pre-commit hook both do.

CI also builds both Docker images without pushing them.

### Backend tests

`pytest` needs Postgres and Redis. Point it at a database that is **not** your
development one — the suite creates and drops schema:

```bash
export TEST_DATABASE_URL=postgresql+asyncpg://wardrobe:wardrobe@localhost:5432/wardrobe_test
export REDIS_URL=redis://localhost:6379/0
export SECRET_KEY=test-secret-key
export STORAGE_PATH=/tmp/wardrobe
pytest
```

`asyncio_mode = auto` is set in `backend/pytest.ini`, so async tests need no
decorator. Coverage: `pytest --cov=app`.

One test (`test_style_quiz.py::test_frontend_deck_matches_the_backend_catalogue`)
skips itself when there is no frontend checkout beside the backend, because it
cross-checks the style-card ids against `frontend/.../cards.ts`. A skip there is
expected in a backend-only image, not a failure.

### Frontend tests

Vitest with jsdom and Testing Library:

```bash
npm test          # vitest run
npm run test:watch
```

Note that CI's coverage step calls `npm run test:coverage`, which does not
exist in `package.json`. The step is `continue-on-error`, so it fails quietly.
Do not copy it.

## Database migrations

Alembic, in `backend/migrations/`. Every model change needs one.

```bash
cd backend
alembic revision -m "short description"      # then write the upgrade/downgrade
alembic upgrade head
alembic downgrade -1                         # check it actually reverses
```

Write the migration by hand rather than autogenerating it blind; autogenerate
is happy to drop columns it does not understand.

**There must be exactly one head.** `scripts/check_migration_heads.py` enforces
this in CI, and it fails the moment two branches each add a migration on top of
the same parent. When you rebase, re-point your migration's `down_revision` at
the new tip instead of merging heads.

## Code style

### Python

Ruff is the authority — `ruff check` and `ruff format`, configured in
`backend/pyproject.toml`. Beyond that:

- Type hints on anything public. Modern syntax (`str | None`, `list[str]`).
- Database access is async, all the way down. No sync sessions.
- Business logic lives in `app/services/`, not in the route handler. A route
  handler validates, calls a service, and returns a schema.
- Anything slow or third-party belongs in an arq job under `app/workers/`.
- Every query that touches user data filters by `user_id`. There is no
  ambient "current user" inside the service layer — pass it.

### TypeScript

- Strict mode. `any` needs a comment explaining itself.
- Function components and hooks. Server state goes through TanStack Query;
  local UI state through `useState` or Zustand. Do not put server data in
  Zustand.
- Primitives live in `components/ui/` (shadcn-style, Radix underneath). Reach
  for an existing one before adding a dependency.
- **No hard-coded colours.** Everything is a CSS variable from
  `app/globals.css`, so the palette can be swapped in one file and dark mode
  keeps working. See [`frontend/DESIGN-SYSTEM.md`](frontend/DESIGN-SYSTEM.md).
- **No hard-coded user-facing strings.** Every string goes through `next-intl`,
  in **both** `frontend/messages/es.json` and `frontend/messages/en.json`.
  Spanish is the default locale and the one to get right first: write what a
  person would actually say, not a translation of the English.
- It has to work at 320 px wide and at 125 % font size, with nothing scrolling
  sideways. `frontend/scripts/responsive-audit.mjs` checks this with Playwright.

## Commits

Conventional commits, with a scope, and a subject that says what changed rather
than which files moved:

```
feat(eraser): zoom into the photo, and wipe a whole hole at once
fix(review): stop the bulk pass losing work it says it saved
docs(readme): describe the app this actually is
```

Types in use: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`, `test`, `ci`,
`style`, `build`.

Write a body when the change deserves one. Explain why, and what you rejected —
several commits in this repo are worth reading as a record of a decision.

If an AI assistant co-wrote the change, say so in a trailer:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Pull requests

Fill in [the template](.github/PULL_REQUEST_TEMPLATE.md). For anything that
changes the UI, attach a screenshot at phone width — that is the size almost
every user is on.

Keep the PR to one thing. A green CI run and a diff a person can hold in their
head will get merged; a 4,000-line branch that does five things will sit there.

## Licence

Contributions are accepted under the [MIT Licence](LICENSE), the same terms as
the rest of the project — including the parts inherited from
[Anyesh/wardrowbe](https://github.com/Anyesh/wardrowbe), which this project is a
fork of.
