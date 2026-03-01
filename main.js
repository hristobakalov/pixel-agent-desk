const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const server = require('./server');

let mainWindow;
let httpServer;

// 윈도우 생성
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 220,
    height: 200,
    x: Math.round((width - 220) / 2),
    y: Math.round((height - 200) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  // 서버 모듈에 메인 윈도우 전달
  server.setMainWindow(mainWindow);

  // 태스크바 위로 올리기 (최상단 레벨)
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
}

// Claude CLI 훅 자동 등록
function registerHooks() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const serverUrl = `http://localhost:${server.getServerPort()}/agent/status`;

  try {
    if (!fs.existsSync(settingsPath)) return;

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    // 최신 Claude CLI 훅 명칭 (type: "http" 사용)
    const hookEvents = [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'Notification'
    ];

    if (!settings.hooks) settings.hooks = {};

    let updated = false;

    // 이전 방식의 무효한 훅 제거
    ['Start', 'Error'].forEach(h => {
      if (settings.hooks[h]) { delete settings.hooks[h]; updated = true; }
    });

    // 최신 규격(type: "http")으로 훅 등록/업데이트
    hookEvents.forEach(name => {
      const target = [{
        matcher: "*",
        hooks: [{
          type: "http",
          url: serverUrl
        }]
      }];

      if (JSON.stringify(settings.hooks[name]) !== JSON.stringify(target)) {
        settings.hooks[name] = target;
        updated = true;
      }
    });

    if (updated) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('최신 Claude CLI 훅 설정(HTTP 방식) 완료');
    }
  } catch (error) {
    console.error('훅 등록 실패:', error);
  }
}

// 앱 시작
app.disableHardwareAcceleration(); // GPU 가속 비활성화

app.whenReady().then(async () => {
  httpServer = await server.createHttpServer();
  console.log(`Pixel Agent Desk started - HTTP Server on port ${server.getServerPort()}`);

  createWindow();
  registerHooks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 앱 종료
app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (httpServer) {
    httpServer.close();
  }
});

// 상태 조회 공통 함수
function getAgentStates() {
  return Array.from(agentStates.entries()).map(([sessionId, data]) => ({
    sessionId,
    ...data
  }));
}

// IPC 핸들러
ipcMain.on('get-work-area', (event) => {
  const workArea = screen.getPrimaryDisplay().workArea;
  event.reply('work-area-response', workArea);
});

ipcMain.on('constrain-window', (event, bounds) => {
  const workArea = screen.getPrimaryDisplay().workArea;
  const { width, height } = mainWindow.getBounds();

  let newX = bounds.x;
  let newY = bounds.y;

  // 화면 경계 체크 (스냅)
  if (newX < workArea.x) newX = workArea.x;
  if (newX + width > workArea.x + workArea.width) newX = workArea.x + workArea.width - width;
  if (newY < workArea.y) newY = workArea.y;
  if (newY + height > workArea.y + workArea.height) newY = workArea.y + workArea.height - height;

  mainWindow.setPosition(newX, newY);
});

ipcMain.on('get-state', (event) => {
  const state = server.getAgentStates();
  event.reply('state-response', state);
});
