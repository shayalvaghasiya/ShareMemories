
# EFS (elastic file system) for shared storage between containers

resource "aws_efs_file_system" "efs" {
    creation_token = "sharememories-efs"
    encrypted = true
}

resource "aws_efs_mount_target" "efs_mount_target_zone_1" {
    file_system_id = aws_efs_file_system.efs.id
    subnet_id = aws_subnet.private_zone_1.id
    security_groups = [aws_security_group.efs_sg.id]
}

resource "aws_efs_mount_target" "efs_mount_target_zone_2" {
    file_system_id = aws_efs_file_system.efs.id
    subnet_id = aws_subnet.private_zone_2.id
    security_groups = [aws_security_group.efs_sg.id]
}