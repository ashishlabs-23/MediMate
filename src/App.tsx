import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useAuth } from './hooks/useAuth';
import { LoginScreen } from './components/auth/LoginScreen';
import { CompleteProfileGate, EmailVerificationGate, requiresEmailVerification } from './components/auth/AuthGates';
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

export function RequireAuth({
  children,
  requiredRole,
}: {
  children: ReactNode;
  requiredRole?: 'elderly' | 'caregiver';
}) {
  const { firebaseUser, isLoading, userProfile, isDemo } = useAuthContext();
  const location = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!firebaseUser) {
    try {
      const searchParams = new URLSearchParams(location.search);
      const code = searchParams.get('code') || searchParams.get('invite');
      if (code) {
        sessionStorage.setItem('medimate_pending_invite_code', code);
      }
    } catch {
      // Ignore storage errors
    }
    return <Navigate to="/login" replace />;
  }
  if (!isDemo && requiresEmailVerification(firebaseUser)) {
    return <Navigate to="/verify-email" replace />;
  }
  if (!isDemo && userProfile?.username === '') {
    return <Navigate to="/complete-profile" replace />;
  }
  if (
    requiredRole &&
    !isDemo &&
    userProfile?.role &&
    userProfile.role !== 'dual' &&
    userProfile.role !== requiredRole
  ) {
    return (
      <Navigate
        to={userProfile.role === 'caregiver' ? '/app/caregiver' : '/app/today'}
        replace
      />
    );
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

function LoginRoute() {
  const { firebaseUser, userProfile, isLoading } = useAuthContext();

  if (isLoading) return <LoadingScreen />;
  if (firebaseUser) {
    return <Navigate to={userProfile?.role === 'caregiver' ? '/app/caregiver' : '/app/today'} replace />;
  }

  return <LoginScreen />;
}

function JoinRoute() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') || searchParams.get('invite') || '';
  if (code) {
    try {
      sessionStorage.setItem('medimate_pending_invite_code', code);
    } catch {
      // Ignore storage errors
    }
  }
  const target = code ? `/app/caregiver?code=${encodeURIComponent(code)}` : '/app/caregiver';
  return <Navigate to={target} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/welcome" element={<LandingPage />} />
      <Route path="/join" element={<JoinRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/verify-email" element={<EmailVerificationGate />} />
      <Route path="/complete-profile" element={<CompleteProfileGate />} />
      <Route
        path="/app/today"
        element={
          <RequireAuth requiredRole="elderly">
            <TodayView />
          </RequireAuth>
        }
      />
      <Route
        path="/app/caregiver"
        element={
          <RequireAuth requiredRole="caregiver">
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
    <ThemeProvider>
      <AuthProvider value={authValue}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
