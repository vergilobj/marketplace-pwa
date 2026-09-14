import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Loader2, MessageSquare, Save, Send, X, Bot, StickyNote } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { errorMessage } from '../../utils/error';
import { formatPhone } from '../../utils/phone';
import { AI_BADGE, ADMIN_BADGE } from '../../components/consult/consult-ui.utils';

/**
 * Двухпанельный тред обращений для админки (ЭТАП 4 ТЗ §5, SPEC §4.6).
 *
 * Слева — список тредов с фильтрами, справа — переписка с ответом админа,
 * внутренней заметкой и сменой статуса.
 *
 * Плашка «Сохранить как знание?» (§6.1 ПУТЬ A): после ответа админа бэкенд
 * создаёт `KnowledgeCandidate` и возвращает его вместе с сообщением. В UI под
 * этим ответом появляется плашка с кнопками «Сохранить» / «Изменить» /
 * «Не надо» — админ ОБЯЗАН поправить формулировку вопроса (FR-3.2).
 *
 * Если бэкенд Этапа 3 ещё не поднят, `knowledgeCandidate` в ответе нет и
 * плашка просто не показывается — ничего не падает.
 */

export type AdminFeedbackListItem = {
  id: string;
  type: string;
  message: string;
  status: string;
  subject?: string | null;
  contact?: string | null;
  createdAt: string;
  lastMessageAt?: string | null;
  unreadForAdmin?: number;
  lastPreview?: string | null;
  hasAiAnswer?: boolean;
  user?: { id: string; name?: string | null; phone?: string | null; role?: string } | null;
  assignedAdmin?: { id: string; name?: string | null } | null;
};

type ThreadMessage = {
  id: string;
  authorRole: string;
  authorName?: string | null;
  body: string;
  kind: string;
  createdAt: string;
};

type KnowledgeCandidate = {
  id: string;
  status: string;
  questionDraft: string;
  answerDraft: string;
};

const TYPE_LABELS: Record<string, string> = {
  SUGGESTION: 'Предложение',
  REQUEST: 'Просьба',
  QUESTION: 'Вопрос',
  CONSULTATION: 'Консультация',
  BUG: 'Баг',
  OTHER: 'Другое',
};

export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  WAITING_USER: 'Ждём юзера',
  WAITING_ADMIN: 'Ждёт админа',
  AI_HANDLED: 'Ответил ИИ',
  CLOSED: 'Закрыто',
};

const STATUS_CLASSES: Record<string, string> = {
  NEW: 'bg-[#22c55e]/10 text-[#22c55e]',
  IN_PROGRESS: 'bg-amber-400/10 text-amber-400',
  WAITING_ADMIN: 'bg-amber-400/10 text-amber-400',
  WAITING_USER: 'bg-[#22c55e]/10 text-[#22c55e]',
  AI_HANDLED: 'bg-[#34d399]/10 text-[#34d399]',
  CLOSED: 'bg-white/[0.04] text-[var(--color-muted)]',
};

const FILTERS = [
  { key: '', label: 'Все' },
  { key: 'WAITING_ADMIN', label: 'Ждёт админа' },
  { key: 'NEW', label: 'Новые' },
  { key: 'CLOSED', label: 'Закрытые' },
];

