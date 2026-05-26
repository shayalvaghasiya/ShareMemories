# creating AWS ElastiCache Redis cluster in the private subnets of our VPC

resource "aws_elasticache_subnet_group" "redis_subnet_group" {
    name       = "sharememories-redis-subnet-group"
    subnet_ids = [aws_subnet.private_zone_1.id, aws_subnet.private_zone_2.id]
    description = "Subnet group for Redis cluster"

    tags = {
        Name = "sharememories-redis-subnet-group"
    }
}

resource "aws_elasticache_cluster" "redis_cluster" {
    cluster_id   = "sharememories-redis"
    engine = "redis"
    node_type = "cache.t3.micro"
    num_cache_nodes = 1
    port = 6379
    subnet_group_name = aws_elasticache_subnet_group.redis_subnet_group.name
    security_group_ids = [aws_security_group.redis_sg.id]
}