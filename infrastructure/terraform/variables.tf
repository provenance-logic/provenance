variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (e.g. mvp, staging, production)."
  type        = string
  default     = "mvp"
}

variable "aws_account_id" {
  description = "AWS account ID — used for globally unique S3 bucket naming."
  type        = string
}

variable "ec2_public_key" {
  description = "SSH public key material to install on EC2 instances."
  type        = string
  sensitive   = true
}

variable "ssh_allowed_cidrs" {
  description = "CIDR blocks permitted to SSH into EC2 instances. Restrict to your team's IPs."
  type        = list(string)
  default     = ["0.0.0.0/0"]  # Tighten before deploying to production.
}

variable "github_org" {
  description = "GitHub organization or user name (for OIDC role trust policy)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (for OIDC role trust policy)."
  type        = string
  default     = "meshos-platform"
}
