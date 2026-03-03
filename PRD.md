# 📋 PRD: Pixel Agent Desk v2

## 목표
Claude CLI 사용 중인 세션을 픽셀 캐릭터로 시각화

## 핵심 기능
1. **JSONL 파일 감시**: `~/.claude/projects/*/` 폴더의 `.jsonl` 파일 실시간 모니터링
2. **멀티 에이전트**: 여러 Claude CLI 세션 동시 표시
3. **상태 시각화**: Working/Done/Waiting/Error 상태에 따른 애니메이션
4. **터미널 포커스**: 에이전트 클릭 시 해당 터미널로 포커스
5. **서브에이전트**: `subagents/agent-*.jsonl` 파일 감지 → 별도 아바타 (보라색 작은 캐릭터)

## 상태 정의
| 상태 | 조건 | 애니메이션 |
|------|------|-----------|
| Working | `stop_reason` 없음 | 일하는 포즈 (frames 1-4) |
| Done | `stop_reason: "end_turn"` | 춤추는 포즈 (frames 20-27) |
| Waiting | 초기 상태 (에이전트 없을 때) | 앉아 있는 포즈 (frame 32) |
| Error | 에러 발생 | 경고 포즈 (frames 0, 31) |

## 에이전트 생명주기
- **표시 조건**: JSONL 파일이 30분 이내 변경된 경우
- **초기 표시**: 앱 시작 시 `Waiting...` 대기 아바타 표시 (에이전트 없을 때)
- **자동 제거**: JSONL mtime 기준 30분 이상 변화 없으면 제거 (5분마다 체크)
- **즉시 제거**: 로그에 `subtype: "SessionEnd"` 감지 시 (현재 Claude CLI가 실제로 안 씀)

## 아키텍처
```
JSONL 파일 (fs.watch)
    ↓
jsonlParser (상태 파싱)
    ↓
agentManager (에이전트 관리)
    ↓
IPC → renderer (UI 표시)
```

## 파일 구조
- `main.js`: Electron 메인 프로세스
- `logMonitor.js`: JSONL 파일 감시
- `jsonlParser.js`: 로그 파싱
- `agentManager.js`: 에이전트 상태 관리
- `renderer.js`: UI 렌더링
- `preload.js`: IPC 브릿지
- `styles.css`: 스타일

## 구현 현황
- ✅ JSONL 파일 감시 (30분 윈도우)
- ✅ 상태 파싱
- ✅ 멀티 에이전트 UI
- ✅ 애니메이션
- ✅ 서브에이전트 시각 구분 (보라색 점선 + Sub 배지)
- ✅ 에이전트 없을 때 대기 아바타 표시
- ✅ 30분 비활성 에이전트 자동 제거

## 미구현 / 고려 중

### Offline 상태 (흐림 표시)
JSONL mtime가 5~30분 사이이면 아바타를 흑백+반투명으로 표시해
"터미널이 닫혔을 수 있다"는 신호를 줌. 30분 초과 시 제거.
- `state-offline` CSS 클래스 (흑백, 점선, opacity 0.5)
- `agentManager.setOffline(id)` 메서드
- 5분마다 mtime 체크

### 터미널 강제 종료 감지 (현재 발생한 핵심 문제: 윈도우 환경 구조적 한계)
터미널 창(X버튼)을 강제 종료했을 때 에이전트를 실시간으로 지우기 위해, `SessionStart` 훅에서 OS 레벨의 PID를 스니핑하고 실시간(1초 간격)으로 `process.kill(pid, 0)`을 통해 모니터링하는 전략(`agent_pids.json`)을 적용했습니다.
그러나 현재 다음과 같은 **치명적인 한계와 구조적 문제(아바타 깜박임/자동 증발 현상)**를 겪고 있습니다.

1. **URL 콜백 방식 (가장 추천하는 현대적 방식 🚀)**
   - 최신 Claude CLI(v2.1.63+)에서는 훅 실행 시 쉘 명령 대신 URL POST 콜백을 보낼 수 있음.
   - **방법**: Pixel Agent Desk 메인 프로세스(앱)에 아주 작은 로컬 HTTP 서버(예: `localhost:3000`)를 띄워둠.
   - **동작**: Claude 시작 시 `http://localhost:3000/start`로 자신의 세션 정보와 PID를 쏨.
   - **장점**: JSON 파일(`agent_pids.json`)을 I/O로 썼다 지웠다 할 필요 없이, 메모리에서 실시간으로 통신하므로 응답 속도가 훨씬 빠르고 구조가 깔끔함. 장애(예외) 처리도 쉬움.

