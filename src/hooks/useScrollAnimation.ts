import { useEffect } from 'react'

/**
 * Activates scroll-triggered entrance animations.
 * Watches all elements with the [data-animate] attribute and adds
 * the 'animate-in' class when they enter the viewport.
 * Animations are triggered once per element (unobserved after first trigger).
 */
export function useScrollAnimation(): void {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-in')
            // Unobserve after animating — no need to re-trigger
            observer.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
      },
    )

    const elements = document.querySelectorAll('[data-animate]')
    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [])
}
