import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
  Check,
  X,
  LoaderCircle,
  TriangleAlert,
  MessageSquareQuote,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { formatDate } from '../../utils/format';
import { errorStatus, errorMessage } from '../../utils/error';

/**
 * B4 §12: счётчик символов для поля с `maxLength`.
 *
 * Без него ввод молча обрывается на лимите — админ видит, что «буквы не
 * печатаются», и не понимает почему. Образец — FeedbackPage.
 */
function CharCounter({ value, max }: { value: number; max: number }) {
  const near = value > max - 0.1 * max;
  return (
    <div className="flex justify-end mt-1">
      <span className={`text-[11px] ${near ? 'text-amber-400' : 'text-[var(--color-faint)]'}`}>
        {value}/{max}
      </span>
    </div>
  );
}

/**
 * Вкладка «Ответы» в админке (ЭТАП 4 ТЗ §5, SPEC §4.6 и §6.4).
 *
 * B4 §6: в UI слово «знание» заменено на «ответ» — владелец проекта прямо
 * говорил, что «база знаний» и «кандидаты в знания» ему непонятны. Русские
 * термины: «ответ на вопрос покупателя». Что осталось КАК ЕСТЬ (это контракт,
 * а не текст для юзера): эндпоинты `/admin/knowledge*`, поля
 * `question`/`answer`/`answerShort`/`productId`, значения статусов
 * (DRAFT|ACTIVE|STALE|ARCHIVED|REVIEW), `KnowledgeCandidate` в API.
 * Их переименование сломало бы запросы к бэкенду Этапа 3.
 *
 * ⚠️ Эндпоинты `/admin/knowledge*` пишет ПАРАЛЛЕЛЬНЫЙ builder (Этап 3). Если их
 * ещё нет в поднятом бэкенде, вкладка НЕ падает: любой 404 переводит её в
 * режим «модуль не подключён» с понятным пояснением и кнопкой «Повторить».
 * Ровно поэтому все запросы проходят через `safeGet/safePost`, а не напрямую.
 */

type KnowledgeEntry = {
  id: string;
  question: string;
  answer: string;
  answerShort?: string | null;
  category?: string | null;
  tags?: string[] | null;
  productId?: string | null;
  source: string;
  status: string;
  usageCount?: number;
  helpfulCount?: number;
  notHelpfulCount?: number;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type KnowledgeCandidate = {
  id: string;
  feedbackId: string;
  questionDraft: string;
  answerDraft: string;
  status: string;
  createdAt?: string;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Активно',
  STALE: 'Устарело',
  ARCHIVED: 'В архиве',
  REVIEW: 'На проверке',
};

const STATUS_CLASSES: Record<string, string> = {
  DRAFT: 'bg-white/[0.04] text-[var(--color-muted)]',
  ACTIVE: 'bg-[#22c55e]/10 text-[#22c55e]',
  STALE: 'bg-amber-400/10 text-amber-400',
  ARCHIVED: 'bg-white/[0.04] text-[var(--color-faint)]',
  REVIEW: 'bg-amber-400/10 text-amber-400',
};

const CATEGORIES = ['доставка', 'оплата', 'гарантия', 'товар', 'прочее'];

const STATUS_FILTERS = [
  { key: '', label: 'Все' },
  { key: 'ACTIVE', label: 'Активные' },
  { key: 'REVIEW', label: 'На проверке' },
  { key: 'STALE', label: 'Устаревшие' },
  { key: 'ARCHIVED', label: 'Архив' },
];

/**
 * Лимиты полей формы.
 *
 * Вопрос/ответ совпадают с бэкендом (`KNOWLEDGE_QUESTION_MAX_LENGTH = 500`,
 * `KNOWLEDGE_ANSWER_MAX_LENGTH = 5000` в `dto/knowledge.dto.ts`) — форма не
 * должна пропускать то, что DTO отвергнет.
 *
 * B4 §11: у «короткой версии» стоял `maxLength={5000}` — лимит ПОЛНОГО ответа
 * на однострочном поле: юзер мог вставить туда пять тысяч символов и не
 * заметить, что это не то поле. Короткая версия идёт в чат консультанта, и ей
 * хватает 280 символов (одно-два предложения) — лимит теперь свой.
 */
const QUESTION_MAX = 500;
const ANSWER_MAX = 5000;
const SHORT_MAX = 280;

/** Пустая форма ответа — и для создания, и как база для правки. */
type KnowledgeForm = {
  question: string;
  answer: string;
  answerShort: string;
  category: string;
  tags: string;
  productId: string;
};

const EMPTY_FORM: KnowledgeForm = {
  question: '',
  answer: '',
  answerShort: '',
  category: '',
  tags: '',
  productId: '',
};

/** Полезная нагрузка из формы (пустые поля не отправляем). */
const formToPayload = (f: KnowledgeForm) => {
  const payload: Record<string, unknown> = {
    question: f.question.trim(),
    answer: f.answer.trim(),
  };
  if (f.answerShort.trim()) payload.answerShort = f.answerShort.trim();
  if (f.category.trim()) payload.category = f.category.trim();
  const tags = f.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length) payload.tags = tags;
  if (f.productId.trim()) payload.productId = f.productId.trim();
  return payload;
};

