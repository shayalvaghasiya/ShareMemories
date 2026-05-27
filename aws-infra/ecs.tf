# ==============================================================================
# ECS Cluster & IAM Roles
# ==============================================================================

resource "aws_ecs_cluster" "main" {
  name = "sharememories-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# The Execution Role: Allows ECS to pull images from ECR and write logs to CloudWatch
resource "aws_iam_role" "ecs_execution_role" {
  name = "sharememories-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Attach the AWS managed policy for ECS execution
resource "aws_iam_role_policy_attachment" "ecs_execution_role_policy" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The Task Role: Allows the running containers to call AWS APIs (like S3)
resource "aws_iam_role" "ecs_task_role" {
  name = "sharememories-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_s3_policy" {
  name = "ecs-s3-policy"
  role = aws_iam_role.ecs_task_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.photos.arn,
          "${aws_s3_bucket.photos.arn}/*"
        ]
      }
    ]
  })
}

# Allow ECS Execution Role to read the RDS Secret
resource "aws_iam_role_policy" "ecs_secrets_policy" {
  name = "ecs-secrets-policy"
  role = aws_iam_role.ecs_execution_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_db_instance.RDS_instance.master_user_secret[0].secret_arn,
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })
}

# frontend container task definition 
resource "aws_ecs_task_definition" "frontend" {
    family = "frontend-task"
    network_mode = "awsvpc"
    requires_compatibilities = ["FARGATE"]
    cpu = 256
    memory = 512
    execution_role_arn = aws_iam_role.ecs_execution_role.arn
    container_definitions = jsonencode([
        {
            name = "frontend"
            image = "${aws_ecr_repository.frontend.repository_url}:latest"
            portMappings = [
                {
                    containerPort = 3000
                    hostPort = 3000
                }
            ]
        }
    ])
}

# ECS service for frontend 
resource "aws_ecs_service" "frontend" {
    name = "frontend-service"
    cluster = aws_ecs_cluster.main.id
    task_definition = aws_ecs_task_definition.frontend.arn
    desired_count = 1
    launch_type = "FARGATE"
    network_configuration {
        subnets = [aws_subnet.private_zone_1.id, aws_subnet.private_zone_2.id]
        security_groups = [aws_security_group.ecs_sg.id]
        assign_public_ip = false
    }
    load_balancer {
        target_group_arn = aws_lb_target_group.frontend_target_group.arn
        container_name = "frontend"
        container_port = 3000
    }
}

# Auto-scaling for Frontend Service
resource "aws_appautoscaling_target" "frontend" {
  max_capacity       = 3
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.frontend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "frontend_cpu" {
  name               = "frontend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.frontend.resource_id
  scalable_dimension = aws_appautoscaling_target.frontend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.frontend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
    scale_in_cooldown  = 300 # Wait 5 mins (300s) after traffic drops to terminate containers
    scale_out_cooldown = 60  # Wait 1 min (60s) after a spike before adding MORE containers
  }
}

# backend container task definition
resource "aws_ecs_task_definition" "backend" {
    family = "backend-task"
    network_mode = "awsvpc"
    requires_compatibilities = ["FARGATE"]
    cpu = 256
    memory = 512
    execution_role_arn = aws_iam_role.ecs_execution_role.arn
    task_role_arn      = aws_iam_role.ecs_task_role.arn

    # 1. Define the EFS Volume mapping
    volume {
        name = "efs-storage"
        efs_volume_configuration {
            file_system_id = aws_efs_file_system.efs.id
            root_directory = "/"
        }
    }

    container_definitions = jsonencode([
        {
            name = "backend"
            image = "${aws_ecr_repository.backend.repository_url}:latest"
            portMappings = [
                {
                    containerPort = 8000
                    hostPort = 8000
                }
            ]
            
            # 2. Mount EFS inside the container
            mountPoints = [
                {
                    sourceVolume  = "efs-storage"
                    containerPath = "/storage"
                    readOnly      = false
                }
            ]
            
            # 3. Dynamically pass infrastructure addresses
            environment = [
                { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.redis_cluster.cache_nodes[0].address}:6379/0" },
                { name = "DB_HOST", value = aws_db_instance.RDS_instance.address },
                { name = "DB_NAME", value = aws_db_instance.RDS_instance.db_name },
                { name = "S3_BUCKET_NAME", value = aws_s3_bucket.photos.bucket },
                { name = "FRONTEND_URL", value = "https://aws.sharememories.app" }
            ]
            
            # 4. Securely fetch secrets from AWS Secrets Manager
            secrets = [
                {
                    name      = "DB_USERNAME"
                    valueFrom = "${aws_db_instance.RDS_instance.master_user_secret[0].secret_arn}:username::"
                },
                {
                    name      = "DB_PASSWORD"
                    valueFrom = "${aws_db_instance.RDS_instance.master_user_secret[0].secret_arn}:password::"
                },
                {
                    name      = "APP_SECRET_KEY"
                    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:APP_SECRET_KEY::"
                },
                {
                    name      = "ADMIN_PASSWORD"
                    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ADMIN_PASSWORD::"
                }
            ]
        }
    ])
}

