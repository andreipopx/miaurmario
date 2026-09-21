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

# Bake the rembg model into the image so the first background removal after a
# deploy does not download 176 MB. rembg looks in $U2NET_HOME (default
# ~/.u2net, which would be /root for this build step but /home/appuser at
# runtime), so pin it to a shared, world-readable path.
ENV U2NET_HOME=/opt/u2net
RUN mkdir -p "$U2NET_HOME" \
    && python -c "from rembg import new_session; new_session('u2net')" \
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
