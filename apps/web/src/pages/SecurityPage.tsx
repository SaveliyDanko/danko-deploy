import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error.message}</div>;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = () => {
    void navigator.clipboard.writeText(codes.join("\n"));
  };

  return (
    <section className="card space-y-4 border-amber-500/40">
      <div>
        <h2 className="text-lg font-semibold text-amber-300">Сохраните резервные коды</h2>
        <p className="mt-1 text-sm text-slate-400">
          Каждый код работает только один раз. Они больше не будут показаны — храните их отдельно от
          устройства с Google Authenticator.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-200 sm:grid-cols-2">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={copy}>
          Копировать
        </button>
        <button className="btn-primary" onClick={onDone}>
          Я сохранил коды
        </button>
      </div>
    </section>
  );
}

export function SecurityPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: api.me });
  const status = useQuery({ queryKey: ["auth", "two-factor"], queryFn: api.twoFactorStatus });
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [actionPassword, setActionPassword] = useState("");
  const [actionCode, setActionCode] = useState("");

  const setup = useMutation({
    mutationFn: () => api.beginTwoFactorSetup(setupPassword),
    onSuccess: () => {
      setConfirmPassword(setupPassword);
      setSetupPassword("");
      void qc.invalidateQueries({ queryKey: ["auth", "two-factor"] });
    },
  });
  const cancel = useMutation({
    mutationFn: api.cancelTwoFactorSetup,
    onSuccess: () => {
      setup.reset();
      void qc.invalidateQueries({ queryKey: ["auth", "two-factor"] });
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.confirmTwoFactorSetup(confirmPassword, confirmCode),
    onSuccess: () => {
      setConfirmPassword("");
      setConfirmCode("");
      void qc.invalidateQueries({ queryKey: ["auth", "two-factor"] });
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
  const disable = useMutation({
    mutationFn: () => api.disableTwoFactor(actionPassword, actionCode),
    onSuccess: () => {
      setActionPassword("");
      setActionCode("");
      void qc.invalidateQueries({ queryKey: ["auth", "two-factor"] });
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
  const regenerate = useMutation({
    mutationFn: () => api.regenerateRecoveryCodes(actionPassword, actionCode),
    onSuccess: () => {
      setActionPassword("");
      setActionCode("");
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });

  const recoveryCodes = confirm.data?.recoveryCodes ?? regenerate.data?.recoveryCodes;
  if (recoveryCodes) {
    return (
      <RecoveryCodes
        codes={recoveryCodes}
        onDone={() => {
          confirm.reset();
          regenerate.reset();
        }}
      />
    );
  }

  if (status.isLoading || me.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!me.data?.authRequired) {
    return (
      <section className="card max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">Безопасность</h1>
        <p className="text-sm text-amber-300">
          Сначала включите вход по паролю через DANKODEPLOY_AUTH_PASSWORD_HASH. Без парольной
          аутентификации второй фактор недоступен.
        </p>
      </section>
    );
  }

  if (status.data?.enabled) {
    return (
      <div className="max-w-2xl space-y-5">
        <section className="card space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-xl">✓</span>
            <div>
              <h1 className="text-xl font-semibold text-emerald-300">
                Двухфакторная защита включена
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                При каждом новом входе нужен пароль и одноразовый код Google Authenticator.
              </p>
            </div>
          </div>
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Управление 2FA</h2>
            <p className="mt-1 text-sm text-slate-400">
              Подтвердите действие паролем и текущим кодом приложения или recovery-кодом.
            </p>
          </div>
          <div>
            <label className="label">Пароль</label>
            <input
              className="input"
              type="password"
              value={actionPassword}
              onChange={(e) => setActionPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Одноразовый код</label>
            <input
              className="input font-mono tracking-widest"
              autoComplete="one-time-code"
              value={actionCode}
              onChange={(e) => setActionCode(e.target.value)}
              placeholder="123456 или recovery-код"
            />
          </div>
          <ErrorMessage error={disable.error ?? regenerate.error} />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={!actionPassword || !actionCode || regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {regenerate.isPending ? <Spinner /> : "Новые резервные коды"}
            </button>
            <button
              className="btn-danger"
              disabled={!actionPassword || !actionCode || disable.isPending}
              onClick={() => disable.mutate()}
            >
              {disable.isPending ? <Spinner /> : "Отключить 2FA"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <section className="card space-y-3">
        <h1 className="text-xl font-semibold">Двухфакторная защита</h1>
        <p className="text-sm text-slate-400">
          После подключения для входа понадобятся пароль и шестизначный код из Google Authenticator
          или другого TOTP-приложения.
        </p>
      </section>

      {!setup.data ? (
        <form
          className="card space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <div>
            <label className="label">Текущий пароль</label>
            <input
              className="input"
              type="password"
              value={setupPassword}
              onChange={(e) => setSetupPassword(e.target.value)}
            />
          </div>
          {status.data?.pendingSetup && (
            <p className="text-xs text-amber-300">
              Незавершённая настройка будет заменена новым секретом.
            </p>
          )}
          <ErrorMessage error={setup.error} />
          <button className="btn-primary" disabled={!setupPassword || setup.isPending}>
            {setup.isPending ? <Spinner /> : "Подключить приложение"}
          </button>
        </form>
      ) : (
        <section className="card space-y-5">
          <div className="grid gap-5 sm:grid-cols-[240px_1fr]">
            <img
              className="rounded-lg bg-white"
              src={setup.data.qrCodeDataUrl}
              alt="QR-код для Google Authenticator"
              width={240}
              height={240}
            />
            <div className="space-y-3 text-sm text-slate-300">
              <p>1. Откройте Google Authenticator и нажмите «Добавить аккаунт».</p>
              <p>2. Отсканируйте QR-код. Если камера недоступна, введите ключ вручную:</p>
              <code className="block break-all rounded-lg bg-slate-950 p-3 text-xs text-indigo-300">
                {setup.data.secret}
              </code>
              <p>3. Введите появившийся шестизначный код ниже.</p>
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate();
            }}
          >
            <div>
              <label className="label">Текущий пароль</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Код из приложения</label>
              <input
                className="input font-mono tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <ErrorMessage error={confirm.error} />
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={!confirmPassword || !confirmCode || confirm.isPending}
              >
                {confirm.isPending ? <Spinner /> : "Подтвердить и включить"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Отмена
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
