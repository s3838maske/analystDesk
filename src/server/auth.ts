// Pilot login: email + password, server-side sessions in the database, httpOnly cookie.
// Role-based access per ADM-03. SSO and MFA (NFR-07) are planned before wider rollout.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "./db";

export type Role = "ANALYST" | "REVIEWER" | "ADMIN" | "COMPLIANCE";
export const ROLES: Role[] = ["ANALYST", "REVIEWER", "ADMIN", "COMPLIANCE"];
export const ROLE_LABEL: Record<Role, string> = {
  ANALYST: "Analyst",
  REVIEWER: "Senior reviewer",
  ADMIN: "Team admin",
  COMPLIANCE: "Compliance viewer",
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const COOKIE = "ad_sid";
const SESSION_HOURS = 12;

export async function getUser(): Promise<SessionUser | null> {
  const sid = (await cookies()).get(COOKIE)?.value;
  if (!sid) return null;
  const s = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  return { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role as Role };
}

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) throw new Error("You do not have access to this action.");
  return u;
}

export async function login(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return null;
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;
  const id = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id, userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) } });
  (await cookies()).set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600 });
  return { id: user.id, name: user.name, email: user.email, role: user.role as Role };
}

export async function logout() {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  if (sid) await prisma.session.deleteMany({ where: { id: sid } });
  jar.delete(COOKIE);
}

export function hashPassword(p: string) {
  return bcrypt.hash(p, 10);
}
