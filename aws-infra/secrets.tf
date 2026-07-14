# ==============================================================================
# Application Secrets (Admin Password, App Secret)
# ==============================================================================

resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "sharememories-app-secrets"
  description = "Application configuration secrets for ShareMemories"
}

resource "aws_secretsmanager_secret_version" "app_secrets_version" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    APP_SECRET_KEY          = "replace-me-in-aws-console"
    ADMIN_PASSWORD          = "replace-me-in-aws-console"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
