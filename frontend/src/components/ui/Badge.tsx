const Badge: React.FC<{ text: string; color?: string }> = ({ text, color = 'bg-gray-200 text-gray-700' }) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{text}</span>
  );
  export default Badge;