import {
  Activity,
  CalendarClock,
  Check,
  Clock,
  Edit3,
  Eye,
  FileText,
  Inbox,
  LogOut,
  Mail,
  Plus,
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

type TemplateForm = {
  name: string;
  subject: string;
  bodyText: string;
  followupSubject: string;
  followupBodyText: string;
};

type ActionKey =
  | "candidate"
  | "import"
  | "template"
  | "settings"
  | "schedule"
  | "refresh"
  | "delete"
  | "logout"
  | "cancel"
  | "search";

const emptyCandidate: CandidateForm = { name: "", email: "", location: "" };
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
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [settings, setSettings] = useState<Settings>(fallbackSettings);
  const [stats, setStats] = useState<Stats>({ emails: {}, candidates: {} });

  const [search, setSearch] = useState("");
  const [candidateForm, setCandidateForm] = useState<CandidateForm>(emptyCandidate);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());

  const [templateForm, setTemplateForm] = useState<TemplateForm>(emptyTemplate);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  const busy = activeAction !== null;
  const selectedCount = selectedCandidateIds.size;
  const activeCount = stats.candidates.active ?? 0;
  const timezoneSelectOptions = useMemo(() => {
    const options = [...timezoneOptions];
    const currentTimezone = settings.timezone;
    if (currentTimezone && !options.some(([value]) => value === currentTimezone)) {
      options.unshift([currentTimezone, currentTimezone]);
    }
    return options;
  }, [settings.timezone]);

  const emailStats = useMemo(
    () => [
      { label: "Scheduled", value: stats.emails.queued ?? 0, icon: Clock, tone: "queued" },
      { label: "Sent", value: stats.emails.sent ?? 0, icon: Send, tone: "sent" },
      { label: "Opened", value: stats.emails.opened ?? 0, icon: Eye, tone: "opened" },
      { label: "Failed", value: stats.emails.failed ?? 0, icon: X, tone: "failed" }
    ],
    [stats]
  );

  async function loadApp(searchValue = search) {
    const [candidateData, templateData, emailData, settingsData, statsData] = await Promise.all([
      api.candidates(searchValue),
      api.templates(),
      api.emails(),
      api.settings(),
      api.stats()
    ]);
    setCandidates(candidateData);
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
      if (editingCandidateId) {
        await api.updateCandidate(editingCandidateId, {
          name: candidateForm.name,
          email: candidateForm.email,
          location: candidateForm.location || null
        });
      } else {
        await api.createCandidate({
          name: candidateForm.name,
          email: candidateForm.email,
          location: candidateForm.location || null
        });
      }
      setCandidateForm(emptyCandidate);
      setEditingCandidateId(null);
      await loadApp();
    }, {
      action: "candidate",
      loading: editingCandidateId ? "Saving candidate..." : "Adding candidate...",
      success: editingCandidateId ? "Candidate saved" : "Candidate added"
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
      await loadApp();
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

  async function queueCampaign(useSelection: boolean) {
    if (!selectedTemplateId) {
      toast.error("Create the primary template before scheduling emails");
      return;
    }

    await run(async () => {
      const result = await api.queueCampaign({
        templateId: selectedTemplateId,
        candidateIds: useSelection ? Array.from(selectedCandidateIds) : undefined
      });
      await loadApp();
      setView("queue");
      return result;
    }, {
      action: "schedule",
      loading: useSelection ? "Scheduling selected candidates..." : "Scheduling active candidates...",
      success: (result) => `${result.queued} scheduled, ${result.skipped} skipped`
    });
  }

  function editCandidate(candidate: Candidate) {
    setEditingCandidateId(candidate.id);
    setCandidateForm({
      name: candidate.name,
      email: candidate.email,
      location: candidate.location ?? ""
    });
    setView("candidates");
  }

  function toggleCandidate(id: string) {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await loadApp(search);
    }, {
      action: "search"
    });
  }

  async function logout() {
    await run(async () => {
      await api.logout();
      setUser(null);
      setCandidates([]);
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
            <div className="brand-mark">
              <Mail size={26} />
            </div>
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
  const currentMeta = viewMeta[view];

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
          <span className="brand-icon">
            <Mail size={22} />
          </span>
          <div>
            <strong>Reach</strong>
            <span>Outreach Console</span>
          </div>
        </div>

      <nav className="tabs" aria-label="Workspace">
        {[
          ["candidates", "Candidates", Users],
          ["templates", "Templates", FileText],
          ["queue", "Outbox", CalendarClock],
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
          <span className="account-avatar">{senderEmail.slice(0, 1).toUpperCase()}</span>
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
            <span className="connection-pill">
              <ShieldCheck size={15} />
              Gmail connected
            </span>
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
                <h2>{editingCandidateId ? "Edit Candidate" : "Add Candidate"}</h2>
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
                {activeAction === "candidate"
                  ? editingCandidateId
                    ? "Saving"
                    : "Adding"
                  : editingCandidateId
                    ? "Save"
                    : "Add"}
              </button>
              {editingCandidateId && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setEditingCandidateId(null);
                    setCandidateForm(emptyCandidate);
                  }}
                >
                  <X size={16} />
                  Clear
                </button>
              )}
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
              <button
                type="button"
                className="ghost-button"
                onClick={() => queueCampaign(true)}
                disabled={!selectedTemplateId || selectedCount === 0 || busy}
              >
                {activeAction === "schedule" ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                {activeAction === "schedule" ? "Scheduling" : `Schedule ${selectedCount || ""}`}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Select"></th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th>Last contact</th>
                    <th aria-label="Actions"></th>
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
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedCandidateIds.has(candidate.id)}
                          onChange={() => toggleCandidate(candidate.id)}
                          disabled={candidate.status !== "active"}
                        />
                      </td>
                      <td>{candidate.name}</td>
                      <td>{candidate.email}</td>
                      <td>{candidate.location || "-"}</td>
                      <td>
                        <span className={`pill ${candidate.status}`}>
                          {statusLabel(candidate.status)}
                        </span>
                      </td>
                      <td>{candidate.open_count ? `${candidate.open_count}x` : "No"}</td>
                      <td>{formatDate(candidate.last_contacted_at)}</td>
                      <td className="actions-cell">
                        <IconButton title="Edit" onClick={() => editCandidate(candidate)}>
                          <Edit3 size={15} />
                        </IconButton>
                        <IconButton
                          title="Delete"
                          tone="danger"
                          onClick={() =>
                            run(async () => {
                              await api.deleteCandidate(candidate.id);
                              setSelectedCandidateIds((current) => {
                                const next = new Set(current);
                                next.delete(candidate.id);
                                return next;
                              });
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <section className="queue-toolbar">
            <div className="queue-template-summary">
              <span>Template</span>
              <strong>{templateForm.name || "Primary template not created"}</strong>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => queueCampaign(true)}
              disabled={!selectedTemplateId || selectedCount === 0 || busy}
            >
              {activeAction === "schedule" ? (
                <RefreshCw className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              {activeAction === "schedule" ? "Scheduling" : "Schedule Selected"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => queueCampaign(false)}
              disabled={!selectedTemplateId || busy}
            >
              {activeAction === "schedule" ? (
                <RefreshCw className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {activeAction === "schedule" ? "Scheduling" : "Schedule Active"}
            </button>
          </section>

          <section className="table-panel">
            <div className="panel-toolbar">
              <h2>Email Activity</h2>
              <span>{selectedCount} selected</span>
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
                    <th aria-label="Actions"></th>
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
                      <td className="actions-cell">
                        <IconButton
                          title="Cancel"
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
                          <X size={15} />
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
        <section className="workspace">
          <form className="settings-form" onSubmit={saveSettings}>
            <section className="settings-section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Schedule</p>
                  <h2>Sending Window</h2>
                </div>
                <CalendarClock size={18} />
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
                  Timezone
                  <select
                    value={settings.timezone}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, timezone: event.target.value }))
                    }
                  >
                    {timezoneSelectOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label} - {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Pace</p>
                  <h2>Delivery Guard</h2>
                </div>
                <Clock size={18} />
              </div>
              <div className="settings-grid">
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
            </section>

            <section className="settings-section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Follow-ups</p>
                  <h2>Sequence Rules</h2>
                </div>
                <RefreshCw size={18} />
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
                      setSettings((current) => ({ ...current, stopOnOpen: event.target.checked }))
                    }
                  />
                  Stop after open
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Sender</p>
                  <h2>Identity</h2>
                </div>
                <Mail size={18} />
              </div>
              <div className="settings-grid">
                <label>
                  Sender display name
                  <input
                    value={settings.senderName ?? ""}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, senderName: event.target.value }))
                    }
                  />
                </label>
                <button className="primary-button save-settings" type="submit" disabled={busy}>
                  <Save size={16} />
                  Save Settings
                </button>
              </div>
            </section>
          </form>
        </section>
      )}
      </section>
    </main>
  );
}
