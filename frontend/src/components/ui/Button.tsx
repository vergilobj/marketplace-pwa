import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}

const GS = { background: 'linear-gradient(135deg, #fbfbf8 0%, #a8b0a8 50%, #a8b0a8 100%)' } as const;

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  loading,
  children,
  className,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center px-6 py-3 rounded-full font-semibold text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100';

  const variants: Record<string, string> = {
    primary:
      'text-[#0b0e0d] hover:scale-[1.02] hover:shadow-[0_20px_50px_rgba(201,242,103,0.38)]',
    secondary:
      'text-[var(--color-text)] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.12)] backdrop-blur hover:border-[rgba(201,242,103,0.5)] hover:text-[#fbfbf8]',
    ghost:
      'text-[var(--color-muted)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--color-text)]',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className || ''}`}
      style={variant === 'primary' ? { ...GS, boxShadow: '0 16px 40px rgba(201,242,103,0.24)' } : undefined}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
};

export default Button;