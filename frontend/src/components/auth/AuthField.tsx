import React from 'react';
import { useApp } from '../../context/AppContext';

interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  hint?: string;
}

export const AuthField: React.FC<AuthFieldProps> = ({
  id,
  label,
  icon,
  trailing,
  hint,
  className = '',
  ...inputProps
}) => {
  const { theme } = useApp();
  const isDark = theme === 'dark';

  const inputClasses = `h-11 w-full rounded-[10px] border py-2.5 pl-10 text-[13px] transition-colors outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
    trailing ? 'pr-11' : 'pr-3'
  } ${
    isDark
      ? 'border-transparent bg-[#1c1c1f] text-[#f5f5f7] placeholder:text-[#6e6e73] focus:border-[#3a3a3d] focus:ring-white/5'
      : 'border-transparent bg-[#f2f2f4] text-[#1c1c1e] placeholder:text-[#8e8e93] focus:border-[#d1d1d6] focus:bg-white focus:ring-[#0b0b0c]/5'
  } ${className}`;

  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-1.5 block text-[11px] font-medium ${isDark ? 'text-[#98989f]' : 'text-[#6e6e73]'}`}
      >
        {label}
      </label>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[#8e8e93]">
          {icon}
        </span>

        <input id={id} className={inputClasses} {...inputProps} />

        {trailing && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
        )}
      </div>

      {hint && (
        <p className={`mt-1.5 text-[11px] ${isDark ? 'text-[#6e6e73]' : 'text-[#98989f]'}`}>{hint}</p>
      )}
    </div>
  );
};

export default AuthField;
