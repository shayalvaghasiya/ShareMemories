import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

def get_int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": get_int_env("DB_POOL_RECYCLE", 1800),
    "pool_size": get_int_env("DB_POOL_SIZE", 25),
    "max_overflow": get_int_env("DB_MAX_OVERFLOW", 50),
    "pool_timeout": get_int_env("DB_POOL_TIMEOUT", 60),
}

# SQLite does not support QueuePool arguments in the same way.
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs = {}

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
