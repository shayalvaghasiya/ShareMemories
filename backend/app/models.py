from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from .database import Base

class Event(Base):
    __tablename__ = "events"
    
    event_id = Column(Integer, primary_key=True, index=True)
    event_name = Column(String, nullable=False)
    preview_image_path = Column(String, nullable=True)
    event_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    
    photos = relationship("Photo", back_populates="event")

class Photo(Base):
    __tablename__ = "photos"
    
    photo_id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.event_id"))
    file_path = Column(String, nullable=False)
    drive_file_id = Column(String, nullable=True)
    thumbnail_path = Column(String, nullable=True)
    processing_status = Column(String, default="pending", nullable=False)
    faces_count = Column(Integer, default=0, nullable=False)
    uploaded_at = Column(DateTime, default=func.now())
    
    event = relationship("Event", back_populates="photos")
    faces = relationship("Face", back_populates="photo", cascade="all, delete-orphan")

class Face(Base):
    __tablename__ = "faces"
    
    face_id = Column(Integer, primary_key=True, index=True)
    photo_id = Column(Integer, ForeignKey("photos.photo_id"))
    # Embedding from InsightFace (usually 512 dimensions for buffalo_l)
    embedding = Column(Vector(512))
    
    photo = relationship("Photo", back_populates="faces")

class Visitor(Base):
    __tablename__ = "visitors"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.event_id"))
    ip_address = Column(String, index=True)
    user_agent = Column(String)
    first_seen = Column(DateTime, default=func.now())
    last_seen = Column(DateTime, default=func.now())
    
    event = relationship("Event")