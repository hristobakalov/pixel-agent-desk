# CLAUDE.md — Pixel Agent Desk

Electron app that visualizes Claude Code CLI status as pixel avatars. Pure JS, Canvas rendering, HTTP hooks (:47821).

## Rules

- Do not change IPC channel names, hookSchema `additionalProperties: true`, or AVATAR_FILES sync between `renderer/config.js` and `office/office-config.js`.
- Avatar lifecycle is fully PID-based (liveness checker) — do not add timer-based or manual dismiss mechanisms.

## Commands

- Run: `npm start`
- Tests: `npm test`

## Architecture

```
Claude CLI ──HTTP hook──▶ POST(:47821) ──▶ hookProcessor
                                              │
                                    ┌─────────┤
                                    ▼         ▼
                              agentManager  dashboard-server(:3000)
                                  │              │
                                  ▼              ▼
                            renderer/*      dashboard.html
                          (pixel avatar)   (web dashboard + office)
```

### Key Modules

| Module | File | Role |
|--------|------|------|
| Main | `src/main.js` | Module init, event wiring, app lifecycle |
| Hook Server | `src/main/hookServer.js` | HTTP :47821, AJV schema validation |
| Hook Processor | `src/main/hookProcessor.js` | Event switch + state mapping |
| Liveness Checker | `src/main/livenessChecker.js` | PID detection, zombie sweep (2s/30s) |
| Agent Manager | `src/agentManager.js` | Agent state Map, event emitting (SSoT) |
| Dashboard Server | `src/dashboard-server.js` | REST API + SSE for web dashboard |
| Renderer | `src/renderer/*.js` | Pixel avatar Canvas rendering |
| Virtual Office | `src/office/*.js` | 2D pixel art office (A* pathfinding, sprites) |

### Avatar Lifecycle

```
SessionStart hook → agent created (Waiting) → 10s grace period
                         │
         Hook events drive state: Waiting → Thinking → Working → Done
                         │
         Removal (automatic only, no manual dismiss):
           1. SessionEnd hook → immediate removal
           2. PID dead + transcript re-check fails → removal
           3. Zombie sweep: process count < agent count → oldest removed
```

### Known Limitation: PID Detection on Windows

- Windows에서 Claude가 JSONL 파일을 열어놓지 않아 transcript_path → PID 감지 실패 가능
- 다중 세션 시 fallback이 PID를 잘못 매핑할 수 있음 (좀비/고스트 아바타)
- 정상 사용(1-2 세션)에서는 문제 없음, 발생해도 표시만 불안정
- 근본 해결은 Claude Code가 hook payload에 PID를 포함하는 것
