import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ children, className, ...rest }) => {
  return (
    <div
      className={`bg-white/70 dark:bg-gray-900/50 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/5 dark:shadow-black/20 border border-white/20 dark:border-gray-800/50 p-6 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};

export default Card;