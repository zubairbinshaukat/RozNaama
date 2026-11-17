import { useId, useState } from 'react'
import { BookOpen, Check, Eye, Loader2, Settings } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import { useToast } from '@/components/shared/Toast'
import ConfirmModal from '@/components/modals/ConfirmModal'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import { useFormatMoney } from '@/context/amountVisibility'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useKhataTotals, useUpdateShopSettings } from '@/hooks/useKhata'
import { useCanEditOnline } from '@/hooks/useCanEditOnline'
import { getErrorMessage } from '@/lib/errors'
import type { Recognition } from '@/lib/khata'
import { ADVANCE_CHOICES, KHATA_SETTINGS_COPY as T, UDHAAR_CHOICES, type RecognitionChoice } from '@/lib/khataSettingsCopy'
import { cn } from '@/lib/utils'

type Change = { khataEnabled?: boolean; advanceRecognition?: Recognition; udhaarRecognition?: Recognition }

/** Account → Settings: the Advance & Udhaar switch and how it counts in sales. Online only; read-only in view-as. */
export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const switchId = useId()
  const { settings, khataOn } = useShopSettings()
  const totals = useKhataTotals()
  const update = useUpdateShopSettings()
  const readOnly = useIsViewingOtherSafe()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const formatMoney = useFormatMoney()
  const [saving, setSaving] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const disabled = readOnly || !canEdit || saving

  const save = async (change: Change, success: string) => {
    setSaving(true)
    try {
      await update(change)
      showToast(success, 'success')
    } catch (e) {
      showToast(getErrorMessage(e, T.saveFailed), 'error')
    } finally {
      setSaving(false)
      setConfirmOff(false)
    }
  }

  const openCount = (totals?.dueCount ?? 0) + (totals?.heldCount ?? 0)
  const toggle = () => {
    if (disabled) return
    if (!khataOn) { void save({ khataEnabled: true }, T.turnedOn); return }
    if (openCount > 0) { setConfirmOff(true); return }
    void save({ khataEnabled: false }, T.turnedOff)
  }

  return (
    <>
      <Sheet onClose={() => { if (!saving) onClose() }} dismissible={!saving} labelledBy={titleId} layer={540}>
        <SheetHeader titleId={titleId} title="Settings" icon={<Settings size={18} />} onClose={onClose} closeDisabled={saving} />
        <SheetBody className="flex flex-col gap-4">
          {readOnly && (
            <p role="status" className="flex items-start gap-2 rounded-2xl bg-warning/10 border border-warning/40 px-3.5 py-2.5 text-sm font-medium text-foreground">
              <Eye size={16} className="shrink-0 mt-0.5 text-warning" aria-hidden /> Viewing another user — settings are read-only.
            </p>
          )}
          {!readOnly && !canEdit && <OfflineEditNote />}

          <div className="flex items-center gap-3 rounded-3xl border border-border/70 px-4 py-3">
            <span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden>
              <BookOpen size={18} />
            </span>
            <span className="flex-1 min-w-0">
              <label htmlFor={switchId} className="block text-base font-bold text-foreground">{T.featureName}</label>
              <span className="block text-[13px] text-muted-foreground leading-snug">{T.description}</span>
            </span>
            <button
              id={switchId}
              type="button"
              role="switch"
              aria-checked={khataOn}
              disabled={disabled}
              onClick={toggle}
              className={cn(
                'relative w-14 h-11 shrink-0 flex items-center rounded-full px-1 transition-colors active:scale-[0.97] disabled:opacity-55',
                khataOn ? 'bg-primary justify-end' : 'bg-muted justify-start',
              )}
            >
              <span className="w-8 h-8 rounded-full bg-card shadow-card flex items-center justify-center" aria-hidden>
                {saving && <Loader2 size={16} className="animate-[spin_1s_linear_infinite] text-muted-foreground" />}
              </span>
            </button>
          </div>

          {khataOn && (
            <>
              <ChoiceGroup
                title={T.advanceLabel}
                options={ADVANCE_CHOICES}
                value={settings.advanceRecognition}
                disabled={disabled}
                onChange={(v) => void save({ advanceRecognition: v }, T.saved)}
              />
              <ChoiceGroup
                title={T.udhaarLabel}
                options={UDHAAR_CHOICES}
                value={settings.udhaarRecognition}
                disabled={disabled}
                onChange={(v) => void save({ udhaarRecognition: v }, T.saved)}
              />
            </>
          )}
        </SheetBody>
        <SheetFooter>
          <p className="text-[13px] text-muted-foreground text-center">{T.footer}</p>
        </SheetFooter>
      </Sheet>

      {confirmOff && (
        <ConfirmModal
          title={T.confirmOffTitle}
          message={T.confirmOffBody(openCount, formatMoney(totals?.dueTotal ?? 0))}
          confirmLabel={T.confirmOffAction}
          loading={saving}
          onConfirm={() => void save({ khataEnabled: false }, T.turnedOff)}
          onClose={() => setConfirmOff(false)}
        />
      )}
    </>
  )
}

function ChoiceGroup({ title, options, value, disabled, onChange }: {
  title: string
  options: readonly RecognitionChoice[]
  value: Recognition
  disabled: boolean
  onChange: (v: Recognition) => void
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-semibold text-foreground">{title}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2">
        {options.map((o) => {
          const checked = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => { if (!checked) onChange(o.value) }}
              className={cn(
                'flex items-start gap-3 min-h-14 px-4 py-3 rounded-2xl border text-left active:scale-[0.97] transition-all disabled:opacity-60',
                checked ? 'border-primary/50 bg-primary/8' : 'border-border/70 bg-card hover:bg-muted/40',
              )}
            >
              <span
                className={cn('mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}
                aria-hidden
              >
                {checked && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-foreground">
                  {o.title}
                  {o.recommended && <span className="ml-1.5 text-[11px] font-semibold text-primary">{T.recommendedTag}</span>}
                </span>
                <span className="block text-[13px] text-muted-foreground leading-snug">{o.example}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
