output "public_ip" {
  description = "Public IP the demo instance is reachable on (the persistent Elastic IP)."
  value       = data.aws_eip.demo.public_ip
}

output "instance_id" {
  description = "EC2 instance id — needed for tear-down via AWS console if state is lost."
  value       = aws_instance.demo.id
}

output "dns_name" {
  description = "Public hostname for the demo app. DNS is managed out-of-band at Cloudflare (one-time setup, see runbook)."
  value       = var.demo_domain
}

output "auth_dns_name" {
  description = "Public hostname for the demo Keycloak endpoint. DNS is managed out-of-band at Cloudflare (one-time setup, see runbook)."
  value       = var.auth_domain
}

output "ssh_command" {
  description = "Convenience SSH command."
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${data.aws_eip.demo.public_ip}"
}
