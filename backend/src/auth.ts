import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { query } from "./db.js";

export type SessionUser = {
  id: string;
  email: string;
};

export type AuthedRequest = Request & {
  user: SessionUser;
};

const cookieName = "reach_session";

function cookieOptions(maxAge?: number) {
  const secure = config.frontendUrl.startsWith("https://") || config.isProduction;
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    maxAge,
    path: "/"
  };
}

export function signSession(user: SessionUser) {
  return jwt.sign(user, config.sessionSecret, {
    expiresIn: "14d",
    audience: "reach",
    issuer: "reach-api"
  });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(cookieName, token, cookieOptions(14 * 24 * 60 * 60 * 1000));
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(cookieName, cookieOptions());
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.cookies?.[cookieName] ?? bearer;
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, config.sessionSecret, {
      audience: "reach",
      issuer: "reach-api"
    }) as SessionUser;

    const user = await query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE id = $1",
      [decoded.id]
    );
    return user.rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  (req as AuthedRequest).user = user;
  next();
}

export const oauthCookieOptions = () => ({
  ...cookieOptions(10 * 60 * 1000),
  sameSite: "lax" as const
});

