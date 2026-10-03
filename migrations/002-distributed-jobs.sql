ALTER TABLE mail_outbox ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE mail_outbox ADD COLUMN lease_until timestamptz;
ALTER TABLE mail_outbox ADD COLUMN lease_owner text;
CREATE INDEX mail_due ON mail_outbox(available_at,id) WHERE status='pending';
CREATE TABLE job_outbox (
 id bigserial PRIMARY KEY,
 mail_id bigint NOT NULL REFERENCES mail_outbox(id) ON DELETE CASCADE,
 event_key text NOT NULL UNIQUE,
 correlation_id text NOT NULL,
 available_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 lease_until timestamptz,
 lease_owner text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_outbox_due ON job_outbox(available_at,id) WHERE published_at IS NULL;
CREATE INDEX trades_expiry ON trades(expires_at,id) WHERE status IN ('pending','accepted');
CREATE INDEX mail_status_created ON mail_outbox(status,created_at);
INSERT INTO job_outbox(mail_id,event_key,correlation_id)
 SELECT id,'mail:'||id||':initial','migration-002' FROM mail_outbox WHERE status='pending';
