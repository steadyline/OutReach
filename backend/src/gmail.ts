import { google } from "googleapis";
import { config } from "./config.js";
import { decryptSecret } from "./crypto.js";

export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";

export const gmailScopes = [
  "openid",
  "email",
  "profile",
  gmailSendScope
];

export function hasGmailSendScope(scopes: string | string[] | null | undefined) {
  const scopeList = Array.isArray(scopes) ? scopes : scopes?.split(/\s+/) ?? [];
  return scopeList.includes(gmailSendScope);
}

export async function refreshTokenHasGmailSendScope(refreshToken: string) {
  const oauth = createOAuthClient();
  oauth.setCredentials({ refresh_token: refreshToken });

  const accessTokenResponse = await oauth.getAccessToken();
  const accessToken =
    typeof accessTokenResponse === "string" ? accessTokenResponse : accessTokenResponse?.token;

  if (!accessToken) {
    return false;
  }

  const tokenInfo = await oauth.getTokenInfo(accessToken);
  return hasGmailSendScope(tokenInfo.scopes);
}

export function createOAuthClient() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

export type SenderTokens = {
  refresh_token_encrypted: string;
  email: string;
  name: string | null;
};

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeMimeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeBodyBase64(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trim();
}

function formatAddress(name: string | null | undefined, email: string) {
  if (!name) {
    return `<${email}>`;
  }
  const safeName = name.replace(/"/g, "'");
  return `"${encodeMimeHeader(safeName)}" <${email}>`;
}

export type GmailSendInput = {
  sender: SenderTokens;
  toName: string;
  toEmail: string;
  subject: string;
  html: string;
  unsubscribeUrl: string;
  threadId?: string | null;
};

export async function sendGmailMessage(input: GmailSendInput) {
  const oauth = createOAuthClient();
  oauth.setCredentials({
    refresh_token: decryptSecret(input.sender.refresh_token_encrypted)
  });

  const headers = [
    `From: ${formatAddress(input.sender.name, input.sender.email)}`,
    `To: ${formatAddress(input.toName, input.toEmail)}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `List-Unsubscribe: <${input.unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click"
  ];

  const mime = `${headers.join("\r\n")}\r\n\r\n${encodeBodyBase64(input.html)}`;
  const gmail = google.gmail({ version: "v1", auth: oauth });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: base64Url(mime),
      threadId: input.threadId || undefined
    }
  });

  return {
    messageId: response.data.id ?? null,
    threadId: response.data.threadId ?? null
  };
}
