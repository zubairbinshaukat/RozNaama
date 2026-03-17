import { UserPlus, ClipboardList, TrendingUp, ArrowRight, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Step {
  number:      string
  icon:        LucideIcon
  title:       string
  description: string
  color:       string
}

const STEPS: Step[] = [
  {
    number:      '01',
    icon:        UserPlus,
    title:       'Create Your Account',
    description: 'Sign up in 30 seconds. No credit card required. Start tracking immediately.',
    color:       'hsl(var(--primary))',
  },
  {
    number:      '02',
    icon:        ClipboardList,
    title:       'Log Your First Sale',
    description: 'Enter product name and amount — done in seconds. Works offline in the field.',
    color:       'hsl(173 58% 39%)',
  },
  {
    number:      '03',
    icon:        TrendingUp,
    title:       'Track & Grow',
    description: 'Watch your daily and weekly analytics update in real-time and hit your targets.',
    color:       'hsl(280 65% 60%)',
  },
]

export default function HowItWorks() {
  const { isSignedIn, isLoaded } = useAuth()

  return (
    <section id="how-it-works" className="py-20">
      <div className="mx-auto px-4 sm:px-6 max-w-[1300px]">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <Badge variant="secondary" className="mb-4 rounded-full px-4 py-1.5 text-xs font-semibold">
            How It Works
          </Badge>
          <h2 className="font-logo text-[2rem] sm:text-[2.5rem] leading-tight tracking-[-0.02em] text-foreground mb-4">
            Up and running in minutes
          </h2>
          <p className="text-muted-foreground text-[1.05rem] leading-relaxed">
            No complex setup. No training required. Just sign up and start tracking.
          </p>
        </motion.div>

        <div className="relative grid md:grid-cols-3 gap-6 lg:gap-10 mb-16">
          {/* Connecting line */}
          <div
            aria-hidden
            className="hidden md:block absolute top-9 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-px border-t border-dashed border-border/70 z-0"
          />
          {STEPS.map((step, i) => (
            <StepCard key={step.number} step={step} delay={i * 0.12} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
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
                Start Tracking Free
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Free forever for small businesses · No credit card needed
          </p>
        </motion.div>

      </div>
    </section>
  )
}

function StepCard({ step, delay }: { step: Step; delay: number }) {
  const Icon = step.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10 flex flex-col items-center text-center group"
    >
      <div className="relative mb-6">
        <div
          className="w-18 h-18 rounded-2xl bg-card border border-border/60 flex items-center justify-center transition-all duration-300 group-hover:shadow-[0_8px_30px_-6px_hsl(var(--primary)/0.25)] group-hover:border-primary/30 group-hover:-translate-y-0.5"
          style={{ boxShadow: '0 2px 12px -2px rgb(0 0 0 / 0.06)' }}
        >
          <Icon className="w-7 h-7" style={{ color: step.color }} />
        </div>
        <span
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center text-white shadow-sm bg-gradient-brand"
        >
          {step.number}
        </span>
      </div>
      <h3 className="text-[0.95rem] font-semibold text-foreground mb-2 tracking-tight">{step.title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-[220px] mx-auto">
        {step.description}
      </p>
    </motion.div>
  )
}
