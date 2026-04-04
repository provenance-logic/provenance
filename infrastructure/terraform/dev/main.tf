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
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "Provenance"
      Environment = "dev"
      ManagedBy   = "Terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Use the default VPC — no need to create one for a single dev instance
# ---------------------------------------------------------------------------
data "aws_vpc" "default" {
  default = true
}

# ---------------------------------------------------------------------------
# Amazon Linux 2023 AMI
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Security group — SSH, HTTP, web app, API, Keycloak
# ---------------------------------------------------------------------------
resource "aws_security_group" "dev" {
  name        = "provenance-dev"
  description = "Provenance dev instance - all services"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Web app"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "API"
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Keycloak"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "provenance-dev-sg" }
}

# ---------------------------------------------------------------------------
# Key pair — provide your public key via variable or tfvars
# ---------------------------------------------------------------------------
resource "aws_key_pair" "dev" {
  key_name   = "provenance-dev"
  public_key = var.ec2_public_key

  tags = { Name = "provenance-dev-keypair" }
}

# ---------------------------------------------------------------------------
# EC2 instance — t3.medium, Amazon Linux 2023
# ---------------------------------------------------------------------------
resource "aws_instance" "dev" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.medium"
  key_name                    = aws_key_pair.dev.key_name
  vpc_security_group_ids      = [aws_security_group.dev.id]
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 50
    delete_on_termination = true
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -euo pipefail
    exec > /var/log/provenance-bootstrap.log 2>&1

    # Docker
    dnf install -y docker
    systemctl enable --now docker
    usermod -aG docker ec2-user

    # Docker Compose plugin (standalone binary into CLI plugins path)
    COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
      | grep '"tag_name"' | cut -d'"' -f4)
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL \
      "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    # Git
    dnf install -y git

    # Clone repo
    git clone https://github.com/provenance-logic/provenance /opt/provenance
    chown -R ec2-user:ec2-user /opt/provenance

    # Start dev stack (run as ec2-user so the docker group membership applies)
    su - ec2-user -c \
      "docker compose -f /opt/provenance/infrastructure/docker/docker-compose.dev.yml up -d"

    echo "Bootstrap complete"
  EOF
  )

  tags = { Name = "provenance-dev" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
