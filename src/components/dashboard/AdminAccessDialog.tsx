import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from 'convex/react'
import { Users, X, Shield } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { useViewAs } from '@/context/ViewAsContext'
import { cn } from '@/lib/utils'
export default function AdminAccessDialog() {
  const { isClerkAdmin, viewAsName, isViewingOther, clearViewAs, setViewAs } = useViewAs()
  const [open, setOpen] = useState(false)
  const users = useQuery(api.users.listForAdmin, open ? {} : 'skip')

  if (!isClerkAdmin) return null

  const buttonLabel = isViewingOther && viewAsName ? viewAsName : 'Access'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold',
          'bg-primary/10 text-primary border border-primary/25',
          'hover:bg-primary/15 hover:border-primary/35',
          'active:scale-[0.97] transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isViewingOther && 'border-border/60 bg-muted/50 text-foreground hover:bg-muted/70',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Shield size={16} strokeWidth={2} className="shrink-0 opacity-90" />
        <span className="max-w-[10rem] sm:max-w-[14rem] truncate">{buttonLabel}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-access-title"
          style={{
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
            paddingTop: 'calc(1rem + env(safe-area-inset-top))',
          }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-lg"
          >
            <div
              className="relative h-full bg-card border border-border/60 rounded-3xl max-h-[85dvh] flex flex-col overflow-hidden"
              style={{
                boxShadow: `
                  0 2px 4px rgba(0,0,0,0.02),
                  0 8px 20px rgba(0,0,0,0.06),
                  0 24px 60px rgba(0,0,0,0.08)
                `,
              }}
            >
              <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Users size={18} className="text-primary" strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 id="admin-access-title" className="text-base font-bold text-foreground tracking-tight">
                    User access
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    View another account&apos;s dashboard (read-only)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              </div>

              <div className="h-px bg-border/50 mx-5 shrink-0" />

              <div className="overflow-y-auto flex-1 min-h-0 px-4 py-4 flex flex-col gap-3 overscroll-contain">
                {users === undefined && (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-[4.5rem] rounded-2xl border border-border/50 bg-muted/20 skeleton"
                      />
                    ))}
                  </div>
                )}

                {users !== undefined &&
                  users.map((u) => (
                    <button
                      key={u._id}
                      type="button"
                      onClick={() => {
                        setViewAs(u._id, u.name)
                        setOpen(false)
                      }}
                      className={cn(
                        'w-full text-left rounded-2xl border border-border/60 bg-card p-4',
                        'hover:bg-muted/40 hover:border-border active:scale-[0.99] transition-all duration-200',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      )}
                    >
                      <p className="font-semibold text-foreground truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate mt-1">{u.email}</p>
                    </button>
                  ))}

                {users !== undefined && users.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No users yet.</p>
                )}
              </div>

              {isViewingOther && (
                <>
                  <div className="h-px bg-border/50 mx-5 shrink-0" />
                  <div className="px-4 py-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        clearViewAs()
                        setOpen(false)
                      }}
                      className={cn(
                        'w-full py-3 rounded-xl text-sm font-semibold',
                        'bg-muted/60 text-foreground border border-border/60',
                        'hover:bg-muted active:scale-[0.98] transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      )}
                    >
                      View my data
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
