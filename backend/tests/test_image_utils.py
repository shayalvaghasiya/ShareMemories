import numpy as np
from unittest.mock import MagicMock

from app import image_utils


def test_looks_like_heic_matches_extension_and_mime_type():
    assert image_utils.looks_like_heic("portrait.HEIC", "application/octet-stream") is True
    assert image_utils.looks_like_heic("portrait.jpg", "image/heif") is True
    assert image_utils.looks_like_heic("portrait.jpg", "image/jpeg") is False


def test_decode_image_bytes_prefers_opencv(monkeypatch):
    expected = np.zeros((2, 2, 3), dtype=np.uint8)
    monkeypatch.setattr(image_utils.cv2, "imdecode", lambda *_args, **_kwargs: expected)

    decoded = image_utils.decode_image_bytes(b"jpeg-bytes")

    assert decoded is expected


def test_decode_image_bytes_falls_back_to_pillow_for_heic(monkeypatch):
    expected = np.ones((3, 3, 3), dtype=np.uint8)
    mock_pil_image = MagicMock()
    mock_pil_image.convert.return_value = "rgb-image"

    class DummyContextManager:
        def __enter__(self):
            return mock_pil_image

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(image_utils.cv2, "imdecode", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(image_utils, "HEIF_SUPPORT_AVAILABLE", True)
    monkeypatch.setattr(image_utils, "Image", MagicMock(open=MagicMock(return_value=DummyContextManager())))
    monkeypatch.setattr(image_utils, "ImageOps", MagicMock(exif_transpose=MagicMock(return_value=mock_pil_image)))
    monkeypatch.setattr(image_utils, "cv2", MagicMock(imdecode=lambda *_a, **_k: None, cvtColor=MagicMock(return_value=expected), COLOR_RGB2BGR=1))
    monkeypatch.setattr(image_utils.np, "array", lambda *_args, **_kwargs: "rgb-array")

    decoded = image_utils.decode_image_bytes(b"heic-bytes")

    assert decoded is expected
