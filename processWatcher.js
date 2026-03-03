/**
 * Process Watcher
 * - Claude 프로세스 실행 여부 감지 (PowerShell / WMI)
 * - 하이브리드 점수제 전략: File Handle(100) + CWD(50) + 시간(30) + 부모(10)
 * - 에이전트 클릭 시 해당 터미널 창 포커스
 */

const { exec, spawn } = require('child_process');
const { normalizePath } = require('./utils');
const path = require('path');

class ProcessWatcher {
    /**
     * 파일 핸들 소유자 PID 확인 (handle64.exe 사용)
     * @param {string} filePath - JSONL 파일 경로
     * @returns {Promise<number|null>} 파일을 열고 있는 PID 또는 null
     */
    async getFileHandleOwner(filePath) {
        return new Promise((resolve) => {
            const fileName = path.basename(filePath);
            const cmd = `handle64.exe -a "${fileName}" | Select-String -Pattern "pid: (\\d+)" | ForEach-Object { $_.Matches.Groups[1].Value } | Select-Object -First 1`;

            exec(`powershell -NoProfile -NonInteractive -Command "${cmd}"`,
                { timeout: 3000, windowsHide: true },
                (err, stdout) => {
                    if (err || !stdout.trim()) return resolve(null);
                    try {
                        const pid = parseInt(stdout.trim());
                        resolve(!isNaN(pid) ? pid : null);
                    } catch { resolve(null); }
                }
            );
        });
    }

    /**
     * claude.exe 프로세스 목록을 비동기로 가져옴 (상세 정보 포함)
     * npm으로 설치된 claude는 node.exe로 실행되므로 node.exe도 검색
     * @returns {Promise<Array>} [{ ProcessId, ParentProcessId, WorkingDirectory, CreationDate }]
     */
    getClaudeProcesses() {
        return new Promise((resolve) => {
            const cmd = `Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*claude*' } | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`;
            exec(`powershell -NoProfile -NonInteractive -Command "${cmd}"`,
                { timeout: 5000, windowsHide: true },
                (err, stdout) => {
                    if (err || !stdout.trim()) return resolve([]);
                    try {
                        const parsed = JSON.parse(stdout.trim());
                        const arr = Array.isArray(parsed) ? parsed : [parsed];
                        // CommandLine에서 CWD 추출
                        resolve(arr.filter(p => p && p.CommandLine).map(p => {
                            const cwdMatch = p.CommandLine.match(/--cwd[ "']([^"']+)["']/);
                            const cwd = cwdMatch ? cwdMatch[1] : null;
                            return {
                                ProcessId: p.ProcessId,
                                ParentProcessId: p.ParentProcessId,
                                WorkingDirectory: cwd,
                                CommandLine: p.CommandLine,
                                CreationDate: p.CreationDate ? new Date(p.CreationDate) : new Date()
                            };
                        }));
                    } catch { resolve([]); }
                }
            );
        });
    }

    /**
     * 프로세스와 에이전트 매칭 점수 계산 (하이브리드 전략)
     * @param {Object} agentData - 에이전트 정보
     * @param {Array} processes - Claude 프로세스 목록
     * @returns {Promise<Object>} { bestMatch, score, details }
     */
    async getProcessScore(agentData, processes) {
        let bestMatch = null;
        let bestScore = 0;
        const details = [];

        console.log(`[ProcessWatcher] Scoring ${agentData.displayName} (${agentData.projectPath}) against ${processes.length} processes`);

        for (const proc of processes) {
            let score = 0;
            const reasons = [];

            // 1. File Handle 소유 (100점) - 가장 정확
            const fileOwner = await this.getFileHandleOwner(agentData.jsonlPath);
            if (fileOwner && fileOwner === proc.ProcessId) {
                score += 100;
                reasons.push('File Handle owner');
            }

            // 2. CWD 일치 (50점) - 기본 필터
            if (proc.WorkingDirectory && agentData.projectPath) {
                const procCwd = normalizePath(proc.WorkingDirectory);
                const agentCwd = normalizePath(agentData.projectPath);
                if (procCwd === agentCwd) {
                    score += 50;
                    reasons.push('CWD match');
                }
            } else if (agentData.projectPath) {
                // WorkingDirectory가 없으면 CommandLine에서 추출 시도
                if (proc.CommandLine && proc.CommandLine.includes(agentData.projectPath)) {
                    score += 30;
                    reasons.push('Path in CommandLine');
                }
            }

            // 3. 시작 시간 오차 < 5s (30점)
            if (agentData.startTime && proc.CreationDate) {
                const timeDiff = Math.abs(agentData.startTime - proc.CreationDate);
                if (timeDiff < 5000) {
                    score += 30;
                    reasons.push(`Time diff: ${Math.round(timeDiff/1000)}s`);
                }
            }

            // 4. Parent Process 일치 (10점)
            if (agentData.parentPid && proc.ParentProcessId) {
                if (agentData.parentPid === proc.ParentProcessId) {
                    score += 10;
                    reasons.push('Parent match');
                }
            }

            if (reasons.length > 0) {
                details.push({ pid: proc.ProcessId, score, reasons: reasons.join(', ') });
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = proc;
            }
        }

        console.log(`[ProcessWatcher] → Best score: ${bestScore}, details:`, details);
        return { bestMatch, score: bestScore, details };
    }

