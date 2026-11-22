# revel8 dashboard sidecar — FastAPI that tails traces and runs the (pure-stdlib)
# agent. The agent package, traces, and .env are mounted at runtime by
# docker-compose, so nothing secret is baked into the image.
FROM python:3.12-slim

WORKDIR /project/sidecar

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# deps only — app.py + the agent come from the compose bind-mounts
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# fallback copy so the image also runs standalone (compose remounts this anyway)
COPY app.py sanitization.py ./

ENV REVEL8_PROJECT_ROOT=/project \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8787

EXPOSE 8787
CMD ["python", "app.py"]
