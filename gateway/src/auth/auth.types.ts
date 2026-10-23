import type { Request } from 'express';

export type Role = 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type AuthedRequest = Request & { user?: AuthUser };

export function toAuthUser(row: { id: string; email: string; name: string; role: string }): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role === 'admin' ? 'admin' : 'member' };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
