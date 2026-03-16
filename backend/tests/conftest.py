import os
import sys
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

# 1. MOCK EXTERNAL & HEAVY DEPENDENCIES BEFORE IMPORTING APP
# This prevents the InsightFace model from loading (saving RAM/Time) 
# and prevents Celery connection attempts during tests.
mock_insightface = MagicMock()
sys.modules["insightface"] = mock_insightface
sys.modules["insightface.app"] = mock_insightface

mock_celery = MagicMock()
sys.modules["celery"] = mock_celery

# 2. IMPORT APP AFTER MOCKS
from app.main import app
from app import database

@pytest.fixture
def mock_db_session():
    """Returns a MagicMock pretending to be a SQLAlchemy Session."""
    session = MagicMock()
    return session

@pytest.fixture
def client(mock_db_session):
    """
    TestClient with overridden dependencies:
    - Database session is mocked.
    - Startup events (DB connection/migration) are disabled.
    """
    
    # Override the get_db dependency to return our mock session
    def override_get_db():
        try:
            yield mock_db_session
        finally:
            pass
    
    app.dependency_overrides[database.get_db] = override_get_db

    # Disable startup events to prevent real DB connection attempts
    # (The TestClient runs startup events by default)
    original_startup_handlers = app.router.on_startup
    app.router.on_startup = []

    # Mock the global app_face used in main.py for search
    # We attach it to the app instance for easy access in tests if needed,
    # or we can patch it in specific tests.
    import app.main as app_main
    app_main.app_face = MagicMock()
    app_main.app_face.prepare = MagicMock()
    app_main.app_face.get = MagicMock(return_value=[])

    with TestClient(app) as c:
        yield c
    
    # Cleanup
    app.dependency_overrides.clear()
    app.router.on_startup = original_startup_handlers