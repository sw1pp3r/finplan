import os

import pytest


def test_db_url() -> str:
    """Database under test. In-memory SQLite by default; set TEST_DATABASE_URL to a
    Postgres URL (CI does this) so the suite runs against the same engine as production."""
    return os.environ.get("TEST_DATABASE_URL", "sqlite://")


@pytest.fixture(autouse=True)
def _tmp_image_dir(tmp_path, monkeypatch):
    """Каждый тест — своя tmp-папка для скачанных картинок мечт (репо не засоряем)."""
    monkeypatch.setenv("FINPLAN_IMAGE_DIR", str(tmp_path / "wish-images"))


@pytest.fixture(autouse=True)
def _reset_db():
    """On a real database (Postgres in CI) drop the schema before each test so tests
    stay isolated. In-memory SQLite is fresh per create_app(), so this is a no-op there."""
    url = test_db_url()
    if not url.startswith("sqlite"):
        from app.db import Base, make_engine

        engine = make_engine(url)
        Base.metadata.drop_all(engine)
        engine.dispose()
    yield
