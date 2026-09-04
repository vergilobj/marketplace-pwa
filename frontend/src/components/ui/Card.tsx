import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ children, className, ...rest }) => {
  return (
    <div
      className={`bg-[var(--color-card)] border border-[var(--color-border)] rounded-[18px] transition-all duration-300 hover:border-[rgba(255,87,155,0.35)] hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(255,87,155,0.24)] p-6 ${className || ''}`}
      {...rest}
    >
      {children}
    </div>
  );
};

export default Card;