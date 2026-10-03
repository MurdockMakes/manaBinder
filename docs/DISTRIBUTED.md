# Containerized services and scaling

This branch implements independently scalable API and background processing services. It is a foundation for measuring capacity, not a claim of any particular user limit. PostgreSQL remains the transactional authority for inventory, trades, identity and job state. RabbitMQ carries background account-email work; Kafka is not required for this workload.

## Start the complete local stack

Requires Docker Engine with Compose v2. This creates a separate development database and uses synthetic/file email delivery.

```sh
node scripts/init-services-env.mjs
docker compose --env-file .env.services -f compose.services.yaml up --build -d --wait
docker compose --env-file .env.services -f compose.services.yaml ps
```

The generated, ignored `.env.services` contains random credentials. Keep it private and stable across restarts. The initialization command refuses to overwrite an existing file.

| Surface                            | Local URL              | Access                         |
| ---------------------------------- | ---------------------- | ------------------------------ |
| Application through Nginx          | http://127.0.0.1:8080  | User accounts                  |
| Grafana: ManaBinder service health | http://127.0.0.1:3000  | admin / GRAFANA_PASSWORD       |
| RabbitMQ management                | http://127.0.0.1:15672 | manabinder / RABBITMQ_PASSWORD |
| Prometheus queries and alert rules | http://127.0.0.1:9090  | Loopback only                  |

Development verification/reset messages are files in the worker's `/mail` volume. Inspect only your test account's message using `docker compose --env-file .env.services -f compose.services.yaml exec worker ls /mail` and then `cat /mail/<id>.json`. Do not publish these files.

## Service boundaries

- **Edge:** static assets, request-size limits and reverse proxy with Docker DNS discovery. Only this service exposes the application to the host.
- **API (two replicas by default):** stateless request handling. Sessions, rate limits, reservations and provider pacing live in PostgreSQL. No sticky sessions are required. Identical catalog files and SESSION_SECRET must reach every replica.
- **Relay:** claims transactional outbox events with short leases and `SKIP LOCKED`, publishes persistent messages, and marks publication only after broker confirmation.
- **Workers (two replicas):** bounded prefetch, short database claims, mail delivery outside database transactions, manual acknowledgments and bounded retries. A stable Idempotency-Key accompanies every retry.
- **Scheduler:** expires trades, recovers abandoned mail work and applies retention. Multiple instances may run; a session advisory lock permits only one maintenance pass at a time. This is not a global lock on user writes.
- **PostgreSQL:** constraints, serializable transactions with bounded retry, and ordered row locks keep stock transfers/reservations atomic. Independent writes no longer share one application-wide advisory lock.
- **RabbitMQ:** durable quorum main and dead-letter queues, publisher confirms and manual consumer acknowledgments. Broker messages contain identifiers and correlation IDs, not email addresses or account tokens.

Public binder reads use batched queries; search uses a trigram candidate index and a bounded cache. The full catalog remains in each API process, so adding replicas also adds memory consumption. Very short searches still scan the catalog.

## Reliability contract

Account changes, encrypted email payload and initial outbox event commit together. A crash before publishing leaves an event for the relay. A crash after publish but before recording confirmation may publish twice. Workers claim jobs in PostgreSQL and tolerate duplicates; expired leases are recovered. Network calls do not hold open SQL transactions. After five delivery attempts, the job fails and normal terminal deliveries enter the dead-letter queue. A process crash on the final attempt is recorded as failed by the scheduler and may have no dead-letter entry: the database and failed-job metric remain authoritative.

Delivery is **at least once**, not exactly once. The production email webhook MUST deduplicate `Idempotency-Key` across retries, including a crash after sending but before committing completion. Broker outage delays mail without stopping inventory requests; PostgreSQL outage prevents safe application writes. Token validity remains 30 minutes, so old queued links can expire and users must request another link. Never automatically replay an entire dead-letter queue without checking current database state and token age.

