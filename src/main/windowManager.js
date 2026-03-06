/**
 * Window Manager
 * 메인윈도우, 대시보드윈도우, keep-alive, 리사이즈, 대시보드 서버 관리
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

function createWindowManager({ agentManager, sessionScanner, heatmapScanner, debugLog, adaptAgentToDashboard, errorHandler, getWindowSizeForAgents }) {
  let mainWindow = null;
  let dashboardWindow = null;
  let dashboardAuthToken = null;
  let keepAliveInterval = null;
  let dashboardServer = null;

  function resizeWindowForAgents(agentsOrCount) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width } = getWindowSizeForAgents(agentsOrCount);
    const bounds = mainWindow.getBounds();
    if (width !== bounds.width) {
      mainWindow.setBounds({ ...bounds, width: width });
    }
    const info = Array.isArray(agentsOrCount) ? agentsOrCount.length : agentsOrCount;
    debugLog(`[Main] Window width → ${width} (${info} agents based layout)`);
  }

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
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.loadFile(path.join(__dirname, '..', '..', 'index.html'));

    errorHandler.setMainWindow(mainWindow);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      // DevTools: --dev 인자 또는 npm run dev 일 때만
      if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    });

    // 메인 윈도우(아바타) 닫힘 → 대시보드도 닫고 앱 종료
    mainWindow.on('closed', () => {
      mainWindow = null;
      closeDashboardWindow();
      const { app } = require('electron');
      app.quit();
    });

    startKeepAlive();
  }

  function startKeepAlive() {
    if (keepAliveInterval) return;
    keepAliveInterval = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 5000);
    debugLog('[Main] Keep-alive interval started');
  }

  function stopKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
      debugLog('[Main] Keep-alive interval stopped');
    }
  }

  function createDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      debugLog('[MissionControl] Window already open, focusing existing window');
      if (dashboardWindow.isMinimized()) {
        dashboardWindow.restore();
      }
      dashboardWindow.focus();
      return { success: true, alreadyOpen: true };
    }

    try {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      // 맵(864) + 사이드바(280) + 패딩(56) = 1200, 높이: 화면 90% 활용
      const minDashW = 1200;
      const minDashH = 1000;
      const dashW = Math.min(Math.max(minDashW, Math.floor(width * 0.7)), width - 40);
      const dashH = Math.min(Math.max(minDashH, Math.floor(height * 0.9)), height - 40);

      dashboardWindow = new BrowserWindow({
        width: dashW,
        height: dashH,
        x: Math.floor((width - dashW) / 2),
        y: Math.floor((height - dashH) / 2),
        title: '픽셀 에이전트 데스크',
        backgroundColor: '#ffffff',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          preload: path.join(__dirname, '..', 'dashboardPreload.js')
        }
      });

      // HTTP 서버를 통해 로드 (file:// 대신) — office 모듈 등 정적 파일 서빙 필요
      dashboardWindow.loadURL('http://localhost:3000/');

      dashboardWindow.webContents.on('did-finish-load', () => {
        debugLog('[MissionControl] Window loaded successfully');

        if (agentManager) {
          const agents = agentManager.getAllAgents();
          const adaptedAgents = agents.map(agent => adaptAgentToDashboard(agent));
          debugLog(`[MissionControl] Sending ${adaptedAgents.length} agents to dashboard`);
          dashboardWindow.webContents.send('dashboard-initial-data', adaptedAgents);
        }
      });

      dashboardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        debugLog(`[MissionControl] Failed to load: ${errorCode} - ${errorDescription}`);
        dashboardWindow.destroy();
        dashboardWindow = null;
        dashboardAuthToken = null;
      });

      dashboardWindow.on('closed', () => {
        debugLog('[MissionControl] Window closed');
        dashboardWindow = null;
        dashboardAuthToken = null;
      });

      debugLog('[MissionControl] Window created');
      return { success: true };

    } catch (error) {
      debugLog(`[MissionControl] Failed to create window: ${error.message}`);
      dashboardWindow = null;
      dashboardAuthToken = null;
      return { success: false, error: error.message };
    }
  }

  function closeDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close();
      debugLog('[MissionControl] Window closed by request');
    }
    dashboardWindow = null;
    dashboardAuthToken = null;
  }

  function startDashboardServer() {
    if (dashboardServer) {
      debugLog('[Dashboard] 서버가 이미 실행 중입니다.');
      return;
    }

    debugLog('[Dashboard] 서버 시작 중...');

    try {
      const serverModule = require('../dashboard-server.js');

      if (agentManager) {
        serverModule.setAgentManager(agentManager);
      }
      if (sessionScanner) {
        serverModule.setSessionScanner(sessionScanner);
      }
      if (heatmapScanner) {
        serverModule.setHeatmapScanner(heatmapScanner);
      }

      dashboardServer = serverModule.startServer();

      debugLog('[Dashboard] 서버 시작 완료 (port 3000)');
    } catch (error) {
      debugLog(`[Dashboard] ❌ 시작 실패: ${error.message}`);
    }
  }

  function stopDashboardServer() {
    if (dashboardServer) {
      debugLog('[Dashboard] 서버 정리 중...');
      try {
        dashboardServer.close(() => {
          debugLog('[Dashboard] 서버 정리 완료');
        });
      } catch (error) {
        debugLog(`[Dashboard] 정리 중 오류: ${error.message}`);
      }
      dashboardServer = null;
    }
  }

  return {
    get mainWindow() { return mainWindow; },
    get dashboardWindow() { return dashboardWindow; },
    createWindow,
    startKeepAlive,
    stopKeepAlive,
    createDashboardWindow,
    closeDashboardWindow,
    startDashboardServer,
    stopDashboardServer,
    resizeWindowForAgents,
  };
}

module.exports = { createWindowManager };
