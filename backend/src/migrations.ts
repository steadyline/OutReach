import { pool, query } from "./db.js";

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS senders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      google_sub TEXT,
      refresh_token_encrypted TEXT NOT NULL,
      access_token_encrypted TEXT,
      token_expiry TIMESTAMPTZ,
      scope TEXT,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_limit INTEGER NOT NULL DEFAULT 60,
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      min_gap_minutes INTEGER NOT NULL DEFAULT 4,
      max_gap_minutes INTEGER NOT NULL DEFAULT 8,
      followup_after_days INTEGER NOT NULL DEFAULT 2,
      second_followup_after_days INTEGER NOT NULL DEFAULT 6,
      max_followups INTEGER NOT NULL DEFAULT 2,
      stop_on_open BOOLEAN NOT NULL DEFAULT true,
      sender_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      opened_at TIMESTAMPTZ,
      last_opened_at TIMESTAMPTZ,
      open_count INTEGER NOT NULL DEFAULT 0,
      last_contacted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      followup_subject TEXT,
      followup_body_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES senders(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'initial',
      sequence_step INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      scheduled_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      open_count INTEGER NOT NULL DEFAULT 0,
      failed_at TIMESTAMPTZ,
      failure_reason TEXT,
      gmail_message_id TEXT,
      gmail_thread_id TEXT,
      tracking_token TEXT UNIQUE NOT NULL,
      subject TEXT,
      body_html TEXT,
      body_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS suppressions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS daily_plans (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, local_date)
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_user_email ON candidates(user_id, email);
    CREATE INDEX IF NOT EXISTS idx_candidates_user_status ON candidates(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_emails_due ON emails(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_emails_user_status ON emails(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_emails_tracking_token ON emails(tracking_token);
    CREATE INDEX IF NOT EXISTS idx_suppressions_user_email ON suppressions(user_id, email);
  `);
}

const isDirectRun =
  process.argv[1]?.endsWith("migrations.ts") || process.argv[1]?.endsWith("migrations.js");

if (isDirectRun) {
  runMigrations()
    .then(async () => {
      await pool.end();
      console.log("Migrations completed");
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
