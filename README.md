# ManaBinder

A Magic: The Gathering binder and local trading app using Node.js, PostgreSQL and vanilla JavaScript. Public binders show printing, finish, condition and quantity; collection locations and wanted lists are private. Prices are fetched only for explicit quotes/sends and never stored on listings or returned through catalog/binder APIs.

**Release status: implemented and locally tested; not approved for public launch.** See [requirement status](docs/STATUS.md) and [release runbook](docs/OPERATIONS.md). No live deployment is included.

## Containerized services

See [distributed service setup and operations](docs/DISTRIBUTED.md) for the complete stack: Nginx, two API replicas, PostgreSQL, RabbitMQ, outbox relay, two workers, scheduler, Prometheus and Grafana. Normal writes use serializable transactions and targeted row locks; background work runs independently of API replicas. This is the recommended local setup for this branch.

```sh
node scripts/init-services-env.mjs
docker compose --env-file .env.services -f compose.services.yaml up --build -d --wait
```

Application: http://127.0.0.1:8080. Grafana: http://127.0.0.1:3000. Credentials are generated in the ignored `.env.services`. The single-host stack needs the production adaptations and verification described in the guide before public deployment.

## API-only development setup

Use Node 22.23.2 (the checked-in runtime pin) and PostgreSQL 18.4. Docker Compose starts only a development database bound to loopback; its credentials are intentionally local-only.

```sh
npm ci
docker compose up -d db
# Copy .env.example to .env and set a stable random SESSION_SECRET.
node --env-file=.env scripts/migrate.mjs
node --env-file=.env server.js
```

Open http://127.0.0.1:4174. This starts only the API. Account email and retention require the relay, worker and scheduler services described above; the API no longer runs background timers. File delivery is forbidden in production, and a production webhook must deduplicate the supplied Idempotency-Key.

The full catalog and 86 Massachusetts stores are already present. There is no six-card fallback. Refresh before the configured freshness deadline:

```sh
npm run import:cards
npm run import:stores:ma
```

Imports validate complete data, retain `.previous` copies and atomically replace files. Restart all app instances after publishing an import. Catalog/store files must be deployed consistently with every replica. An invalid or stale dataset fails startup/readiness; it never becomes a sample catalog silently.

## Verification

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
node scripts/benchmark.mjs
```

Without `TEST_DATABASE_URL`, tests start a disposable loopback PostgreSQL instance under ignored `work/`. Native processes may require normal Windows process permissions. With `TEST_DATABASE_URL`, provide a disposable database and an account allowed to create another temporary database for the restore rehearsal. Never point these commands at real data: browser tests reset the test database. Tests are sequential because they use fixed localhost ports 4197–4200 and 55432. CI provisions PostgreSQL independently.

## Domain rules

- Verify both accounts before quoting/sending. Pending trades do not reserve inventory. Acceptance reserves all selected quantities atomically. Trades expire seven days after creation.
- Each party confirms physical handoff. Only the second confirmation transfers stock into private collections. Repeated confirmations cannot transfer twice. Either party may cancel an active trade; blocks/moderation also cancel active trades.
- Finish is explicit (`nonfoil`, `foil`, `etched`); only finishes supported by the printing are accepted. Choose quantities in the draft. Unknown exact-finish prices block sending.
- Fairness uses integer USD cents, condition-adjusted unit prices rounded to cents, multiplied by selected quantity. About-even tolerance is the larger of 75 cents or 4% of the requested total rounded to cents. Condition multipliers (100/90/78/62/45%) are estimates, not an appraisal.
- Domain writes use PostgreSQL serializable transactions with bounded retries and targeted inventory row locks. Network calls occur outside transactions. Inventory is revalidated before committing. Benchmark write contention and database capacity before a high-traffic release.

## Data and compatibility

The former `data/db.json` is no longer tracked or used. An existing local copy is preserved. There are no built-in shared-password accounts. [Migration instructions](docs/OPERATIONS.md) require a reviewed copy and explicit legacy printing/finish mappings; ambiguous data is rejected. Existing passwords can be carried forward as scrypt hashes, but imported users must verify email. No old cookies are accepted.

See [API changes](docs/API.md), [privacy/retention](docs/PRIVACY.md), and [provider requirements](docs/PROVIDERS.md). Email trade notifications, private messaging and geography beyond Massachusetts are explicitly deferred; in-app trade notifications are implemented.