# ECS service for backend       
resource "aws_ecs_service" "backend" {
    name = "backend-service"
    cluster = aws_ecs_cluster.main.id
    task_definition = aws_ecs_task_definition.backend.arn
    desired_count = 1
    launch_type = "FARGATE"
    network_configuration {
        subnets = [aws_subnet.private_zone_1.id, aws_subnet.private_zone_2.id]
        security_groups = [aws_security_group.ecs_sg.id]
        assign_public_ip = false
    }
    load_balancer {
        target_group_arn = aws_lb_target_group.backend_target_group.arn
        container_name = "backend"
        container_port = 8000
    }
}

# Auto-scaling for Backend Service
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = 5
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ==============================================================================
# Celery Worker Task Definition & Service
# ==============================================================================

resource "aws_ecs_task_definition" "worker" {
    family = "worker-task"
    network_mode = "awsvpc"
    requires_compatibilities = ["FARGATE"]
    cpu = 256
    memory = 512
    execution_role_arn = aws_iam_role.ecs_execution_role.arn
    task_role_arn      = aws_iam_role.ecs_task_role.arn

    volume {
        name = "efs-storage"
        efs_volume_configuration {
            file_system_id = aws_efs_file_system.efs.id
            root_directory = "/"
        }
    }

    container_definitions = jsonencode([
        {
            name = "worker"
            image = "${aws_ecr_repository.backend.repository_url}:latest"
            
            # Override the command to start the Celery worker
            command = ["celery", "-A", "app.worker.celery", "worker", "--loglevel=info", "--concurrency=4"]
            
            mountPoints = [
                {
                    sourceVolume  = "efs-storage"
                    containerPath = "/storage"
                    readOnly      = false
                }
            ]
            
            environment = [
                { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.redis_cluster.cache_nodes[0].address}:6379/0" },
                { name = "DB_HOST", value = aws_db_instance.RDS_instance.address },
                { name = "DB_NAME", value = aws_db_instance.RDS_instance.db_name },
                { name = "S3_BUCKET_NAME", value = aws_s3_bucket.photos.bucket },
                { name = "FRONTEND_URL", value = "https://aws.sharememories.app" }
            ]
            
            secrets = [
                {
                    name      = "DB_USERNAME"
                    valueFrom = "${aws_db_instance.RDS_instance.master_user_secret[0].secret_arn}:username::"
                },
                {
                    name      = "DB_PASSWORD"
                    valueFrom = "${aws_db_instance.RDS_instance.master_user_secret[0].secret_arn}:password::"
                },
                {
                    name      = "APP_SECRET_KEY"
                    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:APP_SECRET_KEY::"
                },
                {
                    name      = "ADMIN_PASSWORD"
                    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ADMIN_PASSWORD::"
                }
            ]
        }
    ])
}

resource "aws_ecs_service" "worker" {
    name = "worker-service"
    cluster = aws_ecs_cluster.main.id
    task_definition = aws_ecs_task_definition.worker.arn
    desired_count = 1
    launch_type = "FARGATE"
    network_configuration {
        subnets = [aws_subnet.private_zone_1.id, aws_subnet.private_zone_2.id]
        security_groups = [aws_security_group.ecs_sg.id]
        assign_public_ip = false
    }
    # Notice: No load_balancer block here!
}

# Auto-scaling for Worker Service
# Note: Scaling based on CPU is a good start. A more advanced setup would scale
# based on the number of messages in the Redis (Celery) queue.
resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 10
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "worker-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300 # Prevent scaling in too quickly (5 minutes)
    scale_out_cooldown = 60  # Allow scaling out quickly (1 minute)
  }
}
