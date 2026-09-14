import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import ConsultChat from '../components/consult/ConsultChat';

/**
 * Страница ИИ-консультанта (ЭТАП 4 ТЗ §2, §5.4).
 *
 * Полноэкранный чат с историей вопросов. Контекст товара — через
 * `?productId=` (кнопка «Спросить у ИИ» на карточке товара ведёт сюда).
 *
 * Роут публичный, но чат требует авторизации (как `/bazar`): гостю внутри
 * показывается приглашение войти, сам роут никого не редиректит.
 */
export default function ConsultPage() {
  return (
    <div className="h-[calc(100dvh-228px)] md:h-[calc(100vh-156px)] flex flex-col overflow-hidden">
      {/* Заголовок для скринридеров и SEO (визуально его заменяет шапка чата) */}
      <h1 className="sr-only">ИИ-консультант</h1>
      <div className="max-w-3xl w-full mx-auto px-4 py-6 flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 rounded-3xl flex flex-col overflow-hidden"
          style={{ background: '#0b0e0d', border: '1px solid rgba(34,197,94,0.12)' }}
        >
          <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6">
            <ConsultChat />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--color-faint)]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={13} className="text-[#22c55e]" />
            Ответы ИИ помечены значком «ИИ». Точные цены и наличие — на карточке товара.
          </span>
          <Link to="/feedback" className="text-[var(--color-muted)] hover:text-[#22c55e] transition-colors">
            Обратная связь и переписка с админом
          </Link>
        </div>
      </div>
    </div>
  );
}