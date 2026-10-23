import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction, useLoad } from '../hooks';
import { ErrorText, OneTimeSecret, formatTime } from '../components';
import type { ApiKey, Invite, Member, NewKey, Role, User } from '../types';
import { KeyTable } from './KeysPage';

export function MembersPage({ currentUser }: { currentUser: User }) {
  const members = useLoad(() => api<Member[]>('/members'));
  const invites = useLoad(() => api<Invite[]>('/members/invites'));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const action = useAction();

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const created = await action.run(() => api<Invite>('/members/invites', { method: 'POST', body: { email, role } }));
    if (created?.inviteUrl) {
      setInviteUrl(created.inviteUrl);
      setEmail('');
      void invites.reload();
    }
  };

  return (
    <section>
      <h1>Members</h1>
      {inviteUrl ? (
        <OneTimeSecret label="Invite link created." value={inviteUrl} onDone={() => setInviteUrl(null)}>
          <p className="muted">Send it to the person you invited. It works once and expires in 7 days.</p>
        </OneTimeSecret>
      ) : (
        <form className="card row" onSubmit={invite}>
          <input type="email" placeholder="Email to invite" value={email} onChange={e => setEmail(e.target.value)} required />
          <select value={role} onChange={e => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button disabled={action.busy}>Invite</button>
        </form>
      )}
      <ErrorText>{action.error ?? members.error ?? invites.error}</ErrorText>

      {invites.data && invites.data.length > 0 && (
        <>
          <h2>Pending invites</h2>
          <ul>
            {invites.data.map(item => <li key={item.id}>{item.email} ({item.role}), expires {formatTime(item.expiresAt)}</li>)}
          </ul>
        </>
      )}

      <h2>People</h2>
      {members.data?.map(member => (
        <MemberRow key={member.id} member={member} isSelf={member.id === currentUser.id} onChanged={members.reload} />
      ))}
    </section>
  );
}

function MemberRow({ member, isSelf, onChanged }: { member: Member; isSelf: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<NewKey | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const { busy, error, run } = useAction();

  const update = async (patch: { role?: Role; status?: Member['status'] }) => {
    await run(() => api(`/members/${member.id}`, { method: 'PATCH', body: patch }));
    onChanged();
  };

  const issueKey = async () => {
    const name = prompt(`Name for the key you are issuing to ${member.name}:`, 'issued by admin');
    if (!name) return;
    const key = await run(() => api<NewKey>(`/members/${member.id}/keys`, { method: 'POST', body: { name } }));
    if (key) {
      setIssued(key);
      setOpen(true);
      setKeysVersion(version => version + 1);
      onChanged();
    }
  };

  return (
    <article className={`card ${member.status === 'disabled' ? 'revoked' : ''}`}>
      <div className="row spread">
        <div>
          <strong>{member.name}</strong> <span className="muted">{member.email}</span>
          <p className="muted">{member.role} · {member.status} · {member.activeKeys} active keys</p>
        </div>
        {!isSelf && (
          <div className="row">
            <select value={member.role} disabled={busy} onChange={e => update({ role: e.target.value as Role })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="secondary" disabled={busy} onClick={() => update({ status: member.status === 'active' ? 'disabled' : 'active' })}>
              {member.status === 'active' ? 'Disable' : 'Enable'}
            </button>
            {member.status === 'active' && <button className="secondary" disabled={busy} onClick={issueKey}>Issue key</button>}
          </div>
        )}
        <button className="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide keys' : 'Show keys'}</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {issued && <OneTimeSecret label={`Key for ${member.name}.`} value={issued.key} onDone={() => setIssued(null)} />}
      {open && <MemberKeys key={keysVersion} memberId={member.id} onChanged={onChanged} />}
    </article>
  );
}

function MemberKeys({ memberId, onChanged }: { memberId: string; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api<ApiKey[]>(`/members/${memberId}/keys`));
  const changed = () => {
    void reload();
    onChanged();
  };
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <KeyTable keys={data ?? []} onChanged={changed} />
    </>
  );
}
