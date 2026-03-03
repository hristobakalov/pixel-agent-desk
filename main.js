const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const LogMonitor = require('./logMonitor');
const AgentManager = require('./agentManager');

// Debug logging to file
const debugLog = (msg) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(path.join(__dirname, 'debug.log'), logMsg);
  console.log(msg);
};

let mainWindow;
let logMonitor = null;
let agentManager = null;

// =====================================================
// 에이전트 수에 따른 동적 윈도우 크기 (P1-6)
// =====================================================
function getWindowSizeForAgents(count) {
  if (count <= 1) return { width: 220, height: 200 };

  // 멀티 에이전트: 카드 90px × N + 갭 + 외부 패딩
  const CARD_W = 90;
  const GAP = 10;
  const OUTER = 20;
  const HEIGHT = 195;

  const width = Math.max(220, count * CARD_W + (count - 1) * GAP + OUTER);
  return { width, height: HEIGHT };
}

function resizeWindowForAgents(count) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = getWindowSizeForAgents(count);
  mainWindow.setSize(width, height);
  console.log(`[Main] Window → ${width}×${height} (${count} agents)`);
}

// =====================================================
// 윈도우 생성
// =====================================================
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winSize = getWindowSizeForAgents(0);

  mainWindow = new BrowserWindow({
    width: winSize.width,
    height: winSize.height,
    x: Math.round((width - winSize.width) / 2),
    y: Math.round((height - winSize.height) / 2),
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  // 작업표시줄 복구 폴링 (250ms)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 250);
}

// =====================================================
// 앱 설정
// ============================================================
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');
process.env.ELECTRON_DISABLE_LOGGING = '1';
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// =====================================================
// Claude CLI 훅 자동 등록 & 프로세스 PID 모니터링
// =====================================================
const HOOK_SERVER_PORT = 47821;

function setupClaudeHooks() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const rawContent = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
        settings = JSON.parse(rawContent);
      } catch (parseErr) {
        debugLog(`[Main] settings.json parse error: ${parseErr.message}. Backing up.`);
        try { fs.copyFileSync(settingsPath, settingsPath + '.corrupt_backup'); } catch (e) { }
        settings = {};
      }
    }
    if (!settings.hooks) settings.hooks = {};

    const hookScript = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
    const hookCmd = `node "${hookScript}"`;

    // command 훅으로 모든 이벤트를 hook.js로 전달 → hook.js가 HTTP 서버로 POST
    const HOOK_EVENTS = [
      'SessionStart', 'SessionEnd',
      'PreToolUse', 'PostToolUse',
      'TaskCompleted', 'PermissionRequest',
      'SubagentStart', 'SubagentStop',
    ];

    for (const eventName of HOOK_EVENTS) {
      let hooks = settings.hooks[eventName] || [];
      // 기존 hook.js 훅 제거 (중복 방지)
      hooks = hooks.filter(c => !c.hooks?.some(h => h.type === 'command' && h.command?.includes('hook.js')));
      // 기존 http 훅도 제거 (Claude CLI가 http 훅을 보내지 않으므로)
      hooks = hooks.filter(c => !c.hooks?.some(h => h.type === 'http' && h.url?.includes(`:${HOOK_SERVER_PORT}`)));
      hooks.push({ matcher: "*", hooks: [{ type: "command", command: hookCmd }] });
      settings.hooks[eventName] = hooks;
    }

    // SessionEnd 추가: JSONL 직접 기록 보험 (강제 종료 직전 sessionend_hook.js 실행)
    const endScript = path.join(__dirname, 'sessionend_hook.js').replace(/\\/g, '/');
    let endHooks = settings.hooks['SessionEnd'] || [];
    endHooks = endHooks.filter(c => !c.hooks?.some(h => h.type === 'command' && h.command?.includes('sessionend_hook')));
    endHooks.push({ matcher: "*", hooks: [{ type: "command", command: `node "${endScript}"` }] });
    settings.hooks['SessionEnd'] = endHooks;

    const tmpPath = settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 4), 'utf-8');
    fs.renameSync(tmpPath, settingsPath);
    debugLog(`[Main] Registered all hooks via hook.js`);
  } catch (e) {
    debugLog(`[Main] Failed to setup hooks: ${e.message}`);
  }
}