See [RabbitMQ confirmations](https://www.rabbitmq.com/docs/confirms), [quorum queues](https://www.rabbitmq.com/docs/quorum-queues), and [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html) for the underlying guarantees. Transactions that are retried must contain only database effects, not external sends.

## Scaling and operating

```sh
docker compose --env-file .env.services -f compose.services.yaml up -d --scale api=4 --scale worker=4
docker compose --env-file .env.services -f compose.services.yaml logs --tail=100 api worker relay scheduler
```

Budget database connections before scaling: sum `replicas * DB_POOL_SIZE` for every process, then reserve connections for migration, operations and monitoring. The default app pool is five in Compose. Do not multiply replicas past PostgreSQL connection/CPU limits. Introduce a tested connection pooler when needed. Scale workers based on pending-job age and provider throughput, not only CPU. Scale APIs based on p95 latency, errors, pool waits and CPU/memory under a representative load test.

Grafana is provisioned with API throughput, p95 latency, error rates, process memory, database pools and mail backlog/outcomes. Prometheus discovers API/worker/relay replicas through Docker DNS and scrapes RabbitMQ. Metrics avoid user identifiers and raw URL labels. Alert rules cover unavailable targets, elevated errors, waiting connections, old pending mail and failed mail. **External notification delivery is not configured:** add Alertmanager and an owned receiver before launch. Restrict management/metrics to an operator network with authentication.

API and workers drain on shutdown; the worker deadline is 40 seconds within a 45-second container grace period. Schema migrations are a one-shot dependency, never implicit API startup work. Use additive, backward-compatible migrations during rolling deployments; take backups and rehearse restore before destructive schema changes. Deploy matching catalog artifacts consistently; a stale catalog intentionally fails readiness.

## Required production deployment work

The checked-in Compose stack is a single-host development topology. Two API replicas do not make its one database, one broker node or one edge highly available.

1. Select a host/orchestrator and capacity target, run the full CI/container smoke suite, then stage representative sustained read/write load and failure tests. No measured maximum concurrent-user claim is made.
2. Use managed PostgreSQL HA with encrypted connections, backups/PITR, restore rehearsal and connection limits. Provision a three-node RabbitMQ cluster across failure domains (or an equivalent managed service); check quorum membership and recovery during node loss. Set broker disk/memory alarms and retention policies.
3. Supply per-environment secrets through the deployment secret manager. Set `NODE_ENV=production`, exact HTTPS `APP_ORIGIN`, shared strong `SESSION_SECRET`, `MAIL_MODE=webhook`, `MAIL_WEBHOOK`, `MAIL_TOKEN`, and a real `SCRYFALL_USER_AGENT` in all relevant application services. Production config rejects development mail/origin defaults. Use restricted database and broker users, TLS for remote infrastructure, and rotate credentials deliberately.
4. Put the edge behind controlled TLS ingress and restrict direct API access. Configure trusted upstream proxy addresses at Nginx so it derives the real client address before overwriting X-Forwarded-For; otherwise an extra ingress makes all clients share one rate-limit address. Do not trust arbitrary forwarded headers. Publish only intended application endpoints; keep management surfaces private.
5. Pin reviewed image digests, scan dependencies/images, set resource requests/limits for every service, implement rolling deployment/readiness gates, and test broker/database loss and worker termination during delivery. Configure external alert delivery and support/on-call ownership.
6. Complete the existing data-provenance, provider-policy, privacy and staging gates in OPERATIONS.md. No real data has been migrated or publicly deployed by this refactor.

## Verification

`npm test` covers independent overlapping SQL writes, retry rollback, transactional outbox rollback, duplicate worker claims, lease recovery, retry exhaustion, metrics labels and the application regression suite. The live broker test requires `TEST_RABBITMQ_URL` pointing to a **dedicated disposable broker**; it purges the named test queues. It is explicitly skipped without that variable.

CI provisions PostgreSQL and RabbitMQ, runs browser tests, builds both images and runs `node scripts/container-smoke.mjs`. That smoke test starts its own `manabinder-smoke` Compose project and validates signup through the edge plus outbox-to-broker-to-worker delivery; it removes only that project's disposable volumes afterward. Do not use that project name for persistent deployments. `node scripts/benchmark.mjs` records full-catalog local sequential timings and a short 20-client read burst in `work/benchmark.json`; this does not replace staging load testing.

At implementation time the local Docker Engine was unavailable. Compose configuration validation passed, but container builds, live RabbitMQ and dashboards have not been executed locally. The CI changes have not run remotely until the branch is pushed.
