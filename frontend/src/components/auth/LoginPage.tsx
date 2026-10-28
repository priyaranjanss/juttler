import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useRouter } from '../../router';
import { api } from '../../services/api';
import { AuthLayout } from './AuthLayout';
import { AuthField } from './AuthField';
import { readNextPath, validateEmail } from './validation';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, theme } = useApp();
  const { navigate } = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDark = theme === 'dark';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.login({ email: email.trim(), password });
      login(result.user, result.token);
      navigate(readNextPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchToRegister = () => {
    const next = readNextPath();
    const suffix = next === '/workspace' ? '' : `?next=${encodeURIComponent(next)}`;
    navigate(`/register${suffix}`);
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your Juttler workspace"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={switchToRegister}
            className={`font-medium underline-offset-2 hover:underline ${
              isDark ? 'text-[#f5f5f7]' : 'text-[#1c1c1e]'
            }`}
          >
            Create one
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={isSubmitting}>
        <AuthField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          maxLength={254}
          disabled={isSubmitting}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError('');
          }}
          placeholder="you@company.com"
          icon={<Mail className="h-4 w-4" />}
        />

        <AuthField
          id="login-password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          maxLength={128}
          disabled={isSubmitting}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
          placeholder="••••••••"
          icon={<Lock className="h-4 w-4" />}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                isDark
                  ? 'text-[#98989f] hover:bg-[#26262a] hover:text-white'
                  : 'text-[#8e8e93] hover:bg-[#e6e6e8] hover:text-[#1c1c1e]'
              }`}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[10px] border border-[#ff6961]/30 bg-[#ff6961]/10 px-3 py-2.5 text-[12px] text-[#ff453a]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`group flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60 ${
            isDark
              ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white'
              : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
