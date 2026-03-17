import { SignUp } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'

export default function SignUpPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-br from-background via-background to-secondary/20">
      {/* Background blobs */}
      <div aria-hidden className="pointer-events-none fixed -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
      <div aria-hidden className="pointer-events-none fixed -bottom-40 -left-40 w-[400px] h-[400px] rounded-full bg-primary/5 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center gap-8 w-full max-w-md">
        {/* Logo + wordmark */}
        <Link to="/" className="flex items-center gap-2.5 font-bold text-xl group">
          <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow-sm transition-transform group-hover:scale-105">
            <TrendingUp className="text-white" size={20} />
          </div>
          <span className="text-foreground tracking-tight">RozNaama</span>
        </Link>

        {/* Clerk SignUp component */}
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
          appearance={{
            elements: {
              rootBox:        'w-full',
              card:           'w-full rounded-2xl border border-border bg-card shadow-card-hover',
              headerTitle:    'text-foreground font-bold',
              headerSubtitle: 'text-muted-foreground',
              socialButtonsBlockButton: 'border border-border bg-background hover:bg-muted text-foreground',
              formButtonPrimary: 'bg-gradient-brand hover:opacity-90 text-white',
              footerActionLink: 'text-primary hover:text-primary/80',
            },
          }}
        />

        {/* Sign-in link */}
        <p className="text-sm text-muted-foreground text-center">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
