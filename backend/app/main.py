import os
import shutil
import time
import uuid
import logging
import cv2
import numpy as np
from typing import List
from celery import Celery
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Form
from fastapi.staticfiles import StaticFiles
from insightface.app import FaceAnalysis
from sqlalchemy.orm import Session
from sqlalchemy import text
from . import models, schemas, database

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Initialize Celery Client (for sending tasks only, no model loading)
celery_client = Celery(__name__, broker=os.getenv("REDIS_URL"), backend=os.getenv("REDIS_URL"))

app = FastAPI(title="Wedding AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url}")
    response = await call_next(request)
    return response

# Global variable for InsightFace model
app_face = None

def get_face_app():
    global app_face
    if app_face is None:
        logger.info("Initializing InsightFace model (Lazy Load)...")
        app_face = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
        app_face.prepare(ctx_id=0, det_size=(640, 640))
        logger.info("InsightFace model loaded successfully.")
    return app_face

# Mount storage to serve images statically for development
# Use an overridable storage path so tests and non-container environments work
storage_path = os.getenv("STORAGE_PATH", "/storage")
if not os.path.exists(storage_path):
    try:
        os.makedirs(storage_path, exist_ok=True)
    except PermissionError:
        # Fall back to workspace-local storage if /storage isn't writable (e.g. unit tests)
        storage_path = os.path.join(os.getcwd(), "storage")
        os.makedirs(storage_path, exist_ok=True)

app.mount("/storage", StaticFiles(directory=storage_path), name="storage")

# Create tables and enable vector extension on startup
@app.on_event("startup")
def startup_event():
    # Enable pgvector extension
    with database.engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    
    # Create tables
    models.Base.metadata.create_all(bind=database.engine)

@app.get("/")
def read_root():
    return {"message": "System is running", "status": "ok"}

@app.get("/health")
def health_check(db: Session = Depends(database.get_db)):
    try:
        # Simple query to check DB connection
        db.execute(text("SELECT 1"))
        return {"database": "connected", "redis": "checking..."}
    except Exception as e:
        return {"database": f"error: {str(e)}"}

@app.get("/events", response_model=List[schemas.Event])
def get_events(db: Session = Depends(database.get_db)):
    events = db.query(models.Event).all()
    return events

@app.post("/events", response_model=schemas.Event)
def create_event(event: schemas.EventCreate, db: Session = Depends(database.get_db)):
    logger.info(f"Received create event request: {event.event_name}")
    try:
        db_event = models.Event(event_name=event.event_name, event_date=event.event_date)
        db.add(db_event)
        db.commit()
        db.refresh(db_event)
        return db_event
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/events/{event_id}", response_model=schemas.Event)
def get_event(event_id: int, db: Session = Depends(database.get_db)):
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@app.post("/events/{event_id}/upload")
def upload_photos(
    event_id: int, 
    files: List[UploadFile] = File(...), 
    db: Session = Depends(database.get_db)
):
    logger.info(f"Received upload request for event {event_id} with {len(files)} files.")
    # Verify event exists
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        logger.error(f"Event {event_id} not found")
        raise HTTPException(status_code=404, detail="Event not found")

    storage_path = f"/storage/events/{event_id}/photos"
    os.makedirs(storage_path, exist_ok=True)
    
    saved_photos = []
    
    try:
        for file in files:
            # Sanitize filename to prevent filesystem errors with special characters
            original_name = file.filename or "upload"
            safe_filename = "".join([c for c in original_name if c.isalpha() or c.isdigit() or c in (' ', '.', '_', '-')]).strip()
            # If filename becomes empty after sanitization, give it a generic name
            if not safe_filename:
                safe_filename = f"image_{int(time.time())}_{uuid.uuid4().hex[:8]}.jpg"
            
            file_location = f"{storage_path}/{safe_filename}"
            logger.info(f"Saving file to {file_location}")
            
            # Save to disk
            # Revert to shutil.copyfileobj for better memory usage
            # and ensure we are at the start of the file
            file.file.seek(0)
            with open(file_location, "wb+") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            # Save to DB
            new_photo = models.Photo(event_id=event_id, file_path=file_location)
            db.add(new_photo)
            db.commit()
            db.refresh(new_photo)
            
            # Queue for AI Processing (Phase 4)
            celery_client.send_task("process_photo_task", args=[new_photo.photo_id, file_location])
            
            saved_photos.append(new_photo.photo_id)
            
        logger.info(f"Successfully uploaded {len(saved_photos)} photos.")
        return {"message": "Upload successful", "photo_ids": saved_photos}
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/events/{event_id}/photos", response_model=List[schemas.Photo])
def get_event_photos(event_id: int, db: Session = Depends(database.get_db)):
    photos = db.query(models.Photo).filter(models.Photo.event_id == event_id).all()
    return photos

