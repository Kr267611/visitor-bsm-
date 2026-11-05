import type { Role } from '@visitor/shared';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DevicesPanel } from '../admin/DevicesPanel';
import { SitesPage } from '../admin/SitesPage';
import { UsersPage } from '../admin/UsersPage';
import { useAuth } from '../auth/AuthProvider';
import { LoginPage } from '../auth/LoginPage';
import { homeFor, RequireRole } from '../auth/RequireRole';
import { DeskPage } from '../desk/DeskPage';
import { ApprovalPage } from '../host/ApprovalPage';
import { DelegateSetting } from '../host/DelegateSetting';
import { InviteForm } from '../host/InviteForm';
import { MyVisitsPage } from '../host/MyVisitsPage';
import { Layout } from '../ui/Layout';
import { InvitePage } from '../visitor/InvitePage';
import { PrivacyPage } from '../visitor/PrivacyPage';

const ALL_ROLES: Role[] = ['guard', 'employee', 'reception', 'security', 'admin'];

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

const Allow = ({ roles }: { roles: Role[] }) => (
  <RequireRole roles={roles}>
    <Outlet />
  </RequireRole>
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v/:token" element={<InvitePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      {/* Side menu ek hi baar banta hai, sirf andar ka page badalta hai. */}
      <Route
        element={
          <RequireRole roles={ALL_ROLES}>
            <Layout />
          </RequireRole>
        }
      >
        <Route path="/desk" element={<Allow roles={['reception', 'security', 'guard', 'admin']} />}>
          <Route index element={<Navigate to="pending" replace />} />
          <Route path="pending" element={<DeskPage key="pending" section="pending" />} />
          <Route path="expected" element={<DeskPage key="expected" section="expected" />} />
          <Route path="inside" element={<DeskPage key="inside" section="inside" />} />
        </Route>
        <Route path="/my" element={<Allow roles={['employee', 'reception', 'security', 'admin']} />}>
          <Route index element={<MyVisitsPage />} />
          <Route path="invite" element={<InviteForm />} />
          <Route path="backup" element={<DelegateSetting />} />
          <Route path="visits/:id" element={<ApprovalPage />} />
        </Route>
        <Route path="/admin/devices" element={<Allow roles={['admin', 'security']} />}>
          <Route index element={<DevicesPanel />} />
        </Route>
        <Route path="/admin" element={<Allow roles={['admin']} />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="sites" element={<SitesPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Home />} />
      <Route path="*" element={<p className="page-message">Yeh page nahi mila.</p>} />
    </Routes>
  );
}
