export type Role = 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type AuthType = 'none' | 'bearer' | 'header';
export type UpstreamState = 'connected' | 'unreachable' | 'disabled' | 'checking';

export interface Upstream {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string | null;
  hasCredential: boolean;
  enabled: boolean;
  state: UpstreamState;
  error: string | null;
  checkedAt: string | null;
  latencyMs: number | null;
  skippedTools: string[];
  tools: { name: string; description: string; readOnly: boolean | null }[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface NewKey {
  id: string;
  name: string;
  prefix: string;
  key: string;
}

export interface Member extends User {
  status: 'active' | 'disabled';
  createdAt: string;
  activeKeys: number;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  inviteUrl?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userId: string | null;
  userEmail: string;
  source: 'mcp' | 'chat';
  upstreamName: string | null;
  toolName: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'denied';
  detail: string | null;
}

export interface ToolTrace {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  preview: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolTrace[];
}
