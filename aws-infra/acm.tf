# Request the SSL Certificate
resource "aws_acm_certificate" "cert" {
  domain_name               = "sharememories.app"
  subject_alternative_names = ["*.sharememories.app"]
  validation_method         = "DNS"

  tags = {
    Name = "sharememories-cert"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Pause Terraform until the certificate is validated via Name.com
resource "aws_acm_certificate_validation" "cert_validation" {
  certificate_arn = aws_acm_certificate.cert.arn
}
