import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, ThumbsUp, ThumbsDown, Headphones, Sparkles, RefreshCw, Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { getProductById } from '../../api/products';
import {
  consultAsk,
  consultCallAdmin,
  consultHistory,
  consultRate,
  type ConsultAnswer,
  type ConsultSource,
} from '../../api/consult';
import { errorStatus, errorMessage } from '../../utils/error';
import {
  AI_BADGE,
  AI_BUBBLE_STYLE,
  MINT,
  SOURCE_LABELS,
  USER_BUBBLE_CLASS,
  formatConsultTime,
} from './consult-ui.utils';

/**
 * Чат с ИИ-консультантом (ЭТАП 4 ТЗ §2).
 *
 * Один компонент на две точки входа:
 *  - страница `/consult` (полноэкранный чат с историей);
 *  - плавающий виджет (`compact`) — та же логика в маленьком окне.
 * Так не появляется «четыре разных чата» (§5.4: виджет один).
 *
 * Контекст товара приходит через `?productId=` — и с карточки товара, и из
 * плавающей кнопки, когда она открыта на `/products/:id`.
 */

interface ConsultChatProps {
  /** Компактный режим — виджет в портале, а не страница. */
  compact?: boolean;
  /** Закрыть виджет (только в compact-режиме). */
  onClose?: () => void;
}

/** Реплика в ленте. `USER` — вопрос юзера, `AI` — ответ консультанта. */
interface ConsultMessage {
  id: string;
  role: 'USER' | 'AI';
  text: string;
  createdAt: string;
  source?: ConsultSource | string;
  knowledgeId?: string | null;
  feedbackId?: string | null;
  askAdmin?: boolean;
  suggestions?: string[];
  logId?: string;
  /** Оценка юзера: null — ещё не оценён. */
  helpful?: boolean | null;
}

const ASK_ERROR_FALLBACK = 'Консультант не ответил, попробуй ещё';

