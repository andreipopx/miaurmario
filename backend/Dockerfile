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
# Three models, because which one is right depends on the garment. Measured on
# textured synthetic photos whose holes we know the truth for — "leak" is how much
# of a hole the fabric encloses is left opaque, where 0 is see-through and 1 is the
# bug users reported:
#
#   model                   halter neck   bag handle   arm gap   worst IoU   s/photo
#   u2net                   0.996         0.067        0.540     0.941       1.0
#   isnet-general-use       0.996         0.011        0.025     0.958       1.4
#   birefnet-general-lite   0.028         0.005        0.019     0.999       11.0
#
# isnet-general-use is the default: it solves the arm gap and the bag handle and
# lifts the silhouette everywhere, at the same order of cost. It does **not** solve
# a small enclosed neckline — birefnet-general-lite is the only one that does, and
# it is roughly eight times slower, which is too slow to sit in an upload. So it is
# baked in but not selected: switching is one env var and no network.
#   BG_REMOVAL_MODEL=birefnet-general-lite
# u2net stays as BG_REMOVAL_FALLBACK_MODEL. Whatever the model misses, the eraser
# in the app fixes by hand — that is the part that is actually guaranteed.
#
# Dropping a model to save ~210 MB of image is fine; the app falls back to u2net
# and logs it:
#   docker build --build-arg REMBG_MODELS="u2net isnet-general-use"
ARG REMBG_MODELS="isnet-general-use u2net birefnet-general-lite"
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
