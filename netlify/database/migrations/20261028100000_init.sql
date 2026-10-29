-- Fox Drive : schéma initial

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  ok         BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (email, created_at DESC);

-- Réglages (valeurs JSON ; les secrets sont chiffrés AES-GCM)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  secret     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chauffeurs (un chauffeur = une personne ; la plaque suit le véhicule loué)
CREATE TABLE drivers (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  name_key         TEXT NOT NULL,
  phone            TEXT NOT NULL DEFAULT '',
  plate            TEXT NOT NULL DEFAULT '',
  vehicle          TEXT NOT NULL DEFAULT '',
  manager          TEXT NOT NULL DEFAULT '',
  pickup           DATE,
  pickup_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  last_verif       DATE,
  last_checkin     DATE,
  last_contacted   TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'archived')),
  absent_since     DATE,
  prev_plate       TEXT,
  source           TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drivers_status_idx ON drivers (status);
CREATE INDEX drivers_name_key_idx ON drivers (name_key);
CREATE INDEX drivers_plate_idx ON drivers (plate);

-- Carnet de numéros nom -> téléphone
CREATE TABLE contacts (
  name_key   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Journal des changements (nouveaux, véhicules, départs, contacts, ...)
CREATE TABLE events (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  type      TEXT NOT NULL,
  driver_id INTEGER,
  name      TEXT NOT NULL DEFAULT '',
  text      TEXT NOT NULL DEFAULT '',
  meta      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX events_ts_idx ON events (ts DESC);
CREATE INDEX events_driver_idx ON events (driver_id, ts DESC);

-- Imports : synchro Google Sheets / fichiers. 'pending' = à valider dans l'app
CREATE TABLE imports (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind       TEXT NOT NULL CHECK (kind IN ('foxdrive', 'contacts')),
  source     TEXT NOT NULL DEFAULT '',
  rows       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('preview', 'pending', 'applied', 'rejected')),
  summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload    JSONB,
  reason     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX imports_status_idx ON imports (status, ts DESC);

-- Campagnes de messages
CREATE TABLE campaigns (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'cancelled')),
  origin     TEXT NOT NULL DEFAULT 'user',      -- user | agent | daily
  title      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  sent_at    TIMESTAMPTZ
);

CREATE TABLE campaign_items (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  driver_id   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  reason      TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  wa_id       TEXT,
  sent_at     TIMESTAMPTZ,
  UNIQUE (campaign_id, driver_id)
);

-- Historique des messages WhatsApp (sortants et entrants)
CREATE TABLE messages (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  driver_id  INTEGER,
  phone      TEXT NOT NULL DEFAULT '',
  direction  TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  kind       TEXT NOT NULL DEFAULT '',          -- relance | revision | controle | relance_ferme | texte | reponse
  body       TEXT NOT NULL DEFAULT '',
  wa_id      TEXT UNIQUE,
  status     TEXT NOT NULL DEFAULT 'queued',    -- queued | sent | delivered | read | failed | received
  error      TEXT NOT NULL DEFAULT '',
  campaign_id BIGINT
);
CREATE INDEX messages_driver_idx ON messages (driver_id, ts DESC);
CREATE INDEX messages_phone_idx ON messages (phone, ts DESC);

-- Journal de l'agent IA (audit des outils appelés)
CREATE TABLE agent_runs (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin     TEXT NOT NULL DEFAULT 'chat',
  prompt     TEXT NOT NULL DEFAULT '',
  reply      TEXT NOT NULL DEFAULT '',
  tools      JSONB NOT NULL DEFAULT '[]'::jsonb,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0
);
