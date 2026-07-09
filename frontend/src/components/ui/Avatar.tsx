import { User } from 'lucide-react';

interface AvatarProps { src?: string | null; name?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'; ring?: boolean; className?: string; }

const sizes: Record<string, string> = { xs: 'w-7 h-7 text-[10px]', sm: 'w-9 h-9 text-xs', md: 'w-11 h-11 text-sm', lg: 'w-14 h-14 text-base', xl: 'w-20 h-20 text-xl', '2xl': 'w-28 h-28 text-3xl' };
const iconSizes: Record<string, number> = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, '2xl': 40 };

export default function Avatar({ src, name, size = 'md', ring = false, className = '' }: AvatarProps) {
  const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '';
  const content = src ? (
    <img src={src} alt={name || 'Avatar'} className={`${sizes[size]} rounded-full object-cover ${ring ? 'ring-2 ring-white dark:ring-slate-800' : ''}`} />
  ) : (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold ${ring ? 'ring-2 ring-white dark:ring-slate-800' : ''}`}>
      {initials || <User size={iconSizes[size]} />}
    </div>
  );
  if (ring) return <div className={`avatar-ring inline-flex shrink-0 ${className}`}>{content}</div>;
  return <span className={`inline-flex shrink-0 ${className}`}>{content}</span>;
}
