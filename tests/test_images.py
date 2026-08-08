"""Картинки мечт: скачивание по URL + сохранение на сервер + SSRF-гард."""
from pathlib import Path

import httpx
import pytest

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


def test_default_fetch_identifies_finplan_to_image_hosts():
    """Wikimedia и часть CDN режут безымянные backend-запросы через 403."""
    seen = {}

    def handler(request):
        seen["user_agent"] = request.headers.get("user-agent")
        return httpx.Response(200, content=b"IMGDATA")

    c = _mock_client(handler)
    assert images._default_bytes_fetch("https://example.com/a.jpg", client=c) == b"IMGDATA"
    assert seen["user_agent"].startswith("finplan/")


def test_openverse_search_simplifies_common_product_model():
    seen = {}

    def search(query):
        seen["query"] = query
        return []

    assert images.find_openverse_images("MacBook Pro M4 Max", "Техника", None, search=search) == []
    assert seen["query"] == "macbook"


@pytest.mark.parametrize(
    ("name", "expected_query"),
    [
        ("Новая кровать", "bedroom bed"),
        ("Сходить на концерт", "live concert"),
        ("Курс английского", "English language learning"),
    ],
)
def test_openverse_search_translates_common_russian_wishes(name, expected_query):
    seen = {}

    def search(query):
        seen["query"] = query
        return []

    assert images.find_openverse_images(name, None, None, search=search) == []
    assert seen["query"] == expected_query


def test_openverse_search_translates_unknown_russian_purchase():
    seen = {"queries": []}

    def search(query):
        seen["queries"].append(query)
        return []

    def translate(text):
        seen["translation_input"] = text
        return "air purifier"

    assert images.find_openverse_images(
        "Очистители воздуха",
        "Вещи",
        None,
        search=search,
        translate=translate,
    ) == []
    assert seen == {
        "translation_input": "Очистители воздуха",
        "queries": ["air purifier", "consumer products"],
    }


def test_openverse_search_never_sends_cyrillic_when_translation_fails():
    seen = []

    assert images.find_openverse_images(
        "Совершенно неизвестная покупка",
        None,
        None,
        search=lambda query: seen.append(query) or [],
        translate=lambda _text: None,
    ) == []
    assert seen == []


def test_openverse_search_uses_english_category_when_translation_fails():
    seen = []

    assert images.find_openverse_images(
        "Совершенно неизвестная покупка",
        "Здоровье",
        None,
        search=lambda query: seen.append(query) or [],
        translate=lambda _text: None,
    ) == []
    assert seen == ["healthcare"]


def test_translation_payload_prefers_quality_match_and_rejects_web_ui_noise():
    payload = {
        "responseData": {
            "translatedText": "Log in to post comments Trip to Japan",
            "match": 0.99,
        },
        "matches": [
            {
                "translation": "Log in to post comments Trip to Japan",
                "quality": "0",
                "match": 0.99,
            },
            {
                "translation": "Trip to Japan",
                "quality": "74",
                "match": 0.96,
            },
        ],
    }

    assert images._translation_from_payload(payload) == "Trip to Japan"


def test_translation_payload_rejects_low_confidence_match():
    payload = {
        "responseData": {"translatedText": "Random product", "match": 0.2},
        "matches": [
            {"translation": "Unrelated appliance", "quality": "74", "match": 0.1},
        ],
    }

    assert images._translation_from_payload(payload) is None


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
