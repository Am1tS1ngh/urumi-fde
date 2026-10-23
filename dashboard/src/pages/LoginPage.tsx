import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { ErrorText } from '../components';
import type { User } from '../types';

export function LoginPage({ onSignedIn }: { onSignedIn: (token: string, user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(() => api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } }));
    if (result) onSignedIn(result.token, result.user);
  };

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Sign in</h1>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <ErrorText>{error}</ErrorText>
      <button disabled={busy}>Sign in</button>
    </form>
  );
}