// =====================================================
// HTTP 훅 서버 — Claude CLI가 SessionStart/End를 POST로 알려줌
// =====================================================
// agentManager 준비 전에 도착한 SessionStart를 임시 보관
const pendingSessionStarts = [];
// 세션별 첫 PreToolUse 여부 추적 (초기화 탐색 무시용)
const firstPreToolUseDone = new Map(); // sessionId → boolean

function startHookServer() {
  const http = require('http');

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404); res.end(); return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      try {
        const data = JSON.parse(body);
        const event = data.hook_event_name;
        const sessionId = data.session_id || data.sessionId;
        if (!sessionId) return;

        debugLog(`[Hook] ${event} session=${sessionId.slice(0, 8)}`);

        switch (event) {
          case 'SessionStart':
            handleSessionStart(sessionId, data.cwd || '');
            break;

          case 'SessionEnd':
            handleSessionEnd(sessionId);
            break;

          case 'PreToolUse':
          case 'PostToolUse': {
            // 첫 PreToolUse는 Claude 세션 초기화(cwd 탐색 등)이므로 무시
            // 두 번째부터는 사용자 요청에 의한 실제 도구 사용 → Working
            if (!firstPreToolUseDone.has(sessionId)) {
              firstPreToolUseDone.set(sessionId, true);
              debugLog(`[Hook] ${event} ignored (first tool use = session init)`);
            } else if (agentManager) {
              const agent = agentManager.getAgent(sessionId);
              if (agent) agentManager.updateAgent({ ...agent, sessionId, state: 'Working' }, 'hook');
            }
            break;
          }

          case 'TaskCompleted':
            // AI 응답 완료 → Done, 다음 사용자 메시지를 위해 첫 PreToolUse 플래그 리셋
            firstPreToolUseDone.delete(sessionId);
            if (agentManager) {
              const agent = agentManager.getAgent(sessionId);
              if (agent) agentManager.updateAgent({ ...agent, sessionId, state: 'Done' }, 'hook');
            }
            break;

          case 'PermissionRequest':
            // 권한 요청 → Help (사용자 입력 필요)
            if (agentManager) {
              const agent = agentManager.getAgent(sessionId);
              if (agent) agentManager.updateAgent({ ...agent, sessionId, state: 'Help' }, 'hook');
            }
            break;

          case 'SubagentStart': {
            const subId = data.subagent_session_id || data.agent_id;
            if (subId) handleSessionStart(subId, data.cwd || '');
            break;
          }

          case 'SubagentStop': {
            const subId = data.subagent_session_id || data.agent_id;
            if (subId) handleSessionEnd(subId);
            break;
          }

          default:
            debugLog(`[Hook] Unknown event: ${event} — ${JSON.stringify(data).slice(0, 200)}`);
        }
      } catch (e) {
        debugLog(`[Hook] Parse error: ${e.message}`);
      }
    });
  });

  server.on('error', (e) => debugLog(`[Hook] Server error: ${e.message}`));
  server.listen(HOOK_SERVER_PORT, '127.0.0.1', () => {
    debugLog(`[Hook] HTTP hook server listening on port ${HOOK_SERVER_PORT}`);
  });
}

function handleSessionStart(sessionId, cwd) {
  if (!agentManager) {
    // agentManager가 아직 준비 안 됐으면 대기열에 보관
    pendingSessionStarts.push({ sessionId, cwd, ts: Date.now() });
    debugLog(`[Hook] SessionStart queued (agentManager not ready): ${sessionId.slice(0, 8)}`);
    return;
  }
  const displayName = cwd ? require('path').basename(cwd) : 'Agent';
  agentManager.updateAgent({
    sessionId,
    projectPath: cwd,
    displayName,
    state: 'Waiting',
    jsonlPath: null
  }, 'http');
  debugLog(`[Hook] SessionStart → agent registered: ${sessionId.slice(0, 8)} (${displayName})`);
}

