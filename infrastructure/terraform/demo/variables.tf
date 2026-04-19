variable "region" {
  description = "AWS region for the demo instance."
  type        = string
  default     = "us-east-1"
}

variable "key_pair_name" {
  description = "Name of an existing EC2 key pair in the target region for SSH access."
  type        = string
}

variable "your_ip_cidr" {
  description = "Operator IP in CIDR form (e.g. 203.0.113.7/32) — SSH is only allowed from this address."
  type        = string

  validation {
    condition     = can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/(32|[12][0-9]|[0-9])$", var.your_ip_cidr))
    error_message = "your_ip_cidr must be a valid IPv4 CIDR (prefer /32 for a single operator)."
  }
}

variable "git_sha" {
  description = "Git SHA to deploy. Use 'main' only if main is known stable (see T-24h checklist)."
  type        = string
  default     = "main"
}

variable "demo_domain" {
  description = "Public hostname served by the demo instance."
  type        = string
  default     = "demo.provenancelogic.com"
}

variable "auth_domain" {
  description = "Public hostname for the demo Keycloak endpoint."
  type        = string
  default     = "auth-demo.provenancelogic.com"
}
