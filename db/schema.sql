CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  roles jsonb NOT NULL,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS handshake_records (
  id text PRIMARY KEY,
  claimant_organization_id text NOT NULL,
  recipient_organization_id text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  version integer NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handshake_records_claimant_created_idx ON handshake_records (claimant_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS handshake_records_recipient_created_idx ON handshake_records (recipient_organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS passport_profiles (
  claimant_organization_id text NOT NULL,
  claimant_id text NOT NULL,
  version integer NOT NULL,
  sealed_profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claimant_organization_id, claimant_id)
);
