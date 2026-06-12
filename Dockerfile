# Stage 1: build the React SPA → web/dist
FROM node:22-slim AS webbuild
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

# Stage 2: Python backend serving the API + the built SPA
FROM python:3.13-slim
WORKDIR /srv/finplan

COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi "uvicorn[standard]" jinja2 sqlalchemy httpx python-multipart apscheduler pillow psycopg2-binary

COPY app ./app
COPY --from=webbuild /build/dist ./web/dist

EXPOSE 8000
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000"]
