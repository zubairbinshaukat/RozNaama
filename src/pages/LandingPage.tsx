import Navbar     from '@/components/landing/Navbar'
import Hero       from '@/components/landing/Hero'
import Features   from '@/components/landing/Features'
import HowItWorks from '@/components/landing/HowItWorks'
import Footer     from '@/components/landing/Footer'
import { useScrollAnimation } from '@/hooks/useScrollAnimation'

/**
 * Public landing page — no authentication required.
 * Assembles all landing sections and activates scroll animations.
 */
export default function LandingPage() {
  // Activates data-animate elements as they scroll into view
  useScrollAnimation()

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  )
}
