import { randomUUID } from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { z } from "zod";
import {
  clearSessionCookie,
  getSessionUser,
  oauthCookieOptions,
  requireAuth,
  setSessionCookie,
  signSession,
  type AuthedRequest
} from "./auth.js";
import { config } from "./config.js";
import { encryptSecret } from "./crypto.js";
import { query } from "./db.js";
import { ensureSettings, queueInitialEmails } from "./delivery.js";
import { createOAuthClient, gmailScopes } from "./gmail.js";

const router = express.Router();
const oauthStateCookie = "reach_oauth_state";

const transparentPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function userId(req: express.Request) {
  return (req as AuthedRequest).user.id;
}

const candidateSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  location: z.string().trim().optional().nullable()
});

const candidateUpdateSchema = candidateSchema.partial().extend({
  status: z.enum(["active", "suppressed", "bounced", "unsubscribed"]).optional()
});

const templateSchema = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  bodyText: z.string().trim().min(1),
  followupSubject: z.string().trim().optional().nullable(),
  followupBodyText: z.string().trim().optional().nullable()
});

const settingsSchema = z
  .object({
    dailyLimit: z.number().int().min(1).max(500),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1).refine(assertTimezone, "Invalid timezone"),
    minGapMinutes: z.number().int().min(1).max(240),
    maxGapMinutes: z.number().int().min(1).max(240),
    followupAfterDays: z.number().int().min(1).max(60),
    secondFollowupAfterDays: z.number().int().min(1).max(90),
    maxFollowups: z.number().int().min(0).max(5),
    stopOnOpen: z.boolean(),
    senderName: z.string().trim().optional().nullable()
  })
  .refine((value) => value.maxGapMinutes >= value.minGapMinutes, {
    message: "Max gap must be greater than or equal to min gap",
    path: ["maxGapMinutes"]
  });

const queueSchema = z.object({
  templateId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).optional()
});

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.get("/auth/google", (req, res) => {
  const state = randomUUID();
  res.cookie(oauthStateCookie, state, oauthCookieOptions());

  const oauth = createOAuthClient();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: gmailScopes,
    state,
    include_granted_scopes: true
  });
  res.redirect(url);
});

router.get(
  "/auth/google/callback",
  asyncRoute(async (req, res) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code || !state || state !== req.cookies?.[oauthStateCookie]) {
      res.redirect(`${config.frontendUrl}?auth_error=invalid_state`);
      return;
    }

    res.clearCookie(oauthStateCookie, oauthCookieOptions());

    const oauth = createOAuthClient();
    const tokenResponse = await oauth.getToken(code);
    const tokens = tokenResponse.tokens;
    oauth.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth });
    const profile = await oauth2.userinfo.get();
    const googleSub = profile.data.id;
    const email = profile.data.email?.toLowerCase();

    if (!googleSub || !email) {
      res.redirect(`${config.frontendUrl}?auth_error=missing_profile`);
      return;
    }

    const existingUser = await query<{ id: string }>(
      "SELECT id FROM users WHERE google_sub = $1 OR email = $2 LIMIT 1",
      [googleSub, email]
    );
    const uid = existingUser.rows[0]?.id ?? randomUUID();

    await query(
      `
        INSERT INTO users (id, google_sub, email, name, avatar_url, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (id)
        DO UPDATE SET google_sub = EXCLUDED.google_sub,
                      email = EXCLUDED.email,
                      name = EXCLUDED.name,
                      avatar_url = EXCLUDED.avatar_url,
                      updated_at = now()
      `,
      [uid, googleSub, email, profile.data.name ?? null, profile.data.picture ?? null]
    );

    const existingSender = await query<{ refresh_token_encrypted: string }>(
      "SELECT refresh_token_encrypted FROM senders WHERE user_id = $1 AND email = $2",
      [uid, email]
    );
    const refreshToken = tokens.refresh_token;

    if (!refreshToken && !existingSender.rows[0]) {
      res.redirect(`${config.frontendUrl}?auth_error=missing_refresh_token`);
      return;
    }

    const refreshTokenEncrypted = refreshToken
      ? encryptSecret(refreshToken)
      : existingSender.rows[0].refresh_token_encrypted;

    await query(
      `
        INSERT INTO senders (
          id, user_id, email, name, google_sub, refresh_token_encrypted,
          access_token_encrypted, token_expiry, scope, revoked_at, connected_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, now())
        ON CONFLICT (user_id, email)
        DO UPDATE SET name = EXCLUDED.name,
                      google_sub = EXCLUDED.google_sub,
                      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                      access_token_encrypted = EXCLUDED.access_token_encrypted,
                      token_expiry = EXCLUDED.token_expiry,
                      scope = EXCLUDED.scope,
                      revoked_at = NULL,
                      connected_at = now()
      `,
      [
        randomUUID(),
        uid,
        email,
        profile.data.name ?? null,
        googleSub,
        refreshTokenEncrypted,
        tokens.access_token ? encryptSecret(tokens.access_token) : null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        tokens.scope ?? gmailScopes.join(" ")
      ]
    );

    await ensureSettings(uid);
    setSessionCookie(res, signSession({ id: uid, email }));
    res.redirect(`${config.frontendUrl}?connected=1`);
  })
);

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get(
  "/auth/me",
  asyncRoute(async (req, res) => {
    const session = await getSessionUser(req);
    if (!session) {
      res.json({ user: null });
      return;
    }

    const result = await query<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      sender_email: string | null;
      connected_at: Date | null;
    }>(
      `
        SELECT u.id, u.email, u.name, u.avatar_url,
               s.email AS sender_email, s.connected_at
        FROM users u
        LEFT JOIN LATERAL (
          SELECT email, connected_at
          FROM senders
          WHERE user_id = u.id AND revoked_at IS NULL
          ORDER BY connected_at DESC
          LIMIT 1
        ) s ON true
        WHERE u.id = $1
      `,
      [session.id]
    );

    res.json({ user: result.rows[0] ?? null });
  })
);

