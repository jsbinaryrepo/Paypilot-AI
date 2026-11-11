import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";

const cookieName = "paypilot_guest";
const lifetimeMs = 30 * 24 * 60 * 60 * 1000;
const guestDomain = "@guest.paypilot.invalid";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function guestSession(db: PrismaClient, secure: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health" || req.path === "/paypal/webhook") return next();
    try {
      const token = req.headers.cookie?.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
        if (session && session.expiresAt > new Date() && session.user.email.endsWith(guestDomain)) {
          res.locals.visitorUserId = session.userId;
          return next();
        }
      }
      const value = randomBytes(32).toString("hex");
      const session = await db.session.create({ data: {
        tokenHash: digest(value), expiresAt: new Date(Date.now() + lifetimeMs),
        user: { create: { email: `guest-${randomUUID()}${guestDomain}` } },
      } });
      res.cookie(cookieName, value, { httpOnly: true, secure, sameSite: "lax", path: "/api", maxAge: lifetimeMs });
      res.locals.visitorUserId = session.userId;
      next();
    } catch (error) { next(error); }
  };
}
