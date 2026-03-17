import { TrendingUp, Users, ShoppingBag, Activity } from 'lucide-react'

const STATS = [
  { icon: Users,      value: '500+',   label: 'Businesses' },
  { icon: ShoppingBag, value: '10,000+', label: 'Sales Tracked' },
  { icon: Activity,   value: '99.9%',  label: 'Uptime' },
  { icon: TrendingUp, value: '3×',     label: 'Faster Reporting' },
]

export default function SocialProof() {
  return (
    <section
      id="social-proof"
      className="py-14 bg-gradient-to-r from-primary/5 via-primary/8 to-primary/5 border-y border-border"
    >
      <div className="container mx-auto px-4 sm:px-6">
        <div
          data-animate
          className="grid grid-cols-2 lg:grid-cols-4 gap-8"
        >
          {STATS.map(({ icon: Icon, value, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-center">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
                <Icon className="text-primary" size={20} strokeWidth={1.5} />
              </div>
              <span className="text-3xl font-bold text-foreground tracking-tight leading-none">
                {value}
              </span>
              <span className="text-sm text-muted-foreground font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
