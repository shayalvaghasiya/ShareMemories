resource "aws_ecr_repository" "backend" {
  name                 = "sharememories-backend"
  image_tag_mutability = "MUTABLE"
  force_delete        = true # Allows you to easily tear down the infra later
}

resource "aws_ecr_repository" "frontend" {
  name                 = "sharememories-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete        = true
}