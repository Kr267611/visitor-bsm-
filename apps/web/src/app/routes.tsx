import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { LoginPage } from '../auth/LoginPage';
import { homeFor, RequireRole } from '../auth/RequireRole';
import { DeskPage } from '../desk/DeskPage';
import { ApprovalPage } from '../host/ApprovalPage';
import { InviteForm } from '../host/InviteForm';
import { MyVisitsPage } from '../host/MyVisitsPage';
import { Layout } from '../ui/Layout';
import { InvitePage } from '../visitor/InvitePage';
import { PrivacyPage } from '../visitor/PrivacyPage';

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v/:token" element={<InvitePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route
        path="/desk"
        element={
          <RequireRole roles={['reception', 'security', 'guard', 'admin']}>
            <Layout>
              <DeskPage />
            </Layout>
          </RequireRole>
        }
      />
      <Route
        path="/my/*"
        element={
          <RequireRole roles={['employee', 'reception', 'security', 'admin']}>
            <Layout>
              <Routes>
                <Route index element={<MyVisitsPage />} />
                <Route path="invite" element={<InviteForm />} />
                <Route path="visits/:id" element={<ApprovalPage />} />
              </Routes>
            </Layout>
          </RequireRole>
        }
      />
      <Route
        path="/admin/*"
        element={
          <RequireRole roles={['admin']}>
            <Layout>
              <h1>Admin</h1>
            </Layout>
          </RequireRole>
        }
      />
      <Route path="/" element={<Home />} />
      <Route path="*" element={<p className="page-message">Yeh page nahi mila.</p>} />
    </Routes>
  );
}
