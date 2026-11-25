import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './components/auth/LoginScreen';
import { LandingPage } from './pages/LandingPage';
import { TodayView } from './pages/TodayView';
import { CaregiverDashboard } from './pages/CaregiverDashboard';

function LoadingScreen() {
  return (
    <main
      role="main"
      className="min-h-screen bg-canvas flex items-center justify-center p-6"
    >
      <div
        role="status"
        aria-live="polite"
        className="text-center text-ink-secondary text-lg font-medium"
      >
        Loading MediMate…
      </div>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { firebaseUser, isLoading } = useAuthContext();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function LandingRoute() {
  const { firebaseUser, userProfile, isLoading } = useAuthContext();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (firebaseUser) {
    if (userProfile?.role === 'caregiver') {
      return <Navigate to="/app/caregiver" replace />;
    }
    return <Navigate to="/app/today" replace />;
  }

  return <LandingPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/welcome" element={<LandingPage />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route
        path="/app/today"
        element={
          <RequireAuth>
            <TodayView />
          </RequireAuth>
        }
      />
      <Route
        path="/app/caregiver"
        element={
          <RequireAuth>
            <CaregiverDashboard />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const authValue = useAuth();

  return (
    <AuthProvider value={authValue}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
