import os
import shutil
from typing import List
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text
from . import models, schemas, database, worker

app = FastAPI(title="Wedding AI API")

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

@app.post("/events/", response_model=schemas.Event)
def create_event(event: schemas.EventCreate, db: Session = Depends(database.get_db)):
    db_event = models.Event(event_name=event.event_name, event_date=event.event_date)
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@app.post("/events/{event_id}/upload")
async def upload_photos(
    event_id: int, 
    files: List[UploadFile] = File(...), 
    db: Session = Depends(database.get_db)
):
    # Verify event exists
    event = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    storage_path = f"/storage/events/{event_id}/photos"
    os.makedirs(storage_path, exist_ok=True)
    
    saved_photos = []
    
    for file in files:
        file_location = f"{storage_path}/{file.filename}"
        
        # Save to disk
        with open(file_location, "wb+") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Save to DB
        new_photo = models.Photo(event_id=event_id, file_path=file_location)
        db.add(new_photo)
        db.commit()
        db.refresh(new_photo)
        
        # Queue for AI Processing (Phase 4)
        worker.process_photo_task.delay(new_photo.photo_id, file_location)
        
        saved_photos.append(new_photo.photo_id)
        
    return {"message": "Upload successful", "photo_ids": saved_photos}
