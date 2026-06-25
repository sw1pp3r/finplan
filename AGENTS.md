# finplan — repo-local agent rules

Личный cash-flow прогноз (FastAPI + React/shadcn SPA). Полная картина — в [`README.md`](README.md). Tenant-контракт (finplan-net, VPS-пути, деплой) — в корневом [workspace AGENTS.md](../../../AGENTS.md), сюда не дублирую.

## Что это и чем НЕ является

Планировщик cash-flow, **не трекер расходов**. Нет импорта выписок, транзакционного учёта, категоризации трат. Если кто-то просит «добавить импорт банка / автокатегоризацию транзакций» — это смена природы продукта, сперва уточнить у sw1pp3r.

Текущая навигация: **Дашборд** (`/`) · **Баланс** (`/balance`, бывш. Снимок; счета + снимки) · **Доходы** (`/income`, одна лента `inflows`: `expected`→`received`, пайплайн «Ожидается») · **Расходы** (`/expenses`, обязательства + «Ежемесячные расходы» с breakeven, edit/delete/status) · **Мечты** (`/wishes`, список + `?view=board` Доска; желания не влияют на прогноз до promote) · **Ещё** (`/more`, Курс; песочница тарифы − расходы → прибыль/мес, на прогноз НЕ влияет, может скрываться `finplan-show-course=0`) · **Настройки** (`/settings`, профиль/прогноз/курсы/справочники + дубль управления счетами). Старые `/snapshot`, `/plans`, `/board`, `/course` редиректятся на новые маршруты. Доска: full-bleed 12-колоночный грид, `RHYTHM` или ручной `card_size` `small`/`square`/`tall`/`wide`/`large`, Geist вместо Playfair, картинки задаются ссылкой или upload и сохраняются в `/wish-images/...` через `app/images.py` (download+save+SSRF-гард).

**Демо-режим:** тумблер «Демо» → заголовок `X-Demo: 1` → `get_db` отдаёт отдельную in-memory демо-БД (`app/demo.py`), реальные данные не трогаются. Учитывать при отладке: ответ API зависит от заголовка.

**Дропдауны валют:** все `CurrencySelect` тянут список из `/api/rates` через хук `useKnownCurrencies` (модульный кеш + `refreshCurrencies()` после добавления курса/валюты), не из захардкоженного списка.

**Онбординг-тур (коачмарки):** на пустой БД Дашборд показывает чеклист «С чего начать», клик открывает интерактивный оверлей-тур из 5 шагов (валюта→счета→снимок→расходы→доходы; шаг «Курсы валют» убран — тянутся сами). Файлы: `web/src/lib/coach.ts` (стор + `COACH_STEPS`), `components/CoachTour.tsx` (оверлей, раскладка, движение, конфетти), `components/OnboardingChecklist.tsx`, хуки в `index.css`. Цели помечены `data-coach="…"` в страницах/компонентах (Settings/AccountsManager/Snapshot/Plans/Income) — список целей нельзя менять, не трогая те файлы. Оверлей **кликабелен насквозь** (`pointer-events:none` + `z-40` ниже дропдаунов `z-50`) — контрол заполняется прямо в туре. Полная дока: [`docs/onboarding-coachmark.md`](docs/onboarding-coachmark.md).

## Рабочий цикл (TDD обязателен для логики)

```bash
.venv/bin/python -m pytest -q          # сейчас: 151 tests collected (forecast, course, api, fx, demo, images, audit-регрессии)
cd web && npx vitest run               # сейчас: 6 files / 32 tests passed
cd web && npm run build                # пересобрать SPA перед проверкой в браузере
```

- **Движок прогноза** (`app/forecast.py`) и **API** — только через TDD (тест → red → green). Тесты в `tests/`.
- **Онбординг-тур (`CoachTour.tsx`)** — регресс-гейт через browser-E2E в `docs/shots/` (см. [`docs/onboarding-coachmark.md`](docs/onboarding-coachmark.md) → «Автотесты»): `coach-visual-e2e` (рамка на цели), `coach-reflow-check` (рамка догоняет форму под троттлингом API), `coach-realclick-check` (живые кнопки — настоящим кликом), `fill-e2e` (сквозной путь). Гонять при правке тура.
- **Фронт** проверять в браузере: пересобрать `web/`, открыть, **хард-релоад с очисткой кеша** (иначе грузится старый бандл — у Vite хеш в имени, но index.html кешируется браузером).
- Локальный прогон: `DATABASE_URL=sqlite:///./demo.db FINPLAN_FX_AUTOFETCH=0 .venv/bin/python -m uvicorn app.asgi:app --port 8741`.
- ⚠️ Запускаем без `--reload`: **после правки `app/*.py` перезапусти uvicorn** — иначе процесс держит старый код, API отдаёт старую схему, и фронт может упасть (`Object.values(undefined)`) на отсутствующем поле. Фронт (`web/dist`) раздаётся с диска, ребилда достаточно; бэкенд требует рестарта.

