import React from 'react';

interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}
const Tabs: React.FC<TabsProps> = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
    {tabs.map(tab => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${active === tab ? 'bg-white dark:bg-gray-700 shadow text-blue-600' : 'text-gray-500'}`}
      >
        {tab}
      </button>
    ))}
  </div>
);
export default Tabs;