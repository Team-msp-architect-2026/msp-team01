# ADR (Architecture Decision Records)

아키텍처 관련 **중요한 결정**을 기록합니다. "왜 이 선택을 했는가"를 남겨 6개월 뒤의 자신과 다음 기수가 맥락을 이해할 수 있도록 합니다.

## 📝 언제 ADR을 작성하나

- 기술 스택 선정 (예: "왜 MySQL 대신 PostgreSQL?")
- 아키텍처 패턴 선택 (예: "왜 이벤트 기반 대신 REST?")
- 외부 서비스/라이브러리 도입 또는 교체
- 보안/성능 관련 중요 정책 결정
- **이력에 남길 가치가 있는 trade-off**

사소한 코드 스타일이나 구현 디테일은 ADR로 남기지 않습니다.

## 📂 네이밍 규칙

```
NNN-kebab-case-decision.md

예)
001-why-argocd.md
002-mysql-vs-postgresql.md
003-nginx-ingress-over-traefik.md
```

- `NNN` = 3자리 순번 (001부터)
- 한 번 부여된 번호는 변경하지 않음
- 폐기된 결정도 삭제하지 않고 `status: Deprecated`로 유지

## 🔄 상태 (Status)

| 상태 | 의미 |
|------|------|
| `Proposed` | 제안 · 논의 중 |
| `Accepted` | 채택 · 현재 유효 |
| `Deprecated` | 더 이상 사용 안 함 (남겨둠) |
| `Superseded by ADR-NNN` | 다른 결정으로 대체됨 |

## 📋 작성 절차

1. `000-template.md` 복사 → `NNN-제목.md`
2. 브랜치 생성: `docs/#이슈번호-adr-제목`
3. PR 올려서 팀원 리뷰 → 합의 후 Merge
4. Merge 시점에 상태를 `Accepted`로 변경

## 📚 현재 ADR 목록

<!-- 새 ADR 추가 시 여기에 링크 추가 -->
- (아직 없음)