## Деплой

GH Actions на push в `main` (тесты → scp → docker build → up → health). Боевой доступ только из Tailscale: `http://localhost:8742`. После пуша: `gh run watch <id> --repo sw1pp3r/finplan`. Проверка живости: `curl http://localhost:8742/api/summary`.

**Картинки мечт:** в `docker-compose.yml` volume `finplan-images:/srv/finplan/wish-images` + `FINPLAN_IMAGE_DIR` — картинки (по ссылке/загрузке файла) переживают редеплой. (Unsplash-поиск убран — `UNSPLASH_ACCESS_KEY` в прод-`.env` больше не используется, можно удалить.)

Не коммить/пушить без явной просьбы. Ветка main — деплоит сразу.

## Опасные зоны / известные грабли

- **Миграции** в `app/db.py` (`_ensure_columns`, `init_db`) — выполняются при старте контейнера на боевом Postgres. Любое изменение модели проверять и на SQLite (тесты), и мысленно на Postgres (длины varchar, ALTER TYPE).
- **varchar валют** — держать ≥12 (USDT и тикеры длиннее 3). SQLite длину не enforce-ит, Postgres рубит.
- **React-формы**: ссылку на форму брать **до** `await` (`const f = e.currentTarget`); после await `e.currentTarget` = null.
- **Две `<form>` в тернаре** (тумблер на Доходах): давать разный `key` на каждой ветке, иначе React морфит инпуты по позиции и тащит старое значение (date → text с прилипшей датой).
- **RefCombo**: custom-режим — отдельный стейт, не выводить из текста.
- **Коачмарк-оверлей**: должен оставаться `pointer-events:none` + `z-40` (ниже `z-50` дропдаунов shadcn) — иначе тур снова начнёт глотать клики или прятать открытые списки за затемнением. Карточка тура не должна пересекать `[data-coach-spotlight]` и обязана быть в вьюпорте на 1440 и 768 (раскладка в `CoachTour.tsx:layout()` это гарантирует подрезкой подсветки для высоких целей). Менять — сверяться с матрицей в [`docs/onboarding-coachmark.md`](docs/onboarding-coachmark.md).
- Не удалять `*.db` при запущенном uvicorn (станет readonly → 500).

### Инварианты после аудита-ремедиации (2026-06-15) — не регрессировать

Полная карта: [`docs/audit/finplan-remediation.md`](docs/audit/finplan-remediation.md) (31 находка → фикс → файл → before/after + верификация + деплой). Регресс-тесты: `tests/test_audit_regressions.py`, `web/src/test/aggregates.test.ts`, `web/src/test/dashboard-period.test.tsx`. Ключевое:

- **Валидация схем (`app/api.py`):** суммы `Amount = Field(gt=0)`; строки с `max_length` под колонки БД (`Currency`≤12, `Name80/120`, `Note`≤300, `ImageUrl`≤500, `ImageSource`≤40); `horizon_days` `Field(ge=7, le=730)`. Новые поля заводить через эти аннотации — иначе вернётся паритет-баг SQLite↔Postgres и фантомные суммы.
- **PATCH-хендлеры** используют `model_dump(exclude_unset=True)` (не `exclude_none`) — явный `null` очищает nullable-поле. Не возвращать `exclude_none`.
- **SSRF-гард `is_safe_remote_url` (`app/images.py`)** резолвит host и валидирует ВСЕ адреса (числовые формы и internal-DNS блокируются; не-резолв → блок). Картинки (фетч и upload) проходят `is_real_image` перед сохранением. Не доверять `content_type`, не отключать резолв.
- **Прогноз (`app/forecast.py`):** `_to_base` через `rates.get(cur, 0)` (валюта без курса = 0, не KeyError). `_occurrences` для серий не складывает все просрочки. `_derive_burn` вычитает запланированные обязательства, наступившие В ОКНЕ снимков (НЕ будущие — иначе сломается демо-кривая `test_demo_forecast_saws`, см. авто-память `finplan-burn-double-count-fix`).
- **Breakeven (`app/service.py`):** при `burn_source=="derived"` `required = max(monthly_obligations, burn_monthly)` (не сумма — двойной счёт). При manual/none — прежняя сумма (от этого зависят тесты).
- **`/api/summary` принимает `horizon`** — дашборд шлёт выбранный период И в `/summary`, И в `/forecast`, чтобы карточки и график были на одном окне. PERIODS «6 месяцев» = 180 = `settings.horizon_days` по умолчанию.

