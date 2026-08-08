"""Картинки покупок (Доска): подобрать или сохранить картинку пользователя.

Автоподбор ищет только public-domain/CC0-фото через Openverse без API-ключа.
Редкие кириллические названия сначала переводятся в английский через MyMemory;
частые предметы и направления обрабатываются локально без дополнительного запроса.
Ручные ссылки и найденные фото скачиваются к нам с SSRF-гардом и сохраняются на диск
(FINPLAN_IMAGE_DIR → раздаётся как /wish-images/...). fetch инъектится → тесты без сети.
"""
import hashlib
import ipaddress
import logging
import re
import socket
from dataclasses import dataclass
from functools import lru_cache
from html import unescape
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import httpx

log = logging.getLogger("finplan.images")

# Ужимаем сохраняемую картинку под размер плиток Доски: меньше вес скачивания,
# памяти GPU и времени декода. Длинная сторона ≤ MAX_IMAGE_EDGE, перекод в JPEG.
MAX_IMAGE_EDGE = 1280


def _downscale(data: bytes) -> bytes:
    """Уменьшить картинку до MAX_IMAGE_EDGE по длинной стороне и пережать в JPEG.
    Если байты не распознались как картинка — вернуть как есть (не роняем сохранение)."""
    try:
        from PIL import Image  # ленивый импорт: если Pillow нет — деградируем мягко
        img = Image.open(BytesIO(data))
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
        img.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))  # только уменьшает, пропорции целы
        out = BytesIO()
        img.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue()
    except Exception as e:  # noqa: BLE001
        log.warning("image downscale failed, keeping original: %s", e)
        return data


MAX_IMAGE_BYTES = 15 * 1024 * 1024  # держать в синхроне с app.api.MAX_IMAGE_BYTES
OPENVERSE_SEARCH_URL = "https://api.openverse.org/v1/images/"
TRANSLATION_URL = "https://api.mymemory.translated.net/get"
IMAGE_USER_AGENT = "finplan/1.0 (personal cash-flow planner)"


@dataclass(frozen=True)
class OpenverseImage:
    id: str
    url: str


_DESTINATIONS = {
    "австрал": "Australia",
    "вьетнам": "Vietnam",
    "греци": "Greece",
    "грузи": "Georgia country",
    "исланд": "Iceland",
    "испан": "Spain",
    "итал": "Italy",
    "кита": "China",
    "коре": "South Korea",
    "португал": "Portugal",
    "тайланд": "Thailand",
    "турци": "Turkey",
    "франци": "France",
    "япони": "Japan",
    "зеланд": "New Zealand",
}
_SUBJECTS = {
    "анализ": "medical laboratory tests",
    "английск": "English language learning",
    "велосипед": "bicycle",
    "гитар": "guitar",
    "дом": "dream home",
    "зуб": "dental care",
    "камер": "camera photography",
    "квартир": "modern apartment",
    "концерт": "live concert",
    "кроват": "bedroom bed",
    "курс": "online learning",
    "лечение челюст": "dental care",
    "машин": "car",
    "мебел": "modern furniture",
    "микрофон": "microphone",
    "ноутбук": "laptop computer",
    "одежд": "fashion clothing",
    "очистител воздуха": "air purifier",
    "пианино": "piano",
    "пылесос": "vacuum cleaner",
    "ремонт": "home renovation",
    "свадьб": "wedding",
    "телефон": "smartphone",
    "холодиль": "refrigerator",
    "кресл": "office chair",
    "наушник": "headphones",
    "телевизор": "television",
}
_CATEGORY_TERMS = {
    "авто": "car",
    "вещ": "consumer products",
    "дом": "modern home",
    "здоров": "healthcare",
    "медицин": "healthcare",
    "образован": "learning",
    "подар": "gift",
    "путешеств": "travel",
    "спорт": "sport",
    "техник": "technology",
}
_LATIN_SUBJECTS = {
    "iphone": "iphone",
    "ipad": "ipad",
    "macbook": "macbook",
    "monitor": "computer monitor",
    "playstation": "playstation",
    "tesla": "tesla car",
}


_CYRILLIC_RE = re.compile(r"[\u0400-\u04ff]")
_TRANSLATION_NOISE = (
    "click here",
    "log in",
    "post comment",
    "read more",
    "sign in",
)


def _clean_english_query(value) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", unescape(value)).strip(" \t\r\n.,:;")
    lowered = cleaned.casefold()
    if (
        not cleaned
        or len(cleaned) > 160
        or _CYRILLIC_RE.search(cleaned)
        or not re.search(r"[a-z]", lowered)
        or any(noise in lowered for noise in _TRANSLATION_NOISE)
    ):
        return None
    return cleaned