function handleSessionEnd(sessionId) {
  firstPreToolUseDone.delete(sessionId); // 플래그 정리
  if (!agentManager) return;
  const agent = agentManager.getAgent(sessionId);
  if (agent) {
    debugLog(`[Hook] SessionEnd → removing agent ${sessionId.slice(0, 8)}`);
    // JSONL에 SessionEnd 기록 (LogMonitor 좀비 방지)
    if (agent.jsonlPath && fs.existsSync(agent.jsonlPath)) {
      try {
        fs.appendFileSync(agent.jsonlPath, JSON.stringify({
          type: 'system', subtype: 'SessionEnd',
          sessionId: agent.id, timestamp: new Date().toISOString()
        }) + '\n');
      } catch (e) { }
    }
    agentManager.removeAgent(sessionId);
  } else {
    debugLog(`[Hook] SessionEnd for unknown agent ${sessionId.slice(0, 8)}`);
  }
}

function startProcessScanner() {
  const { execFile } = require('child_process');
  const SCAN_INTERVAL = 5000;
  const GRACE_PERIOD_MS = 15000;  // 등록 후 15초는 스캔 제외
  const MAX_ABSENT = 3;           // 3회 연속 미발견 시 DEAD
  const absentCounts = new Map();

  function scanClaudeProcesses(callback) {
    const psCmd = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*claude-code*cli.js*' } | ForEach-Object { $_.ProcessId }`;
    execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { timeout: 8000 }, (err, stdout) => {
      if (err) { debugLog(`[Scan] Error: ${err.message}`); callback([]); return; }
      const pids = stdout.trim().split('\n').map(l => parseInt(l.trim(), 10)).filter(p => p > 0);
      callback(pids);
    });
  }

  setInterval(() => {
    if (!agentManager) return;
    const agents = agentManager.getAllAgents();
    if (agents.length === 0) return;

    scanClaudeProcesses((livePids) => {
      debugLog(`[Scan] ${livePids.length} proc(s), ${agents.length} agent(s)`);

      // Grace Period 내 에이전트는 체크 제외
      const checkable = agents.filter(a => {
        if (a.firstSeen && Date.now() - a.firstSeen < GRACE_PERIOD_MS) {
          absentCounts.delete(a.id); return false;
        }
        return true;
      });
      if (checkable.length === 0) return;

      // 프로세스 수 ≥ 에이전트 수 → 모두 살아있음
      if (livePids.length >= checkable.length) {
        for (const a of checkable) absentCounts.delete(a.id);
        return;
      }

      // 초과 에이전트: jsonlPath mtime 기준으로 가장 오래된 것부터 suspect
      const excessCount = checkable.length - livePids.length;
      const withMtime = checkable.map(a => {
        let mtime = 0;
        try { if (a.jsonlPath) mtime = fs.statSync(a.jsonlPath).mtimeMs; } catch (e) { }
        return { agent: a, mtime };
      }).sort((a, b) => a.mtime - b.mtime);

      for (const { agent } of withMtime.slice(excessCount)) absentCounts.delete(agent.id);

      for (const { agent } of withMtime.slice(0, excessCount)) {
        const count = (absentCounts.get(agent.id) || 0) + 1;
        absentCounts.set(agent.id, count);
        if (count < MAX_ABSENT) {
          debugLog(`[Scan] Agent ${agent.id.slice(0, 8)} suspect ${count}/${MAX_ABSENT}`);
          continue;
        }
        debugLog(`[Scan] Agent ${agent.id.slice(0, 8)} DEAD after ${count} scans`);
        absentCounts.delete(agent.id);
        if (agent.jsonlPath && fs.existsSync(agent.jsonlPath)) {
          try { fs.appendFileSync(agent.jsonlPath, JSON.stringify({ type: 'system', subtype: 'SessionEnd', sessionId: agent.id, timestamp: new Date().toISOString() }) + '\n'); } catch (e) { }
        }
        agentManager.removeAgent(agent.id);
      }
    });
  }, SCAN_INTERVAL);
}

