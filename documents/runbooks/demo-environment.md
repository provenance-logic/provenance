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

> **Current state (2026-05-30):** the demo box is **provisioned and kept running** for a self-paced walkthrough — *not* torn down after a single demo. Teardown (Step 5) remains the lifecycle end-state; it's just deferred while the box is in active use. The strategy is unchanged (on-demand, per ADR-004) — the box simply isn't always cycled down between sessions when someone is iterating on it. To bring a standing box up to a newer `main`, see "Updating a standing box" under Step 3.

---

## DNS and Elastic IP — one-time setup

Demo DNS works the same way as `dev.provenancelogic.com`: a single Elastic IP is allocated once and tagged, Cloudflare A records point at that IP, and from that point on terraform attaches each newly-provisioned demo instance to the same EIP. DNS never has to change per demo cycle.

**You only need to do this once per AWS account.** If `34.204.222.196` is already tagged and Cloudflare already has the records, skip this section.

1. **Allocate an Elastic IP in `us-east-1`** (AWS console → EC2 → Elastic IPs → Allocate Elastic IP address), or reuse an existing unassociated one.
2. **Tag it** with `Name=provenance-demo-eip`. This tag is how the demo terraform module finds it (`data "aws_eip" "demo"` in `main.tf`).
3. **Add two A records at Cloudflare** for the `provenancelogic.com` zone:
   - `demo` → the EIP, proxy mode **DNS only** (gray cloud)
   - `auth-demo` → the EIP, proxy mode **DNS only** (gray cloud)

   Both must be DNS-only (not proxied through Cloudflare) so Caddy can complete Let's Encrypt http-01 challenges directly on port 80.

If you ever need to rotate the EIP, retag the new one with `Name=provenance-demo-eip`, update the two Cloudflare A records to the new IP, then `terraform apply` to re-associate the existing demo instance (or `terraform taint aws_eip_association.demo` first to force re-association).

---

## Persistent Caddy data EBS volume — one-time setup

Caddy's TLS cert store lives on a small EBS volume that survives `terraform destroy`, so each demo cycle reuses the existing valid Let's Encrypt cert instead of asking LE for a fresh one. This sidesteps LE's `5 certificates per 7-day rolling window per identifier set` rate limit — the constraint that bit us on 2026-05-16 (see [B-049](../bugs/resolved.md#b-049)). Without this volume, ~5 demo cycles per week is the hard cap, and a single bug-fix-retry loop can burn through that budget in an afternoon.

**You only need to do this once per AWS account.** If `vol-0fd2383ae142d2c95` (or any volume tagged `Name=provenance-demo-caddy-data`) already exists in us-east-1c, skip this section.

1. **Pick an availability zone.** The volume's AZ pins the demo instance's AZ — EBS can only attach to instances in the same AZ. We use `us-east-1c` because that's where the original demo instance happened to land. Any AZ in us-east-1 works; just be consistent.

2. **Allocate a 1 GB gp3 EBS volume** in the chosen AZ:

   ```bash
   aws ec2 create-volume \
     --availability-zone us-east-1c \
     --size 1 --volume-type gp3 --encrypted \
     --tag-specifications 'ResourceType=volume,Tags=[
       {Key=Name,Value=provenance-demo-caddy-data},
       {Key=Project,Value=Provenance},
       {Key=Environment,Value=demo},
       {Key=Lifecycle,Value=persistent}]'
   ```

3. **Done.** Terraform's `data "aws_ebs_volume" "caddy_data"` block (see `infrastructure/terraform/demo/main.tf`) looks up the volume by tag. Every `terraform apply` after this finds it and attaches it. `terraform destroy` removes the attachment but never the volume.

4. **(Optional) Verify.** First `terraform apply` after creating the volume will detect "no filesystem" and run `mkfs.ext4` once. Subsequent applies skip the format step because the filesystem already exists.

If you ever need to recreate the volume (data loss / corruption / deliberately starting fresh on cert state), `aws ec2 delete-volume --volume-id <old>` then recreate with the same tag. The next `terraform apply` will format the new volume on first mount.

**Cost:** ~$0.10/month for a 1 GB gp3 volume. Negligible.

---

## T-24h Checklist

Run this the day before the demo.

