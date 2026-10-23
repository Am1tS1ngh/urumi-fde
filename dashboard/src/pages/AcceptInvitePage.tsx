import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { ErrorText } from '../components';
import type { User } from '../types';

export function AcceptInvitePage({ token, onSignedIn }: { token: string; onSignedIn: (token: string, user: User) => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(() => api<{ token: string; user: User }>('/auth/accept-invite', { method: 'POST', body: { token, name, password } }));
    if (result) onSignedIn(result.token, result.user);
  };

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Join the team</h1>
      <p>Choose your name and a password to finish setting up your account.</p>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
      <label>Password<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} /></label>
      <ErrorText>{error}</ErrorText>
      <button disabled={busy}>Create account</button>
    </form>
  );
}
