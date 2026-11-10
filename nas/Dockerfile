# Gearizo NAS job in a container, for running on the NAS itself (always on).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY nas_sync.py nas_preview.py autopost.py settings.py ./
ENV GEARIZO_CONFIG=/config/gearizo.json
# run every 3 minutes, like the Mac's launchd job
CMD ["sh", "-c", "while true; do python /app/nas_sync.py; sleep 180; done"]
