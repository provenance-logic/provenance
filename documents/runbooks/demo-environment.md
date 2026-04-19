# Demo Environment Runbook

**For context on why this environment exists, see:** `documents/architecture/adr/ADR-004-demo-environment-strategy.md`

This is the procedural document. Read it at T-24h before a demo. Follow the numbered steps. Do not improvise under demo-day pressure.

---

## Environment Overview

| Property | Value |
| --- | --- |
| URL | https://demo.provenancelogic.com |
| Keycloak | https://auth-demo.provenancelogic.com |
| AWS Region | us-east-1 |
| Terraform | `infrastructure/terraform/demo/` |
| Seed package | `packages/seed/` |
| Demo scripts | `infrastructure/scripts/demo-*.sh` |
| Terraform state | Local (in `infrastructure/terraform/demo/terraform.tfstate`) |

**Important:** Terraform state is local. Back up `terraform.tfstate` after provisioning. If the file is lost, you will need to manually destroy the EC2 instance from the AWS console.

---

## T-24h Checklist

Run this the day before the demo.

- [ ] Confirm the git SHA you want to demo is merged to main and all CI checks pass
- [ ] Confirm seed data in `packages/seed/` reflects the demo narrative you intend to tell
- [ ] Run `npm run seed:verify` locally against a dev database to confirm seed consistency
- [ ] Confirm `infrastructure/terraform/demo/variables.tf` has the correct instance size and domain configuration
- [ ] Confirm your AWS credentials are active: `aws sts get-caller-identity`
- [ ] Confirm Route 53 hosted zone for `provenancelogic.com` is accessible
- [ ] Run Terraform plan (Step 2 below) and verify no unexpected changes

---

## Step 1 - Provision the Instance

```bash
cd infrastructure/terraform/demo
terraform init
terraform plan -out=demo.tfplan
# Review the plan. Expect: 1 EC2 instance, 1 security group, 1 EIP, 1 Route 53 record.
terraform apply demo.tfplan
```

Note the outputs:
- `public_ip` - the instance IP
- `instance_id` - needed for tear-down
- `dns_name` - should be demo.provenancelogic.com

**Back up terraform.tfstate now:**
```bash
cp terraform.tfstate terraform.tfstate.backup-$(date +%Y%m%d)
```

Wait 2-3 minutes for the instance to fully initialize before proceeding.

---

## Step 2 - Bootstrap the Instance

```bash
# SSH to the new instance
ssh -i ~/.ssh/[your-key].pem ec2-user@demo.provenancelogic.com

# Run bootstrap (installs Docker, clones repo, configures Caddy, creates .env)
bash infrastructure/scripts/demo-bootstrap.sh
```

Bootstrap completes when you see: `Bootstrap complete. Ready for demo-sync.`

This takes approximately 5-8 minutes on first run.

---

## Step 3 - Sync and Seed

```bash
# From within the demo instance
bash infrastructure/scripts/demo-sync.sh [git-sha]
```

Replace `[git-sha]` with the specific commit SHA you want to demo. Using `main` is acceptable if main is stable and you verified it in the T-24h checklist.

`demo-sync.sh` does the following in order:
1. Pulls the Docker image at the specified SHA
2. Runs database migrations (`flyway migrate`)
3. Imports the Keycloak realm (`configure-keycloak-demo.sh`)
4. Runs the seed package (`npm run seed`)
5. Runs the smoke test (`demo-smoke-test.sh`)

If any step fails, the script exits with a non-zero code and a message identifying the failure. Do not proceed to the demo if the smoke test fails.

> **Idempotency warning — do not run demo-sync during a live demo session.**
> `demo-sync.sh` re-runs `npm run seed` every time it executes. Whether that is data-preserving depends entirely on whether the seed API endpoints are implemented as upserts (idempotent) or plain inserts (duplicating on each run). As of this runbook, that behavior has not been independently verified.
> Before running `demo-sync.sh` against a demo that already has live demo state (users who have clicked around, agents that have emitted lineage, etc.), either: (a) verify the seed endpoints are upsert-based by inspecting `POST /seed/*` handlers and their tests, or (b) run `demo-reset.sh --hard` first so the sync starts from a truncated base. The safe rule: treat `demo-sync.sh` as a between-demos operation, not a during-demo operation.

---

## Step 4 - Run the Smoke Test

The smoke test runs automatically at the end of `demo-sync.sh`. You can also run it independently at any time:

```bash
bash infrastructure/scripts/demo-smoke-test.sh https://demo.provenancelogic.com
```

The smoke test checks six layers:

**Infrastructure layer:**
- API health endpoint returns 200 with valid TLS cert
- Keycloak OIDC configuration endpoint returns 200
- All Docker Compose services report healthy

