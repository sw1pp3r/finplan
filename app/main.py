"""FastAPI app factory: REST API + раздача собранной SPA (web/dist)."""
import os
import uuid
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from .api import router as api_router
from .db import init_db, make_engine
from .demo import seed_demo_data


def create_app(
    database_url: str | None = None,
    api_token: str | None = None,
    fx_autofetch: bool = False,
    seed: bool = True,
    image_dir: str | None = None,
) -> FastAPI:
    database_url = database_url or os.environ.get("DATABASE_URL", "sqlite:///./finplan.db")
    api_token = api_token if api_token is not None else os.environ.get("FINPLAN_API_TOKEN") or None
    # папка для скачанных картинок мечт (self-hosted). В проде — смонтированный volume.
    image_dir_path = Path(
        image_dir or os.environ.get("FINPLAN_IMAGE_DIR")
        or (Path(__file__).resolve().parent.parent / "wish-images")
    )
    image_dir_path.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="finplan")
    engine = make_engine(database_url)
    init_db(engine, seed=seed)
    app.state.SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.api_token = api_token
    app.state.image_dir = str(image_dir_path)

    # Демо-режим: отдельная in-memory БД с фейк-данными для показа на расшаренном экране.
    # Роутится по заголовку X-Demo (см. get_db); реальная БД при этом не задействована.
    # Shared-cache + пул отдельных коннектов (а не один StaticPool-коннект): общий коннект
    # ронял sqlite-курсор при конкурентных запросах демо — дашборд шлёт ~8 разом → плавающие
    # 500 (IndexError: tuple index out of range / UNIQUE settings.id). Уникальное имя на инстанс
    # изолирует БД; keepalive-коннект держит shared in-memory живой на весь процесс.
    demo_name = f"finplan_demo_{uuid.uuid4().hex}"
    demo_engine = create_engine(
        f"sqlite:///file:{demo_name}?mode=memory&cache=shared&uri=true",
        connect_args={"check_same_thread": False},
        poolclass=QueuePool,
    )
    app.state._demo_keepalive = demo_engine.connect()
    init_db(demo_engine, seed=True)
    with sessionmaker(bind=demo_engine)() as demo_db:
        seed_demo_data(demo_db)
    app.state.DemoSessionLocal = sessionmaker(bind=demo_engine, expire_on_commit=False)

    app.include_router(api_router)

    # скачанные картинки мечт — раздаём с диска (до SPA catch-all)
    app.mount("/wish-images", StaticFiles(directory=image_dir_path), name="wish-images")

    # SPA: собранный фронт (vite build → web/dist); /api матчится раньше catch-all
    dist = Path(__file__).resolve().parent.parent / "web" / "dist"
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            dist_root = dist.resolve()
            file = (dist_root / path).resolve()
            if path and file.is_file() and file.is_relative_to(dist_root):
                return FileResponse(file)
            # index.html — всегда ревалидировать: иначе браузер по эвристике отдаёт
            # закешированный shell со ссылкой на старый хешированный бандл, который после
            # редеплоя удалён → белый экран. Кнопка «Демо» (location.reload) это вскрывает.
            return FileResponse(dist_root / "index.html", headers={"Cache-Control": "no-cache"})

    if fx_autofetch:
        from .fx import start_fx_scheduler
        start_fx_scheduler(app)

    return app
