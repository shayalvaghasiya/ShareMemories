# ==============================================================================
# 1. Application Load Balancer (ALB) Security Group
# Allows public web traffic (Port 80 and 443) from anywhere on the internet.
# ==============================================================================

resource "aws_security_group" "alb_sg" {
  name        = "sharememories-alb-sg"
  description = "Allow HTTP and HTTPS inbound traffic"
  vpc_id      = aws_vpc.main.id

  # HTTP
  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound (Egress) - Allow the ALB to send traffic anywhere
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1" # -1 means all protocols
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "sharememories-alb-sg"
  }
}


# ==============================================================================
# 2. ECS Security Group
# Only allow inbound traffic from ALB 
# ==============================================================================

resource "aws_security_group" "ecs_sg" {
    name = "sharememories-ecs-sg"
    vpc_id = aws_vpc.main.id
    description = "Allow inbound traffic from ALB"

    # FastAPI
    ingress {
        description = "Only allow traffic on port 8000 if it physically came from the Load Balancer"
        from_port   = 8000
        to_port     = 8000
        protocol    = "tcp"
        security_groups = [aws_security_group.alb_sg.id]
    }

    # Outbound (Egress)
    egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1" # -1 means all protocols
        cidr_blocks = ["0.0.0.0/0"]
    }

    tags = {
        Name = "sharememories-ecs-sg"
    }
}


# ==============================================================================
# 3. RDS Security Group
# Only allow inbound traffic from ECS
# ==============================================================================

resource "aws_security_group" "rds_sg" {
    name = "sharememories-rds-sg"
    vpc_id = aws_vpc.main.id
    description = "Allow inbound traffic from ECS"

    # RDS
    ingress {
        description = "Only allow traffic on port 5432 if it physically came from the ECS cluster"
        from_port   = 5432
        to_port     = 5432
        protocol    = "tcp"
        security_groups = [aws_security_group.ecs_sg.id]
    }

    # Outbound (Egress)
    egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1" # -1 means all protocols
        cidr_blocks = ["0.0.0.0/0"]
    }

    tags = {
        Name = "sharememories-rds-sg"
    }
}