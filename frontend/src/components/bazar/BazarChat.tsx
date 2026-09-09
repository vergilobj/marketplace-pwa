import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, RotateCcw, Mic, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import {
  bazarWelcome,
  bazarSend,
  bazarHistory,
  bazarReset,
  bazarDealThread,
  bazarDealRelay,
  dealAccept,
  dealCancel,
  DEAL_STATUS_RU,
} from '../../api/bazar';
import type { BazarMessage, BazarDealThread } from '../../api/bazar';
import { getProductById } from '../../api/products';
import { BazarAvatar, BazarDots, BazarRefRow, MINT } from './bazar-ui';
import { bazarStore } from '../../state/bazarStore';
import {
  isSpeechSupported,
  startContinuousDictation,
  startAudioMeter,
} from '../../utils/speech';

interface BazarChatProps {
  compact?: boolean;
}

/**
 * Саундбар — ряд вертикальных полос с градиентом #22c55e → #34d399.
 * Реагирует на реальный уровень громкости (level: 0..1).
 * Каждая полоса имеет свою фазовую вариацию, чтобы играли не синхронно.
 * Плавные пружинные переходы высоты через framer-motion.
 */
function DictationBars({ level }: { level: number }) {
  const bars = useMemo(
    () =>
      Array.from({ length: 160 }, (_, i) => {
        // Фазовая вариация: каждая полоса чуть иначе реагирует на голос.
        const phase = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.35 + 0.6));
        return {
          id: i,
          phase,
          spring: { stiffness: 420, damping: 22, mass: 0.4 },
        };
      }),
    [],
  );

  const height = (phase: number) => Math.max(2, 2 + level * 46 * phase);

  return (
    <div
      className="flex-1 flex items-center justify-between w-full"
      style={{ height: 48, gap: 1 }}
      aria-hidden="true"
    >
      {bars.map((b) => (
        <motion.span
          key={b.id}
          className="rounded-full shrink-0"
          style={{ width: 2, background: 'linear-gradient(to top, #22c55e, #34d399)' }}
          initial={false}
          animate={{ height: height(b.phase) }}
          transition={{ type: 'spring', stiffness: 420, damping: 22, mass: 0.4 }}
        />
      ))}
    </div>
  );
}

