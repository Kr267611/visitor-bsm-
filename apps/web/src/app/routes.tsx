import type { Module, Role } from '@visitor/shared';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DevicesPanel } from '../admin/DevicesPanel';
import { DepartmentsPage } from '../admin/DepartmentsPage';
import { DesignationsPage } from '../admin/DesignationsPage';
import { PremisesPage } from '../admin/PremisesPage';
import { PremisesPosterPage } from '../admin/PremisesPosterPage';
import { UsersPage } from '../admin/UsersPage';
import { useAuth } from '../auth/AuthProvider';
import { LoginPage } from '../auth/LoginPage';
import { PasswordPage } from '../auth/PasswordPage';
import { homeForModules, RequireModule, useModules } from '../auth/RequireModule';
import { RequireRole } from '../auth/RequireRole';
import { DashboardPage } from '../desk/DashboardPage';
import { DeskPage } from '../desk/DeskPage';
import { ApprovalPage } from '../host/ApprovalPage';
import { DelegateSetting } from '../host/DelegateSetting';
import { InviteForm } from '../host/InviteForm';
import { MyVisitsPage } from '../host/MyVisitsPage';
import { Layout } from '../ui/Layout';
import { InvitePage } from '../visitor/InvitePage';
import { PrivacyPage } from '../visitor/PrivacyPage';
import { SelfCheckInPage } from '../visitor/SelfCheckInPage';

const ALL_ROLES: Role[] = ['guard', 'employee', 'reception', 'security', 'admin'];

/** The super admin platform panel comes later; the web app only shows this notice for now. */
function PlatformHome() {
  const { logout } = useAuth();
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Platform admin</h1>
        <p className="muted">The plans and businesses panel is coming soon. For now, this is managed through the API.</p>
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </main>
  );
}

/** Sends each person to the first page their modules allow. */
function Home() {
  const { user } = useAuth();
  const { modules, ready } = useModules();
  if (!user) return <Navigate to="/login" replace />;
  if (!ready && user.role !== 'super_admin') return null;
  return <Navigate to={homeForModules(user.role, modules)} replace />;
}

const Allow = ({ module }: { module: Module }) => (
  <RequireModule module={module}>
    <Outlet />
  </RequireModule>
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v/:token" element={<InvitePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      {/* Premises QR poster: visitors check themselves in. */}
      <Route path="/p/:business/:premises" element={<SelfCheckInPage />} />
      <Route
        path="/admin/premises/:id/poster"
        element={
          <RequireModule module="premises">
            <PremisesPosterPage />
          </RequireModule>
        }
      />
      <Route
        path="/platform"
        element={
          <RequireRole roles={['super_admin']}>
            <PlatformHome />
          </RequireRole>
        }
      />

      {/* The side menu is rendered once; only the page inside changes. */}
      <Route
        element={
          <RequireRole roles={ALL_ROLES}>
            <Layout />
          </RequireRole>
        }
      >
        <Route path="/dashboard" element={<Allow module="desk" />}>
          <Route
            index
            element={
              <RequireRole roles={['admin', 'reception', 'security']}>
                <DashboardPage />
              </RequireRole>
            }
          />
        </Route>
        <Route path="/desk" element={<Allow module="desk" />}>
          <Route index element={<Navigate to="pending" replace />} />
          <Route path="pending" element={<DeskPage key="pending" section="pending" />} />
          <Route path="expected" element={<DeskPage key="expected" section="expected" />} />
          <Route path="inside" element={<DeskPage key="inside" section="inside" />} />
        </Route>
        <Route path="/my" element={<Allow module="visitors" />}>
          <Route index element={<MyVisitsPage />} />
          <Route path="invite" element={<InviteForm />} />
          <Route path="backup" element={<DelegateSetting />} />
          <Route path="visits/:id" element={<ApprovalPage />} />
        </Route>
        <Route path="/admin/devices" element={<Allow module="devices" />}>
          <Route index element={<DevicesPanel />} />
        </Route>
        <Route path="/account/password" element={<PasswordPage />} />
        <Route path="/admin">
          <Route index element={<Navigate to="/" replace />} />
          <Route element={<Allow module="users" />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route element={<Allow module="premises" />}>
            <Route path="premises" element={<PremisesPage />} />
          </Route>
          <Route element={<Allow module="departments" />}>
            <Route path="departments" element={<DepartmentsPage />} />
            <Route path="designations" element={<DesignationsPage />} />
          </Route>
          {/* Old bookmarks. */}
          <Route path="members" element={<Navigate to="/admin/users" replace />} />
          <Route path="sites" element={<Navigate to="/admin/premises" replace />} />
        </Route>
      </Route>

      <Route path="/" element={<Home />} />
      <Route path="*" element={<p className="page-message">Page not found.</p>} />
    </Routes>
  );
}
