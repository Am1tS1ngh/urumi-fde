import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorText, formatTime } from '../components';
import type { AuditEntry, User } from '../types';

export function AuditPage({ user }: { user: User }) {
  const { data: entries, error, reload } = useLoad(() => api<AuditEntry[]>('/audit?limit=200'), 15_000);

  return (
    <section>
      <div className="row spread">
        <h1>Audit log</h1>
        <button className="secondary" onClick={() => void reload()}>Refresh</button>
      </div>
      <p className="muted">{user.role === 'admin' ? 'Every tool call made through the gateway.' : 'Tool calls made with your account.'}</p>
      <ErrorText>{error}</ErrorText>
      {entries?.length === 0 && <p>No tool calls yet.</p>}
      {entries && entries.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Time</th><th>User</th><th>Via</th><th>Server</th><th>Tool</th><th>Result</th><th>Duration</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td>{formatTime(entry.at)}</td>
                  <td>{entry.userEmail}</td>
                  <td>{entry.source === 'chat' ? 'Chat' : 'MCP client'}</td>
                  <td>{entry.upstreamName ?? '—'}</td>
                  <td><code>{entry.toolName}</code></td>
                  <td><span className={`badge badge-${entry.outcome}`}>{entry.outcome}</span></td>
                  <td>{entry.durationMs} ms</td>
                  <td className="detail">{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
