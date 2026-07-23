import {
  Activity,
  Ban,
  CalendarClock,
  Check,
  Clock,
  Edit3,
  Eye,
  FileText,
  Inbox,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X
} from "lucide-react";
import Papa from "papaparse";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { api } from "./api";
import type { Candidate, EmailLog, Settings, Stats, Template, User } from "./types";

type View = "candidates" | "templates" | "queue" | "settings";

type CandidateForm = {
  name: string;
  email: string;
  location: string;
};

type CandidateSort = "newest" | "initial";

type TemplateForm = {
  name: string;
  subject: string;
  bodyText: string;
  followupSubject: string;
  followupBodyText: string;
};

type ActionKey =
  | "candidate"
  | "updateCandidate"
  | "import"
  | "template"
  | "settings"
  | "plan"
  | "refresh"
  | "delete"
  | "deleteEmail"
  | "logout"
  | "cancel"
  | "page"
  | "search";

const emptyCandidate: CandidateForm = { name: "", email: "", location: "" };
const defaultCandidatePagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1
};
const emptyTemplate: TemplateForm = {
  name: "",
  subject: "",
  bodyText: "Hi {{first_name}},\n\n",
  followupSubject: "Re: {{first_name}}",
  followupBodyText:
    "Hi {{first_name}},\n\nJust following up in case my previous note got buried.\n\nWould it make sense to connect?"
};

const fallbackSettings: Settings = {
  dailyLimit: 60,
  startTime: "09:00",
  endTime: "17:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  minGapMinutes: 4,
  maxGapMinutes: 8,
  followupAfterDays: 2,
  secondFollowupAfterDays: 6,
  maxFollowups: 2,
  stopOnOpen: true,
  senderName: ""
};

