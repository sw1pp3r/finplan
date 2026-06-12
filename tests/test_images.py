"""Картинки мечт: скачивание по URL + сохранение на сервер + SSRF-гард."""
from pathlib import Path

import httpx

from app import images


def _mock_client(handler):
    # follow_redirects=False — как в продакшене после фикса (анти-SSRF)
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_default_fetch_blocks_redirect():
    """302 на приватный хост после прохождения URL-гарда не должен скачиваться."""
    def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
    c = _mock_client(handler)
    assert images.fetch_bytes(
        "http://example.com/a.jpg",
        fetch=lambda u: images._default_bytes_fetch(u, client=c),
    ) is None


def test_default_fetch_rejects_oversize(monkeypatch):
    """Тело больше кэпа → не скачиваем (анти-DoS)."""
    monkeypatch.setattr(images, "MAX_IMAGE_BYTES", 8)
    def handler(request):
        return httpx.Response(200, content=b"X" * 64)
    c = _mock_client(handler)
    assert images.fetch_bytes(
        "http://example.com/a.jpg",
        fetch=lambda u: images._default_bytes_fetch(u, client=c),
    ) is None


def test_default_fetch_happy_path():
    """Нормальная картинка скачивается без изменений."""
    def handler(request):
        return httpx.Response(200, content=b"IMGDATA")
    c = _mock_client(handler)
    assert images.fetch_bytes(
        "http://example.com/a.jpg",
        fetch=lambda u: images._default_bytes_fetch(u, client=c),
    ) == b"IMGDATA"


def test_fetch_bytes_returns_data():
    assert images.fetch_bytes("http://x/y.jpg", fetch=lambda u: b"IMG") == b"IMG"


def test_fetch_bytes_error_returns_none():
    def boom(u):
        raise RuntimeError("net down")

    assert images.fetch_bytes("http://x", fetch=boom) is None


def test_save_wish_image_downscales_large(tmp_path):
    """Большую картинку ужимаем под размер плиток (меньше вес/память/декод)."""
    from io import BytesIO
    from PIL import Image
    big = Image.new("RGB", (3000, 2000), (120, 80, 40))
    buf = BytesIO(); big.save(buf, format="JPEG", quality=92)
    original_bytes = len(buf.getvalue())
    name = images.save_wish_image(str(tmp_path), 7, buf.getvalue())
    saved = Image.open(Path(tmp_path) / name)
    assert max(saved.size) <= 1280                      # длинная сторона ≤ 1280
    assert abs(saved.size[0] / saved.size[1] - 1.5) < 0.05  # пропорции сохранены (3000/2000)
    assert (Path(tmp_path) / name).stat().st_size < original_bytes  # стал легче


def test_save_wish_image_writes_and_cleans(tmp_path):
    d = str(tmp_path / "imgs")
    n1 = images.save_wish_image(d, 5, b"AAAA")
    assert n1.startswith("5-") and n1.endswith(".jpg")
    assert (Path(d) / n1).read_bytes() == b"AAAA"
    n2 = images.save_wish_image(d, 5, b"BBBB")  # другие байты → другой файл, старый подчищен
    assert n2 != n1
    assert len(list(Path(d).glob("5-*"))) == 1


def test_is_safe_remote_url():
    assert images.is_safe_remote_url("https://images.unsplash.com/photo-1.jpg")
    assert images.is_safe_remote_url("http://example.com/x.jpg")
    assert not images.is_safe_remote_url("http://localhost/x")
    assert not images.is_safe_remote_url("http://127.0.0.1/x")
    assert not images.is_safe_remote_url("http://10.0.0.5/x")
    assert not images.is_safe_remote_url("http://169.254.169.254/latest/meta-data")
    assert not images.is_safe_remote_url("file:///etc/passwd")
    assert not images.is_safe_remote_url("not a url")
