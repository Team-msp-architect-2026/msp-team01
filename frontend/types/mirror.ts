// frontend/types/mirror.ts

// §7-6 GET /api/mirror/{id}/status 응답
export interface DRStatus {
  dr_status: 'not_ready' | 'syncing' | 'ready'
  last_synced_at: string | null
  sync_trigger: string | null
  aws_resource_count: number
  gcp_resource_count: number
  dr_package: {
    status: 'preparing' | 'ready' | 'failed' | null
    snapshot_status: 'pending' | 'exporting' | 'ready' | 'failed' | null
    rto_minutes: number | null
    rpo_minutes: number | null
  } | null
}

// §7-6 GET /api/mirror/{id}/resources 응답 항목
export type Confidence = 'auto' | 'review' | 'manual'

export interface ResourceMapping {
  aws_resource_type: string
  aws_resource_name: string
  aws_resource_id: string
  gcp_resource_type: string | null
  gcp_resource_name: string | null
  confidence: Confidence
  review_reason: string | null
  user_confirmed: boolean
}

// §7-6 GET /api/mirror/{id}/package 응답
export interface DRPackage {
  package_id: string
  status: 'preparing' | 'ready' | 'failed'
  snapshot_status: 'pending' | 'exporting' | 'ready' | 'failed'
  components: {
    terraform_code: { status: string; s3_path: string | null }
    container_image: {
      status: string
      gcr_uri: string | null
      image_ref_path: string | null
    }
    db_snapshot: {
      status: string
      snapshot_ref_path: string | null
      export_s3_path: string | null
      export_format: string
    }
  }
  dr_report: {
    rto_minutes: number
    rpo_minutes: number
    confidence_summary: { auto: number; review: number; manual: number }
    checklist: { item: string; status: 'done' | 'pending' | 'warning' }[]
  }
  created_at: string
}

export interface DRPackageResponse {
  latest: DRPackage | null
  history: { package_id: string; created_at: string; status: string }[]
}

// §7-6 GET /api/mirror/{id}/sync-history 응답 항목
export interface SyncHistory {
  sync_id: string
  trigger_type: 'deployment_completed' | 'infra_changed' | 'manual'
  status: 'running' | 'completed' | 'failed'
  snapshot_status: string
  aws_resources_detected: number | null
  gcp_resources_mapped: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// §7-6 POST /api/mirror/{id}/failover 응답
export interface FailoverResponse {
  failover_id: string
  mode: 'simulation' | 'actual'
  gcp_region: string
  websocket_url: string
}