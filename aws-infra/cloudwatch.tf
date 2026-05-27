# ==============================================================================
# CloudWatch Dashboard for Application Monitoring
# ==============================================================================

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "ShareMemories-Production-Dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.frontend.name, "ClusterName", aws_ecs_cluster.main.name],
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.backend.name, "ClusterName", aws_ecs_cluster.main.name],
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.worker.name, "ClusterName", aws_ecs_cluster.main.name]
          ]
          region  = "us-east-1"
          title   = "ECS Services CPU Utilization (%)"
          period  = 60
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ServiceName", aws_ecs_service.frontend.name, "ClusterName", aws_ecs_cluster.main.name],
            ["ECS/ContainerInsights", "RunningTaskCount", "ServiceName", aws_ecs_service.backend.name, "ClusterName", aws_ecs_cluster.main.name],
            ["ECS/ContainerInsights", "RunningTaskCount", "ServiceName", aws_ecs_service.worker.name, "ClusterName", aws_ecs_cluster.main.name]
          ]
          region  = "us-east-1"
          title   = "Active Container Count"
          period  = 60
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.alb.arn_suffix]
          ]
          region  = "us-east-1"
          title   = "ALB Total Request Count"
          period  = 60
          stat    = "Sum"
        }
      }
    ]
  })
}