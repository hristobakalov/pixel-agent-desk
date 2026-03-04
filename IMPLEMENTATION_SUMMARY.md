# Pixel Agent Desk v2.0 - Implementation Summary

## Overview
Pixel Agent Desk v2.0는 Claude CLI의 Hook 시스템을 통해 실시간 이벤트를 수신하여 여러 개의 에이전트(서브에이전트 포함)를 픽셀 아바타로 시각화하는 앱입니다. 내장 HTTP 서버와 Claude CLI의 자동 훅 등록을 통해 별도 설정 없이 동작합니다.

## Core Components

### 1. `hook.js` - 범용 훅 스크립트
- Claude CLI의 모든 훅 이벤트를 수신하는 범용 스크립트
- `stdin`에서 JSON 데이터를 읽어 내장 HTTP 서버로 POST 전송
- 서버 다운 시에도 훅 실행을 막지 않음 (fail-silent)
- 3초 타임아웃으로 CLI 블로킹 방지

### 2. `main.js` - Electron 메인 프로세스 & HTTP 훅 서버
- **HTTP 훅 서버** (Port 47821):
  - `hook.js`에서 받은 이벤트를 처리하는 내장 서버
  - 수신 이벤트: `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `TaskCompleted`, `PermissionRequest`, `SubagentStart`, `SubagentStop`
  - 첫 `PreToolUse` 자동 무시 (세션 초기화 탐색)
- **자동 훅 등록**: 앱 시작 시 `~/.claude/settings.json`에 모든 훅을 자동 등록
- **윈도우 관리**: 에이전트 수에 따른 동적 크기 조절
- **30분 비활성 타임아웃**: 5분마다 `lastActivity` 기준 확인 및 자동 제거

### 3. `agentManager.js` - 멀티 에이전트 데이터 관리자
- `sessionId` 기반 에이전트 생명주기 관리
- 상태 관리: `Working`, `Done`, `Waiting`, `Help`, `Thinking`
- 활성 시간 추적 (`activeStartTime`, `lastDuration`)
- EventEmitter 기반 `agent-added`, `agent-updated`, `agent-removed`, `agents-cleaned` 이벤트 발송
- 10분 유휴 타임아웃 및 자동 정리

### 4. `sessionend_hook.js` - 세션 종료 훅
- `SessionEnd` 이벤트 시 JSONL 파일에 `SessionEnd` 기록
- 강제 종료 시에도 로그에 기록을 남겨 좀비 에이전트 방지

### 5. `renderer.js` & `styles.css` - UI 렌더러
- **빈 상태 (0 agents) 표출**: 에이전트가 없으면 대기 아바타를 표시
- **멀티 에이전트 그리드**: 1명 이상 시 카드 뷰로 전환
- **애니메이션 최적화**: `requestAnimationFrame`을 사용한 CSS sprite 애니메이션

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude CLI                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Hook Events (All Types)                │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                    │
└────────────────────────┼────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      hook.js                                │
│  (stdin → JSON → HTTP POST to localhost:47821)              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    main.js (HTTP Hook Server)               │
│  ┌──────────────┐  ┌──────────────────┐                    │
│  │ AgentManager │◄─┤  Event Handlers  │                    │
│  │  (Events)    │  │  (Session/Tool)  │                    │
│  └──────┬───────┘  └──────────────────┘                    │
│         │                 │                                │
│         └─────────────────┘ (30m timeout check)            │
│                           │                                 │
│                    IPC (Renderer)                           │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   renderer.js                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Multi-Agent  │  │  Subagents   │  │ 0-Agent Idle │     │
│  │ (Cards Grid) │  │  (Distinct)  │  │ (Wait Pose)  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Hook-Only Architecture
- 별도 설정 없이 앱 시작 시 자동으로 Claude CLI 훅 등록
- HTTP 서버를 통해 실시간 이벤트 수신 (JSONL 파싱 불필요)
- 모든 주요 이벤트를 Hook으로 처리 (SessionStart/End, ToolUse, TaskCompleted, PermissionRequest, Subagent)

### 2. Smart State Management
- 첫 `PreToolUse` 자동 무시 (세션 초기화 탐색 구분)
- 정확한 상태 전환: Waiting → Working → Done
- `PermissionRequest` 이벤트로 권한 요청 상태 감지

### 3. Subagent Support
- `SubagentStart`, `SubagentStop` 이벤트로 서브에이전트 관리
- 메인 에이전트와 별도로 시각화

### 4. Idle / Auto Clean UI
- 활성 에이전트가 없으면 대기 아바타를 표출
- 30분 비활성 시 자동 제거
- 5분마다 전체 에이전트 활동 상태 확인

## Testing

1. **기본 작동 테스트**: 아무 터미널 창에서나 `claude` CLI를 켜면 대기 아바타에서 메인 에이전트가 튀어나옵니다.
2. **상태 전환 테스트**: 대화 진행 → `Working` 애니메이션 확인 → 응답 완료 시 `Done` 애니메이션 확인
3. **서브에이전트 테스트**: 복잡한 태스크를 요청하면 서브에이전트가 별도로 추가됨
4. **권한 요청 테스트**: 권한이 필요한 작업을 요청하면 `Help` 상태로 전환됨
5. **타임아웃 감시**: 30분 동안 활동이 없으면 에이전트가 자동 제거됨

---

**Version**: 2.0.0
**Refactored**: 2026-03-04 (Hook-Only Architecture)
