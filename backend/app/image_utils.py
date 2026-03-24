import io
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

try:
    from PIL import Image, ImageOps
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF_SUPPORT_AVAILABLE = True
except ImportError:
    Image = None
    ImageOps = None
    HEIF_SUPPORT_AVAILABLE = False


HEIC_EXTENSIONS = {".heic", ".heif"}
HEIC_MIME_TYPES = {"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"}


def looks_like_heic(filename: Optional[str], content_type: Optional[str]) -> bool:
    suffix = Path(filename or "").suffix.lower()
    mime_type = (content_type or "").lower()
    return suffix in HEIC_EXTENSIONS or mime_type in HEIC_MIME_TYPES


def decode_image_bytes(contents: bytes) -> Optional[np.ndarray]:
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is not None:
        return img

    if not HEIF_SUPPORT_AVAILABLE:
        return None

    try:
        with Image.open(io.BytesIO(contents)) as pil_img:
            normalized = ImageOps.exif_transpose(pil_img).convert("RGB")
            rgb = np.array(normalized)
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def load_image_from_path(path: str) -> Optional[np.ndarray]:
    try:
        with open(path, "rb") as file_obj:
            return decode_image_bytes(file_obj.read())
    except OSError:
        return None


def encode_jpeg_bytes(img: np.ndarray, quality: int = 90) -> bytes:
    success, encoded = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not success:
        raise ValueError("Could not encode image as JPEG")
    return encoded.tobytes()
