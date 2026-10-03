CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL, nickname text NOT NULL,
 password_hash text NOT NULL, verified boolean NOT NULL DEFAULT false,
 disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (length(nickname) BETWEEN 2 AND 24)
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email));
CREATE UNIQUE INDEX users_nickname_unique ON users(lower(nickname));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE user_stores (user_id text REFERENCES users ON DELETE CASCADE, store_id text NOT NULL, PRIMARY KEY(user_id,store_id));
CREATE INDEX stores_lookup ON user_stores(store_id,user_id);
CREATE TABLE inventory (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('binder','collection')),
 card_id text NOT NULL, printing_id text NOT NULL, finish text NOT NULL CHECK(finish IN ('nonfoil','foil','etched')),
 condition text NOT NULL CHECK(condition IN ('Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 999),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=80), location text NOT NULL DEFAULT '' CHECK(length(location)<=60),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_owner ON inventory(user_id,kind);
CREATE INDEX inventory_card ON inventory(card_id) WHERE kind='binder' AND quantity>0;
CREATE TABLE wants (id text PRIMARY KEY, user_id text REFERENCES users ON DELETE CASCADE, card_id text NOT NULL,
 priority text NOT NULL CHECK(priority IN ('Low','Normal','High')), note text NOT NULL CHECK(length(note)<=80), UNIQUE(user_id,card_id));
CREATE TABLE trades (
 id text PRIMARY KEY, from_user text NOT NULL REFERENCES users ON DELETE CASCADE,
 to_user text NOT NULL REFERENCES users ON DELETE CASCADE, CHECK(from_user<>to_user),
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled','completed','expired')),
 idempotency_key text NOT NULL, request_hash text NOT NULL, quote jsonb,
 confirmed_from boolean NOT NULL DEFAULT false, confirmed_to boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(from_user,idempotency_key)
);
CREATE INDEX trades_inbox ON trades(to_user,created_at DESC);
CREATE INDEX trades_outbox ON trades(from_user,created_at DESC);
CREATE TABLE trade_items (
 trade_id text REFERENCES trades ON DELETE CASCADE, item_id text REFERENCES inventory,
 owner_id text NOT NULL REFERENCES users ON DELETE CASCADE, quantity integer NOT NULL CHECK(quantity>0),
 snapshot jsonb NOT NULL, PRIMARY KEY(trade_id,item_id)
);
CREATE INDEX trade_items_stock ON trade_items(item_id);
CREATE TABLE trade_events (id bigserial PRIMARY KEY, trade_id text REFERENCES trades ON DELETE CASCADE,
 actor_id text REFERENCES users ON DELETE SET NULL, event text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notifications (id bigserial PRIMARY KEY, user_id text REFERENCES users ON DELETE CASCADE,
 trade_id text REFERENCES trades ON DELETE CASCADE, message text NOT NULL, is_read boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notifications_owner ON notifications(user_id,id DESC);
CREATE TABLE account_tokens (token_hash text PRIMARY KEY,user_id text REFERENCES users ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')),expires_at timestamptz NOT NULL);
CREATE TABLE mail_outbox (id bigserial PRIMARY KEY, user_id text REFERENCES users ON DELETE CASCADE,
 purpose text NOT NULL, sealed_message text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE blocks (user_id text REFERENCES users ON DELETE CASCADE,target_id text REFERENCES users ON DELETE CASCADE,
 CHECK(user_id<>target_id), PRIMARY KEY(user_id,target_id));
CREATE TABLE reports (id bigserial PRIMARY KEY,user_id text REFERENCES users ON DELETE SET NULL,
 target_id text REFERENCES users ON DELETE SET NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE moderation_events (id bigserial PRIMARY KEY,actor_id text REFERENCES users ON DELETE SET NULL,
 target_id text REFERENCES users ON DELETE SET NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE provider_slots (name text PRIMARY KEY,next_at timestamptz NOT NULL);
CREATE TABLE legacy_imports (source_hash text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now(),counts jsonb NOT NULL);
