import { Loader2, TrendingUp } from 'lucide-react'

interface LoadingScreenProps {
  message?: string
}

export default function LoadingScreen({ message = 'Loading…' }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background gap-6">
      {/* Brand mark */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-gradient-brand flex items-center justify-center shadow-glow-md">
          <TrendingUp className="text-white" size={28} strokeWidth={1.5} />
        </div>
        <span className="text-xl font-bold text-foreground tracking-tight">RozNaama</span>
      </div>

      {/* Spinner + message */}
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="text-primary animate-[spin_1s_linear_infinite]" size={24} />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
