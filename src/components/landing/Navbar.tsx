import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogIn, TrendingUp } from 'lucide-react'
import { useAuth } from '@clerk/clerk-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import ThemeSwitcher from '@/components/shared/ThemeSwitcher'
import { cn } from '@/lib/utils'

export default function Navbar() {
  const [isScrolled,   setIsScrolled]   = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const { isSignedIn, isLoaded } = useAuth()

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 768) setIsMobileOpen(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        isScrolled
          ? 'bg-background/80 backdrop-blur-xl border-b border-border/60 shadow-[0_1px_0_0_hsl(var(--border)/0.4)]'
          : 'bg-transparent',
      )}
    >
      <nav className="mx-auto flex items-center justify-between h-16 px-4 sm:px-6 max-w-[1300px]">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-brand flex items-center justify-center shadow-glow-sm">
            <TrendingUp className="text-white" size={15} strokeWidth={2.5} />
          </div>
          <span className="font-logo text-[1.2rem] text-foreground">RozNaama</span>
        </Link>

        {/* Desktop right side */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeSwitcher />
          {isLoaded && isSignedIn ? (
            <Link to="/dashboard">
              <Button size="sm" className="bg-gradient-brand hover:opacity-90 text-white border-0 rounded-full px-5 shadow-glow-sm">
                Dashboard
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/sign-in">
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground rounded-full px-4">
                  <LogIn size={15} />
                  Sign In
                </Button>
              </Link>
              <Link to="/sign-up">
                <Button size="sm" className="bg-gradient-brand hover:opacity-90 text-white border-0 rounded-full px-5 shadow-glow-sm">
                  Get Started
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile: theme + hamburger */}
        <div className="md:hidden flex items-center gap-2">
          <ThemeSwitcher />
          <button
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
            onClick={() => setIsMobileOpen((prev) => !prev)}
            aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileOpen}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <AnimatePresence mode="wait" initial={false}>
                {isMobileOpen ? (
                  <motion.path
                    key="close"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    d="M3 3L15 15M15 3L3 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                ) : (
                  <motion.path
                    key="open"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    d="M2 5h14M2 9h14M2 13h14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                )}
              </AnimatePresence>
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden overflow-hidden bg-background/95 backdrop-blur-xl border-b border-border/60"
          >
            <div className="max-w-[1300px] mx-auto px-4 py-4 flex flex-col gap-3">
              {isLoaded && isSignedIn ? (
                <Link to="/dashboard" className="block" onClick={() => setIsMobileOpen(false)}>
                  <Button size="sm" className="w-full bg-gradient-brand hover:opacity-90 text-white border-0 rounded-full">
                    Go to Dashboard
                  </Button>
                </Link>
              ) : (
                <div className="flex gap-3">
                  <Link to="/sign-in" className="flex-1" onClick={() => setIsMobileOpen(false)}>
                    <Button variant="ghost" size="sm" className="w-full gap-1.5 rounded-full">
                      <LogIn size={15} /> Sign In
                    </Button>
                  </Link>
                  <Link to="/sign-up" className="flex-1" onClick={() => setIsMobileOpen(false)}>
                    <Button size="sm" className="w-full bg-gradient-brand hover:opacity-90 text-white border-0 rounded-full">
                      Get Started
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
