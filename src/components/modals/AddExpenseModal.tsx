import { useState, useRef, useId } from "react";
import { Check, Loader2, AlertCircle, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatDate, isSameLocalDay, startOfDay } from "@/lib/utils";
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase } from "@/lib/ui";
import { checkAmount } from "@/lib/amount";
import { useSubmitEntry } from "@/hooks/useSubmitEntry";
import { useEntryHistory } from "@/hooks/useEntryHistory";
import { queuedToast } from "./submitToasts";
import { useToast } from "@/components/shared/Toast";
import { NOTE_MAX } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import {
  forgetExpenseTitle,
  recordExpenseTitle,
  restoreExpenseTitle,
  suggestExpenseTitles,
} from "@/lib/entryHistory";
import Sheet, { SheetBody, SheetFooter, SheetHeader } from "@/components/shared/Sheet";
import AmountInput from "@/components/shared/AmountInput";
import DateField from "@/components/shared/DateField";
import SuggestionChips from "@/components/shared/SuggestionChips";
import { EXPENSE_QUICK_AMOUNTS, expenseDateFor } from "@/lib/expenseDate";

interface AddExpenseModalProps {
  onClose: () => void;
}

interface ExpenseInput {
  amount: number;
  expenseDate: number;
  note?: string;
}

export default function AddExpenseModal({ onClose }: AddExpenseModalProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dayMs, setDayMs] = useState(() => startOfDay());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { submitExpense: submitEntry } = useSubmitEntry();
  const { userId, history } = useEntryHistory();
  const { showToast } = useToast();
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestExpenseTitles(history.expenses, note);

  const close = () => {
    if (!saving) onClose();
  };

  /** Chip tap: fill title + last amount (explicit, so it overwrites a typed amount). */
  const pickSuggestion = (title: string) => {
    const entry = suggestions.find((s) => s.title === title);
    if (!entry) return;
    setNote(entry.title.slice(0, NOTE_MAX));
    setAmount(String(entry.lastAmount));
    setError(null);
    // Land on the amount with its text selected: confirm, or type over it.
    requestAnimationFrame(() => {
      amountRef.current?.focus();
      amountRef.current?.select();
    });
  };

  const forgetSuggestion = (title: string) => {
    const removed = forgetExpenseTitle(userId, title);
    if (!removed) return;
    showToast(`Removed "${removed.title}"`, "info", {
      action: { label: "Undo", onAction: () => restoreExpenseTitle(userId, removed) },
    });
  };

  /** The one place this sheet writes: server, or this phone's outbox when offline. */
  const submitExpense = (input: ExpenseInput) =>
    submitEntry({
      amount: input.amount,
      expenseDate: input.expenseDate,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const check = checkAmount(amount, "expense amount");
    if (!check.ok) {
      setError(check.message);
      amountRef.current?.focus();
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const title = note.trim();
      const outcome = await submitExpense({
        amount: check.value,
        expenseDate: expenseDateFor(dayMs),
        note: title || undefined,
      });
      // Saved on the server or on this phone: either way the entry is kept.
      recordExpenseTitle(userId, title, check.value);
      if (outcome.status === "saved") {
        showToast(
          isSameLocalDay(dayMs, Date.now()) ? "Expense saved" : `Expense saved for ${formatDate(dayMs)}`,
          "success",
        );
      } else {
        const t = queuedToast(outcome.problem);
        showToast(t.message, t.type);
      }
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Could not save expense. Please try again."));
      showToast(getErrorMessage(e, "Could not save expense."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} initialFocusRef={amountRef}>
      <SheetHeader
        titleId={titleId}
        title="Add expense"
        subtitle={<>Money you spent · <span className="font-semibold text-foreground">{formatDate(dayMs)}</span></>}
        icon={<Receipt size={18} />}
        iconClassName="bg-negative/10 text-negative"
        onClose={close}
        closeDisabled={saving}
      />

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
        <SheetBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="expense-amount" className={fieldLabel}>
              How much did you spend?
            </label>
            <AmountInput
              id="expense-amount"
              inputRef={amountRef}
              size="lg"
              tone="negative"
              value={amount}
              onChange={(v) => {
                setAmount(v);
                setError(null);
              }}
              invalid={Boolean(error)}
              disabled={saving}
              aria-label="Expense amount in PKR"
              aria-describedby={error ? "expense-amount-err" : undefined}
              quickAmounts={EXPENSE_QUICK_AMOUNTS}
            />
            {error && (
              <motion.p
                id="expense-amount-err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={fieldError}
                role="alert"
              >
                <AlertCircle size={16} className="shrink-0" /> {error}
              </motion.p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="expense-note" className={fieldLabel}>
              What was it for? <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="expense-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. electricity, rent"
              maxLength={NOTE_MAX}
              autoComplete="off"
              disabled={saving}
              aria-label="Expense note (optional)"
              className={inputBase}
            />
            <SuggestionChips
              items={suggestions.map((s) => s.title)}
              query={note}
              onPick={pickSuggestion}
              onRemove={forgetSuggestion}
              disabled={saving}
              aria-label={note.trim() ? "Matching expenses" : "Recent expenses"}
            />
          </div>

          <DateField
            label="Expense date"
            value={dayMs}
            onChange={setDayMs}
            disabled={saving}
            hint="Leave as Today unless you forgot to add it earlier."
          />
        </SheetBody>

        <SheetFooter>
          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, "flex-1")}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={cn(btnPrimary, "flex-2")}>
              {saving ? (
                <>
                  <Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…
                </>
              ) : (
                <>
                  <Check size={18} /> Add expense
                </>
              )}
            </button>
          </div>
        </SheetFooter>
      </form>
    </Sheet>
  );
}