export default function KnowledgeTab() {
  const [items, setItems] = useState<KnowledgeEntry[]>([]);
  const [candidates, setCandidates] = useState<KnowledgeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [query, setQuery] = useState('');

  /** true — модуль базы знаний ещё не поднят на бэкенде (404 на любом роуте). */
  const [moduleMissing, setModuleMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /** Модал создания/правки. `editing` = null → создание. */
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [form, setForm] = useState<KnowledgeForm>(EMPTY_FORM);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Кандидат, который сейчас превращаем в знание. */
  const [candidate, setCandidate] = useState<KnowledgeCandidate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, candRes] = await Promise.all([
        api.get<{ items: KnowledgeEntry[] }>('/admin/knowledge', {
          params: {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(query.trim() ? { q: query.trim() } : {}),
            limit: 50,
          },
        }),
        // Кандидаты — отдельным списком; 404 здесь не должен ронять знания.
        api
          .get<{ items: KnowledgeCandidate[] }>('/admin/knowledge/candidates', {
            params: { status: 'PENDING', limit: 50 },
          })
          .catch(() => ({ data: { items: [] } })),
      ]);
      setItems(listRes.data?.items ?? []);
      setCandidates(candRes.data?.items ?? []);
      setModuleMissing(false);
    } catch (e) {
      if (errorStatus(e) === 404) {
        setModuleMissing(true);
      } else {
        toast.error(errorMessage(e, 'Не удалось загрузить ответы — попробуй ещё раз'));
      }
      setItems([]);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load, reloadKey]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditing(entry);
    setForm({
      question: entry.question,
      answer: entry.answer,
      answerShort: entry.answerShort ?? '',
      category: entry.category ?? '',
      tags: (entry.tags ?? []).join(', '),
      productId: entry.productId ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (form.question.trim().length < 3 || form.answer.trim().length < 3) {
      toast.error('Вопрос и ответ — минимум 3 символа');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/admin/knowledge/${editing.id}`, formToPayload(form));
        toast.success('Ответ обновлён');
      } else {
        await api.post('/admin/knowledge', formToPayload(form));
        toast.success('Ответ добавлен');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      // 409 — дубль (trgm > 0.75): бэкенд отдаёт id существующей записи.
      if (errorStatus(e) === 409) {
        toast.error('Похожий ответ уже есть — открой его и отредактируй');
      } else {
        toast.error(errorMessage(e, 'Не удалось сохранить ответ — попробуй ещё раз'));
      }
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (entry: KnowledgeEntry, status: string) => {
    try {
      await api.post(`/admin/knowledge/${entry.id}/status`, { status });
      setItems((prev) =>
        prev.map((k) => (k.id === entry.id ? { ...k, status } : k)),
      );
      toast.success(
        status === 'ARCHIVED' ? 'Ответ убран в архив' : 'Статус ответа обновлён',
      );
    } catch (e) {
      // Фолбэк на DELETE (мягкое архивирование) — на случай, если роут
      // статуса ещё не поднят, а список уже отдаётся.
      if (status === 'ARCHIVED') {
        try {
          await api.delete(`/admin/knowledge/${entry.id}`);
          setItems((prev) =>
            prev.map((k) => (k.id === entry.id ? { ...k, status: 'ARCHIVED' } : k)),
          );
          toast.success('Ответ убран в архив');
          return;
        } catch {
          /* падаем в общий тост ниже */
        }
      }
      toast.error(errorMessage(e, 'Не удалось изменить статус ответа — попробуй ещё раз'));
    }
  };

  const approveCandidate = async () => {
    if (!candidate) return;
    if (form.question.trim().length < 3 || form.answer.trim().length < 3) {
      toast.error('Вопрос и ответ — минимум 3 символа');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        `/admin/knowledge/from-candidate/${candidate.id}`,
        formToPayload(form),
      );
      toast.success('Ответ сохранён');
      setCandidate(null);
      setForm(EMPTY_FORM);
      setModalOpen(false);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось сохранить ответ — попробуй ещё раз'));
    } finally {
      setSaving(false);
    }
  };

  const rejectCandidate = async (c: KnowledgeCandidate) => {
    try {
      await api.post(`/admin/knowledge/candidates/${c.id}/reject`);
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      toast.success('Черновик отклонён — он больше не появится');
    } catch (e) {
      toast.error(errorMessage(e, 'Не удалось отклонить черновик — попробуй ещё раз'));
    }
  };

  /** Открыть кандидата в модале: админ ОБЯЗАН поправить формулировку (FR-3.2). */
  const openCandidate = (c: KnowledgeCandidate) => {
    setEditing(null);
    setCandidate(c);
    setForm({
      ...EMPTY_FORM,
      question: c.questionDraft,
      answer: c.answerDraft,
    });
    setModalOpen(true);
  };

  if (moduleMissing) {
    return (
      <div className="rounded-2xl bg-[var(--color-surface)] border border-amber-400/30 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-text)]">
              Раздел «Ответы» ещё не подключён на бэкенде
            </p>
            <p className="text-[13px] text-[var(--color-muted)] mt-1 leading-relaxed">
              Экран готов и ждёт эндпоинты <code>/api/admin/knowledge</code> (Этап 3, пишет
              параллельный исполнитель). Как только они появятся — вкладка заработает
              без правок фронта.
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-3 inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text)] hover:border-[#22c55e]/40 transition-all"
            >
              <LoaderCircle size={15} className={loading ? 'animate-spin' : ''} />
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Заголовок + создание */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all"
        >
          <Plus size={15} /> Новый ответ
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <div className="flex-1 flex items-center gap-2 px-3 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)]">
            <Search size={15} className="text-[var(--color-faint)] shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по ответам…"
              aria-label="Поиск по ответам"
              className="flex-1 bg-transparent outline-none text-sm text-[var(--color-text)] placeholder:text-[var(--color-faint)] min-h-[44px]"
            />
          </div>
        </div>
      </div>

      {/* Фильтр по статусу */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key || 'all'}
            type="button"
            onClick={() => setStatusFilter(s.key)}
            className={`px-4 min-h-[44px] rounded-full text-sm font-semibold transition-all ${
              statusFilter === s.key
                ? 'bg-[#22c55e] text-[#0d1512]'
                : 'bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Черновики ответов из переписки (ПУТЬ A) */}
      {candidates.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-2">
            {/* B4 §6/§7: было «Кандидаты из ответов админов (N)» — «кандидат»
                это жаргон, и неясно, кто их создал. */}
            Черновики ответов из переписки ({candidates.length})
          </h3>
          <div className="space-y-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="rounded-2xl bg-[var(--color-surface)] border border-[#22c55e]/25 p-4"
              >
                <div className="flex items-start gap-2 mb-2">
                  <MessageSquareQuote size={15} className="text-[#22c55e] shrink-0 mt-0.5" />
                  <p className="text-[13px] text-[var(--color-muted)]">
                    Вопрос юзера: <span className="text-[var(--color-text)]">{c.questionDraft}</span>
                  </p>
                </div>
                <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
                  {c.answerDraft}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => openCandidate(c)}
                    className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all"
                  >
                    <Check size={15} /> Сохранить ответ
                  </button>
                  <button
                    type="button"
                    onClick={() => void rejectCandidate(c)}
                    className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] transition-all"
                  >
                    <X size={15} /> Не надо
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Список знаний */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-8 text-center">
          <BookOpen size={28} className="text-[var(--color-faint)] mx-auto mb-2" />
          <p className="text-sm text-[var(--color-muted)]">
            {statusFilter ? 'В этом статусе ответов нет' : 'Ответов пока нет — добавь первый'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((k) => (
            <div
              key={k.id}
              className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--color-text)] min-w-0 break-words">
                  {k.question}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      STATUS_CLASSES[k.status] || STATUS_CLASSES.DRAFT
                    }`}
                  >
                    {STATUS_LABELS[k.status] || k.status}
                  </span>
                  {k.category && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--color-muted)]">
                      {k.category}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-[13px] text-[var(--color-muted)] whitespace-pre-wrap break-words">
                {k.answerShort || k.answer}
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-[var(--color-faint)]">
                {/* B4 §7: «использовано»/«полезно» — без объекта и с голыми
                    числами. Теперь видно, что считаем, и есть склонение. */}
                <span>подставлялся в чат: {k.usageCount ?? 0}</span>
                <span>
                  помог: {k.helpfulCount ?? 0} · не помог: {k.notHelpfulCount ?? 0}
                </span>
                {k.productId && <span>товар: {k.productId.slice(0, 8)}</span>}
                {/* B4 §4: единый хелпер дат — админ видит, когда ответ правили. */}
                <span>обновлён: {formatDate(k.updatedAt ?? k.createdAt, 'short')}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => openEdit(k)}
                  className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs font-semibold transition-all"
                >
                  <Pencil size={13} /> Изменить
                </button>
                {k.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    onClick={() => void setStatus(k, 'ARCHIVED')}
                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-[var(--bg-3)] text-[var(--color-muted)] hover:text-red-400 text-xs font-semibold transition-all"
                  >
                    <Archive size={13} /> В архив
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void setStatus(k, 'ACTIVE')}
                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-[#22c55e]/10 text-[#22c55e] text-xs font-semibold transition-all"
                  >
                    <ArchiveRestore size={13} /> Вернуть в работу
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модал создания / правки / приёма черновика */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCandidate(null);
        }}
        title={
          candidate
            ? 'Сохранить ответ'
            : editing
              ? 'Править ответ'
              : 'Новый ответ'
        }
        size="lg"
      >
        {/*
          B4 §10: модал был `<div>`, кнопка — `type="button"`, поэтому Enter в
          полях ничего не делал (админ печатал вопрос, жал Enter и ничего не
          сохранялось). Теперь это `<form>`: Enter отправляет, Esc/«Отмена»
          закрывают. Внутри — те же поля, что были.
        */}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (candidate ? approveCandidate() : handleSave());
          }}
        >
          {candidate && (
            <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
              Сформулируй вопрос так, как его задаст покупатель — по этой формулировке
              консультант будет искать ответ.
            </p>
          )}

          <div>
            <label
              htmlFor="knowledge-question"
              className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
            >
              Вопрос
            </label>
            <input
              id="knowledge-question"
              value={form.question}
              maxLength={QUESTION_MAX}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
              placeholder="Сколько стоит доставка по Ижевску?"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all placeholder:text-[var(--color-faint)]"
            />
            <CharCounter value={form.question.length} max={QUESTION_MAX} />
          </div>

          <div>
            <label
              htmlFor="knowledge-answer"
              className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
            >
              Ответ
            </label>
            <textarea
              id="knowledge-answer"
              value={form.answer}
              maxLength={ANSWER_MAX}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              placeholder="Доставка по Ижевску — 300 ₽, в течение дня."
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm leading-relaxed outline-none focus:border-[#22c55e]/50 transition-all resize-none placeholder:text-[var(--color-faint)]"
            />
            <CharCounter value={form.answer.length} max={ANSWER_MAX} />
          </div>

          <div>
            <label
              htmlFor="knowledge-short"
              className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
            >
              Короткая версия (для чата, необязательно)
            </label>
            {/*
              B4 §11: было `<input maxLength={5000}>` — лимит полного ответа на
              однострочном поле. Короткая версия уходит в чат консультанта, ей
              хватает пары предложений: `<textarea rows={2}>` + свой лимит 280.
            */}
            <textarea
              id="knowledge-short"
              value={form.answerShort}
              maxLength={SHORT_MAX}
              rows={2}
              onChange={(e) => setForm((f) => ({ ...f, answerShort: e.target.value }))}
              placeholder="300 ₽ по городу, от 500 ₽ за город"
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm leading-relaxed outline-none focus:border-[#22c55e]/50 transition-all resize-none placeholder:text-[var(--color-faint)]"
            />
            <CharCounter value={form.answerShort.length} max={SHORT_MAX} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="knowledge-category"
                className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
              >
                Категория
              </label>
              <select
                id="knowledge-category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all"
              >
                <option value="">— не выбрана —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="knowledge-tags"
                className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
              >
                Теги (через запятую)
              </label>
              <input
                id="knowledge-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="доставка, сроки"
                className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all placeholder:text-[var(--color-faint)]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="knowledge-product"
              className="block text-sm font-bold text-[var(--color-text)] mb-1.5"
            >
              ID товара (если ответ про конкретный товар)
            </label>
            <input
              id="knowledge-product"
              value={form.productId}
              maxLength={64}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              placeholder="необязательно"
              className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:border-[#22c55e]/50 transition-all placeholder:text-[var(--color-faint)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setCandidate(null);
              }}
              className="px-5 min-h-[44px] rounded-full bg-[var(--bg-3)] border border-[var(--color-border)] text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] transition-all"
            >
              Отмена
            </button>
            {/* B4 §10: `type="submit"` — кнопка теперь часть формы, Enter в
                любом поле делает то же самое. */}
            <button
              type="submit"
              disabled={saving}
              className="px-5 min-h-[44px] rounded-full bg-[#22c55e] text-[#0d1512] text-sm font-bold hover:bg-[#16a34a] transition-all disabled:opacity-50"
            >
              {saving ? 'Сохраняю…' : candidate ? 'Сохранить ответ' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}