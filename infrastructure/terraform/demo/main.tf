terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "Provenance"
      Environment = "demo"
      ManagedBy   = "Terraform"
      Lifecycle   = "on-demand"
    }
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "demo" {
  name        = "provenance-demo"
  description = "Provenance demo instance — HTTP/HTTPS public, SSH restricted"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP (Caddy redirects to HTTPS and solves ACME http-01)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (Caddy-terminated)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH from operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.your_ip_cidr]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "provenance-demo-sg" }
}

resource "aws_eip" "demo" {
  domain = "vpc"
  tags   = { Name = "provenance-demo-eip" }
}

resource "aws_instance" "demo" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.large"
  key_name                    = var.key_pair_name
  vpc_security_group_ids      = [aws_security_group.demo.id]
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 60
    delete_on_termination = true
    encrypted             = true
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh.tpl", {
    git_sha       = var.git_sha
    demo_domain   = var.demo_domain
    auth_domain   = var.auth_domain
  }))

  tags = { Name = "provenance-demo" }

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip_association" "demo" {
  instance_id   = aws_instance.demo.id
  allocation_id = aws_eip.demo.id
}
