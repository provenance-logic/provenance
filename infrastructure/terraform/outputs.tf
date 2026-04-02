output "primary_public_ip" {
  description = "Elastic IP of the primary EC2 instance (API + databases)."
  value       = aws_eip.primary.public_ip
}

output "frontend_public_ip" {
  description = "Elastic IP of the frontend EC2 instance (web + Kong)."
  value       = aws_eip.frontend.public_ip
}

output "ecr_repository_urls" {
  description = "ECR repository URLs keyed by service name."
  value       = { for k, v in aws_ecr_repository.meshos : k => v.repository_url }
}

output "s3_bucket_name" {
  description = "S3 bucket name for audit log exports and policy artifacts."
  value       = aws_s3_bucket.meshos.bucket
}
