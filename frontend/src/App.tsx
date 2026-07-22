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
  UserPlus,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
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

const supportedValuesOf = (Intl as typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
}).supportedValuesOf;

const timezones =
  typeof supportedValuesOf === "function"
    ? supportedValuesOf("timeZone")
    : [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Tokyo"
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
    title: "Send Queue"
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
  return status.replace(/_/g, " ");
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
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("candidates");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
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

  const selectedCount = selectedCandidateIds.size;
  const activeCount = stats.candidates.active ?? 0;

  const emailStats = useMemo(
    () => [
      { label: "Queued", value: stats.emails.queued ?? 0, icon: Clock, tone: "queued" },
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
    setTemplates(templateData);
    setEmails(emailData);
    setSettings(settingsData);
    setStats(statsData);
    setSelectedTemplateId((current) => current || templateData[0]?.id || "");
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
      setError(caught instanceof Error ? caught.message : "Could not load session");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) {
        setNotice(success);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
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
    }, editingCandidateId ? "Candidate saved" : "Candidate added");
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
      if (editingTemplateId) {
        await api.updateTemplate(editingTemplateId, payload);
      } else {
        await api.createTemplate(payload);
      }
      setTemplateForm(emptyTemplate);
      setEditingTemplateId(null);
      await loadApp();
    }, editingTemplateId ? "Template saved" : "Template added");
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.saveSettings(settings);
      await loadApp();
    }, "Settings saved");
  }

  async function queueCampaign(useSelection: boolean) {
    await run(async () => {
      const result = await api.queueCampaign({
        templateId: selectedTemplateId,
        candidateIds: useSelection ? Array.from(selectedCandidateIds) : undefined
      });
      await loadApp();
      setView("queue");
      setNotice(`${result.queued} queued, ${result.skipped} skipped`);
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

  function editTemplate(template: Template) {
    setEditingTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      subject: template.subject,
      bodyText: template.body_text,
      followupSubject: template.followup_subject ?? "",
      followupBodyText: template.followup_body_text ?? ""
    });
    setView("templates");
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
    });
  }

  async function logout() {
    await run(async () => {
      await api.logout();
      setUser(null);
      setCandidates([]);
      setTemplates([]);
      setEmails([]);
    });
  }

  if (loading) {
    return (
      <main className="boot">
        <RefreshCw className="spin" size={24} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login-shell">
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
          {error && <p className="error-text">{error}</p>}
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
          ["queue", "Queue", CalendarClock],
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
            <button type="button" className="ghost-button" onClick={() => run(() => loadApp())}>
              <RefreshCw size={16} />
              Refresh
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

        {(notice || error) && (
          <section className={`notice ${error ? "error" : ""}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => (error ? setError("") : setNotice(""))}>
              <X size={16} />
            </button>
          </section>
        )}

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
                <Save size={16} />
                {editingCandidateId ? "Save" : "Add"}
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
                <Send size={16} />
                Queue {selectedCount || ""}
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
                            }, "Candidate deleted")
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
        <section className="workspace two-column">
          <form className="form-panel wide-form" onSubmit={submitTemplate}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Message</p>
                <h2>{editingTemplateId ? "Edit Template" : "New Template"}</h2>
              </div>
              <FileText size={18} />
            </div>
            <label>
              Name
              <input
                value={templateForm.name}
                placeholder="Senior engineer outreach"
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
            <label>
              Body
              <textarea
                rows={9}
                value={templateForm.bodyText}
                placeholder="Hi {{first_name}},"
                onChange={(event) =>
                  setTemplateForm((current) => ({ ...current, bodyText: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Follow-up Subject
              <input
                value={templateForm.followupSubject}
                onChange={(event) =>
                  setTemplateForm((current) => ({
                    ...current,
                    followupSubject: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Follow-up Body
              <textarea
                rows={5}
                value={templateForm.followupBodyText}
                onChange={(event) =>
                  setTemplateForm((current) => ({
                    ...current,
                    followupBodyText: event.target.value
                  }))
                }
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={busy}>
                <Save size={16} />
                {editingTemplateId ? "Save" : "Add"}
              </button>
              {editingTemplateId && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setEditingTemplateId(null);
                    setTemplateForm(emptyTemplate);
                  }}
                >
                  <X size={16} />
                  Clear
                </button>
              )}
            </div>
          </form>

          <section className="list-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Library</p>
                <h2>Templates</h2>
              </div>
              <span className="count-badge">{templates.length}</span>
            </div>
            <div className="template-list">
              {templates.length === 0 && <div className="empty-state">No templates yet</div>}
              {templates.map((template) => (
                <article className="template-row" key={template.id}>
                  <div>
                    <h3>{template.name}</h3>
                    <p>{template.subject}</p>
                  </div>
                  <div className="actions-cell">
                    <IconButton title="Edit" onClick={() => editTemplate(template)}>
                      <Edit3 size={15} />
                    </IconButton>
                    <IconButton
                      title="Delete"
                      tone="danger"
                      onClick={() =>
                        run(async () => {
                          await api.deleteTemplate(template.id);
                          await loadApp();
                        }, "Template deleted")
                      }
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}

      {view === "queue" && (
        <section className="workspace">
          <section className="queue-toolbar">
            <label>
              Template
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
              >
                <option value="">Select template</option>
                {templates.map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => queueCampaign(true)}
              disabled={!selectedTemplateId || selectedCount === 0 || busy}
            >
              <Send size={16} />
              Queue Selected
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => queueCampaign(false)}
              disabled={!selectedTemplateId || busy}
            >
              <Plus size={16} />
              Queue Active
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
                            }, "Queued email cancelled")
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
          <form className="settings-grid" onSubmit={saveSettings}>
            <label>
              Daily Limit
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
              Start
              <input
                type="time"
                value={settings.startTime}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, startTime: event.target.value }))
                }
              />
            </label>
            <label>
              End
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
              <input
                list="timezone-options"
                value={settings.timezone}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, timezone: event.target.value }))
                }
              />
              <datalist id="timezone-options">
                {timezones.map((timezone) => (
                  <option key={timezone} value={timezone} />
                ))}
              </datalist>
            </label>
            <label>
              Min Gap
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
              Max Gap
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
            <label>
              First Follow-up
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
              Final Follow-up
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
              Max Follow-ups
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
            <label>
              Sender Name
              <input
                value={settings.senderName ?? ""}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, senderName: event.target.value }))
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
              Stop on open
            </label>
            <button className="primary-button save-settings" type="submit" disabled={busy}>
              <Save size={16} />
              Save
            </button>
          </form>
        </section>
      )}
      </section>
    </main>
  );
}