const BazarChat = ({ compact = false }: BazarChatProps) => {
  const { isAuthenticated, user } = useAuth();
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('productId');
  const dealId = searchParams.get('dealId');

  // Режим сделки — отдельный тред, не трогаем общий стор Базара.
  const dealMode = !!dealId;

  const [messages, setMessages] = useState<BazarMessage[]>([]);
  const [deal, setDeal] = useState<BazarDealThread['deal'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [acting, setActing] = useState(false);
  const [input, setInput] = useState('');

  // ── Голосовой ввод: черновик распознанного текста и состояние записи ──
  const [draft, setDraft] = useState('');
  const [dictation, setDictation] = useState<'idle' | 'listening' | 'recorded'>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const draftRef = useRef('');
  const stopDictationRef = useRef<(() => void) | null>(null);
  const stopAudioMeterRef = useRef<(() => void) | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Останавливаем распознавание и аудио-метр при размонтировании.
  useEffect(
    () => () => {
      stopDictationRef.current?.();
      stopAudioMeterRef.current?.();
    },
    [],
  );

  // ── Режим сделки: грузим тред GET /bazar/deals/:id ──
  const loadDeal = useCallback(async () => {
    if (!dealId) return false;
    setLoading(true);
    try {
      const data = await bazarDealThread(dealId);
      setDeal(data.deal);
      setMessages(data.thread ?? []);
      return true;
    } catch (e) {
      console.error('deal thread load failed', e);
      setMessages([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  // ── Обычный режим: общий стор Базара ──
  useEffect(() => {
    if (dealMode) return;
    setMessages(bazarStore.getMessages() ?? []);
    setLoading(!bazarStore.isLoaded());
    return bazarStore.subscribe(() => {
      setMessages(bazarStore.getMessages() ?? []);
      setLoading(!bazarStore.isLoaded());
    });
  }, [dealMode]);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      bazarStore.clearMessages();
      return;
    }
    if (bazarStore.isLoaded()) return;
    setLoading(true);
    try {
      const h = await bazarHistory(1, 50);
      if (h.items.length === 0) {
        await bazarWelcome();
        const h2 = await bazarHistory(1, 50);
        bazarStore.setMessages(h2.items);
      } else {
        bazarStore.setMessages(h.items);
      }
    } catch (e) {
      console.error('bazar load failed', e);
      bazarStore.setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (dealMode) {
      loadDeal();
    } else {
      load();
    }
  }, [dealMode, loadDeal, load]);

  // ── productId: предзаполняем инпут «Хочу купить <название>» ──
  useEffect(() => {
    if (dealMode || !productId || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProductById(productId);
        if (!cancelled && p?.title) {
          setInput(`Хочу купить ${p.title}`);
        }
      } catch {
        // товар не найден — оставляем пустой инпут
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealMode, productId, isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  // ── Toast по meta.action.intent ответа Базара ──
  const notifyForAction = (msg: BazarMessage | undefined | null) => {
    if (!msg) return;
    const meta = msg.meta as any;
    const intent = meta?.action?.intent;
    if (!intent || intent === 'none') return;

    switch (intent) {
      case 'create_deal':
        toast.success('Сделка создана');
        break;
      case 'accept_deal':
        toast.success('Сделка принята');
        break;
      case 'cancel_deal':
      case 'reject_deal':
        toast.error('Сделка отменена');
        break;
      case 'relay_message':
      case 'ask_question':
        toast.success('Сообщение передано');
        break;
      case 'counter_offer':
        toast.success('Предложение отправлено');
        break;
      default:
        break;
    }
  };

  // ── Отправка текста: общая логика для инпута и голосового черновика ──
  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setSending(true);

    if (dealMode && dealId) {
      // Оптимистично показываем своё сообщение как USER-реплику.
      const userMsg: BazarMessage = {
        id: `tmp-${Date.now()}`,
        userId: 'me',
        role: 'USER',
        text,
        refs: [],
        meta: {},
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      try {
        const relayResult: any = await bazarDealRelay(dealId, text);
        // Перечитываем тред, чтобы увидеть ретрансляцию другой стороне.
        const data = await bazarDealThread(dealId);
        setDeal(data.deal);
        setMessages(data.thread ?? []);
        if (relayResult?.blocked) {
          toast.error('Заблокировано модерацией');
        } else {
          toast.success('Сообщение передано');
        }
      } catch (e) {
        console.error('deal relay failed', e);
        toast.error('Базар не ответил, попробуй ещё');
      } finally {
        setSending(false);
      }
      return;
    }

    const userMsg: BazarMessage = {
      id: `tmp-${Date.now()}`,
      userId: 'me',
      role: 'USER',
      text,
      refs: [],
      createdAt: new Date().toISOString(),
    };
    bazarStore.appendMessage(userMsg);
    try {
      const answer = await bazarSend(text);
      bazarStore.appendMessage(answer);
      notifyForAction(answer);
      if ((answer?.meta as any)?.blocked) toast.error('Заблокировано модерацией');
    } catch (e) {
      console.error('bazar send failed', e);
      toast.error('Базар не ответил, попробуй ещё');
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    sendText(text);
  };

  // ── Голосовой ввод ──
  const startListening = () => {
    if (!isSpeechSupported()) return;
    setDictation('listening');
    setAudioLevel(0);

    stopDictationRef.current = startContinuousDictation(
      (text) => {
        setDraft((prev) => {
          const next = prev ? `${prev} ${text}` : text;
          draftRef.current = next;
          return next;
        });
      },
      () => {
        setDictation(draftRef.current.trim() ? 'recorded' : 'idle');
      },
      () => {
        setDictation(draftRef.current.trim() ? 'recorded' : 'idle');
      },
    );

    stopAudioMeterRef.current = startAudioMeter((level) => {
      setAudioLevel(level);
    });
  };

  const cancelDictation = () => {
    stopDictationRef.current?.();
    stopAudioMeterRef.current?.();
    stopDictationRef.current = null;
    stopAudioMeterRef.current = null;
    draftRef.current = '';
    setDraft('');
    setAudioLevel(0);
    setDictation('idle');
  };

  const sendDraft = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    stopDictationRef.current?.();
    stopAudioMeterRef.current?.();
    stopDictationRef.current = null;
    stopAudioMeterRef.current = null;
    draftRef.current = '';
    setDraft('');
    setAudioLevel(0);
    setDictation('idle');
    await sendText(text);
  };

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await bazarReset();
      bazarStore.clearMessages();
      await load();
    } catch (e) {
      console.error('bazar reset failed', e);
    } finally {
      setResetting(false);
    }
  };

  // ── Действия по сделке: accept / cancel, затем перечитываем тред ──
  const handleDealAction = async (action: 'accept' | 'cancel') => {
    if (!dealId || acting) return;
    setActing(true);
    const toastId = toast.loading(action === 'accept' ? 'Принимаю сделку…' : 'Отменяю сделку…');
    try {
      if (action === 'accept') {
        await dealAccept(dealId);
        toast.success('Сделка принята', { id: toastId });
      } else {
        await dealCancel(dealId);
        toast.success('Сделка отменена', { id: toastId });
      }
      await loadDeal();
    } catch (e) {
      console.error(`deal ${action} failed`, e);
      toast.error('Не получилось, попробуй ещё', { id: toastId });
    } finally {
      setActing(false);
    }
  };

  // Роль юзера в текущей сделке.
  const userId = user?.id;
  const dealStatus = deal?.status ?? '';
  const userIsBuyer = !!deal && !!userId && deal.buyer?.id === userId;
  const userIsSeller = !!deal && !!userId && deal.seller?.id === userId;
  const actionableStatus =
    dealStatus === 'NEW' || dealStatus === 'CONTACTED' || dealStatus === 'NEGOTIATING';
  const showActionPanel = dealMode && !!deal && !!userId && actionableStatus && (userIsBuyer || userIsSeller);

  if (!isAuthenticated) {
    return (
      <div className={compact ? '' : 'text-center py-8'}>
        <div className={compact ? 'p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-center' : ''}>
          <div className="text-sm text-[var(--color-muted)] mb-2">Войди, чтобы поговорить с Базаром</div>
          <Link to="/login" className="text-[#22c55e] text-sm font-bold hover:underline">Войти</Link>
        </div>
      </div>
    );
  }

  // Бейдж на ретранслированных сообщениях (meta.relay).
  const renderRelayBadge = (m: BazarMessage) => {
    const meta = m.meta as any;
    if (!meta || meta.relay !== true) return null;
    const originRole = meta.originRole;
    if (originRole === 'seller') {
      return <span style={{ color: MINT, border: '1px solid rgba(52,211,153,0.35)' }} className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md mb-1">Продавец</span>;
    }
    if (originRole === 'buyer') {
      return <span style={{ color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }} className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md mb-1">Покупатель</span>;
    }
    return null;
  };

  // Заголовок треда в режиме сделки.
  const dealTitle = deal
    ? deal.product?.title
      ? `${deal.product.title}`
      : 'Сделка'
    : 'Сделка';

  const isRecording = dictation !== 'idle';
  const hasText = input.trim() !== '';

  return (
    <div className={`flex flex-col ${compact ? '' : 'flex-1 min-h-0 h-full'}`}>
      {/* Шапка сделки */}
      {dealMode && !loading && deal && (
        <div
          className="mb-3 px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-2 shrink-0"
          style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }}
        >
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">{dealTitle}</div>
            <div className="text-[11px] text-[var(--color-muted)] truncate">
              {deal.product?.price ? `${deal.product.price} USDT` : ''}
              {deal.status ? ` · ${DEAL_STATUS_RU[deal.status] ?? deal.status}` : ''}
            </div>
          </div>
        </div>
      )}

      {/* Панель действий по статусу сделки */}
      {showActionPanel && (
        <div
          className="mb-3 px-3.5 py-2.5 rounded-xl flex flex-wrap items-center gap-2 shrink-0"
          style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }}
        >
          <span className="text-[11px] font-bold text-[var(--color-muted)]">
            {DEAL_STATUS_RU[dealStatus] ?? dealStatus}
          </span>
          {userIsBuyer && (
            <button
              onClick={() => handleDealAction('accept')}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-opacity disabled:opacity-50 hover:opacity-85"
              style={{ background: '#22c55e', color: '#0b0e0d' }}
            >
              {acting ? '…' : 'Беру'}
            </button>
          )}
          {userIsBuyer && (
            <button
              onClick={() => handleDealAction('cancel')}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-opacity disabled:opacity-50 hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {acting ? '…' : 'Отменить'}
            </button>
          )}
          {userIsSeller && (
            <button
              onClick={() => handleDealAction('cancel')}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-opacity disabled:opacity-50 hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {acting ? '…' : 'Отклонить'}
            </button>
          )}
        </div>
      )}

      {dealMode && messages.length > 0 && !loading && (
        <div className="flex justify-end mb-2 shrink-0">
          <button
            onClick={() => {/* нет reset в режиме сделки */}}
            disabled
            className="hidden"
          >
          </button>
        </div>
      )}

      {!dealMode && messages.length > 0 && !loading && (
        <div className="flex justify-end mb-2 shrink-0">
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
            style={{ color: MINT, border: '1px solid rgba(52,211,153,0.3)' }}
          >
            <RotateCcw size={13} />
            {resetting ? 'Сброс…' : 'Начать сначала'}
          </button>
        </div>
      )}

      <div
        className={`space-y-4 overflow-y-auto ${compact ? '' : 'flex-1 min-h-0'}`}
        style={compact ? { maxHeight: 340 } : undefined}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-6">
            <BazarDots />
            <span className="text-sm text-[var(--color-muted)]">Базар просыпается…</span>
          </div>
        ) : messages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 mx-auto mb-6">
              <BazarAvatar size={64} />
            </div>
            <div className="text-xl font-bold text-white">{dealMode ? 'Пока нет сообщений' : 'Базар на связи'}</div>
            <div className="text-sm text-[var(--color-muted)] mt-2 leading-relaxed">
              {dealMode ? 'Напиши первым — Базар передаст продавцу.' : 'Спроси — найдёт среди 2000+ своих'}
            </div>
          </motion.div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={`flex ${m.role === 'USER' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'ASSISTANT' && (
                  <div className="mr-2.5 mt-1 shrink-0">
                    <BazarAvatar size={32} />
                  </div>
                )}
                <div
                  className={`max-w-[85%] text-sm leading-relaxed ${
                    m.role === 'USER'
                      ? 'bg-[#22c55e] text-[#0b0e0d] rounded-2xl rounded-br-md px-4 py-3 font-medium'
                      : 'rounded-2xl rounded-bl-md px-4 py-3.5 text-[var(--color-text)]'
                  }`}
                  style={
                    m.role === 'USER'
                      ? undefined
                      : {
                          background: '#0d1210',
                          border: '1px solid rgba(34,197,94,0.18)',
                        }
                  }
                >
                  {m.role !== 'USER' && renderRelayBadge(m)}
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <BazarRefRow refs={m.refs ?? []} large={!compact} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {sending && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-start"
          >
            <div className="mr-2.5 mt-1 shrink-0">
              <BazarAvatar size={32} />
            </div>
            <div
              className="rounded-2xl rounded-bl-md px-4 py-3.5"
              style={{
                background: '#0d1210',
                border: '1px solid rgba(34,197,94,0.18)',
              }}
            >
              <BazarDots />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2.5 mt-4 shrink-0">
        <AnimatePresence mode="wait" initial={false}>
          {isRecording ? (
            <motion.div
              key="recording"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex items-center gap-2.5 w-full"
            >
              <motion.button
                onClick={cancelDictation}
                whileTap={{ scale: 0.9 }}
                aria-label="Отменить голосовой ввод"
                title="Отменить"
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-opacity hover:opacity-80"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--color-muted)',
                }}
              >
                <X size={18} />
              </motion.button>

              <div
                className="flex-1 h-12 px-4 rounded-xl flex items-center"
                style={{ background: '#0d1210', border: '1px solid rgba(34,197,94,0.18)' }}
              >
                <DictationBars level={audioLevel} />
              </div>

              <motion.button
                onClick={sendDraft}
                disabled={sending || !draft.trim()}
                whileTap={{ scale: 0.93 }}
                className="w-12 h-12 rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                style={{ background: '#22c55e', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
              >
                <Send size={18} className="text-[#0b0e0d]" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex items-center gap-2.5 w-full"
            >
              <div
                className="flex-1 h-12 px-4 rounded-xl flex items-center gap-2.5 transition-colors duration-200"
                style={{
                  background: '#0d1210',
                  border: '1px solid rgba(34,197,94,0.18)',
                }}
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
                  placeholder={dealMode ? 'Сообщение продавцу…' : 'Спроси Базара…'}
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-[var(--color-faint)]"
                />
              </div>

              {hasText ? (
                <motion.button
                  onClick={handleSend}
                  disabled={sending}
                  whileTap={{ scale: 0.93 }}
                  className="w-12 h-12 rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  style={{ background: '#22c55e', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                >
                  <Send size={18} className="text-[#0b0e0d]" />
                </motion.button>
              ) : isSpeechSupported() ? (
                <motion.button
                  onClick={startListening}
                  whileTap={{ scale: 0.93 }}
                  aria-label="Голосовой ввод"
                  title="Голосовой ввод"
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-opacity hover:opacity-80"
                  style={{
                    background: 'rgba(34,197,94,0.14)',
                    border: '1px solid rgba(52,211,153,0.45)',
                    color: '#34d399',
                  }}
                >
                  <Mic size={18} />
                </motion.button>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default BazarChat;