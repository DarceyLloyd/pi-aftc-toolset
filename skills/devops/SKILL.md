---
name: devops
description: DevOps practices, CI/CD pipelines, infrastructure as code, deployment strategies, and database operations. Use when discussing CI/CD, deployment, infrastructure, Terraform, Ansible, Kubernetes, or database schema and migrations.
---

# DevOps

## Infrastructure
- Infrastructure as Code (IaC) for all environments.
- Immutable infrastructure over mutable servers.
- Automated rollbacks on deployment failure.
- Secrets management via vault or sealed secrets.
- Monitoring and alerting from day one.

## Database Operations
- MySQL VARCHAR key limit: A UNIQUE KEY or INDEX on VARCHAR(N) requires N ≤ 768 when using utf8mb4 (4 bytes per char × 768 = 3072 bytes, the InnoDB max key length). Use VARCHAR(255) for indexed email columns, or TEXT without indexing.
- Init script idempotency: Always use `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE` so scripts are safe to re-run.
- Health checks: MySQL containers should use `mysqladmin ping -h 127.0.0.1` as their healthcheck.
- Data persistence: Always mount MySQL data to a named Docker volume - never rely on the container's ephemeral filesystem.
- Backup strategy: Implement automated mysqldump backups to a mounted volume before any schema change.
- Connection testing: After deployment, run `mysql -h <host> -u<user> -p<pass> -e "SELECT 1"` to verify connectivity before any app code runs.

## Deployment Verification
- After every deployment, run a smoke test that touches every service.
- Docker: `docker compose ps` (all up), `curl` health endpoints, `docker compose logs --tail=20` (no errors).
- Kubernetes: `kubectl get pods` (all Running), `kubectl logs` (no crash loops).
- Database: connect and run a lightweight query. Check table schemas match expected.
- Rollback plan must be tested BEFORE the deploy - if it doesn't work in staging, don't deploy to prod.
