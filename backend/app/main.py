import os
import shutil
import io
import time
import json
import requests
import uuid
import logging
import hmac
import hashlib
import base64
import cv2
import numpy as np
import zipfile
from datetime import datetime
from stream_zip import ZIP_64, stream_zip
from typing import List, Optional
from celery import Celery
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request, Form, BackgroundTasks, Security
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from insightface.app import FaceAnalysis
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from google.oauth2 import service_account
import google.auth.transport.requests
from . import models, schemas, database
from .image_utils import decode_image_bytes, encode_jpeg_bytes, looks_like_heic

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
GUEST_TOKEN_TTL_SECONDS = 15 * 60


class EventAccessResponse(BaseModel):
    event_id: int
    access_token: str
    expires_in: int

class NumpyEncoder(json.JSONEncoder):
    """Custom encoder for numpy data types"""
    def default(self, obj):
        if isinstance(obj, (np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, (np.int32, np.int64)):
            return int(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

# Initialize Celery Client (for sending tasks only, no model loading)
celery_client = Celery(__name__, broker=os.getenv("REDIS_URL"), backend=os.getenv("REDIS_URL"))

app = FastAPI(title="Wedding AI API")

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"], 
    allow_origin_regex=r"https://.*\.app\.github\.dev",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key"],
    expose_headers=["Content-Disposition"],
)

try:
    if not os.path.exists("/storage"):
        os.makedirs("/storage", exist_ok=True)
    elif not os.path.isdir("/storage"):
        logger.warning("/storage exists but is not a directory. This may cause issues.")
except Exception as e:
    logger.error(f"Error checking/creating /storage: {e}")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url.path}")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    # Allow short-lived browser caching for image previews to improve gallery performance.
    if request.url.path.startswith("/photos/") and request.url.path.endswith("/view"):
        response.headers["Cache-Control"] = "private, max-age=300"
    else:
        response.headers["Cache-Control"] = "no-store"
    return response

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


def get_app_secret() -> str:
    return get_required_env("APP_SECRET_KEY")

def verify_admin(api_key: str = Security(api_key_header)):
    expected_key = get_required_env("ADMIN_PASSWORD")
    if not api_key or not hmac.compare_digest(api_key, expected_key):
        raise HTTPException(status_code=403, detail="Invalid Admin API Key")
    return api_key


def make_guest_access_token(event_id: int, expires_at: Optional[int] = None) -> str:
    if expires_at is None:
        expires_at = int(time.time()) + GUEST_TOKEN_TTL_SECONDS
    payload = f"{event_id}:{expires_at}"
    signature = hmac.new(get_app_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{payload}:{signature}"
    return base64.urlsafe_b64encode(token.encode("utf-8")).decode("utf-8")


def verify_guest_access_token(event_id: int, access_token: str) -> None:
    try:
        decoded = base64.urlsafe_b64decode(access_token.encode("utf-8")).decode("utf-8")
        token_event_id, expires_at, signature = decoded.split(":", 2)
        if int(token_event_id) != event_id:
            raise ValueError("Event mismatch")
        expected_payload = f"{token_event_id}:{expires_at}"
        expected_signature = hmac.new(
            get_app_secret().encode("utf-8"),
            expected_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid signature")
        if int(expires_at) < int(time.time()):
            raise ValueError("Expired token")
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Invalid or expired access token") from exc


def resolve_storage_path(path: str) -> str:
    if path.startswith("/storage/"):
        return path
    return f"/storage/{path.lstrip('/')}"


def read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    chunks = []
    size = 0
    while True:
        chunk = file.file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status_code=413, detail=f"File exceeds {max_bytes // (1024 * 1024)} MB limit")
        chunks.append(chunk)
    return b"".join(chunks)


def sanitize_upload_filename(filename: Optional[str], fallback_extension: str = ".jpg") -> str:
    original_name = filename or "upload"
    safe_filename = "".join([c for c in original_name if c.isalpha() or c.isdigit() or c in (" ", ".", "_", "-")]).strip()
    if not safe_filename:
        return f"image_{int(time.time())}_{uuid.uuid4().hex[:8]}{fallback_extension}"
    return safe_filename


def persist_guest_upload(event_id: int, filename: Optional[str], content_type: Optional[str], contents: bytes, img: np.ndarray) -> str:
    storage_path = f"/storage/uploads/{event_id}"
    os.makedirs(storage_path, exist_ok=True)

    safe_filename = sanitize_upload_filename(filename)
    if looks_like_heic(filename, content_type):
        safe_filename = f"{os.path.splitext(safe_filename)[0]}.jpg"

    file_location = f"{storage_path}/{uuid.uuid4().hex}_{safe_filename}"
    with open(file_location, "wb") as buffer:
        if looks_like_heic(filename, content_type):
            buffer.write(encode_jpeg_bytes(img))
        else:
            buffer.write(contents)
    return file_location


def require_guest_event_access(event_id: int, access_token: str, db: Session) -> models.Event:
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    verify_guest_access_token(event_id, access_token)
    return event

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

def get_drive_token():
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if not creds_json:
        raise ValueError("GOOGLE_CREDENTIALS_JSON environment variable is not set")
    creds_dict = json.loads(creds_json)
    
    # Fix escaped newlines in the private key
    if 'private_key' in creds_dict:
        creds_dict['private_key'] = creds_dict['private_key'].replace('\\n', '\n')
        
    creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=['https://www.googleapis.com/auth/drive'])
    req = google.auth.transport.requests.Request()
    creds.refresh(req)
    return creds.token

