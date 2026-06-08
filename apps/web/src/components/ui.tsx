import type { ReactNode } from "react";

import type { ServiceStatus } from "@dankodeploy/shared";

export function StatusBadge({ status }: { status: ServiceStatus | "success" | "failed" | "running" }) {
  const map: Record<string, string> = {
    running: "bg-emerald-500/15 text-emerald-400",
    success: "bg-emerald-500/15 text-emerald-400",
    stopped: "bg-rose-500/15 text-rose-400",
    failed: "bg-rose-500/15 text-rose-400",
    unknown: "bg-slate-500/15 text-slate-400",
  };
  const labels: Record<string, string> = {
    running: "работает",
    success: "успех",
    stopped: "остановлен",
    failed: "ошибка",
    unknown: "неизвестно",
  };
  return <span className={`badge ${map[status] ?? map.unknown}`}>{labels[status] ?? status}</span>;
}

/** Полоса заполнения (CPU/RAM/диск). */
export function MeterBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color =
    clamped > 85 ? "bg-rose-500" : clamped > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-slate-400">
          <span>{label}</span>
          <span>{clamped.toFixed(0)}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-edge">
        <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Модалка подтверждения опасного действия (замена нативного confirm()).
 * Тело — произвольное описание; кнопка подтверждения по умолчанию красная (danger).
 * Показывает ошибку и блокирует кнопки на время pending. onConfirm НЕ закрывает
 * модалку сам — закрытие делает вызывающий после успешной мутации.
 */
export function ConfirmModal({
  title,
  children,
  confirmLabel,
  tone = "danger",
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-slate-300">{children}</div>
        {error && (
          <div className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" disabled={pending} onClick={onClose}>
            Отмена
          </button>
          <button
            className={tone === "danger" ? "btn-danger" : "btn-primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner /> : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="card text-center text-sm text-slate-400">{text}</div>;
}
