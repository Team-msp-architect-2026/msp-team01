// frontend/types/index.ts

// API 공통 응답 포맷
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

// 사용자
export interface User {
  user_id: string
  email: string
  name: string
  aws_connected: boolean
}

// AWS 계정
export interface AWSAccount {
  account_id: string
  aws_account_id: string
  role_arn: string
  account_alias: string | null
  status: string
  connected_at: string
}

// 프로젝트
export type ProjectStatus = 'created' | 'deploying' | 'completed' | 'failed'
export type DRStatusValue = 'not_ready' | 'syncing' | 'ready'
export type Environment = 'prod' | 'staging' | 'dev'

export interface Project {
  project_id: string
  name: string
  prefix: string
  environment: Environment
  region: string
  status: ProjectStatus
  dr_status: DRStatusValue
  last_deployed_at: string | null
  last_synced_at: string | null
  created_at: string
}

// Deployment
export type DeploymentStatus = 'created' | 'deploying' | 'completed' | 'failed' | 'partial_failed'

export interface Deployment {
  deployment_id: string
  project_id: string
  prefix: string
  environment: Environment
  status: DeploymentStatus
  completed_resources: number | null
  total_resources: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// Validation 결과
export interface ValidationResult {
  validation_id: string
  deployment_id: string
  terraform_code: string
  validation_results: {
    validate: { passed: boolean; correction_attempts: number }
    security_scan: {
      passed: boolean
      critical: number
      high: number
      medium: number
      issues: SecurityIssue[]
    }
    cost_estimation: {
      monthly_total: number
      breakdown: { resource: string; monthly_cost: number }[]
    }
    plan: { add: number; change: number; destroy: number }
  }
}

export interface SecurityIssue {
  tool: string
  severity: string
  rule_id: string
  description: string
  location: string
  line: number
}

// DR 매핑 신뢰도
export type Confidence = 'auto' | 'review' | 'manual'

// WebSocket 이벤트 타입
export type WSEventType =
  | 'deploy_progress'
  | 'deploy_completed'
  | 'deploy_failed'
  | 'sync_progress'
  | 'sync_completed'
  | 'snapshot_ready'
  | 'failover_progress'
  | 'failover_completed'
  | 'error'

export interface WSEvent {
  event_type: WSEventType
  project_id: string
  timestamp: string
  data: Record<string, unknown>
}