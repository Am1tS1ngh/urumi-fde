import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction, useLoad } from '../hooks';
import { CopyButton, ErrorText, OneTimeSecret, formatTime } from '../components';
import type { ApiKey, NewKey } from '../types';

const mcpUrl = `${window.location.origin}/mcp`;

export function KeysPage() {
  const { data: keys, error, reload } = useLoad(() => api<ApiKey[]>('/keys'));
  const [name, setName] = useState('');
  const [created, setCreated] = useState<NewKey | null>(null);
  const action = useAction();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const key = await action.run(() => api<NewKey>('/keys', { method: 'POST', body: { name } }));
    if (key) {
      setCreated(key);
      setName('');
      void reload();
    }
  };

  return (
    <section>
      <h1>API keys</h1>
      <div className="card">
        <p>Point any MCP client at this URL and send your key as a bearer token.</p>
        <div className="secret"><code>{mcpUrl}</code><CopyButton text={mcpUrl} /></div>
      </div>

      {created ? (
        <OneTimeSecret label={`Your key "${created.name}".`} value={created.key} onDone={() => setCreated(null)}>
          <p className="muted">Example client config:</p>
          <pre>{clientConfig(created.key)}</pre>
        </OneTimeSecret>
      ) : (
        <form className="card row" onSubmit={create}>
          <input placeholder="Key name, like laptop or claude-desktop" value={name} onChange={e => setName(e.target.value)} required maxLength={60} />
          <button disabled={action.busy}>Create key</button>
        </form>
      )}
      <ErrorText>{action.error ?? error}</ErrorText>
      <KeyTable keys={keys ?? []} onChanged={reload} />
    </section>
  );
}

/** A key list with revoke buttons. Also used by admins on the members page. */
export function KeyTable({ keys, onChanged }: { keys: ApiKey[]; onChanged: () => void }) {
  const { busy, error, run } = useAction();

  const revoke = async (key: ApiKey) => {
    if (!confirm(`Revoke "${key.name}"? Clients using it stop working immediately.`)) return;
    await run(() => api(`/keys/${key.id}`, { method: 'DELETE' }));
    onChanged();
  };

  if (keys.length === 0) return <p className="muted">No keys yet.</p>;
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <table>
        <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>
          {keys.map(key => (
            <tr key={key.id} className={key.revokedAt ? 'revoked' : undefined}>
              <td>{key.name}</td>
              <td><code>{key.prefix}…</code></td>
              <td>{formatTime(key.createdAt)}</td>
              <td>{formatTime(key.lastUsedAt)}</td>
              <td>{key.revokedAt ? 'Revoked' : <button className="danger" disabled={busy} onClick={() => revoke(key)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function clientConfig(key: string): string {
  return JSON.stringify({
    mcpServers: { gateway: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } },
  }, null, 2);
}
