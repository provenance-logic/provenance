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
  description = "Provenance demo instance - HTTP/HTTPS public, SSH restricted"
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

data "aws_eip" "demo" {
  filter {
    name   = "tag:Name"
    values = [var.eip_name_tag]
  }
}

# Persistent EBS volume that holds Caddy's TLS cert state across demo cycles.
# Looked up by Name tag (mirrors the EIP pattern) so terraform destroy never
# removes it. The volume lives in us-east-1c, which means every demo instance
# also has to launch in us-east-1c — EBS volumes can only attach within their
# own AZ. The aws_subnet data source below pins the instance to the same AZ.
data "aws_ebs_volume" "caddy_data" {
  filter {
    name   = "tag:Name"
    values = [var.caddy_data_volume_name_tag]
  }
  most_recent = true
}

# Default subnet in the persistent volume's AZ. The default VPC has one default
# subnet per AZ; we want the one whose AZ matches the EBS volume so the volume
# attachment doesn't fail.
data "aws_subnet" "demo" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = data.aws_ebs_volume.caddy_data.availability_zone
  default_for_az    = true
}

resource "aws_instance" "demo" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.xlarge"
  key_name                    = var.key_pair_name
  vpc_security_group_ids      = [aws_security_group.demo.id]
  subnet_id                   = data.aws_subnet.demo.id
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
  allocation_id = data.aws_eip.demo.id
}

# Attach the persistent Caddy data volume. The volume itself is preserved
# across terraform destroy; only this attachment is recreated each cycle.
# /dev/sdf is what we ask for; AL2023's NVMe driver renames it under
# /dev/nvme1n1 — user-data discovers the device by Linux symlink rather
# than hardcoding /dev/sdf.
resource "aws_volume_attachment" "caddy_data" {
  device_name = "/dev/sdf"
  volume_id   = data.aws_ebs_volume.caddy_data.id
  instance_id = aws_instance.demo.id

  # Without this, a terraform destroy hangs waiting for the OS to release the
  # volume (it's mounted). Force-detach is safe because the instance itself is
  # also being destroyed in the same plan.
  force_detach = true
}