export default function ConsultChat({ compact = false, onClose }: ConsultChatProps) {
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('productId') ?? undefined;

  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [callingAdmin, setCallingAdmin] = useState(false);
  const [input, setInput] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  // ── История при загрузке (§2: GET /consult/history) ──────────────────
  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const h = await consultHistory(1, 50);
      const items = (h.items ?? []).slice().reverse();
      const restored: ConsultMessage[] = [];
      for (const item of items) {
        restored.push({
          id: `${item.id}-q`,
          role: 'USER',
          text: item.question,
          createdAt: item.createdAt,
        });
        restored.push({
          id: `${item.id}-a`,
          role: 'AI',
          text: item.answer,
          createdAt: item.createdAt,
          source: item.source,
          knowledgeId: item.knowledgeId ?? null,
          feedbackId: item.feedbackId ?? null,
          // askAdmin восстанавливаем по источнику: фолбэк = админ уже позван.
          askAdmin: item.source === 'FALLBACK',
          suggestions: [],
          logId: item.id,
          helpful: item.helpful ?? null,
        });
      }
      setMessages(restored);
    } catch (e) {
      console.error('consult history failed', e);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // ── Контекст товара: показываем, о каком товаре спрашивают ───────────
  const [productTitle, setProductTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!productId || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProductById(productId);
        if (!cancelled) setProductTitle(p?.title ?? null);
      } catch {
        if (!cancelled) setProductTitle(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages, sending]);

  // ── Отправка вопроса ─────────────────────────────────────────────────
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;

      const userMsg: ConsultMessage = {
        id: `tmp-${Date.now()}`,
        role: 'USER',
        text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);

      try {
        const res: ConsultAnswer = await consultAsk({
          text,
          ...(productId ? { productId } : {}),
          route: window.location.pathname,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            role: 'AI',
            text: res.answer,
            createdAt: new Date().toISOString(),
            source: res.source,
            knowledgeId: res.knowledgeId ?? null,
            feedbackId: res.feedbackId ?? null,
            askAdmin: res.askAdmin,
            suggestions: res.suggestions ?? [],
            logId: res.logId,
            helpful: null,
          },
        ]);
      } catch (e) {
        // 503 — консультант выключен владельцем (§5.2 ШАГ 0): не пугаем юзера
        // технической ошибкой, а честно предлагаем живого админа.
        const status = errorStatus(e);
        if (status === 503) {
          toast.error('Консультант сейчас выключен — позовите админа');
        } else {
          toast.error(errorMessage(e, ASK_ERROR_FALLBACK));
        }
        // Оптимистичную реплику оставляем: юзер видит свой вопрос и может
        // повторить, не набирая текст заново.
      } finally {
        setSending(false);
      }
    },
    [productId, sending],
  );

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    void sendText(text);
  };

  // ── Оценка ответа 👍/👎 (§2) ─────────────────────────────────────────
  const rate = async (msg: ConsultMessage, helpful: boolean) => {
    if (!msg.logId) {
      toast.error('Оценка недоступна для этой записи');
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, helpful } : m)),
    );
    try {
      await consultRate(msg.logId, helpful);
      toast.success(helpful ? 'Спасибо, учтём' : 'Понял, передам админу');
      // 👎 — явный сигнал «ответ не помог»: сразу предлагаем живого админа.
      if (!helpful) await callAdmin(msg.text);
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, helpful: null } : m)),
      );
      toast.error(errorMessage(e, 'Не удалось сохранить оценку'));
    }
  };

  // ── «Позвать админа» (§2: POST /consult/call-admin) ──────────────────
  const callAdmin = useCallback(
    async (text?: string) => {
      if (callingAdmin) return;
      setCallingAdmin(true);
      try {
        const res = await consultCallAdmin({
          ...(text ? { text } : {}),
          ...(productId ? {} : {}),
        });
        toast.success(
          res.created
            ? 'Админ вернётся с ответом — ответ придёт в уведомления'
            : 'Передал админу в текущий тред',
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            role: 'AI',
            text:
              'Передал ваш вопрос администратору. Он вернётся с ответом — уведомление придёт сюда.',
            createdAt: new Date().toISOString(),
            source: 'FALLBACK',
            askAdmin: true,
            feedbackId: res.feedbackId ?? null,
            suggestions: [],
            helpful: null,
          },
        ]);
        return res.feedbackId;
      } catch (e) {
        toast.error(errorMessage(e, 'Не удалось позвать админа'));
        return null;
      } finally {
        setCallingAdmin(false);
      }
    },
    [callingAdmin],
  );

  if (!isAuthenticated) {
    return (
      <div className={compact ? 'p-4' : 'text-center py-10'}>
        <div className="text-sm text-[var(--color-muted)] mb-2">
          Войди, чтобы спросить консультанта
        </div>
        <Link to="/login" className="text-[#22c55e] text-sm font-bold hover:underline">
          Войти
        </Link>
      </div>
    );
  }

  const hasText = input.trim() !== '';

  return (
    <div className={`flex flex-col ${compact ? 'h-full min-h-0' : 'flex-1 min-h-0 h-full'}`}>
      {/* Шапка: о каком товаре спрашиваем + обновить историю */}
      <div
        className="mb-3 px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-2 shrink-0"
        style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }}
      >
        <div className="min-w-0 flex items-center gap-2">
          <Sparkles size={16} className="text-[#22c55e] shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">ИИ-консультант</div>
            <div className="text-[11px] text-[var(--color-muted)] truncate">
              {productTitle ? `Про товар: ${productTitle}` : 'Отвечу по доставке, оплате, гарантии'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Обновить историю"
            title="Обновить"
            className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:text-[#22c55e] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {compact && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть консультанта"
              className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <span className="text-xl leading-none">×</span>
            </button>
          )}
        </div>
      </div>

      {/* Лента. pb-16 — чтобы последнее сообщение не уходило под плавающую
          кнопку консультанта (она сидит в правом нижнем углу поверх контента). */}
      <div
        className={`space-y-4 overflow-y-auto pt-4 px-1 pb-16 ${compact ? 'flex-1 min-h-0' : 'flex-1 min-h-0'}`}
      >
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-12 w-3/5" />
            <div className="skeleton h-16 w-4/5 ml-auto" />
          </div>
        ) : messages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="text-center py-6"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center bg-[rgba(34,197,94,0.12)] text-[#22c55e]">
              <Sparkles size={22} />
            </div>
            <div className="text-lg font-bold text-white">Спросите — отвечу сразу</div>
            <div className="text-sm text-[var(--color-muted)] mt-2 leading-relaxed">
              Доставка, оплата, гарантия, наличие. Не знаю — позову админа.
            </div>
          </motion.div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => {
              const isUser = m.role === 'USER';
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[88%] min-w-0">
                    <div
                      className={`min-w-0 break-words text-sm leading-relaxed ${
                        isUser
                          ? USER_BUBBLE_CLASS
                          : 'rounded-2xl rounded-bl-md px-4 py-3.5 text-[var(--color-text)]'
                      }`}
                      style={isUser ? undefined : AI_BUBBLE_STYLE}
                    >
                      {!isUser && (
                        <span
                          className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md mb-1"
                          style={{ color: MINT, border: '1px solid rgba(52,211,153,0.35)' }}
                        >
                          {AI_BADGE}
                        </span>
                      )}
                      <div className="whitespace-pre-wrap">{m.text}</div>

                      {!isUser && m.source && (
                        <div className="text-[11px] text-[var(--color-faint)] mt-2">
                          {SOURCE_LABELS[m.source] ?? m.source}
                          {m.createdAt ? ` · ${formatConsultTime(m.createdAt)}` : ''}
                        </div>
                      )}

                      {/* askAdmin: «Админ вернётся с ответом» + ссылка в тред */}
                      {!isUser && m.askAdmin && (
                        <div
                          className="mt-3 rounded-xl p-3"
                          style={{
                            background: 'rgba(34,197,94,0.06)',
                            border: '1px solid rgba(34,197,94,0.25)',
                          }}
                        >
                          <div className="text-[12px] font-bold text-[#22c55e] mb-1">
                            Админ вернётся с ответом
                          </div>
                          {m.feedbackId && (
                            <Link
                              to={`/feedback/${m.feedbackId}`}
                              className="text-[12px] text-[var(--color-muted)] underline hover:text-[#22c55e] transition-colors"
                            >
                              Открыть переписку с админом
                            </Link>
                          )}
                        </div>
                      )}

                      {/* Оценка 👍/👎 */}
                      {!isUser && m.logId && (
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-[11px] text-[var(--color-faint)]">Помогло?</span>
                          <button
                            type="button"
                            onClick={() => void rate(m, true)}
                            disabled={m.helpful !== null}
                            aria-label="Ответ помог"
                            className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 ${
                              m.helpful === true
                                ? 'text-[#22c55e] bg-[rgba(34,197,94,0.12)]'
                                : 'text-[var(--color-muted)] hover:text-[#22c55e]'
                            }`}
                          >
                            <ThumbsUp size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void rate(m, false)}
                            disabled={m.helpful !== null}
                            aria-label="Ответ не помог"
                            className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 ${
                              m.helpful === false
                                ? 'text-red-400 bg-red-400/10'
                                : 'text-[var(--color-muted)] hover:text-red-400'
                            }`}
                          >
                            <ThumbsDown size={15} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Подсказки следующих вопросов */}
                    {!isUser && (m.suggestions?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {m.suggestions!.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void sendText(s)}
                            disabled={sending}
                            className="px-3 min-h-[44px] rounded-full text-[12px] font-semibold bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {sending && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-start"
          >
            <div
              className="rounded-2xl rounded-bl-md px-4 py-3.5"
              style={AI_BUBBLE_STYLE}
            >
              <span className="flex items-center gap-1.5" aria-label="Консультант печатает">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
                  />
                ))}
              </span>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Позвать админа */}
      <div className="mt-3 shrink-0">
        <button
          type="button"
          onClick={() => void callAdmin(input.trim() || undefined)}
          disabled={callingAdmin}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-[#22c55e]/40 text-[#22c55e] text-sm font-bold hover:bg-[#22c55e]/10 transition-colors disabled:opacity-50"
        >
          <Headphones size={15} />
          {callingAdmin ? 'Передаю…' : 'Позвать админа'}
        </button>
      </div>

      {/* Поле ввода + кнопка отправки. */}
      <div className="flex items-center gap-2.5 mt-3 shrink-0 w-full min-w-0">
        <div
          className="flex-1 min-h-[48px] px-4 rounded-xl flex items-center gap-2.5 transition-colors duration-200"
          style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }}
          onFocusCapture={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.6)';
          }}
          onBlurCapture={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,197,94,0.18)';
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Спросите консультанта…"
            aria-label="Вопрос консультанту"
            className="flex-1 min-h-[44px] bg-transparent outline-none text-sm text-white placeholder:text-[var(--color-faint)]"
          />
        </div>

        {hasText && (
          <motion.button
            type="button"
            onClick={handleSend}
            disabled={sending}
            whileTap={{ scale: 0.93 }}
            aria-label="Отправить вопрос"
            className="w-12 h-12 rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            style={{ background: '#22c55e', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
          >
            <Send size={18} className="text-[#0b0e0d]" />
          </motion.button>
        )}
      </div>

      {!compact && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-[var(--color-faint)] shrink-0">
          <Lightbulb size={13} className="shrink-0 mt-0.5" />
          <span>
            Консультант отвечает по базе знаний площадки. Точные цены и наличие — на карточке товара.
          </span>
        </div>
      )}
    </div>
  );
}