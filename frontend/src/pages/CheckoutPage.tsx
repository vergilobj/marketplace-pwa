import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, ShieldCheck, ArrowLeft, Copy, Check, Loader2, ArrowRight, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createOrder, getOrderPaymentStatus } from '../api/orders';
import api from '../api/axios';
import { QRCodeSVG } from 'qrcode.react';
import { formatPrice } from '../utils/format';
import toast from 'react-hot-toast';
import { errorMessage } from '../utils/error';
import type { ApiOrder } from '../api/types';

type Payment = { depositAddress?: string | null; clientRef?: string | null; status?: string | null; };

type Invoice = {
  orderId: string | null;
  productId: string;
  title: string;
  quantity: number;
  amount: number;
  depositAddress: string | null;
  clientRef: string | null;
  status: string;
};

/**
 * A3: ОДНА общая оплата на всю корзину.
 *
 * Раньше чекаут создавал N заказов и показывал N QR-адресов — платить надо
 * было по каждому отдельно. Теперь при наличии бэкенд-эндпоинта
 * `POST /payments/cart/pay` фронт показывает ОДИН QR и ОДНУ сумму на всю
 * корзину; заказы распределяются на бэкенде.
 *
 * Бэкенд-контракт (описан в отчёте, реализуется отдельно):
 *   POST /payments/cart/pay  { orderIds: string[] }
 *     → { depositAddress, clientRef, amount, status }
 *   - создаёт ОДИН платёж (paymod sidecar, client_ref = mp-cart-<hash>) на
 *     общую сумму корзины и НЕ заводит персональных платежей на заказы;
 *   - webhook распределяет входящий депозит по заказам: каждый переходит в
 *     PAID + escrow HELD, остаток/недоплата считаются на уровне корзины.
 *
 * Пока эндпоинта нет — чекаут не ломается, а деградирует к прежней
 * поштучной оплате (N адресов). Это осознанный fallback: фронт не может
 * «нарисовать» один адрес на всю корзину без серверной сверки суммы —
 * депозит ушёл бы на адрес одного заказа, а webhook зачёл бы его как
 * переплату по этому заказу и не закрыл остальные.
 */
type CartPayment = {
  depositAddress: string;
  clientRef: string | null;
  amount: number;
  status: string;
};

const PAYMENT_WINDOW_MS = 15 * 60 * 1000;
const FINAL_STATUSES = ['CONFIRMED', 'SWEPT'];

/**
 * Дедлайн окна оплаты. Живёт на уровне модуля, а не в теле компонента:
 * react-hooks/purity запрещает вызов impure-функций (Date.now) в области
 * рендера, и обёртка в модульный хелпер — единственный способ оставить
 * вычисление времени в обработчике события без disable-комментария.
 */
const paymentDeadline = () => Date.now() + PAYMENT_WINDOW_MS;

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидание оплаты',
  CONFIRMED: 'Оплачено',
  SWEPT: 'Зачислено',
  FAILED: 'Ошибка',
};

