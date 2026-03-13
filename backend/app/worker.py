import os
import cv2
import numpy as np
from celery import Celery
from insightface.app import FaceAnalysis
from sqlalchemy.orm import Session
from .database import SessionLocal
from . import models

# Initialize Celery
# Use Redis as both broker and backend, configured via env vars in docker-compose
celery = Celery(__name__, broker=os.getenv("REDIS_URL"), backend=os.getenv("REDIS_URL"))

# Initialize InsightFace model globally
# providers=['CPUExecutionProvider'] ensures it works on CPU environments
app_face = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
app_face.prepare(ctx_id=0, det_size=(640, 640))

@celery.task(name="process_photo_task")
def process_photo_task(photo_id: int, file_path: str):
    """
    Background task to process uploaded photos.
    Detects faces and saves embeddings to the database.
    """
    db: Session = SessionLocal()
    try:
        img = cv2.imread(file_path)
        if img is None:
            return f"Error: Could not read image {file_path}"

        # Detect faces
        faces = app_face.get(img)
        
        for face in faces:
            # face.embedding is a numpy array (512,)
            embedding = face.embedding.tolist()
            
            new_face = models.Face(
                photo_id=photo_id,
                embedding=embedding
            )
            db.add(new_face)
        
        db.commit()
        return f"Processed {len(faces)} faces for photo {photo_id}"
    except Exception as e:
        print(f"Error processing {photo_id}: {e}")
        return f"Error: {e}"
    finally:
        db.close()