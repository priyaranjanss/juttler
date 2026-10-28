import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { JuttlerLogo } from '../common/JuttlerLogo';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ title, subtitle, children, footer }) => {
  const { theme, toggleTheme } = useApp();
  const isDark = theme === 'dark';

  return (
    <main
      className={`relative flex min-h-screen items-center justify-center px-4 py-10 transition-colors ${
        isDark ? 'bg-[#0b0b0c] text-[#f5f5f7]' : 'bg-[#fbfbfb] text-[#1c1c1e]'
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(560px 300px at 50% 8%, rgba(124, 58, 237, 0.12), transparent 70%)'
            : 'radial-gradient(560px 300px at 50% 8%, rgba(124, 58, 237, 0.08), transparent 70%)',
        }}
      />

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full transition ${
          isDark
            ? 'text-[#98989f] hover:bg-[#1c1c1f] hover:text-white'
            : 'text-[#8e8e93] hover:bg-[#f2f2f4] hover:text-[#1c1c1e]'
        }`}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className={`mb-4 flex h-12 w-12 items-center justify-center rounded-[12px] border ${
              isDark
                ? 'border-[#2c2c2f] bg-[#141416] text-white'
                : 'border-[#e6e6e8] bg-white text-[#1c1c1e] shadow-sm'
            }`}
          >
            <JuttlerLogo className="h-6 w-6" />
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
          <p className={`mt-1.5 text-[13px] ${isDark ? 'text-[#98989f]' : 'text-[#8e8e93]'}`}>
            {subtitle}
          </p>
        </div>

        <div
          className={`rounded-[10px] border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_48px_rgba(0,0,0,0.06)] ${
            isDark ? 'border-[#232326] bg-[#141416]' : 'border-[#e6e6e8] bg-white'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className={`mt-6 text-center text-[12px] ${isDark ? 'text-[#98989f]' : 'text-[#6e6e73]'}`}>
            {footer}
          </div>
        )}

        <p className={`mt-8 text-center text-[10px] ${isDark ? 'text-[#6e6e73]' : 'text-[#98989f]'}`}>
          Juttler · Private AI workspace
        </p>
      </div>
    </main>
  );
};

export default AuthLayout;