# Create tables and enable vector extension on startup
@app.on_event("startup")
def startup_event():
    get_required_env("ADMIN_PASSWORD")
    get_required_env("APP_SECRET_KEY")
    # Retry logic to wait for database to be ready
    max_retries = 5
    for i in range(max_retries):
        try:
            logger.info(f"Database connection attempt {i+1}/{max_retries}...")
            
            # 1. Enable pgvector extension first (required for models with Vector columns)
            with database.engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            
            # 2. Create tables
            models.Base.metadata.create_all(bind=database.engine)
            
            # 3. Migrate schema (add missing columns to existing tables)
            with database.engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR"))
                    conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR"))
                    conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS processing_status VARCHAR DEFAULT 'pending'"))
                    conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS faces_count INTEGER DEFAULT 0"))
                except Exception as e:
                    logger.info(f"Schema migration skipped or failed: {e}")
            
            logger.info("Database initialized successfully.")
            break
        except Exception as e:
            if i == max_retries - 1:
                logger.error(f"Failed to connect to database after {max_retries} attempts: {e}")
                raise e
            logger.warning(f"Database not ready, retrying in 2 seconds... ({e})")
            time.sleep(2)

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

@app.get("/events", response_model=List[schemas.Event], dependencies=[Depends(verify_admin)])
def get_events(db: Session = Depends(database.get_db)):
    events = db.query(models.Event).all()
    return events

@app.post("/events", response_model=schemas.Event, dependencies=[Depends(verify_admin)])
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


@app.post("/events/{event_id}/access", response_model=EventAccessResponse)
def get_event_access(event_id: int, db: Session = Depends(database.get_db)):
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return EventAccessResponse(
        event_id=event_id,
        access_token=make_guest_access_token(event_id),
        expires_in=GUEST_TOKEN_TTL_SECONDS,
    )

@app.post("/events/{event_id}/visit")
def record_visit(event_id: int, request: Request, db: Session = Depends(database.get_db)):
    """Endpoint for guests to ping periodically to register as active users."""
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        return {"status": "ignored"}
        
    forwarded = request.headers.get("X-Forwarded-For")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host
    user_agent = request.headers.get("User-Agent", "")[:255]

    visitor = db.query(models.Visitor).filter(
        models.Visitor.event_id == event_id,
        models.Visitor.ip_address == ip
    ).first()

    if visitor:
        visitor.last_seen = datetime.now()
    else:
        visitor = models.Visitor(
            event_id=event_id,
            ip_address=ip,
            user_agent=user_agent,
            last_seen=datetime.now(),
            first_seen=datetime.now()
        )
        db.add(visitor)
    
    db.commit()
    return {"status": "ok"}

