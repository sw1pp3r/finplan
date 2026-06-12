"""FastAPI app factory: REST API + раздача собранной SPA (web/dist)."""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

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
    demo_engine = make_engine("sqlite://")
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
            return FileResponse(dist_root / "index.html")

    if fx_autofetch:
        from .fx import start_fx_scheduler
        start_fx_scheduler(app)

    return app
