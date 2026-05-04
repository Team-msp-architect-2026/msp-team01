// frontend/hooks/useMirrorOps.ts
import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api'
import {
  DRStatus, ResourceMapping, DRPackageResponse, SyncHistory
} from '@/types/mirror'

// ─── useDRStatus ───────────────────────────────────────────────
export function useDRStatus(projectId: string | undefined) {
  const [data, setData]       = useState<DRStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    // [FIX] projectId 없으면 early return
    if (!projectId) {
      setIsLoading(false)
      return
    }
    try {
      const res = await apiClient.get(`/api/mirror/${projectId}/status`)
      setData(res.data.data)
      setError(null)
    } catch (err: unknown) {
      // [FIX] 에러 캐치 — 무한 로딩 방지
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'DR 상태를 불러오지 못했습니다.'
      setError(msg)
    } finally {
      // [FIX] 성공·실패 모두 isLoading 해제
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetch()
    // 10초마다 폴링 — 에러 발생해도 폴링 유지
    const interval = setInterval(fetch, 10000)
    return () => clearInterval(interval)
  }, [fetch])

  return { data, isLoading, error, refetch: fetch }
}

// ─── useResourceMappings ───────────────────────────────────────
export function useResourceMappings(projectId: string | undefined) {
  const [data, setData]           = useState<ResourceMapping[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    // [FIX] projectId 없으면 early return
    if (!projectId) {
      setIsLoading(false)
      return
    }
    apiClient
      .get(`/api/mirror/${projectId}/resources`)
      .then((res) => {
        setData(res.data.data)
        setError(null)
      })
      .catch((err: unknown) => {
        // [FIX] 에러 캐치 — isLoading false 처리
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? '리소스 매핑을 불러오지 못했습니다.'
        setError(msg)
      })
      .finally(() => {
        // [FIX] 항상 isLoading 해제
        setIsLoading(false)
      })
  }, [projectId])

  return { data, isLoading, error }
}

// ─── useDRPackage ──────────────────────────────────────────────
export function useDRPackage(projectId: string | undefined) {
  const [data, setData]           = useState<DRPackageResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const fetch = useCallback(async () => {
    // [FIX] projectId 없으면 early return
    if (!projectId) {
      setIsLoading(false)
      return
    }
    try {
      const res = await apiClient.get(`/api/mirror/${projectId}/package`)
      setData(res.data.data)
      setError(null)
    } catch (err: unknown) {
      // [FIX] 에러 캐치
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'DR Package를 불러오지 못했습니다.'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { data, isLoading, error, refetch: fetch }
}

// ─── useSyncHistory ────────────────────────────────────────────
export function useSyncHistory(projectId: string | undefined) {
  const [data, setData]   = useState<SyncHistory[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // [FIX] projectId 없으면 early return
    if (!projectId) return

    apiClient
      .get(`/api/mirror/${projectId}/sync-history`)
      .then((res) => {
        setData(res.data.data)
        setError(null)
      })
      .catch((err: unknown) => {
        // [FIX] 에러 캐치
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? '동기화 이력을 불러오지 못했습니다.'
        setError(msg)
      })
  }, [projectId])

  return { data, error }
}