import { ArrowRight, BarChart3, TrendingUp, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

function fadeUp(delay: number) {
  return {
    initial:    { opacity: 0, y: 24 },
    animate:    { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: 'easeOut' as const },
  }
}

export default function Hero() {
  const { isSignedIn, isLoaded } = useAuth()

  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center overflow-hidden pt-16"
    >
      {/* Global background gradients */}
      <div aria-hidden className="absolute -top-60 -right-60 w-[700px] h-[700px] rounded-full bg-brand-500/8 blur-[120px] pointer-events-none" />
      <div aria-hidden className="absolute -bottom-40 -left-60 w-[600px] h-[600px] rounded-full bg-purple-500/8 blur-[100px] pointer-events-none" />
      <div aria-hidden className="absolute inset-0 bg-dot-pattern bg-dot-md opacity-30 pointer-events-none" />

      <div className="relative mx-auto px-4 sm:px-6 py-20 lg:py-32 w-full max-w-[1300px]">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* Left: text */}
          <div className="flex flex-col gap-7">
            <motion.div {...fadeUp(0)}>
              <Badge variant="secondary" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Now in Beta — Free for small businesses
              </Badge>
            </motion.div>

            <motion.h1
              {...fadeUp(0.1)}
              className="font-logo text-[2.6rem] sm:text-[3.2rem] lg:text-[3.8rem] leading-[1.05] tracking-[-0.03em] text-foreground"
            >
              Track Every Sale.{' '}
              <span className="text-gradient-brand">
                Grow Every Day.
              </span>
            </motion.h1>

            <motion.p
              {...fadeUp(0.2)}
              className="text-[1.05rem] text-muted-foreground max-w-md leading-relaxed"
            >
              RozNaama lets shopkeepers and small businesses log sales in seconds,
              view daily analytics, and stay on top of their numbers — all in one
              simple app.
            </motion.p>

            <motion.div {...fadeUp(0.3)} className="flex flex-col sm:flex-row gap-3">
              {isLoaded && isSignedIn ? (
                <Link to="/dashboard">
                  <Button size="lg" className="bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 shadow-glow-md rounded-full px-7 active:scale-[0.97]">
                    Go to Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              ) : (
                <Link to="/sign-up">
                  <Button size="lg" className="bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 shadow-glow-md rounded-full px-7 active:scale-[0.97]">
                    Get Started Free
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              )}
            </motion.div>

            <motion.p
              {...fadeUp(0.4)}
              className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap"
            >
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              No credit card required
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              Works offline
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              100% free
            </motion.p>
          </div>

          {/* Right: mockup card */}
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.25, ease: 'easeOut' }}
            className="relative flex justify-center lg:justify-end"
          >
            {/* Gradient glow — fills the right column so it aligns with the card */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none overflow-hidden"
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-brand-500/20 blur-[70px]" />
            </div>

            <div
              className="relative z-10 w-full max-w-sm bg-card border border-border/60 rounded-2xl p-6 animate-float"
              style={{ boxShadow: '0 20px 60px -10px hsl(var(--primary)/0.18), 0 4px 20px -4px rgb(0 0 0 / 0.12)' }}
            >
              {/* Card header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Today's Sales</p>
                  <p className="text-[1.75rem] font-logo font-bold text-foreground tracking-tight">PKR 84,200</p>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-gradient-brand flex items-center justify-center shadow-glow-sm">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
              </div>

              {/* Mini bar chart */}
              <div className="flex items-end gap-1.5 h-20 mb-5" aria-label="Sales trend chart">
                {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-primary/20"
                    style={{ height: `${h}%` }}
                  />
                ))}
                <div className="flex-1 rounded-t-sm bg-gradient-brand" style={{ height: '100%' }} />
              </div>

              {/* Stat chips */}
              <div className="grid grid-cols-2 gap-3">
                <StatChip icon={BarChart3}  label="Entries"  value="12" />
                <StatChip icon={DollarSign} label="Avg. Sale" value="PKR 7k" />
              </div>

              {/* Decorative trend badge */}
              <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-500 font-semibold">
                <TrendingUp size={12} />
                +18% vs yesterday
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  )
}

function StatChip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-muted/40 border border-border/50 rounded-xl p-3">
      <Icon className="w-4 h-4 text-primary mb-1.5" />
      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
    </div>
  )
}
