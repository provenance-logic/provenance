# Demo Terraform

On-demand Terraform for a single-instance demo environment. See ADR-004 and
`documents/runbooks/demo-environment.md` for full procedure.

## Quick reference

```bash
terraform init
terraform plan -out demo.tfplan \
  -var "key_pair_name=<name>" \
  -var "your_ip_cidr=<a.b.c.d>/32"
terraform apply demo.tfplan
cp terraform.tfstate "terraform.tfstate.backup-$(date +%Y%m%d)"
```

State is local on purpose. Back up `terraform.tfstate` after every apply.

Route 53 records for `demo_domain` and `auth_domain` are managed outside
Terraform — point them at the `public_ip` output before running the smoke test.

Tear down after the final demo with `terraform destroy`.
