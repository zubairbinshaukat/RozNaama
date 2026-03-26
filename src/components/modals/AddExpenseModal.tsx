import { useState, useEffect, useRef } from "react";
import { X, Check, Loader2, AlertCircle, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useRecordExpense } from "@/hooks/useExpenses";
import { useToast } from "@/components/shared/Toast";
import { useVisualViewportBottomInset } from "@/hooks/useVisualViewportInset";

interface AddExpenseModalProps {
  onClose: () => void;
}

export default function AddExpenseModal({ onClose }: AddExpenseModalProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordExpense = useRecordExpense();
  const { showToast } = useToast();
  const keyboardInset = useVisualViewportBottomInset();
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, saving]);

  const validate = (): { ok: boolean; message?: string } => {
    const v = parseFloat(amount);
    if (isNaN(v) || v <= 0)
      return {
        ok: false,
        message: "Enter a valid expense amount greater than 0.",
      };
    return { ok: true };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const v = validate();
    if (!v.ok) {
      setError(v.message ?? "Invalid input.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const expenseAmount = parseFloat(amount);
      await recordExpense({
        amount: expenseAmount,
        expenseDate: Date.now(),
        note: note.trim() || undefined,
      });
      showToast("Expense added!", "success");
      onClose();
    } catch {
      setError("Could not save expense. Please try again.");
      showToast("Could not save expense.", "error");
    } finally {
      setSaving(false);
    }
  };

  const parsedAmount = parseFloat(amount);

  return (
    <div
      className="fixed inset-0 z-500 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-expense-title"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => {
          if (!saving) onClose();
        }}
        aria-hidden
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-md "
      >
        <div
          className="relative h-full bg-card border border-border/60 rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden pb-8"
          style={{
            boxShadow: `
              0 2px 4px rgba(0,0,0,0.02),
              0 8px 20px rgba(0,0,0,0.06),
              0 24px 60px rgba(0,0,0,0.08)
            `,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-destructive/10 flex items-center justify-center shrink-0">
              <Receipt
                size={18}
                className="text-destructive"
                strokeWidth={1.8}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="add-expense-title"
                className="text-base font-bold text-foreground tracking-tight"
              >
                Add Expense
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">For today</p>
            </div>
            <button
              onClick={() => {
                if (!saving) onClose();
              }}
              aria-label="Close"
              disabled={saving}
              className="p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-40"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="h-px bg-border/50 mx-5" />

          <form
            onSubmit={handleSubmit}
            className="flex flex-col flex-1 min-h-0"
          >
            <div
              className="overflow-y-auto px-4 py-4 flex flex-col gap-3 flex-1 overscroll-contain"
              style={{
                paddingBottom: `calc(1.25rem + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
              }}
            >
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-2xl px-4 py-3"
                  role="alert"
                >
                  <AlertCircle size={16} className="shrink-0" />
                  {error}
                </motion.div>
              )}

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="expense-amount"
                  className="text-sm font-semibold text-foreground"
                >
                  Amount (PKR){" "}
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                </label>
                <input
                  id="expense-amount"
                  ref={amountRef}
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                  placeholder="0"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label="Expense amount in PKR"
                  className={cn(
                    "h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground",
                    "placeholder:text-muted-foreground/50",
                    "focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all",
                    error && "border-destructive focus:ring-destructive/30",
                    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                  )}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="expense-note"
                  className="text-sm font-semibold text-foreground"
                >
                  Note{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <input
                  id="expense-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. fuel, electricity, purchase…"
                  maxLength={100}
                  aria-label="Expense note (optional)"
                  className="h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all"
                />
              </div>

              {!isNaN(parsedAmount) && parsedAmount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Expense total:{" "}
                  <span className="font-semibold text-destructive tabular-nums">
                    {formatCurrency(parsedAmount)}
                  </span>
                </p>
              )}
            </div>

            <div
              className="px-5 pt-4 shrink-0 flex justify-center items-center gap-3"
              style={{
                borderTop:
                  "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
              }}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (!saving) onClose();
                }}
                disabled={saving}
                className="h-10 rounded-xl active:scale-[0.97] transition-transform"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="h-10 rounded-xl bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97] transition-all"
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Check size={16} /> Add Expense
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
