# ==============================================================================
# Amazon S3 Bucket for Raw Image Storage
# ==============================================================================

resource "random_string" "s3_suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "aws_s3_bucket" "photos" {
  bucket        = "sharememories-photos-${random_string.s3_suffix.result}"
  force_destroy = true

  tags = {
    Name = "ShareMemories Raw Photos"
  }
}

# Allow browsers to upload directly via pre-signed URLs
resource "aws_s3_bucket_cors_configuration" "photos_cors" {
  bucket = aws_s3_bucket.photos.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST"]
    allowed_origins = ["*"] # In a strict production environment, specify your domain e.g., ["https://sharememories.app"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}