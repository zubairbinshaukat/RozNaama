import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/components/shared/Toast'
import { useViewAs } from '@/context/ViewAsContext'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Start the existing "view as" (same banner, read-only mode and storage as the
 * dashboard's Access dialog) and open the dashboard.
 */
export function useImpersonate(): (userId: Id<'users'>, name: string) => void {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { setViewAs } = useViewAs()
  return useCallback((userId: Id<'users'>, name: string) => {
    setViewAs(userId, name)
    showToast(`Now viewing ${name}'s data (read-only)`, 'info')
    navigate('/dashboard')
  }, [navigate, setViewAs, showToast])
}
