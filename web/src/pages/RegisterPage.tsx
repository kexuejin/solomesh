import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '../i18n';

interface RegisterStatus {
  allowRegistration: boolean;
  requireInviteCode: boolean;
}

export function RegisterPage() {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const initialized = useAuthStore((state) => state.initialized);
  const checkStatus = useAuthStore((state) => state.checkStatus);

  // Redirect to setup if system is not initialized
  useEffect(() => {
    if (initialized === null) {
      checkStatus();
    } else if (initialized === false) {
      navigate('/setup', { replace: true });
    }
  }, [initialized, checkStatus, navigate]);

  // Registration status from backend
  const [status, setStatus] = useState<RegisterStatus>({
    allowRegistration: true,
    requireInviteCode: true,
  });
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    api
      .get<RegisterStatus>('/api/auth/register/status')
      .then((data) => setStatus(data))
      .catch(() => {
        // Fallback: safe defaults
        setStatus({ allowRegistration: true, requireInviteCode: true });
      })
      .finally(() => setStatusLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      setError(t('auth.register.usernameInvalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.register.passwordTooShort'));
      return;
    }
    if (password.length > 128) {
      setError(t('auth.register.passwordTooLong'));
      return;
    }

    setLoading(true);
    try {
      const payload: { username: string; password: string; display_name?: string; invite_code?: string } = {
        username,
        password,
        display_name: displayName || undefined,
      };
      if (status.requireInviteCode || inviteCode.trim()) {
        payload.invite_code = inviteCode;
      }
      await register(payload);
      const state = useAuthStore.getState();
      if (state.user?.role === 'admin' && state.setupStatus?.needsSetup) {
        navigate('/setup/providers');
        return;
      }
      const mustChange = useAuthStore.getState().user?.must_change_password;
      navigate(mustChange ? '/settings' : '/setup/channels');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : t('auth.register.failed'),
      );
    } finally {
      setLoading(false);
    }
  };

  if (initialized !== true || statusLoading) {
    return (
      <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
        <div className="mx-auto flex h-full w-full max-w-md items-center justify-center">
          <div className="surface-card-soft flex items-center gap-2.5 border border-border/70 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('auth.loading')}
          </div>
        </div>
      </div>
    );
  }

  // Registration disabled
  if (!status.allowRegistration) {
    return (
      <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
        <div className="mx-auto flex min-h-full w-full max-w-md items-center">
          <div className="surface-card w-full p-6 sm:p-8">
            <div className="mb-6 flex justify-center">
              <div className="mx-auto h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-border/70 shadow-sm">
                <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="SoloMesh" className="w-full h-full object-cover" />
              </div>
            </div>
            <h1 className="mb-2 text-center text-2xl font-bold text-foreground">
              {t('auth.register.closedTitle')}
            </h1>
            <p className="mb-6 text-center text-muted-foreground">
              {t('auth.register.closedDesc')}
            </p>
            <Button asChild className="h-10 w-full rounded-xl">
              <Link to="/login">{t('auth.register.backToLogin')}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto flex min-h-full w-full max-w-md items-center">
        <div className="surface-card w-full p-6 sm:p-8">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <div className="mx-auto h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-border/70 shadow-sm">
              <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="SoloMesh" className="w-full h-full object-cover" />
            </div>
          </div>

          <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            Account Setup
          </p>
          <h1 className="mb-2 text-center text-2xl font-bold text-foreground">
            {t('auth.register.title')}
          </h1>
          <p className="mb-6 text-center text-muted-foreground">
            {status.requireInviteCode
              ? t('auth.register.requireInvite')
              : t('auth.register.createAccount')}
          </p>

          {error && (
            <div className="surface-card-soft mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {status.requireInviteCode && (
              <div>
                <label htmlFor="invite_code" className="mb-1 block text-sm font-medium text-foreground/80">
                  {t('auth.register.inviteCode')}
                </label>
                <Input
                  id="invite_code"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="h-10 rounded-xl border-border/75 bg-card/95 font-mono"
                  placeholder={t('auth.register.invitePlaceholder')}
                  required
                  autoFocus
                />
              </div>
            )}

            <div>
              <label htmlFor="reg-username" className="mb-1 block text-sm font-medium text-foreground/80">
                {t('auth.register.username')}
              </label>
              <Input
                id="reg-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth.register.usernamePlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
                required
                autoFocus={!status.requireInviteCode}
              />
            </div>

            <div>
              <label htmlFor="reg-display-name" className="mb-1 block text-sm font-medium text-foreground/80">
                {t('auth.register.displayName')}{' '}
                <span className="text-muted-foreground/80">
                  ({t('auth.register.optional')})
                </span>
              </label>
              <Input
                id="reg-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.register.displayNamePlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
            </div>

            <div>
              <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-foreground/80">
                {t('auth.register.password')}
              </label>
              <Input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.register.passwordPlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
                required
              />
            </div>

            <Button type="submit" disabled={loading} className="h-10 w-full rounded-xl">
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? t('auth.register.submitting') : t('auth.register.submit')}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('auth.register.hasAccount')}
            <Link to="/login" className="text-primary hover:text-primary/80 ml-1">
              {t('auth.register.toLogin')}
            </Link>
          </p>

          <p className="mt-2 text-center text-xs text-muted-foreground/90">
            SoloMesh - Powered by{' '}
            <a href="https://github.com/kexuejin" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
              kexuejin
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
