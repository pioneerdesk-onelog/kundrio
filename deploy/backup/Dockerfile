# Backup-Image: pg_dump 17 + age (Verschlüsselung) + rclone (S3-kompatibel, z. B. STACKIT Object Storage)
# Alles aus den Debian-Paketquellen – keine Fremd-Downloads im Build.
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends age rclone ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backup.sh restore.sh s3env.sh schedule.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/schedule.sh && useradd --system --uid 1001 --create-home pdbackup
USER pdbackup
ENTRYPOINT ["/usr/local/bin/backup.sh"]
