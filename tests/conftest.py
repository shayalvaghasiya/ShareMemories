import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock
from app.main import app
from app.database import get_db

@pytest.fixture
def mock_db_session():
    """Provides a mocked SQLAlchemy session."""
    session = MagicMock()
    yield session

@pytest.fixture
def client(mock_db_session):
    """Provides a FastAPI TestClient with the database dependency overridden."""
    def override_get_db():
        try:
            yield mock_db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()