import React from 'react';

interface JuttlerLogoProps {
  className?: string;
  size?: number;
}

export const JuttlerLogo: React.FC<JuttlerLogoProps> = ({ className = 'h-6 w-6', size }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Sleek geometric emblem inspired by modern multi-agent slash & network nodes */}
      <path
        d="M 18 12 L 34 12 L 82 88 L 66 88 Z"
        fill="currentColor"
      />
      <path
        d="M 32 88 L 48 88 L 82 34 L 66 34 Z"
        fill="currentColor"
        opacity="0.85"
      />
      <circle cx="26" cy="22" r="5" fill="currentColor" />
      <circle cx="74" cy="78" r="5" fill="currentColor" />
      <circle cx="58" cy="46" r="4" fill="currentColor" />
    </svg>
  );
};
