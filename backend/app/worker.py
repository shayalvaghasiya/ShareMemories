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
from google.oauth2 import service_account
import google.auth.transport.requests
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

def get_drive_token():
    creds_json = get_required_env("GOOGLE_CREDENTIALS_JSON")
    creds_dict = json.loads(creds_json)
    
    # Fix escaped newlines in the private key
    if 'private_key' in creds_dict:
        creds_dict['private_key'] = creds_dict['private_key'].replace('\\n', '\n')
        
    creds = service_account.Credentials.from_service_account_info(
        creds_dict, scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    req = google.auth.transport.requests.Request()
    creds.refresh(req)
    return creds.token

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
            if img is not None:
                # Thumbnail is already resized (max 600px in process_drive_sync), so we can just use it
                pass

        if img is None:
            if photo.drive_file_id:
                # Fetch original high-res image directly from Drive into memory (if thumbnail missing)
                token = get_drive_token()
                res = requests.get(
                    f'https://www.googleapis.com/drive/v3/files/{photo.drive_file_id}?alt=media',
                    headers={'Authorization': f'Bearer {token}'},
                    timeout=30,
                )
                if res.status_code == 200:
                    img = decode_image_bytes(res.content)
            else:
                # Fallback to local file for manual uploads
                actual_path = resolve_storage_path(file_path)
                if os.path.exists(actual_path):
                    img = load_image_from_path(actual_path)
                    
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
