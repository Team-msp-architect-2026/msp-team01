// frontend/app/projects/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Project, Environment, ProjectStatus } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState<{
    status?: ProjectStatus
    environment?: Environment
  }>({})

  useEffect(() => {
    const fetchProjects = async () => {
      const params = new URLSearchParams()
      if (filter.status) params.append('status', filter.status)
      if (filter.environment) params.append('environment', filter.environment)

      const res = await apiClient.get(`/api/projects?${params}`)
      setProjects(res.data.data)
    }
    fetchProjects()
  }, [filter])

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">📦 프로젝트 목록</h1>
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          onClick={() => router.push('/projects/new')}
        >
          + 새 인프라 생성
        </Button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        {(['prod', 'staging', 'dev'] as Environment[]).map((env) => (
          <Button
            key={env}
            variant={filter.environment === env ? 'default' : 'outline'}
            size="sm"
            onClick={() =>
              setFilter((f) => ({
                ...f,
                environment: f.environment === env ? undefined : env,
              }))
            }
          >
            {env}
          </Button>
        ))}
      </div>

      {/* 프로젝트 카드 목록 */}
      <div className="grid gap-4">
        {projects.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              프로젝트가 없습니다.{' '}
              <Button
                variant="link"
                onClick={() => router.push('/projects/new')}
              >
                새 인프라 생성하기
              </Button>
            </CardContent>
          </Card>
        ) : (
          projects.map((p) => (
            <Card
              key={p.project_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/projects/${p.project_id}`)}
            >
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium text-lg">{p.name}</p>
                  <p className="text-sm text-gray-500">
                    {p.prefix}-{p.environment} · {p.region}
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  <Badge variant="outline">{p.environment}</Badge>
                  <Badge
                    className={
                      p.dr_status === 'ready'
                        ? 'bg-green-100 text-green-700'
                        : p.dr_status === 'syncing'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-600'
                    }
                  >
                    DR: {p.dr_status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}