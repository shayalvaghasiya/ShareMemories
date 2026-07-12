variable "environment" {
    description = "Deployment env name"
    type = string
    default = "dev"
}

variable "aws_region" {
    description = "AWS region"
    type = string
    default = "us-east-1"
}

variable "vpc_cidr" {
    description = "CIDR block for VPC"
    type = string
    default = "10.0.0.0/16"
}

variable "availability_zones" {
    description = "Availability zones for public and private subnets"
    type = list(string)
    default = ["us-east-1a", "us-east-1b"]
}

variable "root_domain" {
    description = "Root domain for the application"
    type = string
    default = "sharememories.app"
}

variable "frontend_domain" {
    description = "Frontend domain for the application"
    type = string
    default = "aws.sharememories.app"
}

variable "api_domain" {
    description = "API domain for the application"
    type = string
    default = "api-aws.sharememories.app"
}

variable "s3_cors_allowed_origins" {
    description = "List of allowed origins for S3 CORS configuration"
    type = list(string)
    default = ["https://aws.sharememories.app"]
}

variable "rds_instance_class" {
    description = "RDS postgres instance class"
    type = string
    default = "db.t3.micro"
}

variable "rds_allocated_storage" {
  description = "Allocated RDS storage in GB"
  type        = number
  default     = 20
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of Redis cache nodes"
  type        = number
  default     = 1
}

variable "frontend_cpu" {
  type    = number
  default = 256
}

variable "frontend_memory" {
  type    = number
  default = 512
}

variable "frontend_desired_count" {
  type    = number
  default = 1
}

variable "backend_cpu" {
  type    = number
  default = 1024
}

variable "backend_memory" {
  type    = number
  default = 4096
}

variable "backend_desired_count" {
  type    = number
  default = 1
}

variable "worker_cpu" {
  type    = number
  default = 1024
}

variable "worker_memory" {
  type    = number
  default = 4096
}

variable "worker_desired_count" {
  type    = number
  default = 1
}


variable "frontend_min_capacity" {
  type    = number
  default = 1
}

variable "frontend_max_capacity" {
  type    = number
  default = 3
}

variable "backend_min_capacity" {
  type    = number
  default = 1
}

variable "backend_max_capacity" {
  type    = number
  default = 5
}

variable "worker_min_capacity" {
  type    = number
  default = 1
}

variable "worker_max_capacity" {
  type    = number
  default = 10
}