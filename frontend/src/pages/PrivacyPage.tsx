import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% -5%, rgba(34,197,94,0.10) 0%, transparent 60%)'
      }} />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] mb-8 transition-colors">
          <ArrowLeft size={16} /> Назад
        </button>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-4xl font-extrabold tracking-tight text-[var(--color-text)] mb-2">
            <span style={{ background: 'linear-gradient(90deg, #22c55e, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Политика конфиденциальности</span>
          </h1>
          <p className="text-[var(--color-muted)] text-sm mb-8">Как мы обращаемся с твоими данными</p>
        </motion.div>

        <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#34d399] flex items-center justify-center shadow-[0_8px_32px_-8px_rgba(34,197,94,0.5)]">
              <Shield size={20} className="text-[#0d1512]" />
            </div>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-[var(--color-muted)]">
            <p>Мы уважаем вашу приватность и обязуемся защищать ваши персональные данные.</p>
            <h3 className="text-[var(--color-text)] font-semibold text-base">Сбор данных</h3><p>Мы собираем только данные необходимые для работы сервиса: номер телефона, имя, информация о заказах и сообщениях.</p>
            <h3 className="text-[var(--color-text)] font-semibold text-base">Использование данных</h3><p>Ваши данные используются для обеспечения работы маркетплейса, обработки заказов, отправки уведомлений и улучшения сервиса.</p>
            <h3 className="text-[var(--color-text)] font-semibold text-base">Защита данных</h3><p>Мы применяем современные методы шифрования и защиты данных. Доступ к данным имеют только авторизованные сотрудники.</p>
          </div>
        </div>
      </div>
    </div>
  );
}