
# creating VPC with DNS enabled
# having 2 AZ and 4 subnets, a internet gateway, a route table 

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr   

# DNS support is required for ECS to resolve service names to IP addresses
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "sharememories-vpc"
  }
}


# -------------------------------public subnets  ----------------------------------
resource "aws_subnet" "public_zone_1" {
    vpc_id = aws_vpc.main.id
    cidr_block = "10.0.1.0/24"
    availability_zone = var.availability_zones[0]
    map_public_ip_on_launch = true

    tags = {
        Name = "sharememories-public-${var.availability_zones[0]}"
    }
}

resource "aws_subnet" "public_zone_2" {
    vpc_id = aws_vpc.main.id
    cidr_block = "10.0.2.0/24"
    availability_zone = var.availability_zones[1]
    map_public_ip_on_launch = true

    tags = {
        Name = "sharememories-public-${var.availability_zones[1]}"
    }
}


# ---------------------------------private subnets  ----------------------------------
resource "aws_subnet" "private_zone_1" {
    vpc_id = aws_vpc.main.id
    cidr_block = "10.0.3.0/24"
    availability_zone = var.availability_zones[0]

    tags = {
        Name = "sharememories-private-${var.availability_zones[0]}"
    }
}

resource "aws_subnet" "private_zone_2" {
    vpc_id = aws_vpc.main.id
    cidr_block = "10.0.4.0/24"
    availability_zone = var.availability_zones[1]

    tags = {
        Name = "sharememories-private-${var.availability_zones[1]}"
    }
}


# -------------------------------------internet gateway  -------------------------------
resource "aws_internet_gateway" "igw" {
    vpc_id = aws_vpc.main.id

    tags = {
        Name = "sharememories-igw"
    }
}


# -----------------------------route table for public subnets----------------------------
resource "aws_route_table" "public-route-table" {
    vpc_id = aws_vpc.main.id

    route {
        cidr_block = "0.0.0.0/0"
        gateway_id = aws_internet_gateway.igw.id
    }

    tags = {
        Name = "sharememories-public-route-table"
    }
}


# associate public subnets with the route table
resource "aws_route_table_association" "public_zone_1_association" {
    subnet_id = aws_subnet.public_zone_1.id
    route_table_id = aws_route_table.public-route-table.id
}

resource "aws_route_table_association" "public_zone_2_association" {
    subnet_id = aws_subnet.public_zone_2.id
    route_table_id = aws_route_table.public-route-table.id
}


# -----------------------NAT gateway for private subnets -------------------------------
# elastic IP for NAT gateway , static public IP
resource "aws_eip" "nat_eip" {
    domain = "vpc"
}

resource "aws_nat_gateway" "nat_gw" {
    allocation_id = aws_eip.nat_eip.id
    subnet_id = aws_subnet.public_zone_1.id

    tags = {
        Name = "sharememories-nat-gateway"
    }
}

# -------------------------route table for NAT gateway ------------------------------------
resource "aws_route_table" "nat-route-table" {
    vpc_id = aws_vpc.main.id

    route {
        cidr_block = "0.0.0.0/0"
        nat_gateway_id = aws_nat_gateway.nat_gw.id
    }

    tags = {
        Name = "sharememories-nat-route-table"
    }
}


resource "aws_route_table_association" "nat_zone_1_association" {
    subnet_id = aws_subnet.private_zone_1.id
    route_table_id = aws_route_table.nat-route-table.id
}


resource "aws_route_table_association" "nat_zone_2_association" {
    subnet_id = aws_subnet.private_zone_2.id
    route_table_id = aws_route_table.nat-route-table.id
}

