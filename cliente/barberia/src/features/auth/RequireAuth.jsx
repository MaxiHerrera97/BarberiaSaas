import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";

export default function RequireAuth({ children, allowedRoles = null }) {
  const location = useLocation();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-sm text-zinc-400">
        Verificando sesión...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}
