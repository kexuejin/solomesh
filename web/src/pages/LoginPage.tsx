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

export function LoginPage() {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
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

  // Registration status
  const [regStatus, setRegStatus] = useState<RegisterStatus>({
    allowRegistration: true,
    requireInviteCode: true,
  });

  useEffect(() => {
    api
      .get<RegisterStatus>('/api/auth/register/status')
      .then((data) => setRegStatus(data))
      .catch(() => {
        // Fallback: show link with invite code text (safe default)
        setRegStatus({ allowRegistration: true, requireInviteCode: true });
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      const state = useAuthStore.getState();
      if (state.user?.role === 'admin' && state.setupStatus?.needsSetup) {
        navigate('/setup/providers');
        return;
      }
      const mustChange = useAuthStore.getState().user?.must_change_password;
      navigate(mustChange ? '/settings' : '/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : t('auth.login.failed'));
    } finally {
      setLoading(false);
    }
  };

  if (initialized !== true) {
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

          {/* Title */}
          <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            Secure Access
          </p>
          <h1 className="mb-2 text-center text-2xl font-bold tracking-tight text-foreground">
            {t('auth.login.title')}
          </h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            {t('auth.login.subtitle')}
          </p>

          {/* Error Message */}
          {error && (
            <div className="surface-card-soft mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1 block text-sm font-medium text-foreground/80">
                {t('auth.login.username')}
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-foreground/80">
                {t('auth.login.password')}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
                required
              />
            </div>

            <Button type="submit" disabled={loading} className="h-10 w-full rounded-xl">
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
          </form>

          {/* Register Link — hidden when registration is disabled */}
          {regStatus.allowRegistration && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {regStatus.requireInviteCode
                ? t('auth.login.invitePrompt')
                : t('auth.login.noAccountPrompt')}
              <Link to="/register" className="text-primary hover:text-primary/80 ml-1">
                {t('auth.login.register')}
              </Link>
            </p>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground/90">
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
