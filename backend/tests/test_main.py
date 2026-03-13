import pytest
import io
from unittest.mock import MagicMock, patch, mock_open
from app import models

# --- SYSTEM TESTS ---

def test_read_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "System is running", "status": "ok"}

def test_health_check(client, mock_db_session):
    # Mock DB execution
    mock_db_session.execute.return_value = None
    
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"database": "connected", "redis": "checking..."}

# --- EVENT TESTS ---

def test_create_event(client, mock_db_session):
    payload = {"event_name": "Test Wedding", "event_date": "2023-10-27T10:00:00"}
    
    # Mock DB behavior
    mock_db_session.add = MagicMock()
    mock_db_session.commit = MagicMock()
    mock_db_session.refresh = MagicMock(side_effect=lambda x: setattr(x, 'event_id', 1))
    
    response = client.post("/events", json=payload)
    
    assert response.status_code == 200
    data = response.json()
    assert data["event_name"] == "Test Wedding"
    mock_db_session.add.assert_called_once()
    mock_db_session.commit.assert_called_once()

def test_get_events(client, mock_db_session):
    # Mock return list
    mock_event = models.Event(event_id=1, event_name="Wedding A")
    mock_db_session.query.return_value.all.return_value = [mock_event]
    
    response = client.get("/events")
    
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["event_name"] == "Wedding A"

def test_get_event_by_id_found(client, mock_db_session):
    mock_event = models.Event(event_id=1, event_name="Wedding A")
    mock_db_session.query.return_value.filter.return_value.first.return_value = mock_event
    
    response = client.get("/events/1")
    assert response.status_code == 200
    assert response.json()["event_id"] == 1

def test_get_event_by_id_not_found(client, mock_db_session):
    mock_db_session.query.return_value.filter.return_value.first.return_value = None
    
    response = client.get("/events/999")
    assert response.status_code == 404

# --- PHOTO UPLOAD TESTS ---

@patch("builtins.open", new_callable=mock_open)
@patch("shutil.copyfileobj") # Mock file writing
@patch("os.makedirs")        # Mock dir creation
def test_upload_photos(mock_makedirs, mock_copy, mock_file, client, mock_db_session):
    # Mock existing event
    mock_event = models.Event(event_id=1)
    mock_db_session.query.return_value.filter.return_value.first.return_value = mock_event
    
    # Mock adding photo to DB
    mock_db_session.add = MagicMock()
    mock_db_session.refresh = MagicMock(side_effect=lambda x: setattr(x, 'photo_id', 101))
    
    # Create dummy file payload
    files = [('files', ('test.jpg', b'fake content', 'image/jpeg'))]
    
    # Mock celery to prevent error
    with patch("app.main.celery_client.send_task") as mock_celery:
        response = client.post("/events/1/upload", files=files)
        
        assert response.status_code == 200
        assert "photo_ids" in response.json()
        mock_celery.assert_called_once()

def test_upload_photos_event_not_found(client, mock_db_session):
    mock_db_session.query.return_value.filter.return_value.first.return_value = None
    files = [('files', ('test.jpg', b'content', 'image/jpeg'))]
    
    response = client.post("/events/999/upload", files=files)
    assert response.status_code == 404

# --- SEARCH TESTS ---

def test_search_faces_no_face_detected(client, mock_db_session):
    # 1. Mock app_face to return empty list
    from app.main import app_face
    app_face.get.return_value = [] 
    
    files = {"file": ("selfie.jpg", io.BytesIO(b"fakeimg"), "image/jpeg")}
    data = {"event_id": 1}
    response = client.post("/search", files=files, data=data)
        
    assert response.status_code == 400
    assert "No face detected" in response.json()["detail"]

def test_search_faces_success(client, mock_db_session):
    # 1. Mock app_face to return a dummy face with embedding
    from app.main import app_face
    mock_face = MagicMock()
    mock_face.bbox = [0, 0, 100, 100]
    mock_face.embedding = [0.1] * 512 # Fake embedding
    app_face.get.return_value = [mock_face]
    
    # 2. Mock DB search result
    mock_photo = models.Photo(photo_id=5, file_path="/storage/match.jpg")
    
    # Mock the complex chaining query for search
    # query().join().filter().filter().order_by().limit().all()
    mock_query = mock_db_session.query.return_value
    mock_query.join.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_photo]
    
    files = {"file": ("selfie.jpg", io.BytesIO(b"fakeimg"), "image/jpeg")}
    data = {"event_id": 1}
    response = client.post("/search", files=files, data=data)
    
    assert response.status_code == 200
    assert response.json() == {"matches": ["/storage/match.jpg"]}

# --- DELETE & RESET TESTS ---

@patch("os.path.exists", return_value=True)
@patch("os.remove")
def test_delete_photo(mock_remove, mock_exists, client, mock_db_session):
    mock_photo = models.Photo(photo_id=10, file_path="/path/to/img.jpg")
    mock_db_session.query.return_value.filter.return_value.first.return_value = mock_photo
    
    response = client.delete("/photos/10")
    assert response.status_code == 200
    mock_remove.assert_called_with("/path/to/img.jpg")
    mock_db_session.delete.assert_called_once()

@patch("shutil.rmtree")
def test_reset_system(mock_rmtree, client, mock_db_session):
    with patch("os.path.exists", return_value=True):
        response = client.delete("/reset")
        assert response.status_code == 200
        # Should execute TRUNCATE
        mock_db_session.execute.assert_called()
        mock_rmtree.assert_called()