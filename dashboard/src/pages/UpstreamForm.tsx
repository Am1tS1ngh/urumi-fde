import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction } from '../hooks';
import { ErrorText } from '../components';
import type { AuthType, Upstream } from '../types';

/** Adds a new upstream, or edits one when `existing` is given. */
export function UpstreamForm({ existing, onSaved, onCancel }: { existing?: Upstream; onSaved: () => void; onCancel: () => void }) {
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [authType, setAuthType] = useState<AuthType>(existing?.authType ?? 'none');
  const [headerName, setHeaderName] = useState(existing?.authHeaderName ?? '');
  const [credential, setCredential] = useState('');
  const { busy, error, run } = useAction();
  const keepsCredential = existing?.hasCredential && existing.authType !== 'none';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const auth = {
      authType,
      headerName: authType === 'header' ? headerName : null,
      // Leaving the field empty while editing keeps the stored credential.
      ...(credential ? { credential } : {}),
    };
    const saved = await run(() => existing
      ? api(`/upstreams/${existing.id}`, { method: 'PATCH', body: { name, url, ...auth } })
      : api('/upstreams', { method: 'POST', body: { slug, name, url, ...auth } }));
    if (saved) onSaved();
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{existing ? `Edit ${existing.name}` : 'Add a server'}</h2>
      <div className="grid">
        <label>Slug
          <input value={slug} onChange={e => setSlug(e.target.value)} disabled={!!existing} required pattern="[a-z][a-z0-9]{1,19}"
            title="2-20 lowercase letters or digits, starting with a letter" />
          <small>Tools appear as {slug || 'slug'}__tool_name.</small>
        </label>
        <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
        <label className="wide">MCP endpoint URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="http://server:3000/mcp" /></label>
        <label>Authentication
          <select value={authType} onChange={e => setAuthType(e.target.value as AuthType)}>
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </label>
        {authType === 'header' && (
          <label>Header name<input value={headerName} onChange={e => setHeaderName(e.target.value)} required placeholder="X-Api-Key" /></label>
        )}
        {authType !== 'none' && (
          <label>{authType === 'bearer' ? 'Token' : 'Header value'}
            <input type="password" autoComplete="off" value={credential} onChange={e => setCredential(e.target.value)}
              required={!keepsCredential} placeholder={keepsCredential ? 'Leave empty to keep the saved value' : ''} />
          </label>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button disabled={busy}>{existing ? 'Save' : 'Add server'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
