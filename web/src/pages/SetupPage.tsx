import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, Eye, EyeOff, Loader2 } from 'lucide-react';

import { useAuthStore } from '../stores/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '../i18n';

// --- Helpers ---

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// --- Component ---

export function SetupPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { initialized, authenticated, setupAdmin, checkStatus } = useAuthStore();

  // Check initialization status on mount (this is a public page, no AuthGuard)
  useEffect(() => {
    if (initialized === null) {
      checkStatus();
    }
  }, [initialized, checkStatus]);

  // If system is already initialized, redirect to login
  useEffect(() => {
    if (initialized === true && !authenticated) {
      navigate('/login', { replace: true });
    }
  }, [initialized, authenticated, navigate]);

  if (initialized === true && authenticated) {
    return <Navigate to="/setup/providers" replace />;
  }

  // Loading or redirecting
  if (initialized !== false) {
    return (
      <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
        <div className="mx-auto flex h-full w-full max-w-xl items-center justify-center">
          <div className="surface-card-soft flex items-center gap-2.5 border border-border/70 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('auth.setup.loadingInitStatus')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-card shadow-sm">
            <img
              src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
              alt="SoloMesh"
              className="h-full w-full rounded-2xl object-cover"
            />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {t('auth.setup.step')}
          </p>
          <h1 className="mb-2 text-2xl font-bold text-foreground">{t('auth.setup.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('auth.setup.subtitle')}
          </p>
        </div>

        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('auth.setup.adminInfoTitle')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('auth.setup.adminInfoSubtitle')}</p>
            </div>
          </div>
          <div className="px-5 py-4">
            <CreateAdminStep
              onDone={() => navigate('/setup/providers', { replace: true })}
              setupAdmin={setupAdmin}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Create Admin Step ---

function CreateAdminStep({
  onDone,
  setupAdmin,
}: {
  onDone: () => void;
  setupAdmin: (username: string, password: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!username.trim()) {
      setError(t('auth.setup.fillUsername'));
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      setError(t('auth.setup.usernameInvalid'));
      return;
    }
    if (!password) {
      setError(t('auth.setup.fillPassword'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.setup.passwordTooShort'));
      return;
    }
    if (password !== confirmPwd) {
      setError(t('auth.setup.passwordMismatch'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setupAdmin(username, password);
      onDone();
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : NaN;
      if (status === 403) {
        setError(t('auth.setup.alreadyInitializedRedirect'));
        setTimeout(() => { navigate('/login', { replace: true }); }, 2000);
        return;
      }
      setError(getErrorMessage(err, t('auth.setup.createAdminFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="surface-card-soft mb-4 rounded-xl border border-brand-200 bg-brand-50/65 px-3 py-2.5 text-sm text-foreground/85">
        {t('auth.setup.nextTip')}
      </div>

      {error && (
        <div className="surface-card-soft mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="rounded-lg bg-muted/10 p-3">
          <label className="mb-1 block text-sm font-medium text-foreground/80">{t('auth.setup.username')}</label>
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('auth.setup.usernamePlaceholder')}
            className="h-10 rounded-xl border-border/75 bg-card/95"
            autoFocus
            disabled={saving}
          />
        </div>
        <div className="rounded-lg bg-muted/10 p-3">
          <label className="mb-1 block text-sm font-medium text-foreground/80">{t('auth.setup.password')}</label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-xl border-border/75 bg-card/95 pr-10"
              placeholder={t('auth.setup.passwordPlaceholder')}
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={saving}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md border border-transparent p-1 text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="rounded-lg bg-muted/10 p-3">
          <label className="mb-1 block text-sm font-medium text-foreground/80">{t('auth.setup.confirmPassword')}</label>
          <div className="relative">
            <Input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="h-10 rounded-xl border-border/75 bg-card/95 pr-10"
              placeholder={t('auth.setup.confirmPasswordPlaceholder')}
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              disabled={saving}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md border border-transparent p-1 text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="border-t border-border/70 pt-3">
          <Button onClick={handleSubmit} disabled={saving} className="h-10 w-full rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('auth.setup.createAndNext')}
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
