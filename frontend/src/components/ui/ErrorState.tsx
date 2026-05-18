import { AlertTriangle } from 'lucide-react';
import Button from './Button';

export default function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <AlertTriangle size={48} className="text-red-400" />
      <p className="mt-4 text-lg">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Попробовать снова</Button>}
    </div>
  );
}