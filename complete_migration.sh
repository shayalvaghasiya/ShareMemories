#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "========================================================"
echo "  ShareMemories Complete Migration & Backup Script"
echo "========================================================"

BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="sharememories_migration_${BACKUP_DATE}.tar.gz"
DB_BACKUP_FILE="wedding_db_backup.sql"

# 1. Backup the Database
echo "[1/3] Backing up PostgreSQL database..."
# Ensure the container is running before attempting to dump
if [ "$(docker inspect -f '{{.State.Running}}' wedding_db 2>/dev/null)" == "true" ]; then
    # -c (clean/drop objects before recreating), -C (create database)
    docker exec -t wedding_db pg_dump -U admin -c -C wedding_db > $DB_BACKUP_FILE
    echo "      Database backup saved to $DB_BACKUP_FILE"
else
    echo "      ERROR: 'wedding_db' container is not running. Please start it first."
    exit 1
fi

# 2. Archive only the necessary data (DB Backup, Storage, and Env files)
echo "[2/3] Creating compressed archive of the data..."
ENV_FILES=$(find . -name "*.env" -type f)
tar -czvf $ARCHIVE_NAME \
    $DB_BACKUP_FILE \
    storage/ \
    $ENV_FILES

echo "[3/3] Cleaning up temporary database dump..."
rm $DB_BACKUP_FILE

echo "✅ Migration Archive Created Successfully: $ARCHIVE_NAME"