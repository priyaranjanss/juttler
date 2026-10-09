import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useRouter } from '../../router';
import { api } from '../../services/api';
import { JuttlerLogo } from '../common/JuttlerLogo';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { login, theme } = useApp();
  const { navigate } = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDark = theme === 'dark';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.register({ name: trimmedName, email: trimmedEmail, password });
      login(result.user, result.token);
      navigate('/workspace');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = `w-full rounded-xl border py-2.5 pl-10 pr-4 text-sm transition-colors focus:outline-none focus:ring-2 disabled:opacity-60 ${
    isDark
      ? 'border-[#2f3336] bg-[#16181c] text-[#e7e9ea] placeholder:text-[#71767b] focus:border-[#48cae4]/60 focus:ring-[#48cae4]/20'
      : 'border-[#d0d7de] bg-[#f7f9f9] text-[#0f1419] placeholder:text-[#536471] focus:border-[#1d9bf0]/60 focus:ring-[#1d9bf0]/20'
  }`;

  return (
    <div
      className={`relative flex min-h-screen items-center justify-center p-4 transition-colors ${
        isDark ? 'bg-black text-white' : 'bg-[#f7f9f9] text-[#0f1419]'
      }`}
    >
      {/* Soft ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(600px 320px at 50% 12%, rgba(72, 202, 228, 0.10), transparent 70%)'
            : 'radial-gradient(600px 320px at 50% 12%, rgba(29, 155, 240, 0.10), transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border ${
              isDark ? 'border-[#2f3336] bg-[#16181c] text-white' : 'border-[#eff3f4] bg-white text-[#0f1419] shadow-sm'
            }`}
          >
            <JuttlerLogo className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className={`mt-1.5 text-sm ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
            Set up your Juttler workspace
          </p>
        </div>

        {/* Card */}
        <div
          className={`rounded-2xl border p-6 shadow-2xl ${
            isDark ? 'border-[#1f1f1f] bg-[#0d0d0d]' : 'border-[#e6ecf0] bg-white'
          }`}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="register-name"
                className={`mb-1.5 block text-xs font-semibold ${isDark ? 'text-[#8b98a5]' : 'text-[#536471]'}`}
              >
                Full name
              </label>
              <div className="relative">
                <UserIcon
                  className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'
                  }`}
                />
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  disabled={isSubmitting}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError('');
                  }}
                  placeholder="Jordan Lee"
                  className={inputClasses}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="register-email"
                className={`mb-1.5 block text-xs font-semibold ${isDark ? 'text-[#8b98a5]' : 'text-[#536471]'}`}
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'
                  }`}
                />
                <input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  disabled={isSubmitting}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError('');
                  }}
                  placeholder="you@company.com"
                  className={inputClasses}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="register-password"
                className={`mb-1.5 block text-xs font-semibold ${isDark ? 'text-[#8b98a5]' : 'text-[#536471]'}`}
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'
                  }`}
                />
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError('');
                  }}
                  placeholder="••••••••"
                  className={`${inputClasses} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 transition-colors ${
                    isDark ? 'text-[#71767b] hover:text-[#e7e9ea]' : 'text-[#8b98a5] hover:text-[#0f1419]'
                  }`}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className={`mt-1.5 text-[11px] ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
                At least 6 characters.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                  isDark ? 'border-red-500/25 bg-red-500/10 text-red-400' : 'border-red-200 bg-red-50 text-red-600'
                }`}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className={`group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-60 ${
                isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className={`mt-6 text-center text-[11px] ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className={`font-semibold underline-offset-2 hover:underline ${isDark ? 'text-[#e7e9ea]' : 'text-[#0f1419]'}`}
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
