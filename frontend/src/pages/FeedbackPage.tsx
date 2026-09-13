import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { MessageSquare, Send, HelpCircle } from 'lucide-react';
import { PageSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import { useListError } from '../hooks/useListError';
import { errorMessage } from '../utils/error';

/** Лимиты совпадают с DTO на бэкенде (create-feedback.dto.ts). */
const MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;

const PAGE_SIZE = 20;

/**
 * Типы обращений. Ключи — ровно те, что принимает `@IsIn` в
 * `CreateFeedbackDto`; расхождение даст 400 на валидной кнопке.
 */
const TYPES = [
  { key: 'SUGGESTION', label: 'Предложение' },
  { key: 'REQUEST', label: 'Просьба' },
  { key: 'QUESTION', label: 'Вопрос' },
  { key: 'CONSULTATION', label: 'Консультация' },
  { key: 'BUG', label: 'Баг' },
  { key: 'OTHER', label: 'Другое' },
] as const;

type FeedbackTypeKey = (typeof TYPES)[number]['key'];

/** Подписи статусов — как в update-feedback.dto.ts на бэкенде. */
const STATUS_LABELS: Record<string, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  CLOSED: 'Закрыто',
};

const STATUS_CLASSES: Record<string, string> = {
  NEW: 'bg-[#22c55e]/10 text-[#22c55e]',
  IN_PROGRESS: 'bg-amber-400/10 text-amber-400',
  CLOSED: 'bg-white/[0.04] text-[var(--color-muted)]',
};

type FeedbackItem = {
  id: string;
  type: string;
  message: string;
  contact?: string | null;
  status: string;
  adminNote?: string | null;
  createdAt: string;
};

export default function FeedbackPage() {
  const [type, setType] = useState<FeedbackTypeKey>('SUGGESTION');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);

  const [list, setList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const { error, setError, retryKey, errorProps } = useListError();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /** Авто-рост textarea под текст (до max-height, дальше — скролл). */
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [message, autoGrow]);

  useEffect(() => {
    let alive = true;
    api.get('/feedback/my', { params: { page: 1, limit: PAGE_SIZE } })
      .then((r) => {
        if (!alive) return;
        const items: FeedbackItem[] = r.data?.items || [];
        setList(items);
        setPage(1);
        setHasMore(items.length >= PAGE_SIZE);
        setError('');
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, 'Не удалось загрузить обращения'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [retryKey, setError]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await api.get('/feedback/my', {
        params: { page: next, limit: PAGE_SIZE },
      });
      const items: FeedbackItem[] = r.data?.items || [];
      setPage(next);
      setHasMore(items.length >= PAGE_SIZE);
      setList((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...items.filter((f) => !seen.has(f.id))];
      });
    } catch {
      toast.error('Не удалось загрузить ещё');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSubmit = async () => {
    const text = message.trim();
    if (text.length < 3) {
      toast.error('Опишите обращение — минимум 3 символа');
      return;
    }
    if (text.length > MESSAGE_MAX) {
      toast.error(`Слишком длинно: ${text.length}/${MESSAGE_MAX}`);
      return;
    }
    if (sending) return;

    setSending(true);
    try {
      const payload: { type: string; message: string; contact?: string } = {
        type,
        message: text,
      };
      const contactTrimmed = contact.trim();
      if (contactTrimmed) payload.contact = contactTrimmed.slice(0, CONTACT_MAX);

      const r = await api.post('/feedback', payload);
      const created: FeedbackItem | undefined = r.data;
      if (created?.id) setList((prev) => [created, ...prev]);

      setMessage('');
      setContact('');
      setType('SUGGESTION');
      toast.success('Отправлено — админ увидит обращение');
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось отправить'));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <PageSkeleton rows={3} />;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">Обратная связь</h1>
        <p className="text-[var(--color-muted)] text-sm mb-6">
          Предложения, просьбы, вопросы и консультации — всё уходит админу.
        </p>

        {/* ── Форма ───────────────────────────────────────────────────── */}
        <div className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-5 sm:p-6 mb-8">
          <p className="text-sm font-bold text-[var(--color-text)] mb-3">Тема обращения</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setType(t.key)}
                aria-pressed={type === t.key}
                className={`px-4 min-h-[44px] rounded-full text-sm font-semibold transition-all ${
                  type === t.key
                    ? 'bg-[#22c55e] text-[#0d1512]'
                    : 'bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label htmlFor="feedback-message" className="block text-sm font-bold text-[var(--color-text)] mb-1.5">
            Сообщение
          </label>
          <textarea
            id="feedback-message"
            ref={textareaRef}
            value={message}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Расскажите, что неудобно или чего не хватает…"
            className="w-full px-4 py-3 rounded-2xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm leading-relaxed outline-none focus:border-[#22c55e]/50 transition-all resize-none overflow-y-auto placeholder:text-[var(--color-faint)]"
          />
          <div className="flex justify-end mt-1 mb-5">
            <span
              className={`text-[11px] ${
                message.length > MESSAGE_MAX - 100 ? 'text-amber-400' : 'text-[var(--color-faint)]'
              }`}
            >
              {message.length}/{MESSAGE_MAX}
            </span>
          </div>

          <label htmlFor="feedback-contact" className="block text-sm font-bold text-[var(--color-text)] mb-1.5">
            Как с вами связаться
          </label>
          <input
            id="feedback-contact"
            value={contact}
            maxLength={CONTACT_MAX}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Телефон, @username или почта — необязательно"
            className="w-full px-4 py-2.5 rounded-2xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all placeholder:text-[var(--color-faint)] mb-5"
          />

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={sending}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-colors disabled:opacity-60"
          >
            <Send size={15} />
            {sending ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>

        {/* ── Мои обращения ───────────────────────────────────────────── */}
        <h2 className="text-lg font-bold text-[var(--color-text)] mb-3">Мои обращения</h2>

        {list.length === 0 && error ? (
          <ErrorState {...errorProps} />
        ) : list.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            icon={<MessageSquare size={32} />}
            title="Обращений пока нет"
            description="Напишите первым — предложение, вопрос или заявка на консультацию."
          />
        ) : (
          <div className="space-y-3">
            {list.map((f) => {
              const typeLabel = TYPES.find((t) => t.key === f.type)?.label || f.type;
              return (
                <div
                  key={f.id}
                  className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)]">
                      {typeLabel}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                        STATUS_CLASSES[f.status] || STATUS_CLASSES.CLOSED
                      }`}
                    >
                      {STATUS_LABELS[f.status] || f.status}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                    {f.message}
                  </p>

                  <p className="text-[11px] text-[var(--color-faint)] mt-2">
                    {f.createdAt
                      ? format(new Date(f.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })
                      : ''}
                  </p>

                  {f.adminNote && (
                    <div className="mt-3 rounded-xl bg-[#22c55e]/[0.06] border border-[#22c55e]/25 p-3">
                      <p className="text-[11px] font-bold text-[#22c55e] mb-1">Ответ админа</p>
                      <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                        {f.adminNote}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {list.length > 0 && hasMore && (
          <div className="flex justify-center mt-5">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="px-5 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all disabled:opacity-60"
            >
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          </div>
        )}

        <div className="mt-8 flex items-start gap-2 text-[12px] text-[var(--color-faint)]">
          <HelpCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Ответ придёт в «Уведомления». Срочный вопрос по заказу — лучше сразу в чат сделки.
          </span>
        </div>
      </div>
    </div>
  );
}