router.get(
  "/track/open/:token.png",
  asyncRoute(async (req, res) => {
    await handleOpenToken(req.params.token);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.end(transparentPixel);
  })
);

router.get(
  "/unsubscribe/:token",
  asyncRoute(async (req, res) => {
    const ok = await unsubscribeToken(req.params.token);
    res
      .status(ok ? 200 : 404)
      .type("html")
      .send(`<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>${ok ? "Unsubscribed" : "Not found"}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 48px; color: #111827; }
              main { max-width: 560px; }
            </style>
          </head>
          <body>
            <main>
              <h1>${ok ? "You are unsubscribed" : "Link not found"}</h1>
              <p>${
                ok
                  ? "You will not receive additional outreach emails from this sender."
                  : "This unsubscribe link is no longer available."
              }</p>
            </main>
          </body>
        </html>`);
  })
);

router.post(
  "/unsubscribe/:token",
  asyncRoute(async (req, res) => {
    const ok = await unsubscribeToken(req.params.token);
    res.status(ok ? 200 : 404).json({ ok });
  })
);

router.use(requireAuth);

router.get(
  "/settings",
  asyncRoute(async (req, res) => {
    res.json(await ensureSettings(userId(req)));
  })
);

router.put(
  "/settings",
  asyncRoute(async (req, res) => {
    const parsed = settingsSchema.parse(req.body);
    await query(
      `
        INSERT INTO settings (
          user_id, daily_limit, start_time, end_time, timezone, min_gap_minutes,
          max_gap_minutes, followup_after_days, second_followup_after_days,
          max_followups, stop_on_open, sender_name, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (user_id)
        DO UPDATE SET daily_limit = EXCLUDED.daily_limit,
                      start_time = EXCLUDED.start_time,
                      end_time = EXCLUDED.end_time,
                      timezone = EXCLUDED.timezone,
                      min_gap_minutes = EXCLUDED.min_gap_minutes,
                      max_gap_minutes = EXCLUDED.max_gap_minutes,
                      followup_after_days = EXCLUDED.followup_after_days,
                      second_followup_after_days = EXCLUDED.second_followup_after_days,
                      max_followups = EXCLUDED.max_followups,
                      stop_on_open = EXCLUDED.stop_on_open,
                      sender_name = EXCLUDED.sender_name,
                      updated_at = now()
      `,
      [
        userId(req),
        parsed.dailyLimit,
        parsed.startTime,
        parsed.endTime,
        parsed.timezone,
        parsed.minGapMinutes,
        parsed.maxGapMinutes,
        parsed.followupAfterDays,
        parsed.secondFollowupAfterDays,
        parsed.maxFollowups,
        parsed.stopOnOpen,
        parsed.senderName ?? null
      ]
    );
    res.json(await ensureSettings(userId(req)));
  })
);

