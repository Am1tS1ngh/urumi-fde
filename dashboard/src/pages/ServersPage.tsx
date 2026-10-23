import { useState } from 'react';
import { api } from '../api';
import { useAction, useLoad } from '../hooks';
import { ErrorText, StateBadge, formatTime } from '../components';
import type { Upstream, User } from '../types';
import { UpstreamForm } from './UpstreamForm';

export function ServersPage({ user }: { user: User }) {
  const { data: upstreams, error, reload } = useLoad(() => api<Upstream[]>('/upstreams'), 10_000);
  const [editing, setEditing] = useState<Upstream | 'new' | null>(null);
  const isAdmin = user.role === 'admin';

  const saved = () => {
    setEditing(null);
    void reload();
  };

  return (
    <section>
      <div className="row spread">
        <h1>Servers</h1>
        {isAdmin && !editing && <button onClick={() => setEditing('new')}>Add server</button>}
      </div>
      {editing && (
        <UpstreamForm key={editing === 'new' ? 'new' : editing.id} existing={editing === 'new' ? undefined : editing}
          onSaved={saved} onCancel={() => setEditing(null)} />
      )}
      <ErrorText>{error}</ErrorText>
      {upstreams?.length === 0 && <p>No servers yet.</p>}
      {upstreams?.map(upstream => (
        <UpstreamCard key={upstream.id} upstream={upstream} isAdmin={isAdmin} onEdit={() => setEditing(upstream)} onChanged={reload} />
      ))}
    </section>
  );
}

function UpstreamCard({ upstream, isAdmin, onEdit, onChanged }: { upstream: Upstream; isAdmin: boolean; onEdit: () => void; onChanged: () => void }) {
  const { busy, error, run } = useAction();

  const act = async (action: () => Promise<unknown>) => {
    await run(action);
    onChanged();
  };
  const toggle = () => act(() => api(`/upstreams/${upstream.id}`, { method: 'PATCH', body: { enabled: !upstream.enabled } }));
  const refresh = () => act(() => api(`/upstreams/${upstream.id}/refresh`, { method: 'POST' }));
  const remove = () => {
    if (confirm(`Remove ${upstream.name}? Its tools disappear for everyone.`)) void act(() => api(`/upstreams/${upstream.id}`, { method: 'DELETE' }));
  };

  return (
    <article className="card">
      <div className="row spread">
        <div>
          <h2>{upstream.name} <StateBadge state={upstream.state} /></h2>
          <p className="muted">
            {upstream.slug} · {upstream.url} · auth: {upstream.authType}
            {upstream.latencyMs !== null && ` · ${upstream.latencyMs} ms`} · checked {formatTime(upstream.checkedAt)}
          </p>
        </div>
        {isAdmin && (
          <div className="row">
            <button className="secondary" disabled={busy} onClick={refresh}>Check now</button>
            <button className="secondary" disabled={busy} onClick={onEdit}>Edit</button>
            <button className="secondary" disabled={busy} onClick={toggle}>{upstream.enabled ? 'Disable' : 'Enable'}</button>
            <button className="danger" disabled={busy} onClick={remove}>Remove</button>
          </div>
        )}
      </div>
      <ErrorText>{error ?? upstream.error}</ErrorText>
      {upstream.skippedTools.length > 0 && (
        <p className="muted">Hidden because their names cannot be exposed safely: {upstream.skippedTools.join(', ')}</p>
      )}
      {upstream.tools.length > 0 && (
        <details>
          <summary>{upstream.tools.length} tools</summary>
          <ul className="tools">
            {upstream.tools.map(tool => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                {tool.readOnly === true && <span className="tag">read-only</span>}
                <span className="muted"> {tool.description}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
