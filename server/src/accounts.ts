import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, Router } from "express";
import express from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const scrypt = promisify(scryptCallback);
const emailSchema = z.email().max(254).transform((value) => value.toLowerCase());
const credentials = z.object({ email: emailSchema, password: z.string().min(12).max(128) }).strict();
const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const verifyMs = 24 * 60 * 60 * 1000;
const cookieName = "paypilot_session";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
const attempts = new Map<string, { count: number; until: number }>();

export class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
async function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(expected, "hex"));
}
function limited(req: Request) {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const entry = attempts.get(key);
  const current = entry && entry.until > now ? entry : { count: 0, until: now + 15 * 60 * 1000 };
  if (++current.count > 20) throw new AccountError(429, "Too many account requests. Try again later.");
  attempts.set(key, current);
  if (attempts.size > 10000) for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
}
function cookie(req: Request) {
  return req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
function setCookie(res: Response, value: string, secure: boolean) {
  res.cookie(cookieName, value, {
    httpOnly: true, secure, sameSite: "lax", path: "/api", maxAge: sessionMs,
  });
}
async function sendVerification(apiKey: string, from: string, origin: string, recipient: string, value: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [recipient], subject: "Verify your PayPilot account",
      text: `Open this link to verify your PayPilot account:\n${origin}/app/#/verify?token=${value}\n\nThis link expires in 24 hours.`,
    }),
  });
  if (!response.ok) throw new AccountError(503, "Verification email could not be sent. Check the sender setup and try again.");
}

export function accountRoutes(db: PrismaClient, options: {
  origin: string; apiKey: string; from: string;
  sendVerification?: typeof sendVerification;
}) {
  const router: Router = express.Router();
  const secure = options.origin.startsWith("https://");
  router.post("/register", async (req, res) => {
    limited(req);
    const { email, password } = credentials.parse(req.body);
    const existing = await db.user.findUnique({ where: { email } });
    if (existing?.verifiedAt) return res.status(202).json({ message: "If this address is available, a verification email will arrive." });
    const value = token();
    const data = { passwordHash: await passwordHash(password), verificationTokenHash: hash(value), verificationExpiresAt: new Date(Date.now() + verifyMs) };
    await db.user.upsert({ where: { email }, create: { email, ...data }, update: data });
    await (options.sendVerification ?? sendVerification)(options.apiKey, options.from, options.origin, email, value);
    res.status(202).json({ message: "Check your email for a verification link." });
  });
  router.post("/verify", async (req, res) => {
    limited(req);
    const { token: value } = tokenSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { verificationTokenHash: hash(value) } });
    if (!user || !user.verificationExpiresAt || user.verificationExpiresAt < new Date())
      throw new AccountError(400, "Verification link is invalid or expired.");
    await db.user.update({ where: { id: user.id }, data: { verifiedAt: new Date(), verificationTokenHash: null, verificationExpiresAt: null } });
    res.json({ verified: true });
  });
  router.post("/login", async (req, res) => {
    limited(req);
    const { email, password } = credentials.parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !await passwordMatches(password, user.passwordHash))
      throw new AccountError(401, "Email or password is incorrect.");
    if (!user.verifiedAt) throw new AccountError(403, "Verify your email before signing in.");
    const value = token();
    await db.session.create({ data: { userId: user.id, tokenHash: hash(value), expiresAt: new Date(Date.now() + sessionMs) } });
    setCookie(res, value, secure);
    res.json({ email: user.email });
  });
  router.post("/logout", async (req, res) => {
    const value = cookie(req);
    if (value && /^[a-f0-9]{64}$/.test(value)) await db.session.deleteMany({ where: { tokenHash: hash(value) } });
    res.clearCookie(cookieName, { path: "/api", secure, sameSite: "lax", httpOnly: true });
    res.json({ signedOut: true });
  });
  router.get("/me", async (req, res) => {
    const user = await sessionUser(db, req);
    if (!user) throw new AccountError(401, "Sign in to continue.");
    res.json({ email: user.email });
  });
  return router;
}

export async function sessionUser(db: PrismaClient, req: Request) {
  const value = cookie(req);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hash(value) }, include: { user: true } });
  return session && session.expiresAt > new Date() && session.user.verifiedAt ? session.user : null;
}
