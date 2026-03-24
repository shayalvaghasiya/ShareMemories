import pytest
from unittest.mock import patch, MagicMock, ANY
from app import models

class MockQuery:
    """Helper class to mock SQLAlchemy query chains."""
    def __init__(self, result=None):
        self._result = result or []

    def join(self, *args, **kwargs): return self
    def filter(self, *args, **kwargs): return self
    def order_by(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def first(self): return self._result[0] if self._result else None
    def all(self): return self._result

def test_read_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "System is running", "status": "ok"}

def test_health_check(client, mock_db_session):
    response = client.get("/health")
    assert response.status_code == 200
    assert "database" in response.json()
    mock_db_session.execute.assert_called_once()

def test_get_events(client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([
        models.Event(event_id=1, event_name="Wedding", event_date="2023-10-01T00:00:00")
    ])

    response = client.get("/events")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["event_name"] == "Wedding"
    assert data[0]["event_id"] == 1

def test_create_event(client, mock_db_session):
    # Mocking db.refresh to assign an ID dynamically when saving to the database
    def mock_refresh(instance):
        instance.event_id = 2

    mock_db_session.refresh.side_effect = mock_refresh

    response = client.post("/events", json={"event_name": "Birthday Party"})
    assert response.status_code == 200
    data = response.json()
    assert data["event_name"] == "Birthday Party"
    assert data["event_id"] == 2
    mock_db_session.add.assert_called_once()
    mock_db_session.commit.assert_called_once()

def test_get_event(client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([
        models.Event(event_id=1, event_name="Wedding")
    ])
    response = client.get("/events/1")
    assert response.status_code == 200
    assert response.json()["event_name"] == "Wedding"

def test_get_event_not_found(client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([])
    response = client.get("/events/999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"

@patch("app.main.celery_client.send_task")
@patch("app.main.shutil.copyfileobj")
@patch("app.main.os.makedirs")
@patch("builtins.open", new_callable=MagicMock)
def test_upload_photos(mock_open, mock_makedirs, mock_copyfileobj, mock_send_task, client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([
        models.Event(event_id=1, event_name="Wedding")
    ])

    def mock_refresh(instance):
        instance.photo_id = 10

    mock_db_session.refresh.side_effect = mock_refresh

    file_content = b"fake image content"
    response = client.post(
        "/events/1/upload",
        files={"files": ("test.jpg", file_content, "image/jpeg")}
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Upload successful"
    assert response.json()["photo_ids"] == [10]
    
    mock_makedirs.assert_called_once()
    mock_open.assert_called_once()
    mock_db_session.add.assert_called_once()
    mock_db_session.commit.assert_called_once()
    mock_send_task.assert_called_once_with("process_photo_task", args=[10, ANY])

def test_upload_photos_event_not_found(client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([])
    
    response = client.post(
        "/events/999/upload",
        files={"files": ("test.jpg", b"data", "image/jpeg")}
    )
    assert response.status_code == 404

def test_get_event_photos(client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([
        models.Photo(photo_id=1, event_id=1, file_path="/storage/test.jpg")
    ])
    
    response = client.get("/events/1/photos")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["file_path"] == "/storage/test.jpg"

@patch("app.main.os.path.exists", return_value=True)
@patch("app.main.os.remove")
def test_delete_photo(mock_remove, mock_exists, client, mock_db_session):
    mock_db_session.query.return_value = MockQuery([
        models.Photo(photo_id=1, event_id=1, file_path="/storage/test.jpg")
    ])
    
    response = client.delete("/photos/1")
    assert response.status_code == 200
    assert response.json() == {"message": "Photo deleted successfully"}
    
    mock_remove.assert_called_once_with("/storage/test.jpg")
    mock_db_session.delete.assert_called_once()
    mock_db_session.commit.assert_called_once()

@patch("app.main.app_face.get")
@patch("app.main.cv2.imdecode")
@patch("app.main.open", new_callable=MagicMock)
@patch("app.main.os.makedirs")
def test_search_faces(mock_makedirs, mock_open, mock_imdecode, mock_face_get, client, mock_db_session):
    mock_imdecode.return_value = MagicMock()
    
    mock_face = MagicMock()
    mock_face.bbox = [0, 0, 100, 100]
    mock_face.embedding.tolist.return_value = [0.1] * 512
    mock_face_get.return_value = [mock_face]
    
    mock_db_session.query.side_effect = lambda *args: MockQuery([
        models.Photo(photo_id=1, event_id=1, file_path="/storage/photo1.jpg")
    ])
    
    response = client.post(
        "/search",
        data={"event_id": 1},
        files={"file": ("selfie.jpg", b"data", "image/jpeg")}
    )
    
    assert response.status_code == 200
    assert response.json() == {"matches": ["/storage/photo1.jpg"]}
    mock_makedirs.assert_called_once_with("/storage/uploads/1", exist_ok=True)
    mock_open.assert_called_once()

@patch("app.main.app_face.get")
@patch("app.main.cv2.imdecode")
@patch("app.main.open", new_callable=MagicMock)
@patch("app.main.os.makedirs")
def test_search_faces_no_face_detected(mock_makedirs, mock_open, mock_imdecode, mock_face_get, client, mock_db_session):
    mock_imdecode.return_value = MagicMock()
    mock_face_get.return_value = []
    
    response = client.post(
        "/search",
        data={"event_id": 1},
        files={"file": ("selfie.jpg", b"data", "image/jpeg")}
    )
    
    assert response.status_code == 400
    assert "No face detected" in response.json()["detail"]
    mock_makedirs.assert_called_once_with("/storage/uploads/1", exist_ok=True)
    mock_open.assert_called_once()

@patch("app.main.shutil.rmtree")
@patch("app.main.os.path.exists", return_value=True)
def test_reset_system(mock_exists, mock_rmtree, client, mock_db_session):
    response = client.delete("/reset")
    assert response.status_code == 200
    assert "System reset successfully" in response.json()["message"]
    mock_db_session.execute.assert_called_once()
    mock_db_session.commit.assert_called_once()
    assert mock_rmtree.call_count == 2