const isFinal = (s?: string) => !!s && FINAL_STATUSES.includes(s);

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, clearCart } = useApp();
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [cartPayment, setCartPayment] = useState<CartPayment | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const invoicesRef = useRef<Invoice[]>([]);
  const successRef = useRef(false);
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  useEffect(() => { invoicesRef.current = invoices; }, [invoices]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Таймер 15 минут на оплату
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        // счёт истёк — сбрасываем, возвращаем кнопку
        setInvoices([]);
        setCartPayment(null);
        setExpiresAt(null);
        toast.error('Время оплаты истекло. Создайте новый счёт.');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const hasCartPayment = !!cartPayment;
  // A3: при общей оплате адрес один на всю корзину, поэтому «платёжеспособность»
  // позиции определяется не персональным адресом, а привязкой к заказу.
  const payable = hasCartPayment
    ? invoices.filter((i) => !!i.orderId)
    : invoices.filter((i) => !!i.depositAddress);
  const paidCount = payable.filter((i) => isFinal(i.status)).length;
  const allPaid = payable.length > 0 && payable.every((i) => isFinal(i.status));

  // Поллинг статуса ВСЕХ заказов корзины
  useEffect(() => {
    if (payable.length === 0 || allPaid) return;
    const poll = async () => {
      const targets = invoicesRef.current.filter(
        (i) => i.orderId && (i.depositAddress || hasCartPayment),
      );
      if (targets.length === 0) return;
      const results = await Promise.all(
        targets.map(async (inv) => {
          try {
            const st = await getOrderPaymentStatus(inv.orderId as string);
            return { orderId: inv.orderId, status: st?.status as string };
          } catch {
            return null; // продолжаем поллить
          }
        }),
      );
      setInvoices((prev) =>
        prev.map((inv) => {
          const r = results.find((x) => x && x.orderId === inv.orderId);
          return r?.status ? { ...inv, status: r.status } : inv;
        }),
      );
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [payable.length, allPaid, hasCartPayment]);

  // Все позиции оплачены → закрываем корзину
  useEffect(() => {
    if (!allPaid || successRef.current) return;
    successRef.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
    toast.success('Все позиции оплачены!');
    clearCart();
    navigate('/orders');
  }, [allPaid, clearCart, navigate]);

  /**
   * A3: запрос ОДНОЙ общей оплаты на корзину.
   * null — эндпоинт недоступен/не отдал адрес → деградируем к поштучной оплате.
   */
  const requestCartPayment = async (
    orderIds: string[],
  ): Promise<CartPayment | null> => {
    try {
      const res = await api.post<{
        depositAddress?: string | null;
        clientRef?: string | null;
        amount?: number | null;
        status?: string | null;
      }>('/payments/cart/pay', { orderIds });

      const depositAddress = res.data?.depositAddress;
      if (!depositAddress) return null;

      return {
        depositAddress,
        clientRef: res.data.clientRef ?? null,
        amount: res.data.amount ?? total,
        status: res.data.status || 'PENDING',
      };
    } catch {
      // 404/405 (эндпоинт ещё не реализован) или любая иная ошибка —
      // не роняем чекаут: заказы уже созданы, показываем поштучную оплату.
      return null;
    }
  };

  const handleOrder = async () => {
    setLoading(true);
    successRef.current = false;
    setCartPayment(null);
    const created: Invoice[] = [];
    const failed: string[] = [];
    for (const item of cart) {
      try {
        const res: ApiOrder = await createOrder(item.productId, item.price * item.quantity);
        const pay: Payment = res?.payment || {};
        created.push({
          orderId: res?.id ?? null,
          productId: item.productId,
          title: item.title,
          quantity: item.quantity,
          amount: item.price * item.quantity,
          depositAddress: pay.depositAddress || null,
          clientRef: pay.clientRef || null,
          status: pay.status || 'PENDING',
        });
      } catch (e: unknown) {
        failed.push(`${item.title} (${errorMessage(e, 'ошибка')})`);
      }
    }
    setInvoices(created);

    // A3: корзина из 2+ позиций → пробуем общую оплату (один QR на всё).
    const orderIds = created
      .map((i) => i.orderId)
      .filter((id): id is string => !!id);

    if (orderIds.length > 1) {
      const batch = await requestCartPayment(orderIds);
      if (batch) {
        setCartPayment(batch);
        setExpiresAt(paymentDeadline());
        toast.success(
          `Счёт на ${formatPrice(batch.amount)} создан. Оплатите USDT (BSC) одним переводом.`,
        );
        if (failed.length > 0) {
          toast.error(`Не оформлено: ${failed.join('; ')}`);
        }
        setLoading(false);
        return;
      }
    }

    const withAddress = created.filter((i) => i.depositAddress);
    if (withAddress.length > 0) {
      setExpiresAt(paymentDeadline());
      toast.success(
        created.length === 1
          ? 'Счёт создан. Оплатите USDT (BSC).'
          : `Создано счетов: ${withAddress.length} из ${created.length}. Оплатите USDT (BSC) по каждому адресу.`,
      );
    } else if (created.length > 0) {
      toast.error('Заказы созданы, но платёжные адреса не получены.');
    }
    if (failed.length > 0) {
      toast.error(`Не оформлено: ${failed.join('; ')}`);
    }
    setLoading(false);
  };

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(addr);
      toast.success('Адрес скопирован');
      setTimeout(() => setCopiedAddr((c) => (c === addr ? null : c)), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  if (cart.length === 0 && invoices.length === 0) {
    return (
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
        <div className="relative max-w-xl mx-auto px-6 py-24 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--color-surface)] flex items-center justify-center"><ShoppingBag size={32} className="text-[var(--color-faint)]" /></div>
          <h1 className="text-3xl font-extrabold text-[var(--color-text)] mb-2">Пусто</h1>
          <p className="text-[var(--color-muted)] mb-8">Нечего оплачивать.</p>
          <Link to="/products" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#22c55e] text-[#0d1512] font-bold text-sm hover:bg-[#16a34a] transition-colors shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]">
            <ShoppingBag size={16} /> В каталог
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)' }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6 transition-colors text-sm"><ArrowLeft size={16} /> Назад</button>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[26px] bg-[var(--color-surface)] border border-[var(--color-border)] p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-muted)]">безопасный чеккаут</span>
          </div>
          <h1 className="font-extrabold leading-[1.05] tracking-tight text-[var(--color-text)]" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)' }}>
            <span style={{ background: 'linear-gradient(90deg, #22c55e, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Оплата</span>
          </h1>

          {cart.length > 0 && (
            <>
              <div className="space-y-3 mb-6 mt-4">
                {cart.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
                    <span className="text-sm text-[var(--color-text)]">{item.title} × {item.quantity}</span>
                    <span className="text-sm font-bold text-[#22c55e]">{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className="text-base font-bold text-[var(--color-text)]">Итого</span>
                <span className="text-xl font-extrabold text-[#22c55e]">{formatPrice(total)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] mb-6"><ShieldCheck size={14} className="text-[#22c55e]" /> Безопасная оплата через платформу</div>

              {/* Кнопка — только пока не созданы счета */}
              {invoices.length === 0 && (
                <button onClick={handleOrder} disabled={loading} className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#22c55e] text-[#0d1512] font-extrabold text-base hover:bg-[#16a34a] transition-colors shadow-[0_12px_32px_-8px_rgba(34,197,94,0.5)] disabled:opacity-50">
                  <span>{loading ? 'Оформление...' : cart.length > 1 ? 'Оплатить корзину' : 'Создать счёт'}</span><ArrowRight size={18} />
                </button>
              )}
            </>
          )}

          {/* A3: ОДИН QR на всю корзину */}
          {cartPayment && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  Оплатите USDT (BSC) — один счёт на всю корзину ({payable.length} {payable.length === 1 ? 'позиция' : 'позиции'}):
                </p>
                {timeLeft > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e]">
                    <Clock size={14} /> {formatTime(timeLeft)}
                  </span>
                )}
              </div>

              <div className="rounded-2xl bg-[var(--bg-3)] border border-[#22c55e]/20 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[var(--color-text)]">Общая сумма заказа</div>
                    <div className="text-lg text-[#22c55e] font-extrabold mt-0.5">{formatPrice(cartPayment.amount)}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${allPaid ? 'text-[#0d1512] bg-[#22c55e] border-[#22c55e]' : 'text-[var(--color-muted)] border-[var(--color-border)] bg-[var(--color-surface)]'}`}>
                    {allPaid ? STATUS_LABEL.CONFIRMED : `${paidCount}/${payable.length} оплачено`}
                  </span>
                </div>

                <div className="mb-3 flex justify-center">
                  <div className="w-full max-w-[220px] bg-white rounded-2xl p-3">
                    <QRCodeSVG value={cartPayment.depositAddress} className="w-full h-auto" />
                  </div>
                </div>
                <div className="relative">
                  <code className="block w-full pl-3 pr-12 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">{cartPayment.depositAddress}</code>
                  <button onClick={() => copyAddress(cartPayment.depositAddress)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[#22c55e] hover:bg-[var(--bg-3)] transition-colors" title="Копировать адрес">
                    {copiedAddr === cartPayment.depositAddress ? <Check size={16} className="text-[#22c55e]" /> : <Copy size={16} />}
                  </button>
                </div>

                <div className="mt-4 space-y-1.5">
                  {invoices.map((inv) => (
                    <div key={inv.orderId || inv.productId} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-[var(--color-muted)] truncate">{inv.title} × {inv.quantity}</span>
                      <span className={`shrink-0 font-bold ${isFinal(inv.status) ? 'text-[#22c55e]' : 'text-[var(--color-faint)]'}`}>
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 text-xs text-[var(--color-muted)]">
                <Loader2 size={14} className={`animate-spin text-[#22c55e] ${allPaid ? 'opacity-0' : ''}`} />
                {allPaid ? 'Всё оплачено — переходим к заказам...' : 'Ожидание подтверждения транзакции (BSC)...'}
              </div>
              <p className="mt-2 text-[11px] text-[var(--color-faint)]">
                Один перевод на общую сумму закрывает все позиции корзины. Заказ считается оплаченным только после подтверждения сети. Счёт автоматически отменяется через 15 минут.
              </p>
            </div>
          )}

          {/* Fallback: бэкенд без общей оплаты — поштучные адреса */}
          {!cartPayment && payable.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  Оплатите USDT (BSC) — {payable.length === 1 ? 'адрес:' : `по каждому адресу (${paidCount}/${payable.length} оплачено):`}
                </p>
                {timeLeft > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22c55e]">
                    <Clock size={14} /> {formatTime(timeLeft)}
                  </span>
                )}
              </div>

              <div className="space-y-4">
                {invoices.map((inv) => (
                  <div key={inv.orderId || inv.productId} className="rounded-2xl bg-[var(--bg-3)] border border-[#22c55e]/20 p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[var(--color-text)] truncate">{inv.title} × {inv.quantity}</div>
                        <div className="text-xs text-[#22c55e] font-bold mt-0.5">{formatPrice(inv.amount)}</div>
                      </div>
                      <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${isFinal(inv.status) ? 'text-[#0d1512] bg-[#22c55e] border-[#22c55e]' : inv.status === 'FAILED' ? 'text-red-400 border-red-400/40 bg-red-400/10' : 'text-[var(--color-muted)] border-[var(--color-border)] bg-[var(--color-surface)]'}`}>
                        {STATUS_LABEL[inv.status] || inv.status}
                      </span>
                    </div>

                    {inv.depositAddress ? (
                      <>
                        <div className="mb-3 flex justify-center">
                          <div className="w-full max-w-[220px] bg-white rounded-2xl p-3">
                            <QRCodeSVG value={inv.depositAddress} className="w-full h-auto" />
                          </div>
                        </div>
                        <div className="relative">
                          <code className="block w-full pl-3 pr-12 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[#34d399] break-all font-mono">{inv.depositAddress}</code>
                          <button onClick={() => copyAddress(inv.depositAddress as string)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-muted)] hover:text-[#22c55e] hover:bg-[var(--bg-3)] transition-colors" title="Копировать адрес">
                            {copiedAddr === inv.depositAddress ? <Check size={16} className="text-[#22c55e]" /> : <Copy size={16} />}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-red-400">Платёжный адрес не получен. Создайте счёт заново.</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-4 text-xs text-[var(--color-muted)]">
                <Loader2 size={14} className={`animate-spin text-[#22c55e] ${allPaid ? 'opacity-0' : ''}`} />
                {allPaid ? 'Все позиции оплачены — переходим к заказам...' : 'Ожидание подтверждения транзакций (BSC)...'}
              </div>
              <p className="mt-2 text-[11px] text-[var(--color-faint)]">
                Заказ считается оплаченным только после подтверждения сети. Неоплаченные счета автоматически отменяются через 15 минут.
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}