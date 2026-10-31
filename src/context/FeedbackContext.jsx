import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Modal from "../components/ui/Modal";

/**
 * App-wide confirm dialogs and toast messages, replacing window.confirm()
 * and alert() (which block the page and look different in every browser).
 *
 *   const { confirm, toast } = useFeedback();
 *   if (await confirm({ title: "Stop drying?", confirmLabel: "Stop", danger: true })) ...
 *   toast.success("Saved");
 */
const FeedbackContext = createContext(null);

const TOAST_ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolver = useRef(null);
  const nextId = useRef(0);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setDialog({ confirmLabel: "Confirm", cancelLabel: "Cancel", ...options });
      }),
    [],
  );

  const closeDialog = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setDialog(null);
  }, []);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (type, message, timeout = type === "error" ? 8000 : 4500) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((list) => [...list.slice(-3), { id, type, message }]);
      setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  const toast = useMemo(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      warning: (m) => push("warning", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <Modal
        open={Boolean(dialog)}
        title={dialog?.title}
        onClose={() => closeDialog(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => closeDialog(false)}>
              {dialog?.cancelLabel}
            </button>
            <button
              type="button"
              className={`btn ${dialog?.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => closeDialog(true)}
              autoFocus
            >
              {dialog?.confirmLabel}
            </button>
          </>
        }
      >
        {typeof dialog?.message === "string" ? <p>{dialog.message}</p> : dialog?.message}
      </Modal>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => {
          const Icon = TOAST_ICONS[t.type];
          return (
            <div key={t.id} className={`toast toast-${t.type}`} role={t.type === "error" ? "alert" : "status"}>
              <Icon size={18} aria-hidden />
              <span>{t.message}</span>
              <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return context;
}
