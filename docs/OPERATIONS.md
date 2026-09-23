# Release, migration and recovery runbook

## Before staging

1. Choose hosting/domain/region/budget and a managed PostgreSQL instance. No provider has been provisioned by this change. Use a least-privileged runtime DB role; run migrations with a separate role. Configure database TLS with certificate verification through the PostgreSQL connection settings; never disable verification.
2. Set NODE_ENV=production, an exact HTTPS APP_ORIGIN, DATABASE_URL, random SESSION_SECRET (at least 43 base64url characters), real SCRYFALL_USER_AGENT contact, MAIL_MODE=webhook, HTTPS MAIL_WEBHOOK and MAIL_TOKEN. Do not reuse `.env.example` placeholders. Keep backup encryption keys separately from backups and from SESSION_SECRET.
3. Put the container behind an HTTPS reverse proxy with bounded request sizes/timeouts. Set HOST=0.0.0.0 inside the container. Keep TRUST_PROXY=false unless direct app access is blocked and the proxy overwrites X-Forwarded-For. Otherwise clients could bypass shared IP limits. The edge must preserve the real Origin and forward secure cookies without rewriting scope.
4. Run `npm ci`, `npm run check`, `npm test`, `npm run test:browser`, then `docker build -t manabinder:<revision> .`. The Docker build is a CI gate. It was not locally executed because the Docker daemon was unavailable. Pin a reviewed base-image digest in your release pipeline and maintain runtime security updates.
5. Apply `node scripts/migrate.mjs` with DATABASE_URL. Schema changes run under an advisory lock and record completed migration names atomically. The app never applies migrations implicitly.

## Legacy data

The original local data/db.json is preserved but ignored and removed from the index. It contains demo accounts and an account whose provenance needs owner review. Do not print or publish it. If any account credentials were real/reused, reset them and assess Git-history exposure; this change did not rewrite history.

Work from a protected copy, keeping the original unchanged. Remove identified demos from that copy after review. Prepare a mapping JSON keyed by old printing ID, with values `{cardId,printingId,finish}` using the current catalog. Every ambiguous finish or synthetic printing must be explicitly mapped. Unknown stores/cards, duplicate accounts, malformed hashes and unmapped finishes fail the whole transaction. Nonempty legacy trades require a separately reviewed mapping; they are not silently discarded (the audited source had zero trades).

```sh
node scripts/import-legacy.mjs protected-reviewed-copy.json --mapping=reviewed-mapping.json
# Inspect dry-run counts; transaction has rolled back.
node scripts/import-legacy.mjs protected-reviewed-copy.json --mapping=reviewed-mapping.json --apply
```

Repeat of the exact successfully imported file is a no-op. A changed source with existing IDs conflicts rather than overwriting. Preserves user/item IDs, scrypt hashes, timestamps, ownership, condition, locations and quantities. Imported accounts start unverified. Startup cannot use the old JSON database. A fixture dry-run, apply and repeat were tested; the user's actual account data was not imported.

## Backup and rollback

Managed PostgreSQL point-in-time recovery is strongly preferred operationally. Also provided is an application logical backup with AES-256-GCM encryption and a repeatable-read snapshot:

```sh
# Set DATABASE_URL and BACKUP_KEY securely; do not paste secrets into shell history.
node scripts/backup.mjs create protected-backup.enc
# Use a newly created empty target database, then:
node scripts/migrate.mjs
node scripts/backup.mjs restore protected-backup.enc
```

Backup creation refuses overwrite. Restore refuses nonempty tables, validates columns against the schema, restores constraints and serial sequences transactionally, and revokes all restored sessions/reset tokens/queued email to avoid resurrecting old bearer credentials. Users log in and re-request verification/reset mail after restore. Rate-limit windows/provider schedules are ephemeral and not backed up. Protect the original backup and keep the key off-host.

The local regression suite rehearses encrypted backup to a new PostgreSQL database, verifies account counts, refuses a second restore, and exercises legacy migration rollback/repeat. This is not a disaster recovery test of the eventual hosting provider. Before launch, rehearse provider restore, record RPO/RTO and data counts, and verify app behavior against the restored database.

For rollback: stop writes, retain a fresh backup, roll back only to an artifact compatible with the current schema. For incompatible schema changes, restore the pre-release backup to a new database and switch the prior compatible artifact to it. Never run the pre-PostgreSQL prototype against a live new release and expect data compatibility. No automatic down migration or destructive history rewrite is supplied.

## Staging acceptance

- Use synthetic users, a sandbox mail webhook and production-like TLS/secrets. Verify secure cookies, Origin/CSRF rejection, logout/reset replay rejection and two independent app processes sharing PostgreSQL.
- Run two-user signups/verification/inventory/wanted search/trade acceptance/handoff and block/report tests. Verify retries never duplicate transfers and expired reservations release.
- Exercise provider 429/timeouts/missing prices, database loss, stale catalog, mail failures, full restart and graceful shutdown. Alert on failed readiness, elevated 5xx/429 rates, request latency, database contention, memory, failed/old pending mail and data freshness.
- `/api/admin/metrics` exposes instance request/error counts, RSS and failed mail count to ADMIN_IDS only. Route structured logs to your monitoring stack. Per-instance counters reset on restart. Thresholds and an on-call/support owner must be configured by the deployer; these are not a hosted monitoring service.
- Refresh imports with valid production contact metadata, review counts/source dates, restart all replicas and verify readiness. Restore `.previous` file and restart if a new dataset fails validation. Keep all replicas on the same version.
- Check no secrets/demo accounts or private collection fields appear in public APIs/logs. Approve privacy/support contact and third-party use requirements before enabling signups.

## Boundaries and capacity

The app has no payment or shipping workflow and does not adjudicate card authenticity. Handoffs are in person. Email trade alerts and private messaging are deferred; unread in-app notices are supported. The app does not initiate unsolicited email outside requested verification/reset.

Local measured catalog load was approximately 390 ms, RSS approximately 363 MiB, using 35,736 cards/102,186 printings and 100 synthetic users/2,000 listings. Sequential warm p95: search 6.60 ms, anonymous session 3.94 ms, public binder page 14.64 ms. These are not throughput guarantees. Account for PostgreSQL, concurrent requests, imports and container overhead separately. Target staging budgets: p95 below 250 ms for search/session, below 500 ms for binder pages, and measured app RSS below 512 MiB at this baseline. Benchmark write-lock contention and hostile traffic before expanding launch scale.
