terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # Uncomment and configure when ready to use remote state.
  # backend "s3" {
  #   bucket = "provenance-terraform-state"
  #   key    = "mvp/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Provenance"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------------------------------------------------------------------------
# VPC — single AZ for MVP; expand for production
# ---------------------------------------------------------------------------
resource "aws_vpc" "provenance" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "provenance-${var.environment}" }
}

resource "aws_internet_gateway" "provenance" {
  vpc_id = aws_vpc.provenance.id
  tags   = { Name = "provenance-igw-${var.environment}" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.provenance.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "provenance-public-${var.environment}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.provenance.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.provenance.id
  }

  tags = { Name = "provenance-rt-public-${var.environment}" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------
resource "aws_security_group" "primary" {
  name        = "provenance-primary-${var.environment}"
  description = "Provenance primary EC2 — all services"
  vpc_id      = aws_vpc.provenance.id

  # SSH
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "SSH access"
  }

  # Kong proxy (HTTP — terminate HTTPS at ALB in production)
  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Kong proxy"
  }

  # Keycloak (accessed via Kong in production; direct for dev)
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "Keycloak"
  }

  # All outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = { Name = "provenance-primary-sg-${var.environment}" }
}

resource "aws_security_group" "frontend" {
  name        = "provenance-frontend-${var.environment}"
  description = "Provenance frontend EC2 — web and Kong admin"
  vpc_id      = aws_vpc.provenance.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
    description = "SSH access"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = { Name = "provenance-frontend-sg-${var.environment}" }
}

# ---------------------------------------------------------------------------
# EC2 key pair
# ---------------------------------------------------------------------------
resource "aws_key_pair" "provenance" {
  key_name   = "provenance-${var.environment}"
  public_key = var.ec2_public_key

  tags = { Name = "provenance-keypair-${var.environment}" }
}

# ---------------------------------------------------------------------------
# Primary EC2 — t3.xlarge
# Runs: NestJS API, Neo4j, PostgreSQL, Redpanda, OPA, OpenSearch,
#       Keycloak, MinIO, Temporal
# ---------------------------------------------------------------------------
resource "aws_instance" "primary" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.xlarge"
  key_name               = aws_key_pair.provenance.key_name
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.primary.id]

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 100
    delete_on_termination = false
    encrypted             = true

    tags = { Name = "provenance-primary-root-${var.environment}" }
  }

  user_data = base64encode(templatefile("${path.module}/user_data/primary.sh", {
    environment = var.environment
  }))

  tags = { Name = "provenance-primary-${var.environment}" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# ---------------------------------------------------------------------------
# Frontend EC2 — t3.medium
# Runs: React frontend (Nginx), Kong API Gateway, Grafana, embedding service
# ---------------------------------------------------------------------------
resource "aws_instance" "frontend" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.medium"
  key_name               = aws_key_pair.provenance.key_name
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.frontend.id]

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 40
    delete_on_termination = false
    encrypted             = true

    tags = { Name = "provenance-frontend-root-${var.environment}" }
  }

  user_data = base64encode(templatefile("${path.module}/user_data/frontend.sh", {
    environment = var.environment
  }))

  tags = { Name = "provenance-frontend-${var.environment}" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# ---------------------------------------------------------------------------
# Elastic IPs
# ---------------------------------------------------------------------------
resource "aws_eip" "primary" {
  instance = aws_instance.primary.id
  domain   = "vpc"
  tags     = { Name = "provenance-eip-primary-${var.environment}" }
}

resource "aws_eip" "frontend" {
  instance = aws_instance.frontend.id
  domain   = "vpc"
  tags     = { Name = "provenance-eip-frontend-${var.environment}" }
}

# ---------------------------------------------------------------------------
# ECR repositories — one per deployable image
# ---------------------------------------------------------------------------
locals {
  ecr_repos = ["api", "agent-query", "embedding", "web"]
}

resource "aws_ecr_repository" "provenance" {
  for_each = toset(local.ecr_repos)

  name                 = "provenance/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "provenance-ecr-${each.key}-${var.environment}" }
}

resource "aws_ecr_lifecycle_policy" "provenance" {
  for_each   = aws_ecr_repository.provenance
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------
# S3 bucket for audit log exports and policy artifacts
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "provenance" {
  bucket = "provenance-${var.environment}-${var.aws_account_id}"
  tags   = { Name = "provenance-storage-${var.environment}" }
}

resource "aws_s3_bucket_versioning" "provenance" {
  bucket = aws_s3_bucket.provenance.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "provenance" {
  bucket = aws_s3_bucket.provenance.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "provenance" {
  bucket                  = aws_s3_bucket.provenance.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
