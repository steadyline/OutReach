import type {
  Candidate,
  CandidatePage,
  EmailLog,
  EmailPage,
  Settings,
  Stats,
  Template,
  User
} from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
}

export const api = {
  authUrl: `${API_URL}/api/auth/google`,
  me: () => request<{ user: User | null }>("/auth/me"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  settings: () => request<Settings>("/settings"),
  saveSettings: (settings: Settings) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  candidates: ({
    search = "",
    page = 1,
    pageSize = 10,
    sort = "newest"
  }: {
    search?: string;
    page?: number;
    pageSize?: number;
    sort?: "newest" | "initial";
  } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort
    });
    if (search) {
      params.set("search", search);
    }
    return request<CandidatePage>(`/candidates?${params.toString()}`);
  },
  createCandidate: (candidate: Pick<Candidate, "name" | "email" | "location">) =>
    request<Candidate>("/candidates", { method: "POST", body: JSON.stringify(candidate) }),
  importCandidates: (
    rows: Array<Pick<Candidate, "name" | "email"> & { location?: string | null }>
  ) =>
    request<{
      received: number;
      imported: number;
      created: number;
      updated: number;
      skipped: number;
      suppressed: number;
    }>("/candidates/import", {
      method: "POST",
      body: JSON.stringify({ rows })
    }),
  updateCandidate: (
    id: string,
    candidate: Partial<Pick<Candidate, "name" | "email" | "location" | "status">>
  ) => request<Candidate>(`/candidates/${id}`, { method: "PATCH", body: JSON.stringify(candidate) }),
  deleteCandidate: (id: string) => request<void>(`/candidates/${id}`, { method: "DELETE" }),
  templates: () => request<Template[]>("/templates"),
  createTemplate: (template: {
    name: string;
    subject: string;
    bodyText: string;
    followupSubject?: string | null;
    followupBodyText?: string | null;
  }) => request<Template>("/templates", { method: "POST", body: JSON.stringify(template) }),
  updateTemplate: (
    id: string,
    template: Partial<{
      name: string;
      subject: string;
      bodyText: string;
      followupSubject: string | null;
      followupBodyText: string | null;
    }>
  ) => request<Template>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(template) }),
  planToday: () =>
    request<{ queued: number; followups: number; initial: number; skipped: number; reason?: string }>(
      "/campaigns/plan-today",
      { method: "POST" }
    ),
  emails: ({
    page = 1,
    pageSize = 10
  }: {
    page?: number;
    pageSize?: number;
  } = {}) =>
    request<EmailPage>(`/emails?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`),
  cancelEmail: (id: string) => request<EmailLog>(`/emails/${id}/cancel`, { method: "POST" }),
  deleteEmail: (id: string) => request<void>(`/emails/${id}`, { method: "DELETE" }),
  stats: () => request<Stats>("/stats")
};
