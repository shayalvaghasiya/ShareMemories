# define Load balancer and target groups

resource "aws_lb" "alb" {
    name = "sharememories-alb"
    internal = false
    load_balancer_type = "application"
    security_groups = [aws_security_group.alb_sg.id]
    subnets = [aws_subnet.public_zone_1.id, aws_subnet.public_zone_2.id]
}


# frontend target group 
resource "aws_lb_target_group" "frontend_target_group" {
    name = "sharememories-frontend-tg"
    port = 3000
    protocol = "HTTP"
    vpc_id = aws_vpc.main.id
    target_type = "ip"    
}

# backend target group 
resource "aws_lb_target_group" "backend_target_group" {
    name = "sharememories-backend-tg"
    port = 8000
    protocol = "HTTP"
    health_check {
        path = "/docs"
    }
    vpc_id = aws_vpc.main.id
    target_type = "ip"    
}



# frontend listner
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.alb.arn
  port     = 80
  protocol = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS Listener (Port 443)
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate_validation.cert_validation.certificate_arn

  # Default action: route to frontend
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend_target_group.arn
  }
}

# Route api.sharememories.app traffic to the backend target group
resource "aws_lb_listener_rule" "api_routing" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend_target_group.arn
  }

  condition {
    host_header {
      values = [var.api_domain]
    }
  }
}
