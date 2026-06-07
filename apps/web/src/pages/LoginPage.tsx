import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      void navigate("/", { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="text-center">
          <div className="text-lg font-bold tracking-tight text-indigo-400">⚡ DankoDeploy</div>
          <p className="mt-1 text-sm text-slate-400">Вход в панель управления</p>
        </div>
        <div>
          <label className="label">Пароль</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {login.isError && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
            {(login.error).message}
          </div>
        )}
        <button className="btn-primary w-full" disabled={login.isPending || !password}>
          {login.isPending ? <Spinner /> : "Войти"}
        </button>
      </form>
    </div>
  );
}
