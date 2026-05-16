output "public_ip" {
  description = "Elastic IP attached to the demo instance."
  value       = aws_eip.demo.public_ip
}

output "instance_id" {
  description = "EC2 instance id — needed for tear-down via AWS console if state is lost."
  value       = aws_instance.demo.id
}

output "dns_name" {
  description = "Public hostname for the demo app (A record managed by this module)."
  value       = aws_route53_record.demo.fqdn
}

output "auth_dns_name" {
  description = "Public hostname for the demo Keycloak endpoint (A record managed by this module)."
  value       = aws_route53_record.auth_demo.fqdn
}

output "ssh_command" {
  description = "Convenience SSH command."
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.demo.public_ip}"
}