def _translation_from_payload(payload) -> str | None:
    """Взять чистый английский вариант из ответа MyMemory, предпочитая проверенные пары."""
    if not isinstance(payload, dict):
        return None
    matches = payload.get("matches")
    if isinstance(matches, list):
        for match in matches:
            if not isinstance(match, dict):
                continue
            try:
                quality = float(match.get("quality") or 0)
                confidence = float(match.get("match") or 0)
            except (TypeError, ValueError):
                quality, confidence = 0, 0
            if quality < 50 or confidence < 0.6:
                continue
            candidate = _clean_english_query(match.get("translation"))
            if candidate:
                return candidate
    response_data = payload.get("responseData")
    if isinstance(response_data, dict):
        try:
            confidence = float(response_data.get("match") or 0)
        except (TypeError, ValueError):
            confidence = 0
        if confidence < 0.6:
            return None
        return _clean_english_query(response_data.get("translatedText"))
    return None


@lru_cache(maxsize=256)
def _translate_to_english_cached(text: str) -> str:
    """Кэшировать только успешный перевод; исключения lru_cache не запоминает."""
    with httpx.Client(timeout=4, follow_redirects=False) as client:
        response = client.get(
            TRANSLATION_URL,
            params={"q": text, "langpair": "ru|en"},
            headers={"User-Agent": IMAGE_USER_AGENT},
        )
        response.raise_for_status()
        translated = _translation_from_payload(response.json())
    if not translated:
        raise ValueError("translation response has no relevant English text")
    return translated


def _default_translate_to_english(text: str) -> str | None:
    """Перевести редкое русское название без ключа; сбой мягко ведёт к fallback-запросу."""
    try:
        return _translate_to_english_cached(text)
    except Exception as exc:  # noqa: BLE001 — переводчик не должен ронять автоподбор
        log.warning("image query translation failed for %r: %s", text, exc)
        return None


def _openverse_queries(
    name: str,
    category: str | None,
    *,
    translate=None,
) -> list[str]:
    """Собрать английские запросы: точный предмет, перевод, затем безопасная категория."""
    haystack = f"{name} {category or ''}".casefold()
    for needle, destination in _DESTINATIONS.items():
        if needle in haystack:
            return [destination]
    for needle, subject in _SUBJECTS.items():
        if needle in haystack:
            return [subject]
    for needle, subject in _LATIN_SUBJECTS.items():
        if needle in haystack:
            return [subject]
    latin_words = re.findall(r"[a-z][a-z0-9+.-]{1,}", haystack)
    if latin_words:
        return [" ".join(latin_words[:8])]

    queries: list[str] = []
    stripped_name = name.strip()
    if stripped_name and _CYRILLIC_RE.search(stripped_name):
        translator = translate or _default_translate_to_english
        try:
            translated = _clean_english_query(translator(stripped_name))
        except Exception as exc:  # noqa: BLE001 — инъецируемый/внешний перевод не валит поиск
            log.warning("image query translation failed for %r: %s", stripped_name, exc)
            translated = None
        if translated:
            queries.append(translated)
    for needle, subject in _CATEGORY_TERMS.items():
        if needle in haystack:
            if subject not in queries:
                queries.append(subject)
            break
    if not queries and stripped_name and not _CYRILLIC_RE.search(stripped_name):
        queries.append(stripped_name)
    return queries


def _openverse_query(name: str, category: str | None, *, translate=None) -> str | None:
    """Первый запрос для обратной совместимости с точечными проверками."""
    queries = _openverse_queries(name, category, translate=translate)
    return queries[0] if queries else None


def _default_openverse_search(query: str) -> list[dict]:
    """Найти небольшую выдачу открытых растровых фото; анонимного лимита хватает личному UI."""
    with httpx.Client(timeout=12, follow_redirects=False) as client:
        response = client.get(
            OPENVERSE_SEARCH_URL,
            params={
                "q": query,
                "page_size": 16,
                "license": "pdm,cc0",
                "mature": "false",
            },
            headers={"User-Agent": IMAGE_USER_AGENT},
        )
        response.raise_for_status()
        payload = response.json()
    results = payload.get("results")
    return results if isinstance(results, list) else []


def find_openverse_images(
    name: str,
    category: str | None,
    current_source: str | None,
    *,
    search=_default_openverse_search,
    translate=None,
) -> list[OpenverseImage]:
    """Вернуть подходящие PD/CC0-результаты, начиная со следующего после текущего."""
    queries = _openverse_queries(name, category, translate=translate)
    if not queries:
        return []
    raw_results = []
    for query in queries:
        try:
            results = search(query)
        except Exception as exc:  # noqa: BLE001 — внешний каталог не должен ронять finplan
            log.warning("Openverse search failed for %r: %s", query, exc)
            continue
        if isinstance(results, list) and results:
            raw_results = results
            break

    candidates: list[OpenverseImage] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        identifier, url = item.get("id"), item.get("url")
        filetype = str(item.get("filetype") or "").casefold()
        if filetype and filetype not in {"jpg", "jpeg", "png", "webp"}:
            continue
        if not isinstance(identifier, str) or not isinstance(url, str):
            continue
        try:
            UUID(identifier)
        except ValueError:
            continue
        if not is_safe_remote_url(url):
            continue
        candidates.append(OpenverseImage(id=identifier, url=url))
    if not candidates:
        return []

    current_id = current_source.removeprefix("ov:") if (current_source or "").startswith("ov:") else None
    current_index = next((i for i, item in enumerate(candidates) if item.id == current_id), -1)
    start = (current_index + 1) % len(candidates)
    return candidates[start:] + candidates[:start]


