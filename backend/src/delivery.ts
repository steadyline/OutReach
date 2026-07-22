import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";
import { sendGmailMessage } from "./gmail.js";
import {
  addDays,
  addMinutes,
  type DeliverySettings,
  isWithinWorkingWindow,
  localDateKey,
  nextWorkingTime,
  nextWorkingTimeAfterGap,
  randomGapMinutes
} from "./time.js";
import { addTrackingAndFooter, renderVariables, textToHtml } from "./template.js";

export type SettingsRecord = DeliverySettings & {
  senderName: string | null;
};

type SettingsRow = {
  daily_limit: number;
  start_time: string;
  end_time: string;
  timezone: string;
  min_gap_minutes: number;
  max_gap_minutes: number;
  followup_after_days: number;
  second_followup_after_days: number;
  max_followups: number;
  stop_on_open: boolean;
  sender_name: string | null;
};

type CandidateRow = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  location: string | null;
  status: string;
  opened_at: Date | null;
};

type TemplateRow = {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body_text: string;
  followup_subject: string | null;
  followup_body_text: string | null;
};

type SenderRow = {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  refresh_token_encrypted: string;
  revoked_at: Date | null;
};

type EmailJobRow = {
  id: string;
  user_id: string;
  candidate_id: string;
  template_id: string;
  sender_id: string;
  sequence_step: number;
  tracking_token: string;
  gmail_thread_id: string | null;
  candidate_name: string;
  candidate_email: string;
  candidate_location: string | null;
  candidate_status: string;
  candidate_opened_at: Date | null;
  template_subject: string;
  template_body_text: string;
  followup_subject: string | null;
  followup_body_text: string | null;
  sender_email: string;
  sender_name: string | null;
  refresh_token_encrypted: string;
  sender_revoked_at: Date | null;
};

function settingsFromRow(row: SettingsRow): SettingsRecord {
  return {
    dailyLimit: row.daily_limit,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
    minGapMinutes: row.min_gap_minutes,
    maxGapMinutes: row.max_gap_minutes,
    followupAfterDays: row.followup_after_days,
    secondFollowupAfterDays: row.second_followup_after_days,
    maxFollowups: row.max_followups,
    stopOnOpen: row.stop_on_open,
    senderName: row.sender_name
  };
}

export async function ensureSettings(userId: string) {
  await query("INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [
    userId
  ]);

  const result = await query<SettingsRow>("SELECT * FROM settings WHERE user_id = $1", [userId]);
  return settingsFromRow(result.rows[0]);
}

async function sentCountForLocalDay(userId: string, settings: DeliverySettings, date: Date) {
  const targetKey = localDateKey(date, settings.timezone);
  const result = await query<{ sent_at: Date }>(
    `
      SELECT sent_at
      FROM emails
      WHERE user_id = $1
        AND sent_at >= now() - interval '48 hours'
        AND status IN ('sent', 'opened')
    `,
    [userId]
  );

  return result.rows.filter((row) => localDateKey(row.sent_at, settings.timezone) === targetKey)
    .length;
}

