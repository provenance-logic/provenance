# IAM resources for GitHub Actions OIDC authentication.
# This allows GitHub Actions to assume an AWS role without long-lived access keys.

# ---------------------------------------------------------------------------
# GitHub OIDC provider
# ---------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint (stable — rotated by GitHub when needed)
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# ---------------------------------------------------------------------------
# GitHub Actions role
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "meshos-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
  tags               = { Name = "meshos-github-actions" }
}

# ---------------------------------------------------------------------------
# Permissions for the GitHub Actions role
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "github_actions_permissions" {
  # ECR — build and push images
  statement {
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = ["*"]
  }

  # SSM — deploy commands to EC2 instances
  statement {
    effect = "Allow"
    actions = [
      "ssm:SendCommand",
      "ssm:GetCommandInvocation",
    ]
    resources = ["*"]
  }

  # S3 — Terraform state (if using S3 backend)
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::meshos-terraform-state", "arn:aws:s3:::meshos-terraform-state/*"]
  }

  # EC2 — Terraform infrastructure management
  statement {
    effect    = "Allow"
    actions   = ["ec2:*"]
    resources = ["*"]
  }

  # IAM — limited to what Terraform needs for OIDC setup (not full IAM admin)
  statement {
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:TagRole",
      "iam:CreateOpenIDConnectProvider",
      "iam:GetOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "meshos-github-actions-policy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_permissions.json
}
