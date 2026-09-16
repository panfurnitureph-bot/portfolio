import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { AccessDeniedPage } from '@/components/shared/AccessDeniedPage';
import { ADMIN_ONLY_ROUTES } from '@/lib/userPermissions';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'manager' | 'purchasing';
}

// Routes accessible to all authenticated+approved users regardless of permissions
const ALWAYS_ALLOWED = ['/dashboard', '/settings'];

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function RejectedScreen() {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md mx-auto p-6 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
        <h2 className="text-xl font-semibold text-foreground">Account Not Approved</h2>
        <p className="text-muted-foreground text-sm">
          Your account request has been rejected. Contact your administrator for assistance.
        </p>
        <Button variant="destructive" onClick={signOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

function ProfileErrorScreen() {
  const { user, profileError, retryProfile, signOut } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md mx-auto p-6 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
        <h2 className="text-xl font-semibold text-foreground">
          Profile Loading Error
        </h2>
        <p className="text-muted-foreground text-sm">
          {profileError?.message || 'We found your login session, but could not load your profile.'}
        </p>
        {user && (
          <p className="text-xs text-muted-foreground">
            Logged in as: {user.email}
          </p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" onClick={retryProfile} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          <Button variant="destructive" onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const {
    user,
    profile,
    authLoading,
    profileLoading,
    profileError,
    isPending,
    isRejected,
    isAdmin,
    aalLoading,
    needsMfaEnroll,
    needsMfaVerify,
  } = useAuth();
  const { checkCanAccessRoute, loading: permsLoading } = usePermissions();
  const location = useLocation();

  // 1. Auth still loading - show loading
  if (authLoading) {
    return <LoadingScreen message="Checking your session..." />;
  }

  // 2. No user after auth loaded - redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 3. Profile still loading — only block on initial load, not on refetch
  if (profileLoading && !profile) {
    return <LoadingScreen message="Loading your profile..." />;
  }

  // 4. Profile fetch failed - show error with retry/signout
  if (profileError || !profile) {
    return <ProfileErrorScreen />;
  }

  // 5. Profile loaded but rejected
  if (isRejected) {
    return <RejectedScreen />;
  }

  // 6. Profile loaded but pending
  if (isPending) {
    return <Navigate to="/pending-approval" replace />;
  }

  // 6b. MFA gate — every approved user (incl. admins) must reach aal2 (TOTP).
  //     No verified factor → enroll once; has factor but session is aal1 → verify.
  if (aalLoading) {
    return <LoadingScreen message="Checking security..." />;
  }
  if (needsMfaEnroll) {
    return <Navigate to="/mfa/enroll" replace />;
  }
  if (needsMfaVerify) {
    return <Navigate to="/mfa" replace />;
  }

  // 7. Admin bypasses all restrictions (check before permissions load)
  if (isAdmin) {
    return <>{children}</>;
  }

  const role = profile.role || '';
  const path = location.pathname;

  // Always-allowed routes (no permission check needed)
  if (ALWAYS_ALLOWED.some(r => path.startsWith(r)) || path === '/') {
    return <>{children}</>;
  }

  // Admin-only routes (non-admins blocked — admins already returned above)
  if (path.startsWith('/admin') || ADMIN_ONLY_ROUTES.has(path)) {
    return <AccessDeniedPage />;
  }

  // Permissions still loading — render nothing (no flash, no interrupt)
  if (permsLoading) {
    return null;
  }

  // Manager / Purchasing: check permissions
  if (role === 'manager' || role === 'purchasing') {
    if (checkCanAccessRoute(path)) {
      return <>{children}</>;
    }
    return <AccessDeniedPage />;
  }

  // No role / unknown role: dashboard only
  return <AccessDeniedPage />;
}
