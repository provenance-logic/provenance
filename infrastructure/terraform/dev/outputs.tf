output "instance_public_ip" {
  description = "Public IP address of the dev EC2 instance."
  value       = aws_instance.dev.public_ip
}

output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.dev.id
}

output "ssh_command" {
  description = "SSH command to connect to the instance."
  value       = "ssh -i <your-private-key>.pem ec2-user@${aws_instance.dev.public_ip}"
}
