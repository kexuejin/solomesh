import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthGuard } from './components/auth/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';
import { APP_BASE, shouldUseHashRouter } from './utils/url';

const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const SetupPage = lazy(() => import('./pages/SetupPage').then(m => ({ default: m.SetupPage })));
const SetupProvidersPage = lazy(() => import('./pages/SetupProvidersPage').then(m => ({ default: m.SetupProvidersPage })));
const SetupChannelsPage = lazy(() => import('./pages/SetupChannelsPage').then(m => ({ default: m.SetupChannelsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage').then(m => ({ default: m.WorkbenchPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then(m => ({ default: m.TasksPage })));
const MonitorPage = lazy(() => import('./pages/MonitorPage').then(m => ({ default: m.MonitorPage })));
const MemoryPage = lazy(() => import('./pages/MemoryPage').then(m => ({ default: m.MemoryPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then(m => ({ default: m.SkillsPage })));
const McpServersPage = lazy(() => import('./pages/McpServersPage').then(m => ({ default: m.McpServersPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })));

export function App() {
  const Router = shouldUseHashRouter() ? HashRouter : BrowserRouter;

  return (
    <Router basename={APP_BASE === '/' ? undefined : APP_BASE}>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Suspense fallback={null}><LoginPage /></Suspense>} />
        <Route path="/register" element={<Suspense fallback={null}><RegisterPage /></Suspense>} />
        <Route path="/setup" element={<Suspense fallback={null}><SetupPage /></Suspense>} />
        <Route
          path="/setup/providers"
          element={
            <AuthGuard>
              <Suspense fallback={null}><SetupProvidersPage /></Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/setup/channels"
          element={
            <AuthGuard>
              <Suspense fallback={null}><SetupChannelsPage /></Suspense>
            </AuthGuard>
          }
        />

        {/* Protected Routes with Layout */}
        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          <Route path="/chat/:groupFolder?" element={<Suspense fallback={null}><ChatPage /></Suspense>} />
          <Route path="/workbench" element={<Suspense fallback={null}><WorkbenchPage /></Suspense>} />
          <Route path="/groups" element={<Navigate to="/settings?tab=groups" replace />} />
          <Route path="/tasks" element={<Suspense fallback={null}><TasksPage /></Suspense>} />
          <Route path="/todos" element={<Navigate to="/workbench" replace />} />
          <Route path="/decision-center" element={<Navigate to="/workbench" replace />} />
          <Route path="/monitor" element={<Suspense fallback={null}><MonitorPage /></Suspense>} />
          <Route path="/memory" element={<Suspense fallback={null}><MemoryPage /></Suspense>} />
          <Route path="/skills" element={<Suspense fallback={null}><SkillsPage /></Suspense>} />
          <Route path="/mcp-servers" element={<Suspense fallback={null}><McpServersPage /></Suspense>} />
          <Route path="/settings" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
          <Route
            path="/users"
            element={
              <AuthGuard requiredAnyPermissions={['manage_users', 'manage_invites', 'view_audit_log']}>
                <Suspense fallback={null}><UsersPage /></Suspense>
              </AuthGuard>
            }
          />
        </Route>

        {/* Default redirect — go through AuthGuard to detect setup state */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </Router>
  );
}