- [ ] Confirm the git SHA you want to demo is merged to main and all CI checks pass
- [ ] Confirm seed data in `packages/seed/` reflects the demo narrative you intend to tell
- [ ] Run `npm run seed:verify` locally against a dev database to confirm seed consistency
- [ ] Confirm `infrastructure/terraform/demo/variables.tf` has the correct instance size and domain configuration
- [ ] Confirm your AWS credentials are active: `aws sts get-caller-identity`
- [ ] Confirm the persistent demo Elastic IP exists with tag `Name=provenance-demo-eip` (one-time setup; see "DNS and Elastic IP — one-time setup" above)
- [ ] Confirm Cloudflare A records for `demo.provenancelogic.com` and `auth-demo.provenancelogic.com` both point at that EIP (one-time setup)
- [ ] Confirm the persistent Caddy data EBS volume exists with tag `Name=provenance-demo-caddy-data` in us-east-1c (one-time setup; see "Persistent Caddy data EBS volume — one-time setup" above). Without this, Let's Encrypt will eventually rate-limit and the demo will break in browsers.
- [ ] Run Terraform plan (Step 2 below) and verify no unexpected changes

---

## Step 1 - Provision the Instance

```bash
cd infrastructure/terraform/demo
terraform init
terraform plan -out=demo.tfplan \
  -var "key_pair_name=provenance-demo" \
  -var "your_ip_cidr=<your-public-ip>/32"
# Review the plan. Expect: 1 EC2 instance, 1 security group, 1 EIP
# association, 1 EBS volume attachment — four resources to add.
# The Elastic IP and the Caddy-data EBS volume are pre-allocated and
# looked up by tag — terraform does not create or destroy them. DNS is
# also managed out-of-band at Cloudflare.
terraform apply demo.tfplan
```

Note the outputs:
- `public_ip` - the persistent demo Elastic IP
- `instance_id` - needed for tear-down
- `dns_name` - `demo.provenancelogic.com` (already points at `public_ip` via Cloudflare)
- `auth_dns_name` - `auth-demo.provenancelogic.com` (same)

**Back up terraform.tfstate now:**
```bash
cp terraform.tfstate terraform.tfstate.backup-$(date +%Y%m%d)
```

Wait 2-3 minutes for the instance to fully initialize before proceeding.

---

## Step 2 - Bootstrap the Instance

Bootstrap runs **automatically** as part of EC2 user-data — you do not need to SSH in and run it yourself. The `user-data.sh.tpl` installs Docker / Node / pnpm, clones the repo at the requested git SHA, mounts the persistent Caddy-data EBS volume at `/var/lib/caddy-data`, then invokes `demo-bootstrap.sh`. Total time ~5-8 minutes from `terraform apply` complete to "Bootstrap complete."

To watch progress:

```bash
ssh -i ~/.ssh/[your-key].pem ec2-user@demo.provenancelogic.com
sudo tail -f /var/log/provenance-bootstrap.log
```

The log ends with `Bootstrap complete. Ready for demo-sync.` followed by `user-data complete`. Wait for both lines before moving to Step 3.

If user-data fails (rare — usually transient network issues during dnf install or git clone), look at `/var/log/cloud-init-output.log` for the underlying error; you can re-run `bash /opt/provenance/infrastructure/scripts/demo-bootstrap.sh` manually after fixing it, as bootstrap is idempotent.

> **Compose override note.** Both `demo-bootstrap.sh` and `demo-sync.sh` invoke `docker compose` with two files: the base `docker-compose.ec2-dev.yml` plus the demo-specific `docker-compose.demo.yml` override. The override redirects Caddy's `caddy_data` named volume to a bind-mount on `/var/lib/caddy-data` — the persistent EBS mount. Don't drop the second `-f` flag if you run compose commands by hand, or Caddy will fall back to a fresh anonymous volume and forfeit cert persistence for that cycle.

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

### Updating a standing box (the deploy gotcha)

> **`docker compose pull` does not refresh code on this box, and `git pull` alone does not either.** The compose stack **builds api / web / agent-query locally** (no registry), so `demo-sync.sh`'s `docker compose pull` is a no-op for them and `up -d` will **not** recreate a container whose (cached, unchanged) image ID didn't move. Worse, those three services **bind-mount** `/opt/provenance` and run the source directly — so after a `git pull`, the running Node process keeps executing the *old* code it loaded at its last start even though the new code is on disk.
>
> To deploy a merged `main` to a standing box:
> 1. `cd /opt/provenance && git pull --ff-only origin main`
> 2. `docker compose -f docker-compose.ec2-dev.yml -f docker-compose.demo.yml --env-file .env.ec2 restart api agent-query web` (force the processes to reload the bind-mounted source — `restart`, not just `up -d`)
> 3. `docker compose ... restart caddy` (Caddy caches upstream container IPs; restart it after the app containers move)
> 4. `docker compose ... run --rm flyway-migrate` if the pull brought new migrations
> 5. Re-run the smoke test
>
> This cost ~30 min on 2026-05-30 (an agent-grant FK kept failing against api code that was already fixed on disk but not reloaded).

