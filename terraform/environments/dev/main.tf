terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "eu-north-1"
}

module "network" {
  source = "../../modules/network"

  environment = "dev"

  vpc_cidr = "10.0.0.0/16"

  availability_zones = [
    "eu-north-1a",
    "eu-north-1b",
  ]

  public_subnet_cidrs = [
    "10.0.1.0/24",
    "10.0.2.0/24",
  ]

  private_subnet_cidrs = [
    "10.0.101.0/24",
    "10.0.102.0/24",
  ]

  enable_nat_gateway = true
}


module "eks" {
  source = "../../modules/eks"

  environment = "dev"

  cluster_name       = "nodejs-microservices-dev"
  kubernetes_version = "1.35"

  private_subnet_ids = module.network.private_subnet_ids

  node_instance_types = [
    "t3.small"
  ]

  node_min_size     = 1
  node_max_size     = 2
  node_desired_size = 1

  admin_principal_arn = "arn:aws:iam::216010984812:user/terraform-admin"
}