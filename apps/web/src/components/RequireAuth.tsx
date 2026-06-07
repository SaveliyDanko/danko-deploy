import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { api } from "../lib/api.js";
import { Spinner } from "./ui.js";

/**
 * Гейт аутентификации: пока проверяем сессию — спиннер; если не залогинен и логин
 * требуется — редирект на /login. При выключенной аутентификации пропускает всех.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: api.me });

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (me.data && me.data.authRequired && !me.data.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
