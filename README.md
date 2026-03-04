# Pixel Agent Desk v2.0 👾

Claude CLI의 Hook 이벤트를 실시간으로 수신하여 여러 에이전트의 상태를 픽셀 아트로 시각화하는 데스크톱 대시보드입니다.

## 🌟 주요 기능

- **Hook-Only 아키텍처**: Claude CLI의 Hook 시스템과 내장 HTTP 서버를 통해 실시간 이벤트 수신 (JSONL 직접 파싱 불필요).
- **멀티 에이전트 및 서브에이전트 지원**: 메인 에이전트 외에도 서브에이전트를 동시 감지하여 별도 아바타로 표시.
- **실시간 상태 시각화**:
  - ⚙️ **Working**: 도구 사용 중 (일하는 포즈)
  - ✅ **Done**: 대화 턴 종료 (춤추는 포즈)
  - 💤 **Waiting**: 초기 대기 상태 (의자에 앉아있음)
  - ❓ **Help**: 권한 요청 중 (도움 요청 포즈)
- **부드러운 에이전트 생명주기**:
  - 활성 에이전트가 하나도 없으면 대기 픽셀 아바타 한 명을 노출합니다.
  - Claude CLI 시작 시 자동으로 에이전트를 화면에 띄웁니다.
  - 30분 동안 활동이 없으면 자동으로 에이전트를 화면에서 제거합니다.
- **자동 훅 등록**: 앱 시작 시 Claude CLI의 `settings.json`에 필요한 훅을 자동 등록합니다.
- **최상단 유지 (Always on Top)**: 화면 최상단에 고정 (`focusable: false`로 포커스 뺏김 방지).

## 🚀 시작하기

### 1. 설치
```bash
npm install
```

### 2. 실행
```bash
npm start
```

### 3. 사용
Claude Code를 터미널에서 실행하면 `~/.claude/projects/`에 JSONL 로그가 자동 생성됩니다. Pixel Agent Desk가 실시간으로 이를 감지하여 화면에 픽셀 캐릭터로 상태를 시각화합니다. 서브에이전트를 생성하는 복잡한 태스크를 요청하면 서브에이전트 아바타도 추가로 등장합니다.

## 📁 프로젝트 구조

```
pixel-agent-desk/
├── main.js              # Electron 메인 프로세스, HTTP 훅 서버, 동적 윈도우 리사이징
├── hook.js              # 범용 훅 스크립트 (Claude CLI → HTTP 서버)
├── sessionend_hook.js   # 세션 종료 시 JSONL에 SessionEnd 기록
├── agentManager.js      # 멀티 에이전트 데이터 관리 (EventEmitter)
├── renderer.js          # 애니메이션 엔진, 에이전트 0개일 때 대기 아바타 표출
├── preload.js           # IPC 통신 브릿지
├── utils.js             # 유틸리티 함수
├── index.html           # UI 뼈대 구조
├── styles.css           # 디자인 시스템
└── package.json         # 의존성 관리
```

## 📋 기술적 특징

### Hook 기반 이벤트 수신
- Claude CLI의 모든 주요 이벤트를 Hook으로 수신:
  - `SessionStart`, `SessionEnd`: 세션 생명주기 관리
  - `PreToolUse`, `PostToolUse`: 작업 상태 감지
  - `TaskCompleted`: 작업 완료 상태 전환
  - `PermissionRequest`: 권한 요청 상태
  - `SubagentStart`, `SubagentStop`: 서브에이전트 관리

### 초기화 탐색 자동 무시
- 첫 `PreToolUse` 이벤트는 세션 초기화로 간주하여 무시
- 두 번째부터 사용자 요청에 의한 실제 도구 사용으로 처리

### 30분 비활성 타임아웃
- 마지막 활동(`lastActivity`) 기준 30분 경과 시 자동 제거
- 5분마다 전체 에이전트 활동 상태 확인
