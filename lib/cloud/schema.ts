export const CLOUD_SCHEMA = "cargofit_cloud";

export const CLOUD_MIGRATION = `
CREATE SCHEMA IF NOT EXISTS cargofit_cloud;
REVOKE ALL ON SCHEMA cargofit_cloud FROM PUBLIC;
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL CHECK (mode IN ('private','sandbox'))
);

CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_org (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL UNIQUE,
  name text NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  trial_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_member (
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  user_id text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (org_id, user_id),
  UNIQUE (org_id, email)
);
CREATE INDEX IF NOT EXISTS cf_member_user ON cargofit_cloud.cf_member (user_id);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_invite (
  token_hash char(64) PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor','viewer')),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_project (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  name text NOT NULL,
  head uuid,
  version_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS cf_project_org ON cargofit_cloud.cf_project (org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_revision (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid REFERENCES cargofit_cloud.cf_revision(id),
  author_id text NOT NULL,
  sha256 char(64) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, org_id) REFERENCES cargofit_cloud.cf_project(id, org_id),
  UNIQUE (id, project_id, org_id)
);
CREATE INDEX IF NOT EXISTS cf_revision_project ON cargofit_cloud.cf_revision (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_asset (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  author_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('field','weighing','operations','fleet-handoff','photo')),
  name text NOT NULL,
  mime text NOT NULL,
  sha256 char(64) NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, project_id, org_id) REFERENCES cargofit_cloud.cf_revision(id, project_id, org_id)
);
CREATE INDEX IF NOT EXISTS cf_asset_revision ON cargofit_cloud.cf_asset (revision_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_share (
  token_hash char(64) PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (revision_id, project_id, org_id) REFERENCES cargofit_cloud.cf_revision(id, project_id, org_id)
);

CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_usage (
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  actor_id text NOT NULL,
  task_key uuid NOT NULL,
  fingerprint char(64) NOT NULL,
  period char(7) NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0),
  resource_id uuid NOT NULL,
  project_id uuid NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor_id, task_key)
);
CREATE INDEX IF NOT EXISTS cf_usage_period ON cargofit_cloud.cf_usage (org_id, period);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_order (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  buyer_id text NOT NULL,
  request_key uuid NOT NULL,
  origin text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('pro','team')),
  currency char(3) NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  days integer NOT NULL CHECK (days > 0),
  session_id text UNIQUE,
  payment_id text UNIQUE,
  checkout_url text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  valid_until timestamptz,
  refunded integer NOT NULL DEFAULT 0 CHECK (refunded >= 0 AND refunded <= amount),
  dispute_state text NOT NULL DEFAULT 'none' CHECK (dispute_state IN ('none','open','won','lost')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','paid','failed','expired','partial_refund','refunded','disputed')),
  UNIQUE (org_id, buyer_id, request_key)
);
CREATE INDEX IF NOT EXISTS cf_order_org ON cargofit_cloud.cf_order (org_id, created_at DESC);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_payment_event (
  event_id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES cargofit_cloud.cf_order(id),
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cargofit_cloud.cf_entitlement_event (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES cargofit_cloud.cf_org(id),
  order_id uuid REFERENCES cargofit_cloud.cf_order(id),
  actor_id text,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'
);
`;