    /**
     * 특정 에이전트의 실행 중인 프로세스 확인 (하이브리드 방식)
     * @param {Object} agentData - 에이전트 정보
     * @param {Array} processes - getClaudeProcesses() 결과
     * @returns {Promise<boolean>} 실행 중이면 true
     */
    async isRunningForAgent(agentData, processes) {
        if (!agentData || !processes.length) return false;

        // 점수제 매칭
        const result = await this.getProcessScore(agentData, processes);

        // 점수가 50점 이상이면 실행 중으로 간주
        const isRunning = result.score >= 50;

        if (isRunning && result.bestMatch) {
            // 매칭된 PID를 에이전트에 저장 (나중에 포커스용)
            agentData.pid = result.bestMatch.ProcessId;
        }

        return isRunning;
    }

    /**
     * 특정 cwd의 Claude 프로세스가 실행 중인지 확인 (레거시 호환용)
     * @param {string} cwd - 에이전트의 projectPath
     * @param {Array} processes - getClaudeProcesses() 결과 (미리 가져온 경우)
     */
    isRunningForCwd(cwd, processes = []) {
        if (!cwd || !processes.length) return false;
        const target = normalizePath(cwd);
        return processes.some(p => normalizePath(p.WorkingDirectory) === target);
    }

    /**
     * cwd에 해당하는 터미널 창을 최상위로 포커스
     * claude.exe 프로세스 트리를 올라가며 창 핸들을 찾고 SetForegroundWindow 호출
     * @param {string} cwd
     */
    focusTerminal(cwd) {
        if (!cwd) return;

        // PowerShell 경로 패스용 이스케이프
        const safeCwd = cwd.replace(/\\/g, '\\\\').replace(/'/g, "''");

        const script = `
$targetCwd = '${safeCwd}'.ToLower().TrimEnd('\\\\')

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Focus-Window([IntPtr]$hwnd) {
    [WinHelper]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
    [WinHelper]::SetForegroundWindow($hwnd) | Out-Null
}

# claude.exe 프로세스 탐색 (cwd 일치 우선)
$claudeProcs = Get-CimInstance Win32_Process -Filter "name='claude.exe'" |
    Where-Object { $_.WorkingDirectory.ToLower().TrimEnd('\\\\') -eq $targetCwd }

$focused = $false
foreach ($proc in $claudeProcs) {
    $pid = [int]$proc.ParentProcessId
    for ($i = 0; $i -lt 5; $i++) {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
            Focus-Window $p.MainWindowHandle
            $focused = $true
            break
        }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $parent) { break }
        $pid = [int]$parent.ParentProcessId
    }
    if ($focused) { break }
}

# 폴백: 가장 최근 터미널 창
if (-not $focused) {
    $term = @('WindowsTerminal','wt','powershell','pwsh','cmd') | ForEach-Object {
        Get-Process -Name $_ -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
    } | Where-Object { $_ } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($term) { Focus-Window $term.MainWindowHandle }
}`;

        spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        }).unref();
    }
}

module.exports = ProcessWatcher;
