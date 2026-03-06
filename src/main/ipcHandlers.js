/**
 * IPC Handlers
 * Register all ipcMain.on/handle handlers + focusTerminalByPid
 */

const { ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

function focusTerminalByPid(pid, label, debugLog) {
  const { execFile } = require('child_process');
  const psScript = `
$memberDef = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' +
  '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);' +
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);'
Add-Type -MemberDefinition $memberDef -Name W -Namespace FocusUtil -ErrorAction SilentlyContinue
$tpid = ${pid}
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 5; $i++) {
  $p = Get-Process -Id $tpid -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
    $hwnd = $p.MainWindowHandle
    break
  }
  $pp = (Get-CimInstance Win32_Process -Filter "ProcessId = $tpid" -ErrorAction SilentlyContinue).ParentProcessId
  if (-not $pp -or $pp -eq 0 -or $pp -eq $tpid) { break }
  $tpid = $pp
}
if ($hwnd -ne [IntPtr]::Zero) {
  if ([FocusUtil.W]::IsIconic($hwnd)) { [FocusUtil.W]::ShowWindow($hwnd, 9) | Out-Null }
  [FocusUtil.W]::SetForegroundWindow($hwnd) | Out-Null
}
`;
  execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 5000 }, (err) => {
    if (err) debugLog(`[${label}] Focus error: ${err.message}`);
  });
}

function registerIpcHandlers({ agentManager, sessionPids, windowManager, debugLog, adaptAgentToDashboard, errorHandler }) {
  ipcMain.on('resize-window', (e, size) => {
    const mw = windowManager.mainWindow;
    if (!mw || mw.isDestroyed()) return;
    const { width, height, x, y } = mw.getBounds();
    const newWidth = Math.max(220, Math.ceil(size.width ? size.width + 30 : width));
    const newHeight = Math.max(240, Math.ceil(size.height ? size.height + 40 : height));
    if (newWidth === width && newHeight === height) return;
    const dh = newHeight - height;
    const newY = Math.max(0, y - dh);
    mw.setBounds({ x, y: newY, width: newWidth, height: newHeight });
    debugLog(`[Main] Resize → ${newWidth}x${newHeight}`);
  });

  ipcMain.on('get-work-area', (event) => {
    event.reply('work-area-response', screen.getPrimaryDisplay().workArea);
  });

  ipcMain.on('get-avatars', (event) => {
    try {
      const charsDir = path.join(__dirname, '..', '..', 'public', 'characters');
      if (fs.existsSync(charsDir)) {
        const files = fs.readdirSync(charsDir);
        event.reply('avatars-response', files);
      } else {
        event.reply('avatars-response', []);
      }
    } catch (e) {
      errorHandler.capture(e, {
        code: 'E003',
        category: 'FILE_IO',
        severity: 'WARNING'
      });
      debugLog(`[Main] get-avatars error: ${e.message}`);
      event.reply('avatars-response', []);
    }
  });

  ipcMain.on('constrain-window', (event, bounds) => {
    const mw = windowManager.mainWindow;
    if (!mw) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const { width, height } = mw.getBounds();
    mw.setPosition(
      Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - width)),
      Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - height))
    );
  });

  ipcMain.on('get-all-agents', (event) => event.reply('all-agents-response', agentManager?.getAllAgents() ?? []));
  ipcMain.on('get-agent-stats', (event) => event.reply('agent-stats-response', agentManager?.getStats() ?? {}));

  ipcMain.handle('focus-terminal', async (event, agentId) => {
    const pid = sessionPids.get(agentId);
    if (!pid) {
      debugLog(`[Main] Focus: no PID for agent=${agentId.slice(0, 8)}`);
      return { success: false, reason: 'no-pid' };
    }
    debugLog(`[Main] Focus requested for agent=${agentId.slice(0, 8)} pid=${pid}`);
    focusTerminalByPid(pid, 'Main', debugLog);
    return { success: true };
  });

  // Dashboard IPC Handlers
  ipcMain.handle('open-web-dashboard', async (event) => {
    try {
      const result = windowManager.createDashboardWindow();
      return result;
    } catch (error) {
      debugLog(`[MissionControl] Error opening dashboard: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('close-web-dashboard', async (event) => {
    try {
      windowManager.closeDashboardWindow();
      return { success: true };
    } catch (error) {
      debugLog(`[MissionControl] Error closing dashboard: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('is-web-dashboard-open', async (event) => {
    const dw = windowManager.dashboardWindow;
    return {
      isOpen: dw !== null && !dw.isDestroyed()
    };
  });

  ipcMain.handle('get-error-logs', async () => {
    try {
      const logs = errorHandler.readRecentLogs(100);
      return { success: true, logs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('execute-recovery-action', async (event, errorId, action) => {
    try {
      debugLog(`[ErrorRecovery] Executing action: ${action} for error: ${errorId}`);

      switch (action) {
        case 'retry':
          break;
        case 'reset':
          break;
        case 'view_logs':
          break;
        default:
          break;
      }

      return { success: true };
    } catch (error) {
      errorHandler.capture(error, {
        code: 'E000',
        category: 'UNKNOWN',
        severity: 'ERROR'
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('dashboard-focus-agent', (event, agentId) => {
    const pid = sessionPids.get(agentId);
    if (!pid) {
      debugLog(`[Dashboard] Focus: no PID for agent=${agentId.slice(0, 8)}`);
      return;
    }
    debugLog(`[Dashboard] Focus requested for agent=${agentId.slice(0, 8)} pid=${pid}`);
    focusTerminalByPid(pid, 'Dashboard', debugLog);
  });

  ipcMain.on('get-dashboard-agents', (event) => {
    if (agentManager) {
      const agents = agentManager.getAllAgents();
      const adaptedAgents = agents.map(agent => adaptAgentToDashboard(agent));
      event.reply('dashboard-agents-response', adaptedAgents);
    } else {
      event.reply('dashboard-agents-response', []);
    }
  });
}

module.exports = { registerIpcHandlers };
