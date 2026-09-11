import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Megaphone,
  Copy,
  Check,
  Loader2,
  Clock,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { createAd } from '../api/posts';
import { payOrder, getOrderPaymentStatus } from '../api/orders';
import { formatPrice } from '../utils/format';
import {
  AD_PAYMENT_WINDOW_MS,
  adPaymentStatusLabel,
  extractAdOrderId,
  formatTimeLeft,
  isAdPaymentFinal,
} from '../utils/adPayment';

type Step = 'form' | 'pay' | 'paid';

type Invoice = {
  orderId: string;
  amount: number;
  depositAddress: string | null;
  clientRef: string | null;
  status: string;
};

export default function CreateAdPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', days: 3 });
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [expired, setExpired] = useState(false);
  const [redirectIn, setRedirectIn] = useState(8);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  /** Создать/переиспользовать счёт по заказу: POST /payments/order/:id/pay. */
  const startPayment = useCallback(
    async (orderId: string, amount: number) => {
      try {
        const pay: any = await payOrder(orderId);
        setInvoice({
          orderId,
          amount,
          depositAddress: pay?.depositAddress ?? null,
          clientRef: pay?.clientRef ?? null,
          status: pay?.status ?? 'PENDING',
        });
        if (pay?.depositAddress) {
          setExpiresAt(Date.now() + AD_PAYMENT_WINDOW_MS);
          setTimeLeft(AD_PAYMENT_WINDOW_MS / 1000);
          setExpired(false);
        }
        setStep('pay');
        return true;
      } catch (err: any) {
        setInvoice({ orderId, amount, depositAddress: null, clientRef: null, status: 'PENDING' });
        setStep('pay');
        setError(
          err?.response?.data?.message ||
            'Не удалось получить платёжный адрес. Попробуйте ещё раз.',
        );
        return false;
      }
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const post = await createAd({
        title: form.title,
        content: form.content,
        days: form.days,
      });
      const orderId = extractAdOrderId(post);
      if (!orderId) {
        // NH5-ad: без orderId оплатить нечем, а без оплаты реклама не включится.
        setError(
          'Заказ создан, но сервер не вернул orderId — оплата недоступна. Напишите в поддержку.',
        );
        return;
      }
      const amount = Number(post?.order?.amount ?? 0);
      const ok = await startPayment(orderId, amount);
      if (ok) toast.success('Счёт создан. Оплатите USDT (BSC).');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Ошибка при создании рекламы');
    } finally {
      setLoading(false);
    }
  };

  const retryPayment = async () => {
    if (!invoice) return;
    setLoading(true);
    setError('');
    const ok = await startPayment(invoice.orderId, invoice.amount);
    if (ok) toast.success('Адрес обновлён');
    setLoading(false);
  };

  // Таймер окна оплаты (15 минут, как в чеккауте товара).
  useEffect(() => {
    if (step !== 'pay' || !expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        setExpired(true);
        if (pollRef.current) clearInterval(pollRef.current);
        toast.error('Время оплаты истекло. Обновите адрес.');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [step, expiresAt]);

  // Поллинг статуса: GET /payments/order/:orderId/status (PENDING → CONFIRMED/SWEPT).
  useEffect(() => {
    if (step !== 'pay' || !invoice?.depositAddress || expired) return;
    if (isAdPaymentFinal(invoice.status)) return;
    const orderId = invoice.orderId;
    const poll = async () => {
      try {
        const st: any = await getOrderPaymentStatus(orderId);
        if (st?.status) {
          setInvoice((prev) => (prev ? { ...prev, status: st.status } : prev));
        }
      } catch {
        /* сеть мигнула — продолжаем поллить */
      }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, invoice?.orderId, invoice?.depositAddress, invoice?.status, expired]);

  // Депозит подтверждён → активация рекламы уже произошла на бэкенде (webhook → хук).
  useEffect(() => {
    if (step !== 'pay' || !invoice || !isAdPaymentFinal(invoice.status)) return;
    if (pollRef.current) clearInterval(pollRef.current);
    setStep('paid');
    toast.success('Оплата подтверждена — реклама активирована');
  }, [step, invoice]);

  // Редирект с экрана успеха.
  useEffect(() => {
    if (step !== 'paid') return;
    const t = setInterval(() => setRedirectIn((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step === 'paid' && redirectIn <= 0) navigate('/my-products');
  }, [step, redirectIn, navigate]);

  const copyAddress = async () => {
    const addr = invoice?.depositAddress;
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      toast.success('Адрес скопирован');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const back = () => navigate(-1);

  return (
    <div className="max-w-xl mx-auto">
      <button
        onClick={back}
        className="flex items-center text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors"
      >
        <ArrowLeft size={16} className="mr-1" /> Назад
      </button>

      <Card>
        <div className="flex items-center gap-3 mb-6">
          <Megaphone className="w-6 h-6 text-[#22c55e]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            {step === 'form' ? 'Рекламный пост' : step === 'pay' ? 'Оплата рекламы' : 'Реклама активирована'}
          </h1>
        </div>

        {step === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Заголовок"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Текст</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-transparent focus:border-[#22c55e] focus:ring-2 focus:ring-[#22c55e]/20 outline-none"
                required
              />
            </div>
            <Input
              label="Дней размещения"
              type="number"
              value={form.days}
              onChange={(e) => setForm({ ...form, days: parseInt(e.target.value) || 1 })}
              min={1}
              required
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex items-start gap-2 text-xs text-[var(--color-muted)]">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#22c55e]" />
              Реклама запускается только после подтверждения оплаты в сети BSC.
            </div>
            <Button type="submit" loading={loading} className="w-full">
              Перейти к оплате
            </Button>
          </form>
        )}

        {step === 'pay' && invoice && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-muted)]">К оплате</span>
              <span className="text-lg font-extrabold text-[#22c55e]">{formatPrice(invoice.amount)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[11px] font-bold px-2.5 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]">
                {isAdPaymentFinal(invoice.status) ? (
                  <CheckCircle2 size={13} className="text-[#22c55e]" />
                ) : (
                  <Loader2 size={13} className="animate-spin text-[#22c55e]" />
                )}
                {adPaymentStatusLabel(invoice.status)}
              </span>
              {expiresAt && !expired && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e]">
                  <Clock size={14} /> {formatTimeLeft(timeLeft)}
                </span>
              )}
            </div>

            {invoice.depositAddress ? (
              <>
                <div className="flex justify-center">
                  <div className="w-full max-w-[220px] bg-white rounded-2xl p-3">
                    <QRCodeSVG value={invoice.depositAddress} className="w-full h-auto" />
                  </div>
                </div>

                <p className="text-sm font-bold text-[var(--color-text)]">Оплатите USDT (BSC) на адрес:</p>
                <div className="relative">
                  <code className="block w-full pl-3 pr-12 py-3 rounded-xl bg-[var(--bg-3)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">
                    {invoice.depositAddress}
                  </code>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[#22c55e] hover:bg-[var(--bg-3)] transition-colors"
                    title="Копировать адрес"
                  >
                    {copied ? <Check size={16} className="text-[#22c55e]" /> : <Copy size={16} />}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <Loader2 size={14} className={`animate-spin text-[#22c55e] ${expired ? 'opacity-0' : ''}`} />
                  {expired
                    ? 'Время оплаты истекло.'
                    : 'Ожидание подтверждения транзакции (BSC)...'}
                </div>
                <p className="text-[11px] text-[var(--color-faint)]">
                  Реклама активируется автоматически после подтверждения сети. Сумма должна совпадать точно.
                </p>
              </>
            ) : (
              <p className="text-sm text-red-400">
                {error || 'Платёжный адрес не получен.'}
              </p>
            )}

            {(expired || !invoice.depositAddress) && (
              <Button type="button" onClick={retryPayment} loading={loading} className="w-full">
                Обновить адрес
              </Button>
            )}
          </div>
        )}

        {step === 'paid' && (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 flex items-center justify-center">
              <CheckCircle2 size={30} className="text-[#22c55e]" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)]">Оплата подтверждена</p>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                Реклама активирована и показывается в ленте.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Link
                to="/my-products"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#22c55e] text-[#0b0e0d] font-semibold text-sm hover:bg-[#16a34a] transition-colors"
              >
                Мои товары <ArrowRight size={16} />
              </Link>
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-[var(--color-border)] text-[var(--color-text)] font-semibold text-sm hover:border-[#22c55e]/40 transition-colors"
              >
                В ленту
              </Link>
            </div>
            <p className="text-[11px] text-[var(--color-faint)]">
              Переход в «Мои товары» через {Math.max(0, redirectIn)} с...
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}