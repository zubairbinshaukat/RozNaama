import { Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from '@/components/shared/Toast'
import ProtectedRoute from '@/components/shared/ProtectedRoute'
import Landing    from '@/pages/Landing'
import SignInPage from '@/pages/SignInPage'
import SignUpPage from '@/pages/SignUpPage'
import Dashboard  from '@/pages/Dashboard'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/"         element={<Landing />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* Catch-all → home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
