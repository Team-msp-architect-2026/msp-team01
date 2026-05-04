// frontend/store/authStore.ts 수정
import { create } from 'zustand'
import { User } from '@/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, token: string) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>((set: (state: Partial<AuthState>) => void, get: () => AuthState) => ({
  user: null,
  accessToken: null,

  setAuth: (user: User, token: string) => {
    localStorage.setItem('access_token', token)
    localStorage.setItem('user', JSON.stringify(user))
    set({ user, accessToken: token })
  },

  clearAuth: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    set({ user: null, accessToken: null })
  },

  isAuthenticated: () => !!get().accessToken,
}))