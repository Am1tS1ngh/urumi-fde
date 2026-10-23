import { useEffect, useState } from 'react';
import { api, session } from './api';
import { Link, navigate, usePath } from './router';
import type { User } from './types';
import { LoginPage } from './pages/LoginPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ServersPage } from './pages/ServersPage';
import { KeysPage } from './pages/KeysPage';
import { MembersPage } from './pages/MembersPage';
import { AuditPage } from './pages/AuditPage';
import { ChatPage } from './pages/ChatPage';

const pages = [
  { path: '/', label: 'Servers', adminOnly: false },
  { path: '/chat', label: 'Chat', adminOnly: false },
  { path: '/keys', label: 'API keys', adminOnly: false },
  { path: '/audit', label: 'Audit log', adminOnly: false },
  { path: '/members', label: 'Members', adminOnly: true },
];

export function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => session.get() !== null);

  useEffect(() => {
    const signedOut = () => setUser(null);
    window.addEventListener('session-ended', signedOut);
    if (session.get()) {
      api<User>('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
    }
    return () => window.removeEventListener('session-ended', signedOut);
  }, []);

  const signIn = (token: string, signedIn: User) => {
    session.set(token);
    setUser(signedIn);
    navigate('/');
  };

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    session.clear();
    setUser(null);
  };

  if (path.startsWith('/invite/')) return <AcceptInvitePage token={path.slice('/invite/'.length)} onSignedIn={signIn} />;
  if (checking) return null;
  if (!user) return <LoginPage onSignedIn={signIn} />;

  const visible = pages.filter(page => !page.adminOnly || user.role === 'admin');
  return (
    <div className="layout">
      <header>
        <strong>MCP Gateway</strong>
        <nav>
          {visible.map(page => (
            <Link key={page.path} to={page.path} className={page.path === path ? 'active' : undefined}>{page.label}</Link>
          ))}
        </nav>
        <span className="who">{user.name} · {user.role}</span>
        <button type="button" className="secondary" onClick={signOut}>Sign out</button>
      </header>
      <main>{renderPage(path, user)}</main>
    </div>
  );
}

function renderPage(path: string, user: User) {
  switch (path) {
    case '/chat': return <ChatPage />;
    case '/keys': return <KeysPage />;
    case '/audit': return <AuditPage user={user} />;
    case '/members': return user.role === 'admin' ? <MembersPage currentUser={user} /> : <NotFound />;
    case '/': return <ServersPage user={user} />;
    default: return <NotFound />;
  }
}

function NotFound() {
  return <p>Page not found. <Link to="/">Go to servers</Link>.</p>;
}
