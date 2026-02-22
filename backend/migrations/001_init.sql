migrations/001_init.sqlCREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id serial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  price_tier text,
  status text,
  current_period_end timestamptz
);

CREATE TABLE IF NOT EXISTS coins (
  id serial PRIMARY KEY,
  coingecko_id text UNIQUE,
  symbol text,
  name text,
  token_address text,
  chain text,
  metadata jsonb,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS signals (
  id serial PRIMARY KEY,
  coin_id int REFERENCES coins(id),
  snapshot_ts timestamptz DEFAULT now(),

  market_score numeric,
  onchain_score numeric,
  dev_score numeric,
  social_score numeric,
  tokenomics_score numeric,

  daa_score numeric,
  fees_in_token_score numeric,
  burn_rate_score numeric,
  liquidity_score numeric,
  vesting_risk_score numeric,

  composite_score numeric,
  rocket_score numeric,
  combined_score numeric,

  raw jsonb
);

CREATE INDEX IF NOT EXISTS signals_coin_ts_idx ON signals (coin_id, snapshot_ts);

CREATE TABLE IF NOT EXISTS alerts (
  id serial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  coin_id int REFERENCES coins(id),
  level text,
  fired_at timestamptz DEFAULT now(),
  reason text,
  payload jsonb,
  resolved boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS watchlists (
  id serial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  coin_id int REFERENCES coins(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backtests (
  id serial PRIMARY KEY,
  coin_id int REFERENCES coins(id),
  params jsonb,
  result jsonb,
  created_at timestamptz DEFAULT now()
);
