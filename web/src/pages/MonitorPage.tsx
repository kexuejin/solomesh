import { useEffect, useRef } from 'react';
import { useMonitorStore } from '../stores/monitor';
import { useAuthStore } from '../stores/auth';
import { ContainerStatus } from '../components/monitor/ContainerStatus';
import { QueueStatus } from '../components/monitor/QueueStatus';
import { SystemInfo } from '../components/monitor/SystemInfo';
import { GroupStatusCard } from '../components/monitor/GroupStatusCard';
import { RefreshCw, AlertTriangle, CheckCircle, Hammer, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonStatCards } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
import { wsManager } from '../api/ws';
import { useI18n } from '../i18n';

export function MonitorPage() {
  const { t } = useI18n();
  const { status, loading, loadStatus, building, buildLogs, buildResult, buildDockerImage, clearBuildResult } = useMonitorStore();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadStatus();

    const interval = setInterval(() => {
      loadStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, [loadStatus]);

  // WebSocket listeners for docker build progress
  useEffect(() => {
    const unsubLog = wsManager.on('docker_build_log', (data: { line: string }) => {
      useMonitorStore.setState((s) => ({
        buildLogs: [...s.buildLogs.slice(-199), data.line],
      }));
    });
    const unsubComplete = wsManager.on('docker_build_complete', (data: { success: boolean; error?: string }) => {
      useMonitorStore.setState({
        building: false,
        buildResult: { success: data.success, error: data.error },
      });
      loadStatus();
    });

    return () => {
      unsubLog();
      unsubComplete();
    };
  }, [loadStatus]);

  // Auto-scroll build logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [buildLogs]);

  const handleBuild = async () => {
    clearBuildResult();
    await buildDockerImage();
  };

  return (
    <div className="min-h-full app-canvas p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-xl border border-border/80 bg-card px-5 py-4">
          <PageHeader
            title={t('monitor.page.title')}
            subtitle={t('monitor.page.subtitle')}
            className="mb-0"
            actions={
              <Button variant="outline" onClick={loadStatus} disabled={loading}>
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                {t('monitor.page.refresh')}
              </Button>
            }
          />
        </div>

        {loading && !status && (
          <SkeletonStatCards />
        )}

        {status && (
          <div className="space-y-6">
            {/* Docker image status */}
            <div className="surface-card overflow-hidden">
              <div className="border-b border-border/70 bg-muted/30 px-5 py-4">
                <h2 className="text-lg font-semibold text-foreground">{t('monitor.docker.title')}</h2>
                <p className="text-xs text-muted-foreground mt-1">{t('monitor.docker.description')}</p>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {status.dockerImageExists ? (
                      <>
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <span className="text-sm text-green-700 font-medium">{t('monitor.docker.ready')}</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <span className="text-sm text-red-600 font-medium">{t('monitor.docker.missing')}</span>
                      </>
                    )}
                  </div>
                  <Button
                    onClick={handleBuild}
                    disabled={building || !isAdmin}
                    title={!isAdmin ? t('monitor.docker.adminOnly') : undefined}
                  >
                    {building ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('monitor.docker.building')}
                      </>
                    ) : (
                      <>
                        <Hammer className="w-4 h-4" />
                        {status.dockerImageExists ? t('monitor.docker.rebuild') : t('monitor.docker.build')}
                      </>
                    )}
                  </Button>
                </div>

                {/* Build logs */}
                {building && buildLogs.length > 0 && (
                  <div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-[#27344f] bg-[#101a2d] p-3 font-mono text-xs text-green-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {buildLogs.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                )}

                {buildResult && (
                  <div className={`rounded-lg border p-4 ${buildResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="mb-2 flex items-center gap-2">
                      {buildResult.success ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                      )}
                      <span className={`text-sm font-medium ${buildResult.success ? 'text-green-700' : 'text-red-600'}`}>
                        {buildResult.success ? t('monitor.docker.buildSuccess') : t('monitor.docker.buildFailed')}
                      </span>
                    </div>
                    {buildResult.error && (
                      <pre className="mt-2 max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded bg-red-100 p-3 text-xs text-red-700">
                        {buildResult.error}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <ContainerStatus status={status} />
              <QueueStatus status={status} />
              <SystemInfo status={status} />
            </div>

            {/* Group details */}
            {status.groups && status.groups.length > 0 && (
              <div className="surface-card overflow-hidden">
                <div className="border-b border-border/70 bg-muted/30 px-5 py-4">
                  <h2 className="text-lg font-semibold text-foreground">
                    {t('monitor.groups.title')}
                  </h2>
                </div>

                {/* Mobile: card list */}
                <div className="space-y-4 px-5 py-4">
                  <div className="lg:hidden space-y-3">
                    {status.groups.map((group) => (
                      <GroupStatusCard key={group.jid} group={group} />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            {t('monitor.groups.columns.group')}
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            {t('monitor.groups.columns.queue')}
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            {t('monitor.groups.columns.status')}
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                            {t('monitor.groups.columns.process')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {status.groups.map((group) => (
                          <tr key={group.jid} className="hover:bg-muted/40">
                            <td className="px-4 py-3 text-sm font-medium text-foreground">
                              {group.jid}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">
                              {t('monitor.groups.queueSummary', {
                                tasks: group.pendingTasks,
                                messageStatus: group.pendingMessages
                                  ? t('monitor.groups.hasNewMessages')
                                  : t('monitor.groups.noNewMessages'),
                              })}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {group.active ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-600">
                                  {t('monitor.status.running')}
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                                  {t('monitor.status.idle')}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground font-mono text-xs">
                              {group.displayName || group.containerName || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
