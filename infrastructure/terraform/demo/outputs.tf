output "public_ip" {
  description = "Elastic IP attached to the demo instance."
  value       = aws_eip.demo.public_ip
}

output "instance_id" {
  description = "EC2 instance id — needed for tear-down via AWS console if state is lost."
  value       = aws_instance.demo.id
}

output "dns_name" {
  description = "Hostname that should resolve to the Elastic IP — set this in Route 53 before the demo."
  value       = var.demo_domain
}

output "ssh_command" {
  description = "Convenience SSH command."
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.demo.public_ip}"
}
