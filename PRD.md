# 📋 PRD: Pixel Agent Desk v2

## 목표
Claude CLI 사용 중인 세션을 픽셀 캐릭터로 시각화하고 세션의 생명주기(시작/종료)를 안정적으로 관리

## 핵심 기능
1. **Hook 기반 실시간 이벤트 수신**: Claude CLI의 Hook 시스템을 통해 모든 이벤트를 실시간 수신
2. **멀티 에이전트**: 여러 Claude CLI 세션 동시 표시
3. **상태 시각화**: Working/Done/Waiting/Help 상태에 따른 애니메이션
4. **서브에이전트**: `SubagentStart/Stop` 이벤트로 서브에이전트 감지 및 별도 아바타 표시
5. **자동 훅 등록**: 앱 시작 시 Claude CLI 설정에 자동으로 훅 등록

## 상태 정의
| 상태 | 조건 | 애니메이션 |
|------|------|-----------|
| Waiting | 세션 시작 초기 상태 | 앉아 있는 포즈 (frame 32) |
| Working | `PreToolUse`/`PostToolUse` 이벤트 (첫 번째 제외) | 일하는 포즈 (frames 1-4) |
| Done | `TaskCompleted` 이벤트 | 춤추는 포즈 (frames 20-27) |
| Help | `PermissionRequest` 이벤트 | 도움 요청 포즈 |

## 에이전트 생명주기

### 이벤트 기반 상태 전환
1. **SessionStart**: 새 에이전트 생성 + `Waiting` 상태
2. **PreToolUse** (첫 번째 제외): `Working` 상태로 전환
3. **TaskCompleted**: `Done` 상태로 전환 + 다음 PreToolUse 플래그 리셋
4. **PermissionRequest**: `Help` 상태로 전환 (사용자 입력 대기)
5. **SessionEnd**: 에이전트 제거

### 초기화 탐색 자동 무시
- 첫 `PreToolUse` 이벤트는 세션 초기화(cwd 탐색 등)로 간주하여 무시
- 두 번째부터 사용자 요청에 의한 실제 도구 사용으로 처리

### 자동 정리 시스템
1. **30분 비활성 타임아웃**: `lastActivity` 기준 30분 경과 시 자동 제거
2. **5분마다 전체 확인**: 모든 에이전트의 활동 상태 확인 및 정리

## 아키텍처
```
┌─────────────────────────────────────────────┐
│              Claude CLI                     │
│  ┌───────────────────────────────────────┐  │
│  │         Hook Events (All Types)       │  │
│  └───────────────────┬───────────────────┘  │
└──────────────────────┼──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│               hook.js                       │
│    (stdin → HTTP POST localhost:47821)      │
└──────────────────────┼──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│    main.js (HTTP Hook Server + IPC)         │
│  ┌──────────────┐  ┌──────────────────┐    │
│  │ AgentManager │◄─┤  Event Handlers  │    │
│  └──────┬───────┘  └──────────────────┘    │
│         │                                  │
│         └──────────────┐                   │
│                        ▼                   │
│                   [IPC Bridge]              │
└────────────────────────┼───────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────┐
│            renderer.js / UI                 │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ Multi-Agent  │  │ 0-Agent Idle │        │
│  │ (Cards Grid) │  │ (Wait Pose)  │        │
│  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────┘
```

## 파일 구조
- `main.js`: Electron 메인 프로세스, HTTP 훅 서버(Port 47821), 자동 훅 등록
- `hook.js`: 범용 훅 스크립트 (Claude CLI → HTTP 서버)
- `sessionend_hook.js`: 세션 종료 시 JSONL에 SessionEnd 기록
- `agentManager.js`: 에이전트 객체 관리 및 상태 변경 이벤트 발행
- `renderer.js`: UI 렌더링 및 애니메이션
- `preload.js`: IPC 통신 브릿지
- `utils.js`: 유틸리티 함수

## 구현 현황
- ✅ Hook 기반 실시간 이벤트 수신
- ✅ 자동 훅 등록 (앱 시작 시 settings.json 자동 수정)
- ✅ 멀티 에이전트 동적 레이아웃 (Electron 윈도우 리사이징)
- ✅ 서브에이전트 지원 (SubagentStart/Stop 이벤트)
- ✅ 초기화 탐색 자동 무시 (첫 PreToolUse)
- ✅ 권한 요청 상태 감지 (PermissionRequest)
- ✅ 30분 비활성 타임아웃

## 향후 과제
없음 (현재 Hook-Only 아키텍처로 완전히 구현됨)

## 실행 방법
```bash
# 1. 의존성 설치
npm install

# 2. 앱 실행 (앱 실행 시 ~/.claude/settings.json에 훅이 자동 등록됨)
npm start

# 3. Claude CLI 실행
claude
```

## 테스트 방법
1. 터미널에서 `claude` 실행 → 아바타 등장 확인 (SessionStart Hook)
2. 대화 진행 → `Working` 애니메이션 확인 (PreToolUse Hook)
3. 응답 완료 → `Done` 애니메이션 확인 (TaskCompleted Hook)
4. 권한 필요한 작업 요청 → `Help` 상태 확인 (PermissionRequest Hook)
5. 복잡한 태스크 요청 → 서브에이전트 등장 확인 (SubagentStart Hook)
6. 30분 대기 → 자동 제거 확인 (비활성 타임아웃)
