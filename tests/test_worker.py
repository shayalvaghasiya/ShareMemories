import pytest
from unittest.mock import patch, MagicMock
from app.worker import process_photo_task

@patch("app.worker.SessionLocal")
@patch("app.worker.cv2.imread")
@patch("app.worker.app_face.get")
def test_process_photo_task_success(mock_face_get, mock_imread, mock_session_local):
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db
    
    mock_img = MagicMock()
    mock_imread.return_value = mock_img
    
    mock_face = MagicMock()
    mock_face.embedding.tolist.return_value = [0.5] * 512
    mock_face_get.return_value = [mock_face, mock_face]
    
    result = process_photo_task(photo_id=42, file_path="/fake/path.jpg")
    
    assert result == "Processed 2 faces for photo 42"
    mock_imread.assert_called_once_with("/fake/path.jpg")
    mock_face_get.assert_called_once_with(mock_img)
    
    assert mock_db.add.call_count == 2
    mock_db.commit.assert_called_once()
    mock_db.close.assert_called_once()

@patch("app.worker.SessionLocal")
@patch("app.worker.cv2.imread")
def test_process_photo_task_image_read_error(mock_imread, mock_session_local):
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db
    mock_imread.return_value = None
    
    result = process_photo_task(photo_id=42, file_path="/fake/invalid.jpg")
    
    assert "Error: Could not read image" in result
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()
    mock_db.close.assert_called_once()

@patch("app.worker.SessionLocal")
@patch("app.worker.cv2.imread")
@patch("app.worker.app_face.get")
def test_process_photo_task_exception(mock_face_get, mock_imread, mock_session_local):
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db
    
    mock_imread.return_value = MagicMock()
    mock_face_get.side_effect = Exception("Model inference failed")
    
    result = process_photo_task(photo_id=42, file_path="/fake/path.jpg")
    
    assert "Error: Model inference failed" in result
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()
    mock_db.close.assert_called_once()