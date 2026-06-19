import React, { createContext, useContext, useState, useCallback, useRef } from "react";

interface Toast {
  id: number;
  message: string;
  type: "error" | "success" | "info";
  exiting: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: "error" | "success" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const showToast = useCallback((message: string, type: "error" | "success" | "info" = "error") => {
    const id = nextIdRef.current++;
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);

    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 3700);
  }, []);

  const typeStyles: Record<string, React.CSSProperties> = {
    error: { background: "rgba(220, 38, 38, 0.92)", borderLeft: "4px solid #dc2626" },
    success: { background: "rgba(22, 163, 74, 0.92)", borderLeft: "4px solid #16a34a" },
    info: { background: "rgba(0, 52, 92, 0.95)", borderLeft: "4px solid #45AFFF" },
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              ...typeStyles[t.type],
              color: "#fff",
              padding: "10px 18px",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "Roboto Mono, monospace",
              fontWeight: 600,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              maxWidth: 380,
              opacity: t.exiting ? 0 : 1,
              transform: t.exiting ? "translateX(30px)" : "translateX(0)",
              transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
              animation: t.exiting ? "none" : "toastSlideIn 0.35s ease-out",
              backdropFilter: "blur(8px)",
              pointerEvents: "auto",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
