"""Entry-point: uvicorn app.asgi:app"""
import os

from .main import create_app

app = create_app(fx_autofetch=os.environ.get("FINPLAN_FX_AUTOFETCH", "1") == "1")
