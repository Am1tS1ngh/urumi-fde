import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction, useLoad } from '../hooks';
import { ErrorText } from '../components';
import type { ChatMessage, ToolTrace } from '../types';

interface ChatInfo {
  configured: boolean;
  model: string | null;
  tools: { name: string; upstreamName: string }[];
}

export function ChatPage() {
  const { data: info } = useLoad(() => api<ChatInfo>('/chat/tools'));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const { busy, error, run } = useAction();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setDraft('');
    const response = await run(() => api<{ reply: string; toolCalls: ToolTrace[] }>('/chat', {
      method: 'POST',
      body: { messages: history.map(({ role, content }) => ({ role, content })) },
    }));
    if (response) setMessages([...history, { role: 'assistant', content: response.reply, toolCalls: response.toolCalls }]);
  };

  return (
    <section className="chat">
      <div className="row spread">
        <h1>Chat</h1>
        <button className="secondary" onClick={() => setMessages([])} disabled={busy || messages.length === 0}>New chat</button>
      </div>
      {info && (
        <p className="muted">
          {info.configured ? `Model ${info.model}` : 'Chat is not configured on the gateway.'} · {info.tools.length} tools available,
          called as you through the gateway.
        </p>
      )}
      <div className="messages">
        {messages.length === 0 && <p className="muted">Try: "Create a product called Blue Mug priced at 499" or "What is order 42 worth in USD?"</p>}
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            {message.toolCalls && message.toolCalls.length > 0 && <ToolTraceList calls={message.toolCalls} />}
            <p>{message.content}</p>
          </div>
        ))}
        {busy && <p className="muted">Working…</p>}
        <div ref={bottom} />
      </div>
      <ErrorText>{error}</ErrorText>
      <form className="row" onSubmit={send}>
        <input className="grow" placeholder="Ask about your store, orders or anything the tools can do" value={draft}
          onChange={e => setDraft(e.target.value)} disabled={busy || info?.configured === false} maxLength={8000} />
        <button disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}

function ToolTraceList({ calls }: { calls: ToolTrace[] }) {
  return (
    <div className="trace">
      {calls.map((call, index) => (
        <details key={index}>
          <summary>
            <span className={`badge badge-${call.ok ? 'success' : 'error'}`}>{call.ok ? 'ok' : 'failed'}</span>
            <code>{call.tool}</code> <span className="muted">{call.durationMs} ms</span>
          </summary>
          <p className="muted">Arguments</p>
          <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          <p className="muted">Result</p>
          <pre>{call.preview}</pre>
        </details>
      ))}
    </div>
  );
}