**Auth layer:**
- Seeded test user obtains a JWT via direct grant
- JWT contains expected claims (`provenance_org_id`, `provenance_principal_id`, `provenance_principal_type`)
- Authenticated API call succeeds with that JWT

**Control plane layer:**
- Seeded org is present (GET /organizations/me)
- Seeded products are present at expected count
- Product detail endpoint returns expected enrichment fields (schema, ownership, freshness, access status)

**Agent layer:**
- Seeded agent obtains a JWT via client_credentials grant
- MCP SSE endpoint at port 3002 accepts connection with agent JWT
- `list_products` MCP tool call succeeds end-to-end

**Data plane layer:**
- Neo4j returns expected lineage edges for a known seeded product
- OpenSearch returns hits from both `data_products` and `provenance-products` indices for a known product name
- PostgreSQL row-level security is active (cross-org query returns zero rows)

**Observability layer:**
- Trust score is computed for at least one seeded product

**Expected runtime:** under 60 seconds.

**Exit codes:** 0 = all checks pass. Non-zero = specific failure message identifying which check failed and which layer.

**Do not proceed to the demo if the smoke test exits non-zero.**

---

## Between Back-to-Back Demos (Soft Reset)

If you are running multiple demos on the same provisioned instance, run a soft reset between them to clear transactional state (audit log entries, trust score fluctuations, lineage events from the demo session) while keeping the base seed intact.

```bash
bash infrastructure/scripts/demo-reset.sh --soft
```

Run the smoke test after the soft reset before proceeding to the next demo.

---

## Step 5 - Tear Down After Final Demo

After the last demo on a provisioned instance, destroy it. Do not leave it running idle.

```bash
cd infrastructure/terraform/demo
terraform destroy
# Type 'yes' to confirm
```

Verify destruction in the AWS console: EC2 instance terminated, EIP released, Route 53 record removed.

---

## Rollback Procedures

**Smoke test fails after demo-sync:**

1. Check which layer failed from the smoke test output
2. For auth layer failures: re-run `configure-keycloak-demo.sh` manually and re-run the smoke test
3. For control plane or data layer failures: run `npm run seed:reset:hard` and re-run `demo-sync.sh`
4. If failures persist after a hard reset: tear down and reprovision from Step 1

**demo-sync.sh fails mid-run:**

1. Check the error output to identify which step failed
2. Migration failures: check `flyway info` for migration state; manually repair if needed
3. Seed failures: run `npm run seed:reset:hard` and re-run `npm run seed`
4. If the instance is in an unknown state: tear down and reprovision

**Demo-day emergency - instance not responding:**

1. Check EC2 instance status in AWS console (us-east-1)
2. If instance is stopped: start it from the console; wait 2 minutes; re-run smoke test
3. If instance is terminated or unreachable: you do not have time to reprovision
4. Fallback option: run the demo against dev.provenancelogic.com if dev is in a stable state
5. Always have the dev environment smoke-tested and available as a fallback before a demo

---

## Seed Package Reference

| Command | What it does |
| --- | --- |
| `npm run seed` | Full seed from empty database |
| `npm run seed:reset:soft` | Clears transactional state; keeps base seed |
| `npm run seed:reset:hard` | Destroys all data and reseeds from scratch |
| `npm run seed:verify` | Checks seeded state is internally consistent |

Seed data lives in `packages/seed/src/`:

| Directory | Contents |
| --- | --- |
| `orgs/` | Seed organizations (demo tenant) |
| `policies/` | OPA policy seed data |
| `users/` | Keycloak user seeds |
| `products/` | Data product definitions with port contracts and connection details |
| `agents/` | Registered agent seeds with JWT client configs |
| `lineage/` | Declared lineage edges for the demo narrative |

**To update the demo narrative:** edit the files in `packages/seed/src/products/` and `packages/seed/src/lineage/`. Run `npm run seed:verify` locally to confirm consistency before the next demo.

---

## Terraform State Note

Terraform state for the demo environment is local at `infrastructure/terraform/demo/terraform.tfstate`. This is intentional for simplicity at current scale.

**Back up the state file after every `terraform apply`.** If the state file is lost while an instance is running, you must destroy the instance manually from the AWS console and clean up the Route 53 record by hand.

When the business reaches Phase 6, migrate state to S3:
```hcl
backend "s3" {
  bucket = "provenance-terraform-state"
  key    = "demo/terraform.tfstate"
  region = "us-east-1"
}
```

---

## Demo Script Reference

| Script | When to run |
| --- | --- |
| `demo-bootstrap.sh` | Once per provisioned instance, immediately after Terraform apply |
| `demo-sync.sh [sha]` | Once per demo, after bootstrap |
| `demo-smoke-test.sh [base-url]` | After sync, after soft reset, any time you want to verify |
| `demo-reset.sh --soft` | Between back-to-back demos on the same instance |
| `demo-reset.sh --hard` | When recovering from a corrupted state |
