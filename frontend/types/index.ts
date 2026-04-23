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

// 프로젝트
export type ProjectStatus = 'created' | 'deploying' | 'completed' | 'failed';
export type DRStatus = 'not_ready' | 'syncing' | 'ready';
export type Environment = 'prod' | 'staging' | 'dev';

// DR 매핑 신뢰도
export type Confidence = 'auto' | 'review' | 'manual';

// WebSocket 이벤트 타입
export type WSEventType =
  | 'deploy_progress'
  | 'deploy_completed'
  | 'deploy_failed'
  | 'sync_progress'
  | 'sync_completed'
  | 'snapshot_ready'
  | 'failover_progress'
  | 'failover_completed';