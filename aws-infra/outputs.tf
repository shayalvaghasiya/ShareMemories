output "alb_dns_name" {
  description = "The public DNS name of the Application Load Balancer"
  value       = aws_lb.alb.dns_name
}

output "database_endpoint" {
  description = "The endpoint of the RDS database"
  value       = aws_db_instance.RDS_instance.address
}
