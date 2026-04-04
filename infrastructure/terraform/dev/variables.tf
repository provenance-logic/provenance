variable "ec2_public_key" {
  description = "SSH public key material to install on the dev EC2 instance."
  type        = string
  sensitive   = true
}
