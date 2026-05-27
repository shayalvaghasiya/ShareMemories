# subnet where rds will be deployed

resource "aws_db_subnet_group" "rds_subnet_group" {
    name = "sharememories-rds-subnet-group"
    subnet_ids = [aws_subnet.private_zone_1.id, aws_subnet.private_zone_2.id]
    description = "Subnet group for RDS instance"

    tags = {
        Name = "sharememories-rds-subnet-group"
    }
}


# RDS instance 
resource "aws_db_instance" "RDS_instance" {
  db_name              = "wedding_db"
  engine               = "postgres"
  engine_version       = "15"
  allocated_storage    =  20
  instance_class       = "db.t3.micro"
  username             = "dbadmin"
  manage_master_user_password = true
  parameter_group_name = "default.postgres15"
  skip_final_snapshot  = true
  db_subnet_group_name = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
}