async function plannedCounts(userId: string, settings: DeliverySettings) {
  const result = await query<{ planned_at: Date }>(
    `
      SELECT COALESCE(sent_at, scheduled_at) AS planned_at
      FROM emails
      WHERE user_id = $1
        AND status IN ('queued', 'sent', 'opened')
        AND COALESCE(sent_at, scheduled_at) >= now() - interval '48 hours'
        AND COALESCE(sent_at, scheduled_at) <= now() + interval '30 days'
    `,
    [userId]
  );

  const counts = new Map<string, number>();
  for (const row of result.rows) {
    const key = localDateKey(row.planned_at, settings.timezone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export async function planSendTimes(userId: string, count: number) {
  const settings = await ensureSettings(userId);
  const counts = await plannedCounts(userId, settings);
  const times: Date[] = [];
  let cursor = nextWorkingTime(new Date(), settings);

  for (let index = 0; index < count; index += 1) {
    while ((counts.get(localDateKey(cursor, settings.timezone)) ?? 0) >= settings.dailyLimit) {
      cursor = nextWorkingTime(addDays(cursor, 1), settings);
    }

    times.push(cursor);
    const key = localDateKey(cursor, settings.timezone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    cursor = nextWorkingTime(addMinutes(cursor, randomGapMinutes(settings)), settings);
  }

  return times;
}

export async function queueInitialEmails(input: {
  userId: string;
  templateId: string;
  candidateIds?: string[];
}) {
  const sender = await query<SenderRow>(
    `
      SELECT *
      FROM senders
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY connected_at DESC
      LIMIT 1
    `,
    [input.userId]
  );
  if (!sender.rows[0]) {
    throw new Error("Connect Gmail before queueing emails");
  }

  const template = await query<TemplateRow>(
    "SELECT * FROM templates WHERE user_id = $1 AND id = $2",
    [input.userId, input.templateId]
  );
  if (!template.rows[0]) {
    throw new Error("Template not found");
  }

  const params: unknown[] = [input.userId, input.templateId];
  let candidateFilter = "";
  if (input.candidateIds?.length) {
    params.push(input.candidateIds);
    candidateFilter = `AND c.id = ANY($${params.length}::text[])`;
  }

  const candidates = await query<CandidateRow>(
    `
      SELECT c.*
      FROM candidates c
      LEFT JOIN suppressions s
        ON s.user_id = c.user_id AND lower(s.email) = lower(c.email)
      WHERE c.user_id = $1
        AND c.status = 'active'
        AND s.id IS NULL
        ${candidateFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM emails e
          WHERE e.candidate_id = c.id
            AND e.template_id = $2
            AND e.sequence_step = 0
            AND e.status IN ('queued', 'sent', 'opened')
        )
      ORDER BY c.created_at ASC
      LIMIT 500
    `,
    params
  );

  const times = await planSendTimes(input.userId, candidates.rows.length);

  for (let index = 0; index < candidates.rows.length; index += 1) {
    await query(
      `
        INSERT INTO emails (
          id, user_id, candidate_id, template_id, sender_id, type, sequence_step,
          status, scheduled_at, tracking_token
        )
        VALUES ($1, $2, $3, $4, $5, 'initial', 0, 'queued', $6, $7)
      `,
      [
        randomUUID(),
        input.userId,
        candidates.rows[index].id,
        input.templateId,
        sender.rows[0].id,
        times[index],
        randomUUID()
      ]
    );
  }

  return {
    queued: candidates.rows.length,
    skipped: Math.max((input.candidateIds?.length ?? candidates.rows.length) - candidates.rows.length, 0)
  };
}

function defaultFollowupBody() {
  return [
    "Hi {{first_name}},",
    "",
    "Just following up in case my previous note got buried.",
    "",
    "Would it make sense to connect?"
  ].join("\n");
}

function renderEmail(job: EmailJobRow, settings: SettingsRecord) {
  const unsubscribeUrl = `${config.backendPublicUrl}/api/unsubscribe/${job.tracking_token}`;
  const trackingPixelUrl = `${config.backendPublicUrl}/api/track/open/${job.tracking_token}.png`;
  const candidate = {
    name: job.candidate_name,
    email: job.candidate_email,
    location: job.candidate_location
  };
  const extras = {
    unsubscribeUrl,
    trackingPixelUrl,
    senderName: settings.senderName ?? job.sender_name
  };

  const subjectSource =
    job.sequence_step > 0
      ? job.followup_subject || `Re: ${job.template_subject}`
      : job.template_subject;
  const bodySource =
    job.sequence_step > 0
      ? job.followup_body_text || defaultFollowupBody()
      : job.template_body_text;

  const subject = renderVariables(subjectSource, candidate, extras);
  const bodyText = renderVariables(bodySource, candidate, extras);
  const html = addTrackingAndFooter(textToHtml(bodyText), extras);

  return {
    subject,
    bodyText,
    html,
    unsubscribeUrl
  };
}

async function reschedule(emailId: string, scheduledAt: Date, reason: string) {
  await query(
    `
      UPDATE emails
      SET scheduled_at = $2, failure_reason = $3, updated_at = now()
      WHERE id = $1
    `,
    [emailId, scheduledAt, reason]
  );
}

async function cancelEmail(emailId: string, reason: string) {
  await query(
    `
      UPDATE emails
      SET status = 'cancelled', failure_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'queued'
    `,
    [emailId, reason]
  );
}

function transientDelayMinutes(error: unknown) {
  const code =
    Number((error as { code?: number }).code) ||
    Number((error as { response?: { status?: number } }).response?.status);

  if (code === 429 || code === 403) {
    return 60;
  }
  if (code >= 500) {
    return 30;
  }
  return 0;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown delivery error";
}

async function scheduleNextFollowup(job: EmailJobRow, settings: SettingsRecord, threadId: string | null) {
  if (job.sequence_step >= settings.maxFollowups) {
    return;
  }

  const nextStep = job.sequence_step + 1;
  const delayDays =
    nextStep === 1 ? settings.followupAfterDays : settings.secondFollowupAfterDays;
  const scheduledAt = nextWorkingTime(addDays(new Date(), delayDays), settings);

  await query(
    `
      INSERT INTO emails (
        id, user_id, candidate_id, template_id, sender_id, type, sequence_step,
        status, scheduled_at, tracking_token, gmail_thread_id
      )
      VALUES ($1, $2, $3, $4, $5, 'followup', $6, 'queued', $7, $8, $9)
    `,
    [
      randomUUID(),
      job.user_id,
      job.candidate_id,
      job.template_id,
      job.sender_id,
      nextStep,
      scheduledAt,
      randomUUID(),
      threadId
    ]
  );
}

async function processEmail(job: EmailJobRow) {
  const settings = await ensureSettings(job.user_id);

  if (job.sender_revoked_at) {
    await cancelEmail(job.id, "Gmail sender is disconnected");
    return;
  }

  if (job.candidate_status !== "active") {
    await cancelEmail(job.id, `Candidate is ${job.candidate_status}`);
    return;
  }

  if (settings.stopOnOpen && job.candidate_opened_at) {
    await cancelEmail(job.id, "Candidate opened a previous email");
    return;
  }

  const now = new Date();
  if (!isWithinWorkingWindow(now, settings)) {
    await reschedule(job.id, nextWorkingTime(now, settings), "Outside configured send window");
    return;
  }

  const sentToday = await sentCountForLocalDay(job.user_id, settings, now);
  if (sentToday >= settings.dailyLimit) {
    await reschedule(
      job.id,
      nextWorkingTime(addDays(now, 1), settings),
      "Daily send limit reached"
    );
    return;
  }

  const lastSent = await query<{ sent_at: Date }>(
    `
      SELECT sent_at
      FROM emails
      WHERE user_id = $1 AND sent_at IS NOT NULL
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    [job.user_id]
  );
  const lastSentAt = lastSent.rows[0]?.sent_at;
  if (
    lastSentAt &&
    now.getTime() - lastSentAt.getTime() < settings.minGapMinutes * 60_000
  ) {
    await reschedule(
      job.id,
      nextWorkingTimeAfterGap(lastSentAt, settings),
      "Waiting for safe send gap"
    );
    return;
  }

  const rendered = renderEmail(job, settings);
  const senderName = settings.senderName ?? job.sender_name;

  try {
    const gmail = await sendGmailMessage({
      sender: {
        email: job.sender_email,
        name: senderName,
        refresh_token_encrypted: job.refresh_token_encrypted
      },
      toEmail: job.candidate_email,
      toName: job.candidate_name,
      subject: rendered.subject,
      html: rendered.html,
      unsubscribeUrl: rendered.unsubscribeUrl,
      threadId: job.gmail_thread_id
    });

    await query(
      `
        UPDATE emails
        SET status = 'sent',
            sent_at = now(),
            gmail_message_id = $2,
            gmail_thread_id = $3,
            subject = $4,
            body_html = $5,
            body_text = $6,
            failure_reason = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [job.id, gmail.messageId, gmail.threadId, rendered.subject, rendered.html, rendered.bodyText]
    );

    await query(
      `
        UPDATE candidates
        SET last_contacted_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [job.candidate_id]
    );

    await scheduleNextFollowup(job, settings, gmail.threadId);
  } catch (error) {
    const delay = transientDelayMinutes(error);
    if (delay > 0) {
      await reschedule(job.id, nextWorkingTime(addMinutes(new Date(), delay), settings), errorMessage(error));
      return;
    }

    await query(
      `
        UPDATE emails
        SET status = 'failed',
            failed_at = now(),
            failure_reason = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [job.id, errorMessage(error)]
    );
  }
}

export async function processDueEmails(limit = 10) {
  const jobs = await query<EmailJobRow>(
    `
      SELECT
        e.*,
        c.name AS candidate_name,
        c.email AS candidate_email,
        c.location AS candidate_location,
        c.status AS candidate_status,
        c.opened_at AS candidate_opened_at,
        t.subject AS template_subject,
        t.body_text AS template_body_text,
        t.followup_subject,
        t.followup_body_text,
        s.email AS sender_email,
        s.name AS sender_name,
        s.refresh_token_encrypted,
        s.revoked_at AS sender_revoked_at
      FROM emails e
      JOIN candidates c ON c.id = e.candidate_id
      JOIN templates t ON t.id = e.template_id
      JOIN senders s ON s.id = e.sender_id
      WHERE e.status = 'queued'
        AND e.scheduled_at <= now()
      ORDER BY e.scheduled_at ASC
      LIMIT $1
    `,
    [limit]
  );

  for (const job of jobs.rows) {
    await processEmail(job);
  }

  return jobs.rows.length;
}

export function startDeliveryWorker() {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await processDueEmails();
    } catch (error) {
      console.error("Delivery worker failed", error);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  return () => clearInterval(interval);
}

