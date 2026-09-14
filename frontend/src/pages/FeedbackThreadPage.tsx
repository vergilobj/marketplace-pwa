import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, CheckCircle2, Sparkles, Bot } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { PageSkeleton } from '../components/ui/Skeleton';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useListError } from '../hooks/useListError';
import { errorMessage } from '../utils/error';
import { AI_BADGE, ADMIN_BADGE } from '../components/consult/consult-ui.utils';

/**
 * Тред обращения: юзер ↔ админ ↔ ИИ (ЭТАП 4 ТЗ §4.7).
 *
 * Роут `/feedback/:id` — цель deep-link'а из уведомлений и из блока
 * «Админ вернётся с ответом» на странице консультанта.
 *
 * Пузыри: юзер справа; админ слева с бейджем «Админ»; ИИ слева с бейджем «ИИ».
 * Сообщения `kind=NOTE` (внутренние заметки админа) бэкенд юзеру не отдаёт —
 * фильтровать на клиенте не нужно, но подстраховка оставлена.
 */

type ThreadMessage = {
  id: string;
  authorRole: string;
  authorName?: string | null;
  body: string;
  kind: string;
  createdAt: string;
};

type ThreadFeedback = {
  id: string;
  type: string;
  status: string;
  subject?: string | null;
  message: string;
  createdAt: string;
  productId?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  WAITING_USER: 'Ждём вас',
  WAITING_ADMIN: 'Ждём админа',
  AI_HANDLED: 'Ответил ИИ',
  CLOSED: 'Закрыто',
};

const TYPE_LABELS: Record<string, string> = {
  SUGGESTION: 'Предложение',
  REQUEST: 'Просьба',
  QUESTION: 'Вопрос',
  CONSULTATION: 'Консультация',
  BUG: 'Баг',
  OTHER: 'Другое',
};

const MESSAGE_MAX = 2000;

export default function FeedbackThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<ThreadFeedback | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [input, setInput] = useState('');
  const { error, setError, retryKey, errorProps } = useListError();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await api.get<{ feedback: ThreadFeedback; messages: ThreadMessage[] }>(
        `/feedback/${id}`,
      );
      setFeedback(r.data?.feedback ?? null);
      // Внутренние заметки админа юзеру не адресованы — не показываем даже
      // если бэкенд когда-нибудь начнёт их отдавать.
      setMessages((r.data?.messages ?? []).filter((m) => m.kind !== 'NOTE'));
      setError('');
    } catch (e) {
      setError(errorMessage(e, 'Не удалось открыть обращение'));
    } finally {
      setLoading(false);
    }
  }, [id, setError]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load, retryKey]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !id) return;
    setSending(true);
    try {
      await api.post(`/feedback/${id}/messages`, { body: text });
      setInput('');
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось отправить сообщение'));
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!id || closing) return;
    setClosing(true);
    try {
      await api.post(`/feedback/${id}/close`);
      toast.success('Обращение закрыто');
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось закрыть обращение'));
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <PageSkeleton rows={3} />;

  if (!feedback && error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <ErrorState {...errorProps} />
      </div>
    );
  }

  if (!feedback) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <EmptyState
          icon={<Sparkles size={32} />}
          title="Обращение не найдено"
          description="Возможно, ссылка устарела. Откройте список обращений."
        />
        <div className="text-center mt-4">
          <Link to="/feedback" className="text-[#22c55e] text-sm font-bold hover:underline">
            К обращениям
          </Link>
        </div>
      </div>
    );
  }

  const closed = feedback.status === 'CLOSED';

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-20">
        <button
          type="button"
          onClick={() => navigate('/feedback')}
          className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors mb-4"
        >
          <ArrowLeft size={16} /> Все обращения
        </button>

        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)]">
              {TYPE_LABELS[feedback.type] || feedback.type}
            </span>
            <span
              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                closed ? 'bg-white/[0.04] text-[var(--color-muted)]' : 'bg-[#22c55e]/10 text-[#22c55e]'
              }`}
            >
              {STATUS_LABELS[feedback.status] || feedback.status}
            </span>
            <span className="text-[11px] text-[var(--color-faint)] ml-auto">
              {feedback.createdAt
                ? format(new Date(feedback.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })
                : ''}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
            {feedback.message}
          </p>
          {feedback.productId && (
            <Link
              to={`/products/${feedback.productId}`}
              className="inline-block mt-3 text-[12px] text-[#22c55e] hover:underline"
            >
              Открыть товар, о котором речь
            </Link>
          )}
        </div>

        {/* Лента сообщений */}
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] text-center py-8">
            Пока нет ответов. Напишите — админ увидит.
          </p>
        ) : (
          <div className="space-y-3 mb-5">
            {messages.map((m) => {
              const isUser = m.authorRole === 'USER';
              const isAi = m.authorRole === 'AI' || m.kind === 'AI_ANSWER';
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] min-w-0 break-words text-sm leading-relaxed rounded-2xl px-4 py-3 ${
                      isUser
                        ? 'bg-[#22c55e] text-[#0b0e0d] rounded-br-md font-medium'
                        : 'text-[var(--color-text)] rounded-bl-md'
                    }`}
                    style={
                      isUser
                        ? undefined
                        : { background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }
                    }
                  >
                    {!isUser && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md mb-1"
                        style={
                          isAi
                            ? { color: '#34d399', border: '1px solid rgba(52,211,153,0.35)' }
                            : { color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }
                        }
                      >
                        {isAi ? <Bot size={11} /> : null}
                        {isAi ? AI_BADGE : ADMIN_BADGE}
                        {m.authorName ? ` · ${m.authorName}` : ''}
                      </span>
                    )}
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div
                      className={`text-[11px] mt-1.5 ${
                        isUser ? 'text-[#0b0e0d]/70' : 'text-[var(--color-faint)]'
                      }`}
                    >
                      {m.createdAt
                        ? format(new Date(m.createdAt), 'd MMM, HH:mm', { locale: ru })
                        : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Композер */}
        {closed ? (
          <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              Обращение закрыто. Нужен новый вопрос — создайте обращение.
            </p>
            <Link
              to="/feedback"
              className="inline-block mt-3 text-[#22c55e] text-sm font-bold hover:underline"
            >
              Написать снова
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2.5">
              <textarea
                value={input}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                placeholder="Ваш ответ…"
                aria-label="Сообщение в обращении"
                className="flex-1 min-h-[44px] px-4 py-3 rounded-2xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm leading-relaxed outline-none focus:border-[#22c55e]/50 transition-all resize-none placeholder:text-[var(--color-faint)]"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || !input.trim()}
                aria-label="Отправить сообщение"
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-[#22c55e] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={18} className="text-[#0b0e0d]" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 mt-3">
              <span className="text-[11px] text-[var(--color-faint)]">
                {input.length}/{MESSAGE_MAX}
              </span>
              <button
                type="button"
                onClick={() => void handleClose()}
                disabled={closing}
                className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all disabled:opacity-50"
              >
                <CheckCircle2 size={15} />
                {closing ? 'Закрываю…' : 'Решено'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}