provider "aws" {
    region = var.aws_region
}

terraform {
  required_version = ">= 1.13"
  backend "s3" {
    bucket         = "tf-state-bucket-sharememories"
    key            = "sharememories/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.46"
    }
  }
}