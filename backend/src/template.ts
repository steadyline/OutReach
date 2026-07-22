type CandidateForTemplate = {
  name: string;
  email: string;
  location: string | null;
};

type RenderExtras = {
  unsubscribeUrl: string;
  trackingPixelUrl: string;
  senderName?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function renderVariables(
  source: string,
  candidate: CandidateForTemplate,
  extras: RenderExtras
) {
  const values: Record<string, string> = {
    name: candidate.name,
    first_name: firstName(candidate.name),
    email: candidate.email,
    location: candidate.location ?? "",
    unsubscribe_url: extras.unsubscribeUrl,
    sender_name: extras.senderName ?? ""
  };

  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return values[key] ?? "";
  });
}

export function textToHtml(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const withBreaks = escapeHtml(paragraph).replace(/\n/g, "<br>");
      return `<p>${withBreaks}</p>`;
    });
  return paragraphs.join("\n");
}

export function addTrackingAndFooter(html: string, extras: RenderExtras) {
  const footer = `
    <div style="margin-top:24px;color:#64748b;font-size:12px;line-height:1.5">
      <a href="${escapeHtml(extras.unsubscribeUrl)}" style="color:#475569">Unsubscribe</a>
    </div>
    <img src="${escapeHtml(
      extras.trackingPixelUrl
    )}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" />
  `;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.55">${html}${footer}</body></html>`;
}

