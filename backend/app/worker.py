import os
from celery import Celery

# Initialize Celery
# Use Redis as both broker and backend, configured via env vars in docker-compose
celery = Celery(__name__, broker=os.getenv("REDIS_URL"), backend=os.getenv("REDIS_URL"))

@celery.task(name="process_photo_task")
def process_photo_task(photo_id: int, file_path: str):
    """
    Background task to process uploaded photos.
    In Phase 4, we will add the AI Face Detection logic here.
    """
    print(f"Stub: Processing photo {photo_id} at {file_path}")
    return True