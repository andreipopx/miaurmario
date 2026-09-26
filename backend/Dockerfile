FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt requirements-extras.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-extras.txt

# Bake the rembg models into the image so the first background removal after a
# deploy does not download 180 MB, and so cutting a garment out never needs the
# network. rembg looks in $U2NET_HOME (default ~/.u2net, which would be /root for
# this build step but /home/appuser at runtime), so pin it to a shared,
# world-readable path.
#
# isnet-general-use is the default (BG_REMOVAL_MODEL) because it is markedly
# better at holes enclosed by fabric — a halter neckline, a bag handle, the gap
# between arm and body. Measured on synthetic shapes with known holes:
#
#   model                   hole left opaque   IoU      s/photo (768px, 8 cpu)
#   u2net                   0.61               0.949    1.0
#   u2netp                  0.38               0.971    0.3
#   silueta                 0.56               0.957    0.9
#   isnet-general-use       0.34               0.985    1.4   <- default
#   birefnet-general-lite   0.13               0.993    11.0
#   u2net_cloth_seg         (segments a person, not a flat garment: unusable)
#
# u2net stays baked in as BG_REMOVAL_FALLBACK_MODEL. birefnet-general-lite is the
# quality-over-speed option: ~8x the time per photo, so it is not baked in by
# default, but an operator who wants it can add it here without giving the
# container a network dependency:
#   docker build --build-arg REMBG_MODELS="u2net isnet-general-use birefnet-general-lite"
ARG REMBG_MODELS="isnet-general-use u2net"
ENV U2NET_HOME=/opt/u2net
RUN mkdir -p "$U2NET_HOME" \
    && for model in $REMBG_MODELS; do \
         python -c "import sys; from rembg import new_session; new_session(sys.argv[1])" "$model"; \
       done \
    && chmod -R a+rX "$U2NET_HOME"

# Copy application code
COPY . .

# Create non-root user and storage directory
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
RUN mkdir -p /data/wardrobe /data/uploads && chown -R appuser:appuser /data

# Entrypoint drops to appuser (remapped to PUID/PGID when set); when the
# container is started as a non-root uid (e.g. k8s runAsUser) it execs directly
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# Expose port
EXPOSE 8000

# Run application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