app.whenReady().then(() => {
  debugLog('Pixel Agent Desk started');
  startHookServer();       // HTTP 훅 서버 먼저 시작
  setupClaudeHooks();      // 훅 설정 등록
  startProcessScanner();   // 강제 종료 백업 스캔
  createWindow();


  ipcMain.once('renderer-ready', () => {
    debugLog('[Main] renderer-ready event received!');

    agentManager = new AgentManager();
    agentManager.start();
    debugLog('[Main] AgentManager started');

    // agentManager 준비 전에 도착한 SessionStart 처리
    while (pendingSessionStarts.length > 0) {
      const { sessionId, cwd } = pendingSessionStarts.shift();
      handleSessionStart(sessionId, cwd);
    }

    // 에이전트 이벤트 → renderer IPC 전달 + 동적 리사이징
    agentManager.on('agent-added', (agent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-added', agent);
        resizeWindowForAgents(agentManager.getAgentCount());
      }
    });

    agentManager.on('agent-updated', (agent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-updated', agent);
      }
    });

    agentManager.on('agent-removed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-removed', data);
        resizeWindowForAgents(agentManager.getAgentCount());
      }
    });

    agentManager.on('agents-cleaned', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agents-cleaned', data);
        resizeWindowForAgents(agentManager.getAgentCount());
      }
    });

    logMonitor = new LogMonitor(agentManager);
    debugLog('[Main] Starting LogMonitor...');
    logMonitor.start();
    debugLog('[Main] LogMonitor started');

    // =====================================================
    // 비활성 에이전트 정리: JSONL mtime 기반 (P3-Active)
    // Claude가 실행 중이면 로그 파일이 계속 갱신됨
    // 30분 이상 로그 변경이 없으면 비활성으로 간주 → 제거
    // =====================================================
    const INACTIVE_MS = 30 * 60 * 1000; // 30분

    function checkInactiveAgents() {
      if (!agentManager || !logMonitor) return;
      const now = Date.now();
      const agents = agentManager.getAllAgents();

      for (const agent of agents) {
        if (!agent.jsonlPath) continue;

        try {
          const stat = require('fs').statSync(agent.jsonlPath);
          const mtime = stat.mtimeMs;
          const age = now - mtime;

          if (age > INACTIVE_MS) {
            debugLog(`[Main] Agent '${agent.displayName}' inactive for ${Math.round(age / 60000)}min, removing...`);
            agentManager.removeAgent(agent.id);
          }
        } catch (e) {
          // 파일이 없어진 경우도 제거
          debugLog(`[Main] Agent '${agent.displayName}' jsonl missing, removing...`);
          agentManager.removeAgent(agent.id);
        }
      }
    }

    // 시작 5분 후 첫 체크 (앱 시작 직후엔 로그가 오래됐을 수 있음)
    setTimeout(() => checkInactiveAgents(), 5 * 60 * 1000);

    // 이후 5분마다 주기적 체크
    setInterval(() => checkInactiveAgents(), 5 * 60 * 1000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (logMonitor) logMonitor.stop();
  if (agentManager) agentManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (logMonitor) logMonitor.stop();
  if (agentManager) agentManager.stop();
});

// =====================================================
// IPC 핸들러
// =====================================================

ipcMain.on('get-work-area', (event) => {
  event.reply('work-area-response', screen.getPrimaryDisplay().workArea);
});

ipcMain.on('constrain-window', (event, bounds) => {
  const wa = screen.getPrimaryDisplay().workArea;
  const { width, height } = mainWindow.getBounds();
  mainWindow.setPosition(
    Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - width)),
    Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - height))
  );
});

ipcMain.on('get-all-agents', (event) => event.reply('all-agents-response', agentManager?.getAllAgents() ?? []));
ipcMain.on('get-agent-stats', (event) => event.reply('agent-stats-response', agentManager?.getStats() ?? {}));

// 에이전트 수동 퇴근 IPC 핸들러
ipcMain.on('dismiss-agent', (event, agentId) => {
  if (agentManager) agentManager.dismissAgent(agentId);
});
