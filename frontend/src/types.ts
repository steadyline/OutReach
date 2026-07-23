export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  sender_email: string | null;
  connected_at: string | null;
};

export type Candidate = {
  id: string;
  name: string;
  email: string;
  location: string | null;
  status:
    | "active"
    | "scheduled"
    | "sent"
    | "opened"
    | "failed"
    | "suppressed"
    | "bounced"
    | "unsubscribed";
  opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  last_contacted_at: string | null;
  created_at: string;
};

export type CandidatePage = {
  data: Candidate[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Template = {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  followup_subject: string | null;
  followup_body_text: string | null;
  created_at: string;
};

export type Settings = {
  dailyLimit: number;
  startTime: string;
  endTime: string;
  timezone: string;
  minGapMinutes: number;
  maxGapMinutes: number;
  followupAfterDays: number;
  secondFollowupAfterDays: number;
  maxFollowups: number;
  stopOnOpen: boolean;
  senderName: string | null;
};

export type EmailLog = {
  id: string;
  candidate_name: string;
  candidate_email: string;
  template_name: string;
  type: "initial" | "followup";
  sequence_step: number;
  status: "queued" | "sent" | "opened" | "failed" | "cancelled";
  scheduled_at: string;
  sent_at: string | null;
  opened_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  subject: string | null;
};

export type EmailPage = {
  data: EmailLog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Stats = {
  emails: Record<string, number>;
  candidates: Record<string, number>;
};