def _default_bytes_fetch(url: str, *, client: httpx.Client | None = None) -> bytes:
    """Скачать байты картинки: без редиректов (анти-SSRF — иначе 302 на приватный
    хост обходит is_safe_remote_url) и с кэпом размера (анти-DoS)."""
    owns = client is None
    client = client or httpx.Client(
        timeout=20,
        follow_redirects=False,
        headers={"User-Agent": IMAGE_USER_AGENT},
    )
    try:
        with client.stream("GET", url, headers={"User-Agent": IMAGE_USER_AGENT}) as resp:
            if resp.is_redirect:
                raise ValueError(f"redirect not allowed: {resp.headers.get('location')!r}")
            resp.raise_for_status()
            chunks, total = [], 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise ValueError("image too large")
                chunks.append(chunk)
            return b"".join(chunks)
    finally:
        if owns:
            client.close()


def fetch_bytes(url: str, *, fetch=_default_bytes_fetch) -> bytes | None:
    """Скачать байты картинки по URL. None если сеть/URL упали."""
    try:
        return fetch(url)
    except Exception as e:  # noqa: BLE001 — не скачали = картинки нет, не роняем запрос
        log.warning("image download failed for %s: %s", url, e)
        return None


def save_wish_image(directory: str, wish_id: int, data: bytes) -> str:
    """Сохранить байты картинки мечты на диск (имя = id-хеш.jpg), подчистив прежние файлы мечты.
    Хеш-суффикс кэш-бастит и уникален на картинку. Возвращает имя файла."""
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob(f"{wish_id}-*"):
        old.unlink(missing_ok=True)
    data = _downscale(data)  # ужимаем под размер плиток
    name = f"{wish_id}-{hashlib.sha1(data).hexdigest()[:10]}.jpg"
    (d / name).write_bytes(data)
    return name


def same_as_saved_wish_image(image_url: str | None, data: bytes) -> bool:
    """Сравнить скачанный кандидат с текущей локальной картинкой по content hash.

    Openverse может переупорядочить выдачу или показать тот же файл под другим UUID;
    тогда кнопка «Подобрать другую» должна перейти к следующему реальному изображению.
    """
    if not image_url:
        return False
    match = re.search(
        r"/wish-images/(?:demo/)?\d+-([0-9a-f]{10})\.jpg$",
        image_url,
    )
    if not match:
        return False
    digest = hashlib.sha1(_downscale(data)).hexdigest()[:10]
    return digest == match.group(1)


def _ip_blocked(ip) -> bool:
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified)


def is_safe_remote_url(url: str, *, resolve=socket.getaddrinfo) -> bool:
    """Защита от SSRF: только http(s), и КАЖДЫЙ адрес, в который резолвится хост,
    должен быть публичным. Раньше проверялся лишь текстовый host как литеральный IP —
    числовые формы (2130706433 / 0x7f000001 / 127.1) и internal-DNS-имена
    (metadata.google.internal) обходили гард, хотя ОС резолвит их в loopback/метадату
    (#26/#27). Теперь резолвим сами и валидируем результат; не резолвится → не рискуем."""
    try:
        u = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower()
    if not host or host == "localhost":
        return False
    # литеральный IP (dotted/colon) — проверяем напрямую
    try:
        return not _ip_blocked(ipaddress.ip_address(host))
    except ValueError:
        pass  # не литеральный IP — резолвим имя/числовую форму через ОС
    try:
        infos = resolve(host, None)
    except Exception:  # noqa: BLE001 — не резолвится: internal-only имя или офлайн → блок
        return False
    if not infos:
        return False
    for info in infos:
        addr = info[4][0].split("%")[0]  # отрезаем zone-id у link-local IPv6
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if _ip_blocked(ip):
            return False
    return True


def is_real_image(data: bytes) -> bool:
    """True, только если байты декодируются как растровая картинка (Pillow.verify).
    Защищает от content-confusion: не-картинку (HTML/SVG/exec) не сохраняем и не отдаём (#28/#29)."""
    if not data:
        return False
    try:
        from PIL import Image
        with Image.open(BytesIO(data)) as img:
            img.verify()
        return True
    except Exception:  # noqa: BLE001
        return False