router.get(
  "/candidates",
  asyncRoute(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const params = [userId(req)];
    let filter = "";
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filter = `AND (
        lower(name) LIKE $2 OR lower(email) LIKE $2 OR lower(coalesce(location, '')) LIKE $2
      )`;
    }

    const result = await query(
      `
        SELECT *
        FROM candidates
        WHERE user_id = $1
          ${filter}
        ORDER BY created_at DESC
      `,
      params
    );
    res.json(result.rows);
  })
);

router.post(
  "/candidates",
  asyncRoute(async (req, res) => {
    const parsed = candidateSchema.parse(req.body);
    const suppressed = await query<{ id: string }>(
      "SELECT id FROM suppressions WHERE user_id = $1 AND lower(email) = lower($2)",
      [userId(req), parsed.email]
    );
    const result = await query(
      `
        INSERT INTO candidates (id, user_id, name, email, location, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, email)
        DO UPDATE SET name = EXCLUDED.name,
                      location = EXCLUDED.location,
                      updated_at = now()
        RETURNING *
      `,
      [
        randomUUID(),
        userId(req),
        parsed.name,
        parsed.email,
        parsed.location || null,
        suppressed.rows[0] ? "suppressed" : "active"
      ]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.patch(
  "/candidates/:id",
  asyncRoute(async (req, res) => {
    const parsed = candidateUpdateSchema.parse(req.body);
    const current = await query("SELECT * FROM candidates WHERE user_id = $1 AND id = $2", [
      userId(req),
      req.params.id
    ]);
    if (!current.rows[0]) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    const next = {
      ...current.rows[0],
      name: parsed.name ?? current.rows[0].name,
      email: parsed.email ?? current.rows[0].email,
      location: parsed.location !== undefined ? parsed.location || null : current.rows[0].location,
      status: parsed.status ?? current.rows[0].status
    };

    const result = await query(
      `
        UPDATE candidates
        SET name = $3, email = $4, location = $5, status = $6, updated_at = now()
        WHERE user_id = $1 AND id = $2
        RETURNING *
      `,
      [userId(req), req.params.id, next.name, next.email, next.location, next.status]
    );
    res.json(result.rows[0]);
  })
);

router.delete(
  "/candidates/:id",
  asyncRoute(async (req, res) => {
    await query("DELETE FROM candidates WHERE user_id = $1 AND id = $2", [
      userId(req),
      req.params.id
    ]);
    res.status(204).end();
  })
);

router.get(
  "/templates",
  asyncRoute(async (req, res) => {
    const result = await query("SELECT * FROM templates WHERE user_id = $1 ORDER BY created_at DESC", [
      userId(req)
    ]);
    res.json(result.rows);
  })
);

router.post(
  "/templates",
  asyncRoute(async (req, res) => {
    const parsed = templateSchema.parse(req.body);
    const result = await query(
      `
        INSERT INTO templates (
          id, user_id, name, subject, body_text, followup_subject, followup_body_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        randomUUID(),
        userId(req),
        parsed.name,
        parsed.subject,
        parsed.bodyText,
        parsed.followupSubject || null,
        parsed.followupBodyText || null
      ]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.patch(
  "/templates/:id",
  asyncRoute(async (req, res) => {
    const parsed = templateSchema.partial().parse(req.body);
    const current = await query("SELECT * FROM templates WHERE user_id = $1 AND id = $2", [
      userId(req),
      req.params.id
    ]);
    if (!current.rows[0]) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const next = {
      ...current.rows[0],
      name: parsed.name ?? current.rows[0].name,
      subject: parsed.subject ?? current.rows[0].subject,
      body_text: parsed.bodyText ?? current.rows[0].body_text,
      followup_subject:
        parsed.followupSubject !== undefined
          ? parsed.followupSubject || null
          : current.rows[0].followup_subject,
      followup_body_text:
        parsed.followupBodyText !== undefined
          ? parsed.followupBodyText || null
          : current.rows[0].followup_body_text
    };

    const result = await query(
      `
        UPDATE templates
        SET name = $3,
            subject = $4,
            body_text = $5,
            followup_subject = $6,
            followup_body_text = $7,
            updated_at = now()
        WHERE user_id = $1 AND id = $2
        RETURNING *
      `,
      [
        userId(req),
        req.params.id,
        next.name,
        next.subject,
        next.body_text,
        next.followup_subject,
        next.followup_body_text
      ]
    );
    res.json(result.rows[0]);
  })
);

router.delete(
  "/templates/:id",
  asyncRoute(async (req, res) => {
    await query("DELETE FROM templates WHERE user_id = $1 AND id = $2", [
      userId(req),
      req.params.id
    ]);
    res.status(204).end();
  })
);

router.post(
  "/campaigns/queue",
  asyncRoute(async (req, res) => {
    const parsed = queueSchema.parse(req.body);
    const result = await queueInitialEmails({
      userId: userId(req),
      templateId: parsed.templateId,
      candidateIds: parsed.candidateIds
    });
    res.status(201).json(result);
  })
);

router.get(
  "/emails",
  asyncRoute(async (req, res) => {
    const result = await query(
      `
        SELECT e.*,
               c.name AS candidate_name,
               c.email AS candidate_email,
               t.name AS template_name
        FROM emails e
        JOIN candidates c ON c.id = e.candidate_id
        JOIN templates t ON t.id = e.template_id
        WHERE e.user_id = $1
        ORDER BY e.scheduled_at DESC
        LIMIT 250
      `,
      [userId(req)]
    );
    res.json(result.rows);
  })
);

router.post(
  "/emails/:id/cancel",
  asyncRoute(async (req, res) => {
    const result = await query(
      `
        UPDATE emails
        SET status = 'cancelled',
            failure_reason = 'Cancelled manually',
            updated_at = now()
        WHERE user_id = $1 AND id = $2 AND status = 'queued'
        RETURNING *
      `,
      [userId(req), req.params.id]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Queued email not found" });
      return;
    }
    res.json(result.rows[0]);
  })
);

router.get(
  "/stats",
  asyncRoute(async (req, res) => {
    const emailStats = await query<{ status: string; count: string }>(
      "SELECT status, count(*) FROM emails WHERE user_id = $1 GROUP BY status",
      [userId(req)]
    );
    const candidateStats = await query<{ status: string; count: string }>(
      "SELECT status, count(*) FROM candidates WHERE user_id = $1 GROUP BY status",
      [userId(req)]
    );

    res.json({
      emails: Object.fromEntries(
        emailStats.rows.map((row) => [row.status, Number(row.count)])
      ),
      candidates: Object.fromEntries(
        candidateStats.rows.map((row) => [row.status, Number(row.count)])
      )
    });
  })
);

export async function handleOpenToken(token: string) {
  const email = await query<{
    id: string;
    user_id: string;
    candidate_id: string;
    status: string;
  }>("SELECT id, user_id, candidate_id, status FROM emails WHERE tracking_token = $1", [token]);

  const row = email.rows[0];
  if (!row) {
    return;
  }

  await query(
    `
      UPDATE emails
      SET status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
          opened_at = COALESCE(opened_at, now()),
          open_count = open_count + 1,
          updated_at = now()
      WHERE id = $1
    `,
    [row.id]
  );

  await query(
    `
      UPDATE candidates
      SET opened_at = COALESCE(opened_at, now()),
          last_opened_at = now(),
          open_count = open_count + 1,
          updated_at = now()
      WHERE id = $1
    `,
    [row.candidate_id]
  );

  const settings = await ensureSettings(row.user_id);
  if (settings.stopOnOpen) {
    await query(
      `
        UPDATE emails
        SET status = 'cancelled',
            failure_reason = 'Stopped because candidate opened an email',
            updated_at = now()
        WHERE user_id = $1
          AND candidate_id = $2
          AND status = 'queued'
      `,
      [row.user_id, row.candidate_id]
    );
  }
}

async function unsubscribeToken(token: string) {
  const result = await query<{
    user_id: string;
    candidate_id: string;
    candidate_email: string;
  }>(
    `
      SELECT e.user_id, e.candidate_id, c.email AS candidate_email
      FROM emails e
      JOIN candidates c ON c.id = e.candidate_id
      WHERE e.tracking_token = $1
    `,
    [token]
  );
  const row = result.rows[0];
  if (!row) {
    return false;
  }

  await query(
    `
      INSERT INTO suppressions (id, user_id, email, reason)
      VALUES ($1, $2, $3, 'unsubscribe')
      ON CONFLICT (user_id, email)
      DO UPDATE SET reason = 'unsubscribe'
    `,
    [randomUUID(), row.user_id, row.candidate_email]
  );

  await query(
    `
      UPDATE candidates
      SET status = 'unsubscribed', updated_at = now()
      WHERE id = $1
    `,
    [row.candidate_id]
  );

  await query(
    `
      UPDATE emails
      SET status = 'cancelled',
          failure_reason = 'Candidate unsubscribed',
          updated_at = now()
      WHERE user_id = $1
        AND candidate_id = $2
        AND status = 'queued'
    `,
    [row.user_id, row.candidate_id]
  );

  return true;
}

export { router };
