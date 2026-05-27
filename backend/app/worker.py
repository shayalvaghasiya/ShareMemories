import os
import cv2
import json
import requests
import numpy as np
from celery import Celery
from insightface.app import FaceAnalysis
from sqlalchemy.orm import Session
from .database import SessionLocal
from . import models
import boto3
from .image_utils import decode_image_bytes, load_image_from_path

# Initialize Celery
# Use Redis as both broker and backend, configured via env vars in docker-compose
celery = Celery(__name__, broker=os.getenv("REDIS_URL"), backend=os.getenv("REDIS_URL"))

# Initialize InsightFace model globally
# providers=['CPUExecutionProvider'] ensures it works on CPU environments
app_face = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
app_face.prepare(ctx_id=0, det_size=(640, 640))


def get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


def resolve_storage_path(path: str) -> str:
    if path.startswith("/storage/"):
        return path
    return f"/storage/{path.lstrip('/')}"

@celery.task(name="process_photo_task")
def process_photo_task(photo_id: int, file_path: str):
    """
    Background task to process uploaded photos.
    Detects faces and saves embeddings to the database.
    """
    db: Session = SessionLocal()
    try:
        photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
        if not photo:
            return f"Error: Photo {photo_id} not found in DB"
            
        img = None
        # Optimization: Prioritize local thumbnail if it exists to save RAM and avoid Drive download
        if photo.thumbnail_path and os.path.exists(photo.thumbnail_path):
            img = load_image_from_path(photo.thumbnail_path)

        if img is None and file_path:
            # Fetch original high-res image directly from S3 into memory
            try:
                s3_client = boto3.client('s3')
                bucket_name = os.getenv("S3_BUCKET_NAME")
                obj = s3_client.get_object(Bucket=bucket_name, Key=file_path)
                img = decode_image_bytes(obj['Body'].read())
                
                # Generate and save a local EFS thumbnail for fast gallery viewing
                if img is not None:
                    h, w = img.shape[:2]
                    max_dim = 600
                    if max(h, w) > max_dim:
                        scale = max_dim / max(h, w)
                        thumb_img = cv2.resize(img, (int(w * scale), int(h * scale)))
                    else:
                        thumb_img = img
                    
                    thumb_dir = f"/storage/events/{photo.event_id}/thumbnails"
                    os.makedirs(thumb_dir, exist_ok=True)
                    thumb_path = f"{thumb_dir}/{photo.photo_id}.jpg"
                    cv2.imwrite(thumb_path, thumb_img)
                    
                    photo.thumbnail_path = thumb_path
                    db.commit()
            except Exception as e:
                print(f"Failed to fetch from S3 or generate thumbnail: {e}")
                    
        if img is None:
            photo.processing_status = "failed"
            db.commit()
            return f"Error: Could not decode image for photo {photo_id}"

        # Optimization: Resize image if it's still too large (e.g. if it came from Drive or manual upload)
        max_dim = 800
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))

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
        
        # Update processing status
        photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
        if photo:
            photo.processing_status = "completed"
            photo.faces_count = len(faces)
        
        db.commit()
        return f"Processed {len(faces)} faces for photo {photo_id}"
    except Exception as e:
        print(f"Error processing {photo_id}: {e}")
        # Mark as failed on any exception
        try:
            photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
            if photo:
                photo.processing_status = "failed"
                db.commit()
        except Exception:
            pass
        return f"Error: {e}"
    finally:
        db.close()
