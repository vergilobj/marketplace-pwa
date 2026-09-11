import React from 'react';

interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
  className?: string;
}

/** R17 + R14 — табы под тёмную тему, тач-таргет ≥44px. */
const Tabs: React.FC<TabsProps> = ({ tabs, active, onChange, className = '' }) => (
  <div className={`flex gap-1 bg-[var(--bg-3)] p-1 rounded-xl ${className}`} role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab}
        role="tab"
        aria-selected={active === tab}
        onClick={() => onChange(tab)}
        className={`flex-1 min-h-[44px] px-4 text-sm font-medium rounded-lg transition-all ${
          active === tab
            ? 'bg-[var(--color-surface)] text-[#22c55e] shadow-sm'
            : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
        }`}
      >
        {tab}
      </button>
    ))}
  </div>
);

export default Tabs;