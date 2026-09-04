import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbsProps {
  items: { label: string; to?: string }[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center space-x-2 text-sm text-gray-500 mb-4">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <ChevronRight size={14} />}
          {item.to ? (
            <Link to={item.to} className="hover:text-blue-600 transition">{item.label}</Link>
          ) : (
            <span className="text-gray-900 dark:text-[var(--color-text)] font-medium">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}