@app.get("/admin/visitors", dependencies=[Depends(verify_admin)])
def get_visitors(db: Session = Depends(database.get_db)):
    """Retrieves all visitors for the admin dashboard."""
    visitors = db.query(models.Visitor, models.Event.event_name)\
                 .join(models.Event, models.Visitor.event_id == models.Event.event_id)\
                 .order_by(models.Visitor.last_seen.desc()).all()
    
    now = datetime.now()
    # We consider a user "Active" if they have pinged within the last 5 minutes (300 seconds)
    return [{ "id": v.id, "event_id": v.event_id, "event_name": event_name, "ip_address": v.ip_address, "user_agent": v.user_agent, "first_seen": v.first_seen.isoformat() if v.first_seen else None, "last_seen": v.last_seen.isoformat() if v.last_seen else None, "is_active": (now - v.last_seen).total_seconds() < 300 } for v, event_name in visitors]

class FileInfo(BaseModel):
    filename: str
    contentType: str

class ConfirmUploadRequest(BaseModel):
    file_ids: List[str]

class SyncDriveRequest(BaseModel):
    folder_url: str


def process_drive_sync(event_id: int, files: list):
    db: Session = database.SessionLocal()
    try:
        logger.info(f"Starting background sync for {len(files)} files.")
        token = get_drive_token()
        headers = {"Authorization": f"Bearer {token}"}
        
        # Ensure base directories exist
        storage_path = f"/storage/events/{event_id}/thumbnails"
        os.makedirs(storage_path, exist_ok=True)
        
        batch_size = 10
        for i in range(0, len(files), batch_size):
            batch_files = files[i:i + batch_size]
            new_photos = []
            
            for f in batch_files:
                file_id = f['id']
                try:
                    # Download image into memory
                    dl_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
                    dl_res = requests.get(dl_url, headers=headers, timeout=30)
                    
                    if dl_res.status_code == 401:
                        logger.info("Google Drive token expired. Refreshing...")
                        token = get_drive_token()
                        headers = {"Authorization": f"Bearer {token}"}
                        dl_res = requests.get(dl_url, headers=headers, timeout=30)

                    if dl_res.status_code != 200:
                        logger.error(f"Failed to download {file_id}: {dl_res.status_code}")
                        continue
                        
                    nparr = np.frombuffer(dl_res.content, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img is None:
                        logger.error(f"Failed to decode image {file_id}")
                        continue
                        
                    # Resize for thumbnail
                    height, width = img.shape[:2]
                    max_dim = 600
                    if max(height, width) > max_dim:
                        scale = max_dim / max(height, width)
                        img = cv2.resize(img, (int(width * scale), int(height * scale)))
                        
                    thumb_filename = f"{file_id}.jpg"
                    thumb_path = f"{storage_path}/{thumb_filename}"
                    cv2.imwrite(thumb_path, img)
                    
                    photo = models.Photo(
                        event_id=event_id, 
                        file_path=f"events/{event_id}/thumbnails/{thumb_filename}",
                        drive_file_id=file_id,
                        thumbnail_path=thumb_path
                    )
                    db.add(photo)
                    new_photos.append((photo, thumb_path))
                except Exception as e:
                    logger.error(f"Error processing {file_id}: {e}")
                    continue
            
            # Commit the batch to get IDs
            db.commit()
            
            # Queue Celery tasks for all photos in the batch
            for photo, thumb_path in new_photos:
                db.refresh(photo)
                celery_client.send_task("process_photo_task", args=[photo.photo_id, thumb_path])
                
    except Exception as e:
        logger.error(f"Fatal error in background sync: {e}")
    finally:
        db.close()
        logger.info("Background sync completed.")

def repair_missing_photos():
    """Background task to re-download missing photos that have drive_file_id"""
    db: Session = database.SessionLocal()
    try:
        logger.info("Starting background repair for missing Google Drive photos.")
        # Find all photos that have a drive_file_id
        all_drive_photos = db.query(models.Photo).filter(models.Photo.drive_file_id != None).all()
        
        missing_photos = []
        for p in all_drive_photos:
            # Check if the local file exists (inside /storage)
            full_path = p.file_path if p.file_path.startswith("/storage") else f"/storage/{p.file_path.lstrip('/')}"
            if not os.path.exists(full_path):
                missing_photos.append((p, full_path))
                
        if not missing_photos:
            logger.info("No missing photos found to repair.")
            return

        logger.info(f"Found {len(missing_photos)} missing photos to recover from Google Drive.")
        token = get_drive_token()
        headers = {"Authorization": f"Bearer {token}"}
        
        for p, full_path in missing_photos:
            try:
                # Ensure directory exists
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                
                # Download
                dl_url = f"https://www.googleapis.com/drive/v3/files/{p.drive_file_id}?alt=media"
                dl_res = requests.get(dl_url, headers=headers, timeout=30)
                
                if dl_res.status_code == 401:
                    logger.info("Google Drive token expired during repair. Refreshing...")
                    token = get_drive_token()
                    headers = {"Authorization": f"Bearer {token}"}
                    dl_res = requests.get(dl_url, headers=headers, timeout=30)

                if dl_res.status_code == 200:
                    nparr = np.frombuffer(dl_res.content, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img is not None:
                        # Resize for thumbnail
                        height, width = img.shape[:2]
                        max_dim = 600
                        if max(height, width) > max_dim:
                            scale = max_dim / max(height, width)
                            img = cv2.resize(img, (int(width * scale), int(height * scale)))
                        
                        # Re-save thumbnail
                        cv2.imwrite(full_path, img)
                        logger.info(f"Successfully recovered {p.photo_id} from Drive.")
                        
                        # Only re-trigger processing if the status wasn't completed in the backup
                        if p.processing_status != "completed":
                            celery_client.send_task("process_photo_task", args=[p.photo_id, full_path])
                else:
                    logger.warning(f"Failed to recover {p.photo_id} (ID: {p.drive_file_id}): {dl_res.status_code}")
            except Exception as e:
                logger.error(f"Error repairing photo {p.photo_id}: {e}")
                
    except Exception as e:
        logger.error(f"Fatal error in photo repair: {e}")
    finally:
        db.close()
        logger.info("Background repair completed.")

@app.post("/events/{event_id}/sync-drive", dependencies=[Depends(verify_admin)])
def sync_drive_folder(
    event_id: int, 
    payload: SyncDriveRequest, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db)
):
    logger.info(f"Received sync drive request for event {event_id}: {payload.folder_url}")
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    import re
    folder_id = payload.folder_url
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', payload.folder_url)
    if match:
        folder_id = match.group(1)
    else:
        match_id = re.search(r'id=([a-zA-Z0-9_-]+)', payload.folder_url)
        if match_id:
            folder_id = match_id.group(1)

    token = get_drive_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
    
    files = []
    page_token = None
    while True:
        url = f"https://www.googleapis.com/drive/v3/files?q={requests.utils.quote(query)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000"
        if page_token:
            url += f"&pageToken={page_token}"
            
        res = requests.get(url, headers=headers, timeout=30)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to access Google Drive folder: {res.text}")
            
        data = res.json()
        files.extend(data.get('files', []))
        page_token = data.get('nextPageToken')
        if not page_token:
            break
            
    if not files:
        return {"message": "No images found in the folder.", "synced_count": 0, "total_found": 0, "new_found": 0}

    # Identify new files
    existing_photos = db.query(models.Photo.drive_file_id).filter(models.Photo.event_id == event_id).all()
    existing_ids = {p[0] for p in existing_photos if p[0]}
    new_files = [f for f in files if f['id'] not in existing_ids]

    if not new_files:
        return {"message": "All images already synced.", "synced_count": 0, "total_found": len(files), "new_found": 0}

    background_tasks.add_task(process_drive_sync, event_id, new_files)
    
    return {"message": "Sync started", "synced_count": 0, "total_found": len(files), "new_found": len(new_files)}

@app.get("/photos/{photo_id}/download")
def download_photo(
    photo_id: int,
    access_token: Optional[str] = None,
    api_key: Optional[str] = Security(api_key_header),
):
    db = database.SessionLocal()
    try:
        photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")
        if not api_key:
            if not access_token:
                raise HTTPException(status_code=403, detail="Access token required")
            verify_guest_access_token(photo.event_id, access_token)
        else:
            verify_admin(api_key)

        if photo.drive_file_id:
            token = get_drive_token()
            headers = {"Authorization": f"Bearer {token}"}
            dl_url = f"https://www.googleapis.com/drive/v3/files/{photo.drive_file_id}?alt=media"

            res = requests.get(dl_url, headers=headers, stream=True, timeout=30)
            if res.status_code != 200:
                raise HTTPException(status_code=res.status_code, detail="Failed to fetch from Google Drive")

            return StreamingResponse(
                res.iter_content(chunk_size=1024*1024),
                media_type=res.headers.get("Content-Type", "image/jpeg"),
                headers={"Content-Disposition": f'attachment; filename="photo_{photo_id}.jpg"'}
            )
        elif photo.file_path:
            actual_path = resolve_storage_path(photo.file_path)
            if os.path.exists(actual_path):
                return FileResponse(
                    path=actual_path,
                    media_type="image/jpeg",
                    filename=f"photo_{photo_id}.jpg"
                )

        raise HTTPException(status_code=404, detail="File not found on server")
    finally:
        db.close()

@app.get("/photos/{photo_id}/view")
def view_photo(
    photo_id: int,
    access_token: str,
):
    db = database.SessionLocal()
    try:
        photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")
        verify_guest_access_token(photo.event_id, access_token)

        actual_path = resolve_storage_path(photo.thumbnail_path or photo.file_path)
        if not os.path.exists(actual_path):
            raise HTTPException(status_code=404, detail="File not found on server")
        return FileResponse(path=actual_path, media_type="image/jpeg", filename=f"photo_{photo_id}.jpg")
    finally:
        db.close()


@app.get("/events/{event_id}/download-zip")
def download_photos_zip(
    event_id: int, 
    photo_ids: str, 
    access_token: str,
    db: Session = Depends(database.get_db)
):
    require_guest_event_access(event_id, access_token, db)
    ids = [int(i) for i in photo_ids.split(",") if i.isdigit()]
    if not ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")
        
    photos = db.query(models.Photo).filter(models.Photo.photo_id.in_(ids), models.Photo.event_id == event_id).all()
    
    if not photos:
        raise HTTPException(status_code=404, detail="No photos found")
        
    def zip_generator():
        token = get_drive_token()
        headers = {"Authorization": f"Bearer {token}"}
        now = datetime.now()
        
        def get_files():
            for photo in photos:
                filename = f"photo_{photo.photo_id}.jpg"
                if photo.drive_file_id:
                    dl_url = f"https://www.googleapis.com/drive/v3/files/{photo.drive_file_id}?alt=media"
                    # Stream from Google Drive directly into the ZIP chunk
                    with requests.get(dl_url, headers=headers, stream=True, timeout=30) as res:
                        if res.status_code == 200:
                            yield filename, now, 0o600, ZIP_64, res.iter_content(chunk_size=65536)
                elif photo.file_path:
                    actual_path = resolve_storage_path(photo.file_path)
                    if os.path.exists(actual_path):
                        def file_chunks():
                            with open(actual_path, "rb") as f:
                                while chunk := f.read(65536):
                                    yield chunk
                        yield filename, now, 0o600, ZIP_64, file_chunks()
        
        # Stream the zip bytes directly to the client
        yield from stream_zip(get_files())
        
    return StreamingResponse(
        zip_generator(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="memories_{event_id}.zip"'
        }
    )

@app.post("/events/{event_id}/upload", dependencies=[Depends(verify_admin)])
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
    new_photos = []
    
    try:
        for file in files:
            if not (file.content_type or "").startswith("image/"):
                raise HTTPException(status_code=400, detail="Only image uploads are allowed")
            # Sanitize filename to prevent filesystem errors with special characters
            original_name = file.filename or "upload"
            safe_filename = sanitize_upload_filename(original_name)

            if looks_like_heic(original_name, file.content_type):
                safe_filename = f"{os.path.splitext(safe_filename)[0]}.jpg"

            file_location = f"{storage_path}/{uuid.uuid4().hex}_{safe_filename}"
            relative_path = file_location.replace("/storage/", "", 1) if file_location.startswith("/storage/") else file_location
            logger.info(f"Saving file to {file_location}")
            
            # Save to disk
            file.file.seek(0)
            if looks_like_heic(original_name, file.content_type):
                contents = read_upload_limited(file, MAX_IMAGE_UPLOAD_BYTES)
                img = decode_image_bytes(contents)
                if img is None:
                    raise HTTPException(status_code=400, detail="Unsupported HEIC/HEIF image")
                with open(file_location, "wb+") as buffer:
                    buffer.write(encode_jpeg_bytes(img))
            else:
                size = 0
                with open(file_location, "wb+") as buffer:
                    while True:
                        chunk = file.file.read(1024 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_IMAGE_UPLOAD_BYTES:
                            raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit")
                        buffer.write(chunk)
                
            # Save to DB
            new_photo = models.Photo(event_id=event_id, file_path=relative_path)
            new_photos.append(new_photo)
            
        # Bulk save to DB to significantly speed up waiting time after upload
        db.add_all(new_photos)
        db.commit()
        
        for new_photo in new_photos:
            db.refresh(new_photo)
            # Queue for AI Processing (Phase 4)
            celery_client.send_task("process_photo_task", args=[new_photo.photo_id, resolve_storage_path(new_photo.file_path)])
            saved_photos.append(new_photo.photo_id)
            
        logger.info(f"Successfully uploaded {len(saved_photos)} photos.")
        return {"message": "Upload successful", "photo_ids": saved_photos}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/events/{event_id}/photos", response_model=List[schemas.Photo], dependencies=[Depends(verify_admin)])
def get_event_photos(event_id: int, db: Session = Depends(database.get_db)):
    photos = db.query(models.Photo).filter(models.Photo.event_id == event_id).all()
    return photos

@app.delete("/photos/{photo_id}", dependencies=[Depends(verify_admin)])
def delete_photo(photo_id: int, db: Session = Depends(database.get_db)):
    photo = db.query(models.Photo).filter(models.Photo.photo_id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        # Delete from local storage if exists
        if photo.file_path:
            actual_file_path = resolve_storage_path(photo.file_path)
            if os.path.exists(actual_file_path):
                os.remove(actual_file_path)
                logger.info(f"Deleted local file: {actual_file_path}")
            
        if photo.thumbnail_path:
            actual_thumbnail_path = resolve_storage_path(photo.thumbnail_path)
            if os.path.exists(actual_thumbnail_path):
                os.remove(actual_thumbnail_path)
                logger.info(f"Deleted local thumbnail: {actual_thumbnail_path}")

        # Delete from Google Drive if it was a drive file
        if photo.drive_file_id:
            token = get_drive_token()
            requests.delete(
                f'https://www.googleapis.com/drive/v3/files/{photo.drive_file_id}',
                headers={'Authorization': f'Bearer {token}'},
                timeout=30,
            )
    except Exception as e:
        logger.error(f"Error deleting files for photo {photo_id}: {e}")
        
    db.delete(photo)
    db.commit()
    return {"message": "Photo deleted successfully"}

@app.post("/search")
def search_faces(
    event_id: int = Form(...),
    access_token: str = Form(...),
    file: UploadFile = File(...), 
    db: Session = Depends(database.get_db)
):
    start_time = time.time()
    require_guest_event_access(event_id, access_token, db)
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")
    logger.info(f"Received search request for file: {file.filename}")
    
    # Read image file from upload
    contents = read_upload_limited(file, MAX_IMAGE_UPLOAD_BYTES)
    logger.info(f"File read complete. Size: {len(contents) / 1024 / 1024:.2f} MB")

    img = decode_image_bytes(contents)
    
    if img is None:
        logger.error("Error: Could not decode image file")
        raise HTTPException(status_code=400, detail="Invalid or unsupported image file")

    saved_upload_path = persist_guest_upload(event_id, file.filename, file.content_type, contents, img)
    logger.info(f"Stored guest upload at {saved_upload_path}")

    # Optimization: Resize image if it's too large to save RAM during inference
    max_dim = 800
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
        logger.info(f"Resized search image to {img.shape[1]}x{img.shape[0]}")

    logger.info("Starting face detection (Inference)...")
    # Detect face
    # Note: This is CPU intensive and might pause the server for 1-3 seconds
    face_app = get_face_app()
    faces = face_app.get(img)
    logger.info(f"Face detection finished in {time.time() - start_time:.2f}s. Found {len(faces)} faces.")

    if not faces:
        logger.warning("No face detected in uploaded photo")
        raise HTTPException(status_code=400, detail="No face detected. Please try a clearer selfie.")
    
    if len(faces) > 1:
        logger.warning(f"Multiple faces detected: {len(faces)}")
        raise HTTPException(status_code=400, detail=f"Found {len(faces)} faces in the photo. Please upload a clear photo of ONLY yourself for accurate matching.")

    user_embedding = faces[0].embedding.tolist()

    # Search using pgvector cosine distance
    logger.info("Querying database for matches...")
    
    # Filter by Event ID and Cosine Distance
    results = db.query(models.Photo).join(models.Face)\
        .filter(models.Photo.event_id == event_id)\
        .filter(models.Face.embedding.cosine_distance(user_embedding) < 0.6)\
        .order_by(models.Face.embedding.cosine_distance(user_embedding)).all()

    logger.info(f"Found {len(results)} matches. Total time: {time.time() - start_time:.2f}s")
    matches = [
        {
            "photo_id": photo.photo_id, 
            "url": f"/photos/{photo.photo_id}/view?access_token={access_token}",
            "download_url": f"/photos/{photo.photo_id}/download?access_token={access_token}"
        } 
        for photo in results
    ]
    return {"matches": matches}

# ==================== ADMIN DATABASE MANAGEMENT ====================

@app.get("/admin/db-status", dependencies=[Depends(verify_admin)])
def get_db_status(db: Session = Depends(database.get_db)):
    """Returns processing status overview and per-photo details."""
    total = db.query(models.Photo).count()
    pending = db.query(models.Photo).filter(models.Photo.processing_status == "pending").count()
    completed = db.query(models.Photo).filter(models.Photo.processing_status == "completed").count()
    failed = db.query(models.Photo).filter(models.Photo.processing_status == "failed").count()
    total_faces = db.query(models.Face).count()
    total_events = db.query(models.Event).count()

    # Get per-photo status list (most recent first)
    photos = db.query(models.Photo).order_by(models.Photo.photo_id.desc()).all()
    photo_list = [
        {
            "photo_id": p.photo_id,
            "event_id": p.event_id,
            "file_path": p.file_path,
            "drive_file_id": p.drive_file_id,
            "processing_status": p.processing_status or "pending",
            "faces_count": p.faces_count or 0,
            "uploaded_at": p.uploaded_at.isoformat() if p.uploaded_at else None,
        }
        for p in photos
    ]

    return {
        "summary": {
            "total_events": total_events,
            "total_photos": total,
            "pending": pending,
            "completed": completed,
            "failed": failed,
            "total_faces": total_faces,
        },
        "photos": photo_list,
    }

@app.post("/admin/retry-pending", dependencies=[Depends(verify_admin)])
def retry_pending_photos(db: Session = Depends(database.get_db)):
    """Manually re-queues any photos stuck in 'pending' or 'failed' state."""
    logger.info("Manually triggering retry for pending/failed photos...")
    stuck_photos = db.query(models.Photo).filter(models.Photo.processing_status.in_(["pending", "failed"])).all()
    
    count = 0
    for p in stuck_photos:
        actual_path = p.thumbnail_path or p.file_path
        if actual_path and not actual_path.startswith("/storage"):
            actual_path = f"/storage/{actual_path.lstrip('/')}"
            
        celery_client.send_task("process_photo_task", args=[p.photo_id, actual_path])
        count += 1
        
    return {"message": f"Successfully re-queued {count} photos for processing.", "count": count}


@app.get("/admin/db-export", dependencies=[Depends(verify_admin)])
def export_database(db: Session = Depends(database.get_db)):
    """Exports entire database state as a downloadable JSON file."""
    logger.info("Exporting database snapshot...")

    events = db.query(models.Event).all()
    events_data = [
        {
            "event_id": e.event_id,
            "event_name": e.event_name,
            "event_date": e.event_date.isoformat() if e.event_date else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]

    photos = db.query(models.Photo).all()
    photos_data = [
        {
            "photo_id": p.photo_id,
            "event_id": p.event_id,
            "file_path": p.file_path,
            "drive_file_id": p.drive_file_id,
            "thumbnail_path": p.thumbnail_path,
            "processing_status": p.processing_status or "pending",
            "faces_count": p.faces_count or 0,
            "uploaded_at": p.uploaded_at.isoformat() if p.uploaded_at else None,
        }
        for p in photos
    ]

    faces = db.query(models.Face).all()
    faces_data = [
        {
            "face_id": f.face_id,
            "photo_id": f.photo_id,
            "embedding": f.embedding.tolist() if f.embedding is not None else [],
        }
        for f in faces
    ]

    snapshot = {
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "events": events_data,
        "photos": photos_data,
        "faces": faces_data,
    }

    json_bytes = json.dumps(snapshot, indent=2, cls=NumpyEncoder).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=sharememories_backup.json"},
    )


class ImportResult(BaseModel):
    events_imported: int = 0
    photos_imported: int = 0
    faces_imported: int = 0
    message: str = ""


@app.post("/admin/db-import", response_model=ImportResult, dependencies=[Depends(verify_admin)])
async def import_database(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
):
    """Imports a JSON snapshot to restore database state."""
    logger.info("Importing database snapshot...")
    try:
        if file.content_type not in {"application/json", "text/json"}:
            raise HTTPException(status_code=400, detail="Import file must be JSON")
        content = await file.read()
        snapshot = json.loads(content)

        events_count = 0
        photos_count = 0
        faces_count = 0

        # Import events
        for ev in snapshot.get("events", []):
            existing = db.query(models.Event).filter(models.Event.event_id == ev["event_id"]).first()
            if not existing:
                from datetime import datetime
                new_event = models.Event(
                    event_id=ev["event_id"],
                    event_name=ev["event_name"],
                    event_date=datetime.fromisoformat(ev["event_date"]) if ev.get("event_date") else None,
                )
                db.add(new_event)
                events_count += 1

        db.flush()

        # Import photos
        for ph in snapshot.get("photos", []):
            existing = db.query(models.Photo).filter(models.Photo.photo_id == ph["photo_id"]).first()
            if not existing:
                new_photo = models.Photo(
                    photo_id=ph["photo_id"],
                    event_id=ph["event_id"],
                    file_path=ph["file_path"],
                    drive_file_id=ph.get("drive_file_id"),
                    thumbnail_path=ph.get("thumbnail_path"),
                    processing_status=ph.get("processing_status", "pending"),
                    faces_count=ph.get("faces_count", 0),
                )
                db.add(new_photo)
                photos_count += 1

        db.flush()

        # Import faces
        for fc in snapshot.get("faces", []):
            existing = db.query(models.Face).filter(models.Face.face_id == fc["face_id"]).first()
            if not existing:
                new_face = models.Face(
                    face_id=fc["face_id"],
                    photo_id=fc["photo_id"],
                    embedding=fc.get("embedding", []),
                )
                db.add(new_face)
                faces_count += 1

        db.commit()

        # Reset sequences so future inserts don't collide
        db.execute(text("SELECT setval('events_event_id_seq', COALESCE((SELECT MAX(event_id) FROM events), 0) + 1, false)"))
        db.execute(text("SELECT setval('photos_photo_id_seq', COALESCE((SELECT MAX(photo_id) FROM photos), 0) + 1, false)"))
        db.execute(text("SELECT setval('faces_face_id_seq', COALESCE((SELECT MAX(face_id) FROM faces), 0) + 1, false)"))
        db.commit()

        # Auto-trigger repair background task
        background_tasks.add_task(repair_missing_photos)

        msg = f"Imported {events_count} events, {photos_count} photos, {faces_count} faces. Background recovery started for missing files."
        logger.info(msg)
        return ImportResult(
            events_imported=events_count,
            photos_imported=photos_count,
            faces_imported=faces_count,
            message=msg,
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file.")
    except Exception as e:
        db.rollback()
        logger.error(f"Import failed: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@app.delete("/reset", dependencies=[Depends(verify_admin)])
def reset_system(background_tasks: BackgroundTasks, db: Session = Depends(database.get_db)):
    logger.warning("Resetting system: Clearing database and storage.")
    
    # 1. Clear Database
    try:
        # TRUNCATE events CASCADE will also truncate photos and faces due to foreign keys
        db.execute(text("TRUNCATE TABLE events RESTART IDENTITY CASCADE"))
        db.commit()
    except Exception as e:
        logger.error(f"Error resetting database (tables might not exist): {e}")
        db.rollback()

    # 2. Clear Storage in background
    # Doing this in a background task prevents the "Connection reset by peer" error 
    # if Uvicorn is running with --reload and watching the /storage directory.
    def clear_storage():
        storage_paths = ["/storage/events", "/storage/uploads"]
        try:
            for storage_path in storage_paths:
                if os.path.exists(storage_path):
                    shutil.rmtree(storage_path)
                os.makedirs(storage_path, exist_ok=True)
            logger.info("Storage cleared and recreated successfully.")
        except Exception as e:
            logger.error(f"Error clearing storage: {e}")
            
    background_tasks.add_task(clear_storage)

    return {"message": "System reset initiated successfully."}
