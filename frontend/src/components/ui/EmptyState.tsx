import { PackageOpen } from 'lucide-react';

export default function EmptyState({ message = 'Здесь пока пусто' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <PackageOpen size={48} />
      <p className="mt-4 text-lg">{message}</p>
    </div>
  );
}