const timezoneOptions: Array<[string, string]> = [
  ["UTC", "UTC"],
  ["America/New_York", "Eastern Time"],
  ["America/Chicago", "Central Time"],
  ["America/Denver", "Mountain Time"],
  ["America/Los_Angeles", "Pacific Time"],
  ["America/Toronto", "Toronto"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Berlin"],
  ["Europe/Paris", "Paris"],
  ["Asia/Dubai", "Dubai"],
  ["Asia/Kolkata", "India"],
  ["Asia/Bangkok", "Bangkok"],
  ["Asia/Jakarta", "Jakarta"],
  ["Asia/Manila", "Manila"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Hong_Kong", "Hong Kong"],
  ["Asia/Shanghai", "Shanghai"],
  ["Asia/Seoul", "Seoul"],
  ["Asia/Tokyo", "Tokyo"],
  ["Australia/Sydney", "Sydney"],
  ["Australia/Melbourne", "Melbourne"],
  ["Pacific/Auckland", "Auckland"]
];

const viewMeta: Record<View, { eyebrow: string; title: string }> = {
  candidates: {
    eyebrow: "People",
    title: "Candidate Pipeline"
  },
  templates: {
    eyebrow: "Messaging",
    title: "Email Templates"
  },
  queue: {
    eyebrow: "Delivery",
    title: "Outbox"
  },
  settings: {
    eyebrow: "Controls",
    title: "Delivery Settings"
  }
};

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (status === "queued") {
    return "scheduled";
  }
  return status.replace(/_/g, " ");
}

function authErrorMessage(code: string) {
  const messages: Record<string, string> = {
    missing_gmail_send_scope:
      "Google did not grant Gmail sending permission. Reconnect Gmail and approve the Gmail send scope.",
    reconnect_gmail_send_scope:
      "Reconnect Gmail to replace the old token with Gmail sending permission.",
    missing_refresh_token:
      "Google did not return an offline token. Reconnect Gmail and approve access again.",
    invalid_state: "Google sign-in expired. Please try again.",
    missing_profile: "Google did not return your profile. Please try again."
  };
  return messages[code] ?? "Google connection failed. Please reconnect Gmail.";
}

function userInitials(name: string | null, email: string) {
  const source = (name || email.split("@")[0] || "User").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return initials.toUpperCase();
}

function timezoneGmtOffset(timezone: string) {
  try {
    const timeZoneName = "longOffset" as Intl.DateTimeFormatOptions["timeZoneName"];
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    return "GMT";
  }
}

function templateToForm(template: Template): TemplateForm {
  return {
    name: template.name,
    subject: template.subject,
    bodyText: template.body_text,
    followupSubject: template.followup_subject ?? "",
    followupBodyText: template.followup_body_text ?? ""
  };
}

type CandidateCsvRow = Record<string, unknown>;

function csvString(row: CandidateCsvRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function csvName(row: CandidateCsvRow) {
  const fullName = csvString(row, [
    "name",
    "full_name",
    "candidate_name",
    "person_name",
    "contact_name"
  ]);
  if (fullName) {
    return fullName;
  }

  return [csvString(row, ["first_name", "firstname"]), csvString(row, ["last_name", "lastname"])]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function parseCandidateCsv(file: File) {
  return new Promise<Array<{ name: string; email: string; location: string | null }>>(
    (resolve, reject) => {
      Papa.parse<CandidateCsvRow>(file, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) =>
          header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        complete: (result) => {
          if (result.errors.length) {
            reject(new Error(result.errors[0].message));
            return;
          }

          const invalidRows: number[] = [];
          const rows = result.data
            .map((row, index) => {
              const name = csvName(row);
              const email = csvString(row, ["email", "email_address", "mail"]).toLowerCase();
              const location = csvString(row, ["location", "city", "region", "country"]);

              if (!name || !email) {
                invalidRows.push(index + 2);
                return null;
              }

              return {
                name,
                email,
                location: location || null
              };
            })
            .filter((row): row is { name: string; email: string; location: string | null } =>
              Boolean(row)
            );

          if (invalidRows.length) {
            reject(
              new Error(
                `CSV rows missing name or email: ${invalidRows.slice(0, 8).join(", ")}`
              )
            );
            return;
          }

          if (!rows.length) {
            reject(new Error("CSV did not contain any candidate rows"));
            return;
          }

          resolve(rows);
        },
        error: (error) => reject(error)
      });
    }
  );
}

function IconButton({
  title,
  onClick,
  children,
  tone = "plain",
  disabled = false
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "plain" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${tone}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [view, setView] = useState<View>("candidates");
  const [authError, setAuthError] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatePagination, setCandidatePagination] = useState(defaultCandidatePagination);
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [settings, setSettings] = useState<Settings>(fallbackSettings);
  const [stats, setStats] = useState<Stats>({ emails: {}, candidates: {} });

  const [search, setSearch] = useState("");
  const [candidateSort, setCandidateSort] = useState<CandidateSort>("newest");
  const [candidateForm, setCandidateForm] = useState<CandidateForm>(emptyCandidate);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [candidateEditForm, setCandidateEditForm] = useState<CandidateForm>(emptyCandidate);

  const [templateForm, setTemplateForm] = useState<TemplateForm>(emptyTemplate);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  const busy = activeAction !== null;
  const activeCount = stats.candidates.active ?? 0;
  const timezoneSelectOptions = useMemo(() => {
    const options = [...timezoneOptions];
    const currentTimezone = settings.timezone;
    if (currentTimezone && !options.some(([value]) => value === currentTimezone)) {
      options.unshift([currentTimezone, currentTimezone]);
    }
    return options.map(([value, label]) => ({
      value,
      label,
      offset: timezoneGmtOffset(value)
    }));
  }, [settings.timezone]);
  const currentTimezoneOffset = useMemo(
    () => timezoneGmtOffset(settings.timezone),
    [settings.timezone]
  );

  const emailStats = useMemo(
    () => [
      { label: "Scheduled", value: stats.emails.queued ?? 0, icon: Clock, tone: "queued" },
      { label: "Sent", value: stats.emails.sent ?? 0, icon: Send, tone: "sent" },
      { label: "Opened", value: stats.emails.opened ?? 0, icon: Eye, tone: "opened" },
      { label: "Failed", value: stats.emails.failed ?? 0, icon: X, tone: "failed" }
    ],
    [stats]
  );
  const hasQueuedEmails = useMemo(
    () => emails.some((email) => email.status === "queued"),
    [emails]
  );

  async function loadApp(
    searchValue = search,
    pageValue = candidatePagination.page,
    pageSizeValue = candidatePagination.pageSize,
    sortValue = candidateSort
  ) {
    const [candidatePageData, templateData, emailData, settingsData, statsData] = await Promise.all([
      api.candidates({
        search: searchValue,
        page: pageValue,
        pageSize: pageSizeValue,
        sort: sortValue
      }),
      api.templates(),
      api.emails(),
      api.settings(),
      api.stats()
    ]);
    setCandidates(candidatePageData.data);
    setCandidatePagination({
      page: candidatePageData.page,
      pageSize: candidatePageData.pageSize,
      total: candidatePageData.total,
      totalPages: candidatePageData.totalPages
    });
    setEmails(emailData);
    setSettings(settingsData);
    setStats(statsData);
    const primaryTemplate = templateData[0];
    setSelectedTemplateId(primaryTemplate?.id ?? "");
    setEditingTemplateId(primaryTemplate?.id ?? null);
    setTemplateForm(primaryTemplate ? templateToForm(primaryTemplate) : emptyTemplate);
  }

  async function refreshAuth() {
    setLoading(true);
    try {
      const authErrorCode = new URLSearchParams(window.location.search).get("auth_error");
      if (authErrorCode) {
        const message = authErrorMessage(authErrorCode);
        setAuthError(message);
        toast.error(message);
        window.history.replaceState({}, "", window.location.pathname);
      }

      const result = await api.me();
      setUser(result.user);
      if (result.user) {
        await loadApp("");
      }
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "Could not load session");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    if (!user || !hasQueuedEmails) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadApp(
        search,
        candidatePagination.page,
        candidatePagination.pageSize,
        candidateSort
      );
    }, 8_000);

    return () => window.clearInterval(intervalId);
  }, [
    candidatePagination.page,
    candidatePagination.pageSize,
    candidateSort,
    hasQueuedEmails,
    search,
    user
  ]);

  async function run<T>(
    action: () => Promise<T>,
    options: {
      action?: ActionKey;
      loading?: string;
      success?: string | ((result: T) => string);
    } = {}
  ) {
    const toastId = options.loading ? toast.loading(options.loading) : undefined;
    setActiveAction(options.action ?? "refresh");
    try {
      const result = await action();
      if (options.success) {
        toast.success(
          typeof options.success === "function" ? options.success(result) : options.success,
          { id: toastId }
        );
      } else if (toastId) {
        toast.dismiss(toastId);
      }
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Something went wrong";
      if (toastId) {
        toast.error(message, { id: toastId });
      } else {
        toast.error(message);
      }
      return undefined;
    } finally {
      setActiveAction(null);
    }
  }

  async function submitCandidate(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createCandidate({
        name: candidateForm.name,
        email: candidateForm.email,
        location: candidateForm.location || null
      });
      setCandidateForm(emptyCandidate);
      await loadApp(search, 1, candidatePagination.pageSize, candidateSort);
    }, {
      action: "candidate",
      loading: "Adding candidate...",
      success: "Candidate added"
    });
  }

  async function handleCandidateCsvImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    await run(async () => {
      const rows = await parseCandidateCsv(file);
      const result = await api.importCandidates(rows);
      await loadApp(search, 1, candidatePagination.pageSize, candidateSort);
      return result;
    }, {
      action: "import",
      loading: "Importing CSV...",
      success: (result) =>
        `Imported ${result.imported}: ${result.created} added, ${result.updated} updated, ${result.skipped} duplicate rows skipped`
    });
  }

  async function submitTemplate(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const payload = {
        name: templateForm.name,
        subject: templateForm.subject,
        bodyText: templateForm.bodyText,
        followupSubject: templateForm.followupSubject || null,
        followupBodyText: templateForm.followupBodyText || null
      };
      let savedTemplate: Template;
      if (editingTemplateId) {
        savedTemplate = await api.updateTemplate(editingTemplateId, payload);
      } else {
        savedTemplate = await api.createTemplate(payload);
      }
      setEditingTemplateId(savedTemplate.id);
      setSelectedTemplateId(savedTemplate.id);
      setTemplateForm(templateToForm(savedTemplate));
      await loadApp();
    }, {
      action: "template",
      loading: "Saving template...",
      success: "Template saved"
    });
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.saveSettings(settings);
      await loadApp();
    }, {
      action: "settings",
      loading: "Saving settings...",
      success: "Settings saved"
    });
  }

  async function planToday() {
    if (!selectedTemplateId) {
      toast.error("Create the primary template before planning today");
      return;
    }

    await run(async () => {
      const result = await api.planToday();
      await loadApp();
      setView("queue");
      return result;
    }, {
      action: "plan",
      loading: "Planning today's outbox...",
      success: (result) =>
        result.queued
          ? `${result.queued} planned today: ${result.followups} follow-ups, ${result.initial} new`
          : "Today's outbox is already planned"
    });
  }

  function startCandidateEdit(candidate: Candidate) {
    setEditingCandidateId(candidate.id);
    setCandidateEditForm({
      name: candidate.name,
      email: candidate.email,
      location: candidate.location ?? ""
    });
  }

  function cancelCandidateEdit() {
    setEditingCandidateId(null);
    setCandidateEditForm(emptyCandidate);
  }

  async function saveCandidateEdit(candidateId: string) {
    const payload = {
      name: candidateEditForm.name.trim(),
      email: candidateEditForm.email.trim(),
      location: candidateEditForm.location.trim() || null
    };

    if (!payload.name || !payload.email) {
      toast.error("Name and email are required");
      return;
    }

    await run(async () => {
      await api.updateCandidate(candidateId, payload);
      cancelCandidateEdit();
      await loadApp();
    }, {
      action: "updateCandidate",
      loading: "Updating candidate...",
      success: "Candidate updated"
    });
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      cancelCandidateEdit();
      await loadApp(search, 1, candidatePagination.pageSize, candidateSort);
    }, {
      action: "search"
    });
  }

  async function changeCandidatePage(page: number) {
    const nextPage = Math.min(Math.max(1, page), candidatePagination.totalPages);
    if (nextPage === candidatePagination.page) {
      return;
    }

    cancelCandidateEdit();
    await run(async () => {
      await loadApp(search, nextPage, candidatePagination.pageSize, candidateSort);
    }, {
      action: "page"
    });
  }

  async function changeCandidatePageSize(event: ChangeEvent<HTMLSelectElement>) {
    const nextPageSize = Number(event.target.value);
    cancelCandidateEdit();
    setCandidatePagination((current) => ({
      ...current,
      page: 1,
      pageSize: nextPageSize
    }));
    await run(async () => {
      await loadApp(search, 1, nextPageSize, candidateSort);
    }, {
      action: "page"
    });
  }

  async function changeCandidateSort(event: ChangeEvent<HTMLSelectElement>) {
    const nextSort = event.target.value as CandidateSort;
    cancelCandidateEdit();
    setCandidateSort(nextSort);
    await run(async () => {
      await loadApp(search, 1, candidatePagination.pageSize, nextSort);
    }, {
      action: "page"
    });
  }

  async function logout() {
    await run(async () => {
      await api.logout();
      setUser(null);
      setCandidates([]);
      setCandidatePagination(defaultCandidatePagination);
      setEmails([]);
    }, {
      action: "logout",
      loading: "Signing out..."
    });
  }

  if (loading) {
    return (
      <main className="boot">
        <Toaster position="top-right" />
        <RefreshCw className="spin" size={24} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login-shell">
        <Toaster position="top-right" />
        <section className="login-panel">
          <div className="login-brand-row">
            <div className="brand-mark">R</div>
            <span>Reach</span>
          </div>
          <div className="login-copy">
            <p className="eyebrow">Outreach workspace</p>
            <h1>Sign in to Reach</h1>
            <p>Connect Gmail to manage candidates, templates, tracking, and delivery windows.</p>
          </div>
          <a className="primary-link login-cta" href={api.authUrl}>
            <Mail size={18} />
            Continue with Gmail
          </a>
          {authError && <p className="error-text">{authError}</p>}
        </section>
        <section className="login-preview" aria-hidden="true">
          <div className="preview-topline">
            <span className="status-light" />
            <span>Delivery guard ready</span>
          </div>
          <div className="preview-window">
            <div className="preview-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-grid">
              <div>
                <Users size={18} />
                <strong>128</strong>
                <span>Candidates</span>
              </div>
              <div>
                <Inbox size={18} />
                <strong>60</strong>
                <span>Daily cap</span>
              </div>
              <div>
                <Activity size={18} />
                <strong>42%</strong>
                <span>Open rate</span>
              </div>
            </div>
            <div className="preview-list">
              <div>
                <span className="avatar-chip">AM</span>
                <div>
                  <strong>Amanda Morgan</strong>
                  <span>Follow-up queued</span>
                </div>
                <Clock size={16} />
              </div>
              <div>
                <span className="avatar-chip green">JL</span>
                <div>
                  <strong>Jon Lee</strong>
                  <span>Opened today</span>
                </div>
                <Eye size={16} />
              </div>
              <div>
                <span className="avatar-chip blue">KP</span>
                <div>
                  <strong>Kira Patel</strong>
                  <span>Initial sent</span>
                </div>
                <Check size={16} />
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const senderEmail = user.sender_email ?? user.email;
  const accountInitials = userInitials(user.name, senderEmail);
  const currentMeta = viewMeta[view];
  const candidateRangeStart =
    candidatePagination.total === 0
      ? 0
      : (candidatePagination.page - 1) * candidatePagination.pageSize + 1;
  const candidateRangeEnd = Math.min(
    candidatePagination.total,
    candidatePagination.page * candidatePagination.pageSize
  );

  return (
    <main className="product-shell">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            border: "1px solid #e4e7ec",
            boxShadow: "0 8px 24px rgba(16, 24, 40, 0.08)",
            color: "#101828",
            fontSize: "13px"
          }
        }}
      />
      <aside className="sidebar">
        <div className="side-brand">
          <span className="brand-icon">R</span>
          <div>
            <strong>Reach</strong>
            <span>Outreach Console</span>
          </div>
        </div>

      <nav className="tabs" aria-label="Workspace">
        {[
          ["candidates", "Candidates", Users],
          ["templates", "Templates", FileText],
          ["queue", "Outbox", Inbox],
          ["settings", "Settings", SettingsIcon]
        ].map(([key, label, Icon]) => (
          <button
            type="button"
            key={key as string}
            className={view === key ? "active" : ""}
            onClick={() => setView(key as View)}
          >
            <Icon size={16} />
            {label as string}
          </button>
        ))}
      </nav>

        <div className="side-account">
          <span className="account-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              accountInitials
            )}
          </span>
          <div>
            <strong>{user.name ?? "Connected Gmail"}</strong>
            <span>{senderEmail}</span>
          </div>
        </div>
      </aside>

      <section className="app-shell">
        <header className="topbar">
          <div className="page-title">
            <p className="eyebrow">{currentMeta.eyebrow}</p>
            <h1>{currentMeta.title}</h1>
          </div>
          <div className="top-actions">
            <a className="connection-pill" href={`${api.authUrl}?reconnect=1`} title="Reconnect Gmail">
              <ShieldCheck size={15} />
              Gmail connected
            </a>
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                run(() => loadApp(), {
                  action: "refresh"
                })
              }
              disabled={activeAction === "refresh"}
            >
              <RefreshCw className={activeAction === "refresh" ? "spin" : ""} size={16} />
              {activeAction === "refresh" ? "Refreshing" : "Refresh"}
            </button>
            <button type="button" className="ghost-button" onClick={logout}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </header>

        <section className="stats-strip">
          {emailStats.map((item) => (
            <div className={`stat ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <item.icon size={18} />
            </div>
          ))}
          <div className="stat accent">
            <span>Active</span>
            <strong>{activeCount}</strong>
            <Check size={18} />
          </div>
        </section>

      {view === "candidates" && (
        <section className="workspace two-column">
          <form className="form-panel" onSubmit={submitCandidate}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Record</p>
                <h2>Add Candidate</h2>
              </div>
              <UserPlus size={18} />
            </div>
            <label>
              Name
              <input
                value={candidateForm.name}
                placeholder="Ava Johnson"
                onChange={(event) =>
                  setCandidateForm((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={candidateForm.email}
                placeholder="ava@company.com"
                onChange={(event) =>
                  setCandidateForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Location
              <input
                value={candidateForm.location}
                placeholder="New York"
                onChange={(event) =>
                  setCandidateForm((current) => ({ ...current, location: event.target.value }))
                }
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={busy}>
                {activeAction === "candidate" ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                {activeAction === "candidate" ? "Adding" : "Add"}
              </button>
            </div>
            <div className="import-panel">
              <div>
                <p className="eyebrow">Bulk</p>
                <h3>Import Candidates</h3>
                <span>CSV columns: name, email, location</span>
              </div>
              <input
                ref={csvInputRef}
                className="hidden-file-input"
                type="file"
                accept=".csv,text/csv"
                onChange={handleCandidateCsvImport}
              />
              <button
                className="ghost-button"
                type="button"
                disabled={busy}
                onClick={() => csvInputRef.current?.click()}
              >
                {activeAction === "import" ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Upload size={16} />
                )}
                {activeAction === "import" ? "Importing" : "Import CSV"}
              </button>
            </div>
          </form>

          <section className="table-panel">
            <div className="panel-toolbar">
              <form className="search-box" onSubmit={handleSearch}>
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search candidates"
                />
              </form>
              <div className="toolbar-actions">
                <label className="sort-control">
                  Sort
                  <select value={candidateSort} onChange={changeCandidateSort} disabled={busy}>
                    <option value="newest">Newest first</option>
                    <option value="initial">Initial send order</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={planToday}
                  disabled={!selectedTemplateId || busy}
                >
                  {activeAction === "plan" ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <CalendarClock size={16} />
                  )}
                  {activeAction === "plan" ? "Planning" : "Plan Today"}
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th>Last contact</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 && (
                    <tr>
                      <td className="empty-row" colSpan={8}>
                        No candidates found
                      </td>
                    </tr>
                  )}
                  {candidates.map((candidate) => {
                    const isEditing = editingCandidateId === candidate.id;
                    const isUpdating = isEditing && activeAction === "updateCandidate";

                    return (
                    <tr className={isEditing ? "editing-row" : undefined} key={candidate.id}>
                      <td>
                        {isEditing ? (
                          <input
                            className="table-input"
                            value={candidateEditForm.name}
                            onChange={(event) =>
                              setCandidateEditForm((current) => ({
                                ...current,
                                name: event.target.value
                              }))
                            }
                            aria-label="Candidate name"
                          />
                        ) : (
                          candidate.name
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="table-input"
                            type="email"
                            value={candidateEditForm.email}
                            onChange={(event) =>
                              setCandidateEditForm((current) => ({
                                ...current,
                                email: event.target.value
                              }))
                            }
                            aria-label="Candidate email"
                          />
                        ) : (
                          candidate.email
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="table-input"
                            value={candidateEditForm.location}
                            onChange={(event) =>
                              setCandidateEditForm((current) => ({
                                ...current,
                                location: event.target.value
                              }))
                            }
                            aria-label="Candidate location"
                          />
                        ) : (
                          candidate.location || "-"
                        )}
                      </td>
                      <td>{formatDate(candidate.created_at)}</td>
                      <td>
                        <span className={`pill ${candidate.status}`}>
                          {statusLabel(candidate.status)}
                        </span>
                      </td>
                      <td>{candidate.open_count ? `${candidate.open_count}x` : "No"}</td>
                      <td>{formatDate(candidate.last_contacted_at)}</td>
                      <td className="actions-cell candidate-actions">
                        {isEditing ? (
                          <>
                            <button
                              className="row-action primary"
                              type="button"
                              disabled={busy}
                              onClick={() => saveCandidateEdit(candidate.id)}
                            >
                              {isUpdating ? (
                                <RefreshCw className="spin" size={14} />
                              ) : (
                                <Save size={14} />
                              )}
                              {isUpdating ? "Updating" : "Update"}
                            </button>
                            <button
                              className="row-action"
                              type="button"
                              disabled={busy}
                              onClick={cancelCandidateEdit}
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <IconButton
                              title="Edit"
                              disabled={busy}
                              onClick={() => startCandidateEdit(candidate)}
                            >
                              <Edit3 size={15} />
                            </IconButton>
                            <IconButton
                              title="Delete"
                              tone="danger"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api.deleteCandidate(candidate.id);
                                  await loadApp();
                                }, {
                                  action: "delete",
                                  loading: "Deleting candidate...",
                                  success: "Candidate deleted"
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span>
                {candidatePagination.total === 0
                  ? "0 candidates"
                  : `${candidateRangeStart}-${candidateRangeEnd} of ${candidatePagination.total}`}
              </span>
              <div className="pagination-controls">
                <label>
                  Rows
                  <select
                    value={candidatePagination.pageSize}
                    onChange={changeCandidatePageSize}
                    disabled={busy}
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-button pagination-icon"
                  type="button"
                  title="Previous page"
                  disabled={busy || candidatePagination.page <= 1}
                  onClick={() => changeCandidatePage(candidatePagination.page - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="page-count">
                  Page {candidatePagination.page} of {candidatePagination.totalPages}
                </span>
                <button
                  className="icon-button pagination-icon"
                  type="button"
                  title="Next page"
                  disabled={busy || candidatePagination.page >= candidatePagination.totalPages}
                  onClick={() => changeCandidatePage(candidatePagination.page + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </section>
        </section>
      )}

      {view === "templates" && (
        <section className="workspace template-workspace">
          <form className="template-editor" onSubmit={submitTemplate}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Primary Message</p>
                <h2>Email Template</h2>
              </div>
              <FileText size={18} />
            </div>
            <div className="template-grid">
              <label>
                Template name
                <input
                  value={templateForm.name}
                  placeholder="Primary outreach"
                  onChange={(event) =>
                    setTemplateForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Subject
                <input
                  value={templateForm.subject}
                  placeholder="Quick question, {{first_name}}"
                  onChange={(event) =>
                    setTemplateForm((current) => ({ ...current, subject: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="template-span">
                First email
                <textarea
                  rows={10}
                  value={templateForm.bodyText}
                  placeholder="Hi {{first_name}},"
                  onChange={(event) =>
                    setTemplateForm((current) => ({ ...current, bodyText: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Follow-up subject
                <input
                  value={templateForm.followupSubject}
                  placeholder="Re: {{first_name}}"
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      followupSubject: event.target.value
                    }))
                  }
                />
              </label>
              <label className="template-span">
                Follow-up email
                <textarea
                  rows={6}
                  value={templateForm.followupBodyText}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      followupBodyText: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <div className="button-row template-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                {activeAction === "template" ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                {activeAction === "template" ? "Saving" : "Save Template"}
              </button>
              <span>Variables: {"{{first_name}}"}, {"{{name}}"}, {"{{location}}"}</span>
            </div>
          </form>
        </section>
      )}

      {view === "queue" && (
        <section className="workspace">
          <section className="table-panel">
            <div className="panel-toolbar">
              <h2>Email Activity</h2>
              <span>{emails.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Template</th>
                    <th>Step</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th>Sent</th>
                    <th>Opened</th>
                    <th className="actions-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.length === 0 && (
                    <tr>
                      <td className="empty-row" colSpan={8}>
                        No email activity yet
                      </td>
                    </tr>
                  )}
                  {emails.map((email) => (
                    <tr key={email.id}>
                      <td>
                        <strong>{email.candidate_name}</strong>
                        <span className="subcell">{email.candidate_email}</span>
                      </td>
                      <td>{email.template_name}</td>
                      <td>{email.sequence_step === 0 ? "Initial" : `Follow-up ${email.sequence_step}`}</td>
                      <td>
                        <span className={`pill ${email.status}`}>{statusLabel(email.status)}</span>
                      </td>
                      <td>{formatDate(email.scheduled_at)}</td>
                      <td>{formatDate(email.sent_at)}</td>
                      <td>{formatDate(email.opened_at)}</td>
                      <td className="actions-cell activity-actions">
                        <IconButton
                          title={email.status === "queued" ? "Cancel send" : "Only scheduled emails can be cancelled"}
                          disabled={email.status !== "queued"}
                          onClick={() =>
                            run(async () => {
                              await api.cancelEmail(email.id);
                              await loadApp();
                            }, {
                              action: "cancel",
                              loading: "Cancelling scheduled email...",
                              success: "Scheduled email cancelled"
                            })
                          }
                        >
                          <Ban size={15} />
                        </IconButton>
                        <IconButton
                          title="Delete activity"
                          tone="danger"
                          disabled={activeAction === "deleteEmail"}
                          onClick={() =>
                            run(async () => {
                              await api.deleteEmail(email.id);
                              await loadApp();
                            }, {
                              action: "deleteEmail",
                              loading: "Deleting activity...",
                              success: "Activity deleted"
                            })
                          }
                        >
                          {activeAction === "deleteEmail" ? (
                            <RefreshCw className="spin" size={15} />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {view === "settings" && (
        <section className="workspace settings-workspace">
          <form className="settings-form" onSubmit={saveSettings}>
            <section className="settings-section settings-panel">
              <div className="section-head settings-header">
                <div>
                  <p className="eyebrow">Controls</p>
                  <h2>Delivery Rules</h2>
                </div>
                <button className="primary-button save-settings" type="submit" disabled={busy}>
                  {activeAction === "settings" ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  {activeAction === "settings" ? "Saving" : "Save Settings"}
                </button>
              </div>

              <div className="settings-layout">
                <div className="settings-block">
                  <div className="settings-block-title">
                    <CalendarClock size={17} />
                    <div>
                      <h3>Sending Window</h3>
                      <p>Daily cap and local working hours.</p>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <label>
                      Emails per day
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={settings.dailyLimit}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            dailyLimit: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Start time
                      <input
                        type="time"
                        value={settings.startTime}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, startTime: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      End time
                      <input
                        type="time"
                        value={settings.endTime}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, endTime: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Timezone ({currentTimezoneOffset})
                      <select
                        value={settings.timezone}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, timezone: event.target.value }))
                        }
                      >
                        {timezoneSelectOptions.map(({ value, label, offset }) => (
                          <option key={value} value={value}>
                            {label} ({offset}) - {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="settings-block">
                  <div className="settings-block-title">
                    <Clock size={17} />
                    <div>
                      <h3>Delivery Guard</h3>
                      <p>Randomized delay between sends.</p>
                    </div>
                  </div>
                  <div className="settings-grid two">
                    <label>
                      Minimum gap, minutes
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={settings.minGapMinutes}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            minGapMinutes: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Maximum gap, minutes
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={settings.maxGapMinutes}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            maxGapMinutes: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-block">
                  <div className="settings-block-title">
                    <RefreshCw size={17} />
                    <div>
                      <h3>Follow-ups</h3>
                      <p>Retry only when the candidate has not opened.</p>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <label>
                      First follow-up, days
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={settings.followupAfterDays}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            followupAfterDays: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Final follow-up, days
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={settings.secondFollowupAfterDays}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            secondFollowupAfterDays: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Maximum follow-ups
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={settings.maxFollowups}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            maxFollowups: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={settings.stopOnOpen}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            stopOnOpen: event.target.checked
                          }))
                        }
                      />
                      Stop after open
                    </label>
                  </div>
                </div>

                <div className="settings-block">
                  <div className="settings-block-title">
                    <Mail size={17} />
                    <div>
                      <h3>Sender Identity</h3>
                      <p>Optional display name for outgoing mail.</p>
                    </div>
                  </div>
                  <div className="settings-grid two">
                    <label>
                      Sender display name
                      <input
                        value={settings.senderName ?? ""}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, senderName: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>
          </form>
        </section>
      )}
      </section>
    </main>
  );
}