---

## Step 4 - Run the Smoke Test

The smoke test runs automatically at the end of `demo-sync.sh`. You can also run it independently at any time:

```bash
bash infrastructure/scripts/demo-smoke-test.sh https://demo.provenancelogic.com
```

> **Standalone runs need `SMOKE_AGENT_SECRET` for the agent layer.** `demo-sync.sh` resolves the Marketing Copilot client secret from Keycloak before calling the smoke test (its step 6); a bare `demo-smoke-test.sh` invocation does not, so the **agent** layer fails with `SMOKE_AGENT_SECRET not set` (the other five layers still run). To run the agent layer standalone, resolve it first:
> ```bash
> set -a; source infrastructure/docker/.env.ec2; set +a
> TOK=$(curl -sS -X POST "https://${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}/realms/provenance/protocol/openid-connect/token" \
>   -d grant_type=client_credentials -d client_id="${KEYCLOAK_ADMIN_CLIENT_ID:-provenance-admin}" \
>   -d client_secret="$KEYCLOAK_ADMIN_CLIENT_SECRET" | jq -r .access_token)
> CU=$(curl -sS -H "Authorization: Bearer $TOK" "https://${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}/admin/realms/provenance/clients?clientId=agent-acme-marketing-copilot" | jq -r '.[0].id')
> export SMOKE_AGENT_SECRET=$(curl -sS -H "Authorization: Bearer $TOK" "https://${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}/admin/realms/provenance/clients/$CU/client-secret" | jq -r .value)
> bash infrastructure/scripts/demo-smoke-test.sh https://demo.provenancelogic.com
> ```

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

> **⚠️ Soft reset currently blocked by [B-060](../bugs/open.md#B-060) (filed 2026-05-18).** `softReset` references columns/tables that don't exist in the schema (`event_at` on `audit.audit_log`, `created_at` on `access.access_requests`, plus `observability_snapshots` and `lineage.emission_events` which aren't in any migration). The first DELETE throws and the transaction rolls back; the command exits non-zero every time. Remove this callout when B-060 lands.
>
> **Working clean-slate path: `demo-reset.sh --hard`.** Hard reset is now **safe and repeatable on an already-seeded box** as of 2026-05-30 ([B-078](../bugs/resolved.md#B-078) + [B-085](../bugs/resolved.md#B-085) fixed in #234) — it no longer truncates `flyway_schema_history` (which used to break the next boot) and `createAgentClient` is idempotent (it used to 500 on the orphaned Keycloak agent client). It truncates **all** platform schemas (incl. `consent` + `notifications`) and reseeds from scratch — so use it when you want a pristine base, not to preserve mid-walkthrough state. `bash infrastructure/scripts/demo-sync.sh main` is the alternative (idempotent re-seed without truncation). **Both require the box to be on #234+ code** (see "Updating a standing box") for the hard-reset fixes to apply.

---

## Step 5 - Tear Down After Final Demo

After you're done with a provisioned instance, destroy it — don't leave it running idle indefinitely (cost + drift). **Exception:** while the box is in active use (a self-paced walkthrough or a multi-day iteration window, as on 2026-05-30), it's fine to keep it running between sessions; tear down when that window closes. Teardown is still the lifecycle end-state, just not after every single demo.

```bash
cd infrastructure/terraform/demo
terraform destroy
# Type 'yes' to confirm
```

Verify destruction in the AWS console: EC2 instance terminated, EIP detached (but **not** released — it is persistent and will be reused next cycle), Caddy-data EBS volume detached (but **not** deleted — it is persistent and holds the cert state for the next cycle). Cloudflare DNS records stay in place (they still point at the persistent EIP).

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
| `demo-smoke-test.sh [base-url]` | After sync, after soft reset, any time you want to verify. **B-060: layers 3–6 broken** (phantom endpoints). Layers 1–2 trustworthy; layer-3+ green-light gate unavailable until B-060 lands. |
| `demo-reset.sh --soft` | Between back-to-back demos on the same instance. **B-060: currently broken** — use `demo-sync.sh main` as fallback. |
| `demo-reset.sh --hard` | When recovering from a corrupted state. Not yet end-to-end verified, but `hardReset` may still work (TRUNCATE + re-seed doesn't depend on the column references that break `softReset`). |
