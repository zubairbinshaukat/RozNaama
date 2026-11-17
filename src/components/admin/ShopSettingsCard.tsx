import { useId, useState, type ReactNode } from 'react'
import { BookOpenText, CloudOff, Loader2 } from 'lucide-react'
import { useToast } from '@/components/shared/Toast'
import { useAdminUserSettings, useSetAdminUserSettings, type AdminShopSettings } from '@/hooks/useAdmin'
import { getErrorMessage } from '@/lib/errors'
import { ADVANCE_CHOICES, KHATA_SETTINGS_COPY as T, UDHAAR_CHOICES, type RecognitionChoice as Choice } from '@/lib/khataSettingsCopy'
import { useBrowserOnline } from '@/lib/network'
import { cn } from '@/lib/utils'

type Recognition = AdminShopSettings['advanceRecognition']
type Patch = Partial<Pick<AdminShopSettings, 'khataEnabled' | 'advanceRecognition' | 'udhaarRecognition'>>
type Field = keyof Patch

function ChoiceGroup({
  label,
  choices,
  value,
  disabled,
  busy,
  onChange,
}: {
  label: string
  choices: readonly Choice[]
  value: Recognition
  disabled: boolean
  busy: boolean
  onChange: (v: Recognition) => void
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby={labelId}>
      <p id={labelId} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {label}
        {busy && <Loader2 size={14} className="animate-[spin_1s_linear_infinite] text-muted-foreground" aria-hidden />}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {choices.map((c) => {
          const on = c.value === value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => { if (!on) onChange(c.value) }}
              className={cn(
                'min-h-11 text-left rounded-2xl border px-3 py-2.5 flex items-start gap-2.5 active:scale-[0.97] transition-all disabled:opacity-50 disabled:active:scale-100',
                on ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-card hover:bg-muted/50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 w-4.5 h-4.5 rounded-full border-2 shrink-0 flex items-center justify-center',
                  on ? 'border-primary' : 'border-border',
                )}
                aria-hidden
              >
                {on && <span className="w-2 h-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-foreground leading-tight">
                  {c.title}
                  {c.recommended && <span className="ml-1.5 text-[11px] font-semibold text-primary">{T.recommendedTag}</span>}
                </span>
                <span className="text-[12px] text-muted-foreground leading-snug">{c.example}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="shop-settings-heading" className="rounded-3xl border border-border/70 bg-card shadow-card p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden>
          <BookOpenText size={18} />
        </span>
        <h2 id="shop-settings-heading" className="text-base font-bold text-foreground">Shop settings</h2>
      </div>
      {children}
    </section>
  )
}

/** Admin: change one user's Advance & Udhaar settings (saved on each tap; online only). */
export default function ShopSettingsCard({ userId, name }: { userId: string; name: string }) {
  const settings = useAdminUserSettings(userId)
  const setSettings = useSetAdminUserSettings()
  const online = useBrowserOnline()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<Field | null>(null)
  const switchId = useId()

  if (settings === undefined) {
    return (
      <Frame>
        <div className="flex flex-col gap-3" aria-hidden data-testid="shop-settings-skeleton">
          <div className="skeleton h-12 rounded-2xl" />
          <div className="skeleton h-3 w-40 rounded-full" />
        </div>
      </Frame>
    )
  }
  if (settings === null) return null

  const save = async (field: Field, patch: Patch) => {
    setBusy(field)
    try {
      await setSettings({ userId, ...patch })
      showToast(T.savedFor(name), 'success')
    } catch (e) {
      showToast(getErrorMessage(e, T.saveFailed), 'error')
    } finally {
      setBusy(null)
    }
  }
  const locked = !online || busy !== null
  const enabled = settings.khataEnabled

  return (
    <Frame>
      {!online && (
        <p className="flex items-start gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm font-medium text-muted-foreground">
          <CloudOff size={16} className="shrink-0 mt-0.5" aria-hidden />
          {T.offline}
        </p>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p id={switchId} className="text-[15px] font-semibold text-foreground">{T.featureName}</p>
          <p className="text-[13px] text-muted-foreground leading-snug">{T.description}</p>
        </div>
        {busy === 'khataEnabled' && <Loader2 size={18} className="animate-[spin_1s_linear_infinite] text-muted-foreground shrink-0" aria-hidden />}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={switchId}
          disabled={locked}
          onClick={() => void save('khataEnabled', { khataEnabled: !enabled })}
          className={cn(
            'relative shrink-0 w-14 h-8 rounded-full transition-colors active:scale-[0.97] disabled:opacity-50',
            'before:absolute before:-inset-1.5 before:content-[""]', // ≥ 44px touch target
            enabled ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        >
          <span
            className={cn(
              'absolute top-1 left-1 w-6 h-6 rounded-full bg-card shadow transition-transform',
              enabled && 'translate-x-6',
            )}
            aria-hidden
          />
        </button>
      </div>

      {enabled && (
        <>
          <ChoiceGroup
            label={T.advanceLabel}
            choices={ADVANCE_CHOICES}
            value={settings.advanceRecognition}
            disabled={locked}
            busy={busy === 'advanceRecognition'}
            onChange={(v) => void save('advanceRecognition', { advanceRecognition: v })}
          />
          <ChoiceGroup
            label={T.udhaarLabel}
            choices={UDHAAR_CHOICES}
            value={settings.udhaarRecognition}
            disabled={locked}
            busy={busy === 'udhaarRecognition'}
            onChange={(v) => void save('udhaarRecognition', { udhaarRecognition: v })}
          />
        </>
      )}
      <p className="text-[12px] text-muted-foreground border-t border-border/60 pt-3">{T.footer}</p>
    </Frame>
  )
}
