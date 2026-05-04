// frontend/app/projects/new/page.tsx
import { Suspense } from 'react'
import NewProjectPageContent from './NewProjectPageContent'

export default function NewProjectPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen text-[#9ca3af]">
        로딩 중...
      </div>
    }>
      <NewProjectPageContent />
    </Suspense>
  )
}