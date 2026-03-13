from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

class PhotoBase(BaseModel):
    file_path: str

class Photo(PhotoBase):
    photo_id: int
    event_id: int

    class Config:
        orm_mode = True

class EventBase(BaseModel):
    event_name: str
    event_date: Optional[datetime] = None

class EventCreate(EventBase):
    pass

class Event(EventBase):
    event_id: int

    class Config:
        orm_mode = True