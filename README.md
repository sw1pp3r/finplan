# finplan

**English** · [Русский](README.ru.md)

A self-hosted **cash-flow planner** — not an expense tracker. finplan answers one
question: *will my balance clear my cushion over the planning horizon, and if not,
where is the gap and how big is it?*

You enter where you stand today (a **snapshot**), what you owe in the future
(**obligations**), and what you expect to receive (**inflows**). finplan projects
your balance forward and shows the curve, three scenarios, and any shortfall.

- **Compose deploy:** FastAPI backend + a React/Tailwind SPA in one image, plus PostgreSQL.
- **Production parity:** bundled **PostgreSQL** by default — the same engine the app is
  tested and run against, so there are no SQLite-vs-Postgres surprises. SQLite stays
  available for a minimal single-file setup.
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

This starts **PostgreSQL and the app**. Open **http://localhost:8742**. On first load an
in-app onboarding walks you through the model and the setup steps. Your data lives in
Docker volumes (`finplan-db`, `finplan-images`) and survives restarts and redeploys.

That's it — no `.env` needed for a private/local run. To customize (your own DB
credentials, an external database or SQLite, FX fetch, an API token), copy
`.env.example` to `.env` and edit, then `docker compose up -d` again.

---

## How the numbers work

finplan is a forecast engine, not a ledger. There is no bank import and no transaction
categorization — you maintain a few small, deliberate inputs and it does the projection.

- **Snapshot → starting point (T0).** On the *Баланс* (Balance) tab you record the
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

## Sections

The app is a sidebar of focused tabs:

- **Дашборд** (Dashboard) — the balance curve with three scenarios, a cushion line and a
  negative zone, a period selector (2 weeks … 1 year), and headline cards: runway,
  balance, income/month, free/month.
- **Баланс** (Balance) — record the current balance of each account; the latest entry is T0.
- **Доходы** (Income) — expected and received money in one feed (*expected* lifts the
  forecast; *received* is already in your balance).
- **Расходы** (Expenses) — obligations (rent, taxes, subscriptions, one-offs) normalized to
  a monthly figure, plus a break-even ("how much must I earn per month").
- **Мечты** (Wishes) — a list and an expressive **board**; each dream is tagged
  *по карману / впритык / не хватает* against your free headroom.
- **Ещё** (More) — an optional sandbox to model course/product economics; it never affects
  the forecast.
- **Настройки** (Settings) — base currency, FX rates, cushion, planning horizon, accounts, profile.

A first-run **onboarding wizard** walks you through setup, and a **dark theme** is available.

---

## Configuration

All optional — see `.env.example`. Highlights:

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `finplan` | Credentials for the bundled PostgreSQL; the app's `DATABASE_URL` is derived from them |
| `DATABASE_URL` | bundled Postgres | Override to point at an external database, or SQLite |
| `FINPLAN_FX_AUTOFETCH` | `0` | `1` enables a daily FX fetch from open.er-api.com. Off = no outbound network |
| `FINPLAN_API_TOKEN` | empty | If set, `/api/*` requires `Authorization: Bearer <token>` |
| `FINPLAN_IMAGE_DIR` | `/srv/finplan/wish-images` | Where wish-board images are stored |

The schema is created automatically on startup (lightweight migrations, no Alembic
needed). **External database:** set `DATABASE_URL` to your own Postgres, e.g.
`postgresql+psycopg2://USER:SECRET@your-host:5432/finplan`. **Minimal SQLite setup:** set
`DATABASE_URL=sqlite:////data/finplan.db` and mount a volume at `/data` — handy for a
quick single-file trial, though PostgreSQL is recommended to match production.

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
