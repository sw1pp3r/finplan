import pytest


@pytest.fixture(autouse=True)
def _tmp_image_dir(tmp_path, monkeypatch):
    """Каждый тест — своя tmp-папка для скачанных картинок мечт (репо не засоряем)."""
    monkeypatch.setenv("FINPLAN_IMAGE_DIR", str(tmp_path / "wish-images"))