#### 현재 겪고 있는 문제의 과정과 원인
1. **단명하는 래퍼 프로세스(Short-lived Wrapper Process)**: Claude CLI가 SessionStart 훅을 실행할 때, 본체 터미널 프로세스(`node.exe`)가 직접 훅(`sessionstart_hook.js`)을 품고 실행하는 것이 아니라, `cmd.exe`나 임시 `powershell.exe` 처럼 0.1~0.5초 만에 사라지는 "임시 매개(Wrapper) 쉘 프로세스"를 스폰하여 스크립트를 호출하고 바로 닫아버립니다. 
2. **트리 추적 타이밍 및 고아(Orphan) 이슈**: 훅 스크립트가 켜지자마자 자신의 부모(PPID)를 시작점으로 Windows WMI(`Get-CimInstance`)를 통해 최상위까지 조상 프로세스를 5단계 거슬러 올라가며 진짜 `claude-code` 프로세스를 찾으려 시도합니다. 그러나 WMI 조회 속도가 느려 이 조회를 하는 도중(1~2초)에 이미 중간 부모 쉘 프로세스들이 할 일을 마치고 닫혀버리면 사슬이 끊어지고 고아 프로세스가 되어 트리 추적에 실패합니다.
3. **거짓/단명 PID 저장**: 결국 스크립트가 영구적인 최외곽 Claude CLI(본체)의 진짜 PID를 찾지 못하고, 방금 죽어버린 임시 쉘의 PID나 거짓된 PID를 `agent_pids.json`에 저장해버립니다.
4. **아바타 즉시 삭제 착각**: 메인 앱(`main.js`)은 저장된 이 PID 값을 가져가서 스캔하는데, "어? 1초도 안돼서 내 감시 대상이 죽었네? 창이 강제종료됐구나!" 하고 대형 착각을 하며 모니터에서 **아바타를 그리자마자 순식간에 삭제(`DEAD`)** 해버립니다. (그리고 이후 채팅을 치면 다른 파일 모니터 로직에 의해 아바타가 부활해버리는 이상 패턴 발생)

#### 향후 구현 및 완벽한 해결 대안 2가지

1. **URL 콜백 + 심장박동(Heartbeat) 방식 (가장 추천하고 확실한 현대적 방식 🚀)**
   - 최신 Claude CLI(v2.1.63+)에서는 훅 실행 시 로컬 쉘 명령어 대신 URL POST 네트워크 콜백을 쏠 수 있습니다.
   - **방법**: Pixel Agent Desk 메인 앱 프로세스가 아주 가벼운 로컬 HTTP 서버(예: `localhost:3000`)를 엽니다.
   - **장점**: JSON 파일을 I/O로 수시로 썼다 지우거나 우회 프로세스를 만들어 느린 OS(Windows) WMI 부모 트리를 기형적으로 스니핑할 필요 없이 아주 깔끔하고 순수하게 해결됩니다. Claude가 직접 자기 상태 정보 등을 메신저 보내듯 보내주므로 아키텍처가 100% 무결하고 쾌적해집니다.

2. **CWD 기반 WMI 전체 모니터링 (무식하지만 확실한 우회 대안)**
   - 매 3~5초마다 OS 모니터링 앱이 실행 중인 "전체 `node.exe`의 커맨드라인 문자열"을 한 번에 뽑아낸 뒤, 해당 앱의 작업폴더(CWD)나 특정 인자를 가진 노드가 세상에서 완전히 종적을 감췄는지 무식하게 검사해 터미널 닫힘을 파악합니다. (현재 방식보다 리소스는 더 소모하나, 추적 사슬이 끊어지는 타이밍 오류는 원천 차단 가능)

### SessionEnd 훅 → JSONL 직접 기록 방식
HTTP 서버 없이 훅만으로 세션 종료를 즉시 감지하는 방법:

Claude CLI 훅은 실행 시 stdin으로 아래 데이터를 줌:
```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/xxx/abc123.jsonl"
}
```

`SessionEnd` 훅 스크립트가 `transcript_path`에 직접 한 줄을 append:
```js
// sessionend_hook.js
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  const { transcript_path, session_id } = JSON.parse(Buffer.concat(chunks).toString());
  const fs = require('fs');
  fs.appendFileSync(transcript_path, JSON.stringify({
    type: 'system',
    subtype: 'SessionEnd',
    sessionId: session_id,
    timestamp: new Date().toISOString()
  }) + '\n');
});
```

`logMonitor`의 `fs.watch`가 변경을 즉시 감지 → `SessionEnd` 파싱 → 에이전트 제거.
**HTTP 서버 불필요** — 과거 사용하던 `server.js`도 더 이상 필요 없습니다.

`.claude/settings.json` 훅 등록:
```json
{
  "hooks": {
    "SessionEnd": [{
      "type": "command",
      "command": "node /path/to/sessionend_hook.js"
    }]
  }
}
```

## 실행 방법
```bash
npm install
npm start
```

## 테스트 방법
1. 터미널에서 `claude` 실행
2. 아무 말이나 입력
3. 에이전트 카드 표시 확인