@app.delete("/photos/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(database.get_db)):
    photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    try:
        if os.path.exists(photo.file_path):
            os.remove(photo.file_path)
    except Exception as e:
        logger.error(f"Error deleting file {photo.file_path}: {e}")
        
    db.delete(photo)
    db.commit()
    return {"message": "Photo deleted successfully"}

@app.post("/search")
def search_faces(
    event_id: int = Form(...),
    file: UploadFile = File(...), 
    db: Session = Depends(database.get_db)
):
    start_time = time.time()
    logger.info(f"Received search request for file: {file.filename}")
    
    # Read image file from upload
    contents = file.file.read()
    logger.info(f"File read complete. Size: {len(contents) / 1024 / 1024:.2f} MB")

    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        logger.error("Error: Could not decode image file")
        raise HTTPException(status_code=400, detail="Invalid image file")

    logger.info("Starting face detection (Inference)...")
    # Detect face
    # Note: This is CPU intensive and might pause the server for 1-3 seconds
    face_app = get_face_app()
    faces = face_app.get(img)
    logger.info(f"Face detection finished in {time.time() - start_time:.2f}s. Found {len(faces)} faces.")

    if not faces:
        logger.warning("No face detected in uploaded photo")
        raise HTTPException(status_code=400, detail="No face detected. Please try a clearer selfie.")
    
    # Use the largest face found
    faces.sort(key=lambda x: (x.bbox[2]-x.bbox[0]) * (x.bbox[3]-x.bbox[1]), reverse=True)
    user_embedding = faces[0].embedding.tolist()

    # Search using pgvector cosine distance
    logger.info("Querying database for matches...")
    
    # DEBUG: Get top 5 closest regardless of threshold to see values
    debug_results = db.query(models.Face.embedding.cosine_distance(user_embedding)).order_by(models.Face.embedding.cosine_distance(user_embedding)).limit(5).all()
    logger.info(f"DEBUG: Top 5 distances found: {[r[0] for r in debug_results]}")

    # Filter by Event ID and Cosine Distance
    results = db.query(models.Photo).join(models.Face)\
        .filter(models.Photo.event_id == event_id)\
        .filter(models.Face.embedding.cosine_distance(user_embedding) < 0.6)\
        .order_by(models.Face.embedding.cosine_distance(user_embedding))\
        .limit(50).all()

    logger.info(f"Found {len(results)} matches. Total time: {time.time() - start_time:.2f}s")
    return {"matches": [photo.file_path for photo in results]}

@app.delete("/reset")
def reset_system(db: Session = Depends(database.get_db)):
    logger.warning("Resetting system: Clearing database and storage.")
    
    # 1. Clear Database
    # TRUNCATE events CASCADE will also truncate photos and faces due to foreign keys
    db.execute(text("TRUNCATE TABLE events RESTART IDENTITY CASCADE"))
    db.commit()

    # 2. Clear Storage
    if os.path.exists("/storage/events"):
        shutil.rmtree("/storage/events")
        
    return {"message": "System reset successfully. All events, photos, and faces have been deleted."}