## Документация: что читать первым

- [`README.md`](README.md) — публичная картина продукта, локальный запуск, API, деплой.
- [`docs/current-state.md`](docs/current-state.md) — актуальный снимок состояния на 2026-06-20: маршруты, модули, проверки, деплой, backlog.
- [`docs/onboarding-coachmark.md`](docs/onboarding-coachmark.md) — инварианты коачмарка и browser-E2E матрица.
- [`docs/audit/2026-06-18-finplan-ui-ux-audit.md`](docs/audit/2026-06-18-finplan-ui-ux-audit.md) — последний UI/UX audit -> remediation -> deploy log.
- [`docs/audit/2026-06-18-finplan-quality-audit.md`](docs/audit/2026-06-18-finplan-quality-audit.md) — последний backend/API quality audit и оставшийся backlog.
- [`docs/audit/finplan-remediation.md`](docs/audit/finplan-remediation.md) — полная карта ранней remediation: 31 находка → фикс → verification.

## Редизайн v2 (частично внедрён, 2026-06-14+)

Полный редизайн UI (понятнее + теплее-современнее + полноценный онбординг) уже частично вошёл в React: боковая навигация, новые имена разделов, тёплые токены, тёмная тема, полноэкранный onboarding wizard, демо-персона Артём, `Мечты` как список/доска, `Ещё` для курса. Дизайн **сделан** в Codex.ai/design (через скилл `auteur`): 8 экранов-макетов лежат в **`designs/*.html`** (источник истины по визуалу). Полная visual parity по всем макетам и browser-матрице ещё не закрыта:

- Рубрика внедрения: [`docs/superpowers/specs/2026-06-14-finplan-redesign-implementation.md`](docs/superpowers/specs/2026-06-14-finplan-redesign-implementation.md) (токены, IA/роуты, экран-за-экраном, тесты, Definition of Done).
- Дизайн-направление: [`docs/superpowers/specs/2026-06-14-finplan-redesign-master.md`](docs/superpowers/specs/2026-06-14-finplan-redesign-master.md). Бриф: `…-redesign-design.md`.
- Готовый goal-prompt под ключ: [`docs/superpowers/specs/2026-06-14-finplan-redesign-goal.md`](docs/superpowers/specs/2026-06-14-finplan-redesign-goal.md).

Ключевые решения: навигация **Дашборд · Баланс (бывш. Снимок) · Доходы · Расходы · Мечты (Покупки+Доска) · Ещё (Курс) · Настройки**; тёплая палитра (терракота-акцент, не бежевая бумага) + тёмная тема; график со сценариями/подушкой/минус-зоной + дропдаун периода; онбординг = демо-витрина + мастер 5 шагов; демо-персона = AI Builder Артём. Тон профессиональный, без инфантильности.

## Что ещё не сделано (на случай запроса)

- Полная v2 visual parity с `designs/*.html`: нужен свежий browser-прогон 1440/768, светлая/тёмная тема, все разделы + onboarding, с вердиктом по Definition of Done из `docs/superpowers/specs/2026-06-14-finplan-redesign-implementation.md`.
- Общий frontend API error UX: сейчас часть mutation handlers всё ещё может падать только в console; нужен единый toast/banner/helper и Vitest на представительном сценарии.
- Bundle split: `npm run build` проходит, но Vite предупреждает о большом main chunk; позже стоит lazy-load тяжёлые страницы/графики.
- What-if линия «если купить всё из покупок» на дашборде — обсуждалась, не сделана.
