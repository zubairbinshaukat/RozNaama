import Navbar     from '@/components/landing/Navbar'
import Hero       from '@/components/landing/Hero'
import HowItWorks from '@/components/landing/HowItWorks'
import Footer     from '@/components/landing/Footer'
import { useScrollAnimation } from '@/hooks/useScrollAnimation'

export default function Landing() {
  useScrollAnimation()

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  )
}
