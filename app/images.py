"""Картинки мечт (Доска): сохранить на сервер картинку, заданную пользователем.

Картинку мечте задаёт сам пользователь — ссылкой (мы её скачиваем) или загрузкой файла.
Здесь только: безопасное скачивание по URL (SSRF-гард) и сохранение байтов на диск
(FINPLAN_IMAGE_DIR → раздаётся как /wish-images/...). fetch инъектится → тесты без сети.
"""
import hashlib
import ipaddress
import logging
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

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


def _default_bytes_fetch(url: str, *, client: httpx.Client | None = None) -> bytes:
    """Скачать байты картинки: без редиректов (анти-SSRF — иначе 302 на приватный
    хост обходит is_safe_remote_url) и с кэпом размера (анти-DoS)."""
    owns = client is None
    client = client or httpx.Client(timeout=20, follow_redirects=False)
    try:
        with client.stream("GET", url) as resp:
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


def is_safe_remote_url(url: str) -> bool:
    """Грубая защита от SSRF: только http(s) и не приватный/локальный хост."""
    try:
        u = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower()
    if not host or host == "localhost":
        return False
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return False
    except ValueError:
        pass  # это hostname, не IP — допускаем (внешние хосты картинок)
    return True
