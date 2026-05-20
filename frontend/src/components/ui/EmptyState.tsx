import React from 'react';
import { PackageOpen } from 'lucide-react';
import Button from './Button';

interface EmptyStateProps {
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ message = 'Здесь пока пусто', action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <PackageOpen size={48} />
      <p className="mt-4 text-lg">{message}</p>
      {action && (
        <Button variant="secondary" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}