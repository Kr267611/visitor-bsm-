import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { LoginPage } from '../auth/LoginPage';
import { homeFor, RequireRole } from '../auth/RequireRole';
import { Layout } from '../ui/Layout';

function MyVisitsPlaceholder() {
  const api = useApi();
  useQuery({ queryKey: ['visits', 'mine'], queryFn: () => api.visits.list() });
  return <h1>Mere visitors</h1>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/desk"
        element={
          <RequireRole roles={['reception', 'security', 'guard', 'admin']}>
            <Layout>
              <h1>Reception desk</h1>
            </Layout>
          </RequireRole>
        }
      />
      <Route
        path="/my/*"
        element={
          <RequireRole roles={['employee', 'reception', 'admin']}>
            <Layout>
              <MyVisitsPlaceholder />
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
