import { AlertTriangle } from 'lucide-react';
import Button from './Button';

/** R17 — состояние ошибки под тёмную тему. */
export default function ErrorState({
  message,
  description,
  onRetry,
}: {
  message: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-20 h-20 mb-5 rounded-full bg-[rgba(248,113,113,0.10)] flex items-center justify-center">
        <AlertTriangle size={32} className="text-red-400" />
      </div>
      <p className="text-lg font-semibold text-[var(--color-text)] mb-1.5">{message}</p>
      {description && <p className="text-sm text-[var(--color-muted)] max-w-xs">{description}</p>}
      {onRetry && (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          Попробовать снова
        </Button>
      )}
    </div>
  );
}