const STATUS_OPTIONS = ['NEW', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_ADMIN', 'AI_HANDLED', 'CLOSED'];

interface Props {
  items: AdminFeedbackListItem[];
  /** Открыть тред: id активного треда (подсветка в списке). */
  activeId?: string | null;
  onSelect: (id: string) => void;
  /** Смена статуса из панели (использует общий handleUpdateFeedback в AdminPage). */
  onChangeStatus: (id: string, status: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

export default function AdminFeedbackPanel({
  items,
  activeId,
  onSelect,
  onChangeStatus,
  onRefresh,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Смена статуса треда: держим панель занятой, пока идёт запрос, и
   * перечитываем список — статус в левой колонке приходит с сервера.
   */
  const changeStatus = async (id: string, status: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onChangeStatus(id, status);
    } finally {
      setBusy(false);
    }
  };

  /** Кандидаты в знания по id сообщения админа — для плашки под ответом. */
  const [candidates, setCandidates] = useState<Record<string, KnowledgeCandidate>>({});
  /** Плашки, от которых админ отказался локально (без перезагрузки). */
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  /** Кандидат, открытый на редактирование в инлайновой форме. */
  const [editing, setEditing] = useState<KnowledgeCandidate | null>(null);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  const active = items.find((i) => i.id === activeId) ?? null;

  const loadThread = useCallback(async () => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get<{
        feedback: unknown;
        messages: ThreadMessage[];
        knowledgeCandidate?: KnowledgeCandidate | null;
      }>(`/admin/feedback/${activeId}`);
      setMessages(r.data?.messages ?? []);
      // Кандидаты, пришедшие вместе с тредом (если бэкенд так умеет).
      const found: Record<string, KnowledgeCandidate> = {};
      if (r.data?.knowledgeCandidate) {
        found[r.data.knowledgeCandidate.id] = r.data.knowledgeCandidate;
      }
      setCandidates(found);
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось открыть тред'));
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (alive) await loadThread();
    })();
    return () => {
      alive = false;
    };
  }, [loadThread]);

  const send = async (kind: 'TEXT' | 'NOTE') => {
    const body = reply.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const r = await api.post<{
        message: ThreadMessage;
        knowledgeCandidate?: KnowledgeCandidate | null;
      }>(`/admin/feedback/${activeId}/messages`, { body, kind });

      const created = r.data?.message;
      if (created) setMessages((prev) => [...prev, created]);
      // ПУТЬ A: бэкенд вернул кандидата — показываем плашку под ответом.
      const cand = r.data?.knowledgeCandidate;
      if (cand && created) {
        setCandidates((prev) => ({ ...prev, [created.id]: cand }));
      }
      setReply('');
      setNoteMode(false);
      toast.success(kind === 'NOTE' ? 'Заметка сохранена' : 'Ответ отправлен');
      await onRefresh();
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось отправить'));
    } finally {
      setSending(false);
    }
  };

  const approve = async (cand: KnowledgeCandidate, question: string, answer: string) => {
    setSavingKnowledge(true);
    try {
      await api.post(`/admin/knowledge/from-candidate/${cand.id}`, {
        question: question.trim(),
        answer: answer.trim(),
      });
      setCandidates((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key].id === cand.id) delete next[key];
        }
        return next;
      });
      setEditing(null);
      toast.success('Сохранено в базу знаний');
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось сохранить знание'));
    } finally {
      setSavingKnowledge(false);
    }
  };

  const reject = async (cand: KnowledgeCandidate, messageId: string) => {
    setDismissed((prev) => ({ ...prev, [messageId]: true }));
    try {
      await api.post(`/admin/knowledge/candidates/${cand.id}/reject`);
      toast.success('Не сохраняем');
    } catch {
      // Кандидат остаётся на сервере, но плашку не возвращаем — админ уже решил.
      toast.error('Не удалось отметить отказ — попробуйте позже');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4">
      {/* ── Левая панель: список тредов ─────────────────────────────── */}
      <div className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] py-8 text-center">
            Обращений нет
          </p>
        ) : (
          items.map((f) => {
            const isActive = f.id === activeId;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelect(f.id)}
                className={`w-full text-left rounded-2xl p-3.5 border transition-colors min-h-[44px] ${
                  isActive
                    ? 'bg-[#22c55e]/10 border-[#22c55e]/45'
                    : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[#22c55e]/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[13px] font-semibold text-[var(--color-text)] truncate">
                    {f.user?.name || 'Без имени'}
                  </span>
                  {!!f.unreadForAdmin && f.unreadForAdmin > 0 && (
                    <span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" aria-label="Непрочитанное" />
                  )}
                </div>
                <div className="text-[12px] text-[var(--color-muted)] truncate">
                  {f.subject || f.lastPreview || f.message}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)]">
                    {TYPE_LABELS[f.type] || f.type}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      STATUS_CLASSES[f.status] || STATUS_CLASSES.CLOSED
                    }`}
                  >
                    {FEEDBACK_STATUS_LABELS[f.status] || f.status}
                  </span>
                  {f.hasAiAnswer && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md text-[#34d399] border border-[rgba(52,211,153,0.35)]">
                      {AI_BADGE}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Правая панель: тред ─────────────────────────────────────── */}
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4 min-h-[320px] flex flex-col">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
            <MessageSquare size={28} className="text-[var(--color-faint)] mb-2" />
            <p className="text-sm text-[var(--color-muted)]">
              Выберите обращение слева
            </p>
          </div>
        ) : (
          <>
            {/* Шапка треда */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[var(--color-border)]">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--color-text)] truncate">
                  {active.user?.name || 'Без имени'}
                </p>
                <p className="text-[12px] text-[var(--color-muted)] truncate">
                  {active.user?.phone ? formatPhone(active.user.phone) : '—'}
                  {active.contact ? ` · связь: ${active.contact}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={active.status}
                  onChange={(e) => void changeStatus(active.id, e.target.value)}
                  aria-label="Статус обращения"
                  className="min-h-[44px] px-3 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[13px] text-[var(--color-text)] outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {FEEDBACK_STATUS_LABELS[s] || s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void changeStatus(active.id, 'CLOSED')}
                  disabled={busy || active.status === 'CLOSED'}
                  className="px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all disabled:opacity-40"
                >
                  Закрыть
                </button>
              </div>
            </div>

            {/* Лента сообщений */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={20} className="animate-spin text-[#22c55e]" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)] py-8 text-center">
                  Сообщений нет
                </p>
              ) : (
                messages.map((m) => {
                  const isUser = m.authorRole === 'USER';
                  const isAi = m.authorRole === 'AI' || m.kind === 'AI_ANSWER';
                  const isNote = m.kind === 'NOTE';
                  const cand = candidates[m.id];
                  const showPlate = !!cand && !dismissed[m.id];
                  return (
                    <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[85%] min-w-0">
                        <div
                          className={`text-sm leading-relaxed rounded-2xl px-4 py-3 break-words ${
                            isUser
                              ? 'bg-[#22c55e] text-[#0b0e0d] rounded-br-md font-medium'
                              : 'text-[var(--color-text)] rounded-bl-md'
                          }`}
                          style={
                            isUser
                              ? undefined
                              : isNote
                                ? {
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px dashed rgba(255,255,255,0.18)',
                                  }
                                : {
                                    background: '#0d1210',
                                    border: '1px solid rgba(34,197,94,0.18)',
                                  }
                          }
                        >
                          {!isUser && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md mb-1"
                              style={
                                isNote
                                  ? { color: 'var(--color-muted)', border: '1px solid rgba(255,255,255,0.2)' }
                                  : isAi
                                    ? { color: '#34d399', border: '1px solid rgba(52,211,153,0.35)' }
                                    : { color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }
                              }
                            >
                              {isNote ? <StickyNote size={11} /> : isAi ? <Bot size={11} /> : null}
                              {isNote ? 'Заметка' : isAi ? AI_BADGE : ADMIN_BADGE}
                              {m.authorName && !isAi ? ` · ${m.authorName}` : ''}
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

                        {/* Плашка «Сохранить как знание?» (ПУТЬ A) */}
                        {showPlate && (
                          <div
                            className="mt-2 rounded-xl p-3"
                            style={{
                              background: 'rgba(34,197,94,0.06)',
                              border: '1px solid rgba(34,197,94,0.28)',
                            }}
                          >
                            <p className="text-[12px] font-bold text-[#22c55e] mb-2">
                              Сохранить как знание?
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void approve(cand, cand.questionDraft, cand.answerDraft)
                                }
                                disabled={savingKnowledge}
                                className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-[#22c55e] text-[#0d1512] text-xs font-bold hover:bg-[#16a34a] transition-all disabled:opacity-50"
                              >
                                <Save size={13} /> Сохранить
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(cand);
                                  setDraftQuestion(cand.questionDraft);
                                  setDraftAnswer(cand.answerDraft);
                                }}
                                className="px-3 min-h-[44px] rounded-lg bg-[var(--bg-3)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all"
                              >
                                Изменить
                              </button>
                              <button
                                type="button"
                                onClick={() => void reject(cand, m.id)}
                                className="px-3 min-h-[44px] rounded-lg text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                              >
                                Не надо
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Инлайновая форма правки кандидата (FR-3.2: админ правит вопрос) */}
            {editing && (
              <div className="mt-3 rounded-xl p-3 border border-[#22c55e]/30 bg-[#0d1210]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-bold text-[#22c55e]">Формулировка знания</p>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    aria-label="Отменить правку"
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  >
                    <X size={16} />
                  </button>
                </div>
                <label htmlFor="cand-q" className="block text-[11px] text-[var(--color-muted)] mb-1">
                  Вопрос (как его задаст покупатель)
                </label>
                <input
                  id="cand-q"
                  value={draftQuestion}
                  onChange={(e) => setDraftQuestion(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg bg-[var(--bg-3)] border border-[var(--color-border)] text-sm text-[var(--color-text)] outline-none focus:border-[#22c55e]/50 mb-2"
                />
                <label htmlFor="cand-a" className="block text-[11px] text-[var(--color-muted)] mb-1">
                  Ответ
                </label>
                <textarea
                  id="cand-a"
                  value={draftAnswer}
                  rows={3}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-3)] border border-[var(--color-border)] text-sm text-[var(--color-text)] outline-none focus:border-[#22c55e]/50 resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => void approve(editing, draftQuestion, draftAnswer)}
                    disabled={savingKnowledge}
                    className="inline-flex items-center gap-1.5 px-4 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-xs font-bold hover:bg-[#16a34a] transition-all disabled:opacity-50"
                  >
                    <Save size={13} /> Сохранить как знание
                  </button>
                </div>
              </div>
            )}

            {/* Композер */}
            <div className="mt-3 shrink-0">
              <textarea
                value={reply}
                rows={2}
                maxLength={2000}
                onChange={(e) => setReply(e.target.value)}
                placeholder={noteMode ? 'Внутренняя заметка (юзеру не видна)…' : 'Ответ юзеру…'}
                aria-label={noteMode ? 'Внутренняя заметка' : 'Ответ юзеру'}
                className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-sm text-[var(--color-text)] outline-none focus:border-[#22c55e]/50 transition-all resize-none placeholder:text-[var(--color-faint)]"
              />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void send('TEXT')}
                  disabled={sending || !reply.trim()}
                  className="inline-flex items-center gap-1.5 px-4 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-[13px] font-bold hover:bg-[#16a34a] transition-all disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Ответить
                </button>
                <button
                  type="button"
                  onClick={() => setNoteMode((v) => !v)}
                  aria-pressed={noteMode}
                  className={`px-4 min-h-[44px] rounded-full text-[13px] font-semibold transition-all ${
                    noteMode
                      ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40'
                      : 'bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  Внутренняя заметка
                </button>
                {noteMode && (
                  <button
                    type="button"
                    onClick={() => void send('NOTE')}
                    disabled={sending || !reply.trim()}
                    className="px-4 min-h-[44px] rounded-full bg-amber-400/15 border border-amber-400/40 text-amber-400 text-[13px] font-bold transition-all disabled:opacity-50"
                  >
                    Сохранить заметку
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { FILTERS as FEEDBACK_FILTERS };