FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so application edits do not invalidate the pip layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Only the runtime artifacts are copied, so no .env or local database can leak
# into the image.
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

EXPOSE 10000

# Migrations run before the server starts; exec keeps uvicorn as PID 1 so it
# receives Render's stop signal.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
