import { BarChart3, WifiOff, Zap, Users, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface FeatureCard {
  icon:        LucideIcon
  title:       string
  description: string
  gradient:    string  // Tailwind gradient classes
  iconBg:      string  // Background for icon wrapper
}

const FEATURES: FeatureCard[] = [
  {
    icon:        BarChart3,
    title:       'Real-Time Analytics',
    description: 'Visual dashboards with daily, weekly, and monthly breakdowns. Spot trends the moment they happen.',
    gradient:    'from-indigo-500 to-purple-500',
    iconBg:      'bg-indigo-500/10',
  },
  {
    icon:        WifiOff,
    title:       'Works Offline',
    description: "Log sales even without internet. Data syncs automatically the moment you're back online.",
    gradient:    'from-emerald-500 to-teal-500',
    iconBg:      'bg-emerald-500/10',
  },
  {
    icon:        Zap,
    title:       'Instant Entry',
    description: 'Add a complete sale record in under 5 seconds with smart quick-entry forms built for speed.',
    gradient:    'from-amber-500 to-orange-500',
    iconBg:      'bg-amber-500/10',
  },
  {
    icon:        Users,
    title:       'Team View',
    description: 'Managers see team leaderboards, individual performance, and daily targets at a glance.',
    gradient:    'from-pink-500 to-rose-500',
    iconBg:      'bg-pink-500/10',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-24 bg-muted/20">
      <div className="container mx-auto px-4 sm:px-6">

        {/* Section header */}
        <div data-animate className="text-center max-w-2xl mx-auto mb-16">
          <Badge variant="secondary" className="mb-4">Features</Badge>
          <h2 className="text-3xl sm:text-display-md font-bold text-foreground tracking-tight mb-4">
            Everything your sales team needs
          </h2>
          <p className="text-muted-foreground text-lg">
            Purpose-built for field reps and managers who need speed, reliability, and clarity.
          </p>
        </div>

        {/* Feature cards grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              {...feature}
              delay={i * 100}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  gradient,
  iconBg,
  delay,
}: FeatureCard & { delay: number }) {
  return (
    <div
      data-animate
      data-animate-delay={String(delay)}
      className="group relative p-6 rounded-2xl bg-card border border-border hover:shadow-card-hover hover:-translate-y-1 transition-all duration-300"
    >
      {/* Icon */}
      <div
        className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center mb-5',
          iconBg,
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center',
            gradient,
          )}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>

      <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>

      {/* Hover accent line */}
      <div
        className={cn(
          'absolute bottom-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-300',
          gradient,
        )}
      />
    </div>
  )
}
