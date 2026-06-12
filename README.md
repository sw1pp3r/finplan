# finplan

A self-hosted **cash-flow planner** — not an expense tracker. finplan answers one
question: *will my balance clear my cushion over the planning horizon, and if not,
where is the gap and how big is it?*

You enter where you stand today (a **snapshot**), what you owe in the future
(**obligations**), and what you expect to receive (**inflows**). finplan projects
your balance forward and shows the curve, three scenarios, and any shortfall.

- **Single-container deploy:** FastAPI backend + a React/Tailwind SPA in one image.
- **Standalone:** SQLite by default, no external services required. PostgreSQL optional.
- **Private by design:** no telemetry, no analytics. The only outbound request is an
  optional once-a-day FX-rate fetch, which is **off by default**.
- **Multi-currency** with a base currency and daily-or-manual FX rates.

> The UI is currently in Russian. The data model and this README are documented in
> English; translations are welcome.

---

## Quick start (one command)

You need Docker with the Compose plugin.

```bash
git clone https://github.com/sw1pp3r/finplan.git
cd finplan
docker compose up -d --build
```

Open **http://localhost:8742**. On first load an in-app onboarding walks you through
the model and the setup steps. Your data lives in Docker volumes (`finplan-data`,
`finplan-images`) and survives restarts and redeploys.

That's it — no `.env` needed. To customize (Postgres, FX fetch, an API token), copy
`.env.example` to `.env` and edit, then `docker compose up -d` again.

---

## How the numbers work

finplan is a forecast engine, not a ledger. There is no bank import and no transaction
categorization — you maintain a few small, deliberate inputs and it does the projection.

- **Snapshot → starting point (T0).** On the *Снимок* (Snapshot) tab you record the
  current balance of each account. The most recent snapshot is **T0**, where the
  forecast starts. Several snapshots over time yield a **burn rate** — how fast the
  balance drains per week.
- **Inflows → expected income.** On *Доходы* (Income) you list future receipts
  (invoices, salary, payments). While marked *expected* they lift the forecast curve on
  their date. When the money lands you flip the row to *received*, and it is already
  reflected in your next snapshot.
- **Obligations → future outflows.** On *Расходы* (Expenses) you list rent, taxes,
  subscriptions, one-off payments. One-offs subtract on their date; recurring ones
  (weekly / monthly / yearly) subtract on every date through the horizon.
- **Forecast and gap.** The *Дашборд* (Dashboard) projects the balance forward:
  `T0 − burn − obligations + expected inflows`. If the curve dips below your **cushion**,
  finplan reports the **gap** — how much is missing and by when. Three scenarios
  (pessimistic / base / optimistic) weight inflows by their probability.

There is also a sandbox to model course/product economics and a visual **wish board** —
neither affects the forecast unless you promote a wish into an obligation.

A built-in **demo mode** (toggle in the header) shows the app with realistic sample data
in a separate in-memory database; your real data is never touched.

---

## Configuration

All optional — see `.env.example`. Highlights:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:////data/finplan.db` | SQLite file (on a volume) or a Postgres URL |
| `FINPLAN_FX_AUTOFETCH` | `0` | `1` enables a daily FX fetch from open.er-api.com. Off = no outbound network |
| `FINPLAN_API_TOKEN` | empty | If set, `/api/*` requires `Authorization: Bearer <token>` |
| `FINPLAN_IMAGE_DIR` | `/srv/finplan/wish-images` | Where wish-board images are stored |

**PostgreSQL instead of SQLite:** point `DATABASE_URL` at your database, e.g.
`postgresql+psycopg2://USER:SECRET@HOST:5432/finplan`. Schema is created automatically
on startup (lightweight migrations, no Alembic needed).

---

## Updating

The release workflow publishes a Docker image to GHCR on every push to `main`. To update
a running deployment to the latest published image:

```bash
docker compose pull
docker compose up -d
```

Your volumes (data and images) are preserved across updates.

To pin a specific build instead of `latest`, set the image tag in `docker-compose.yml`
to a commit SHA or release tag published by the workflow.

---

## Development (without Docker)

Backend (Python 3.12+):

```bash
python -m venv .venv && . .venv/bin/activate
pip install fastapi "uvicorn[standard]" jinja2 sqlalchemy httpx python-multipart apscheduler pillow pytest
pytest -q                                   # run the test suite
DATABASE_URL=sqlite:///./dev.db FINPLAN_FX_AUTOFETCH=0 uvicorn app.asgi:app --port 8741
```

Frontend (Node 20+):

```bash
cd web
npm install
npm run build        # outputs web/dist, served by the backend
# or: npm run dev    # Vite dev server with hot reload
```

The backend serves the built SPA from `web/dist`, so `npm run build` then start uvicorn,
or run the Vite dev server alongside it.

---

## Privacy

finplan is built to run on your own machine or private server and to keep your financial
data yours. It ships **no telemetry and no analytics**. The single optional outbound
request is the daily FX-rate fetch, disabled by default (`FINPLAN_FX_AUTOFETCH=0`). With
it off, the app makes no network calls at all.

## License

MIT — see [LICENSE](LICENSE).
