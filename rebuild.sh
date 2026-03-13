#!/bin/bash
# Stop containers and remove volumes (fixes missing node_modules issues)
docker-compose down -v

# Rebuild and start
docker-compose up --build