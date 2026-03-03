/**
 * Pixel Agent Desk Renderer - Multi-Agent Support
 * 멀티 에이전트 그리드 레이아웃 및 개별 상태 관리
 */

// --- DOM Elements ---
const agentGrid = document.getElementById('agent-grid');

// --- 스프라이트 시트 설정 ---
const SHEET = {
  cols: 9,
  width: 48,
  height: 64
};

// --- 애니메이션 시퀀스 ---
const ANIM_SEQUENCES = {
  working: { frames: [1, 2, 3, 4], fps: 8, loop: true },
  complete: { frames: [20, 21, 22, 23, 24, 25, 26, 27], fps: 6, loop: true },
  waiting: { frames: [32], fps: 1, loop: true },
  alert: { frames: [0, 31], fps: 4, loop: true }
};

// --- 상태별 맵핑 ---
const stateConfig = {
  'Working': { anim: 'working', class: 'state-working', label: 'Working...' },
  'Thinking': { anim: 'working', class: 'state-working', label: 'Working...' },
  'Done': { anim: 'complete', class: 'state-complete', label: 'Done!' },
  'Waiting': { anim: 'waiting', class: 'state-waiting', label: 'Waiting...' },
  'Error': { anim: 'alert', class: 'state-alert', label: 'Error!' },
  'Help': { anim: 'alert', class: 'state-alert', label: 'Help!' }
};

// --- 에이전트별 상태 관리 ---
const agentStates = new Map(); // agentId -> { animName, frameIdx, interval, startTime, timerInterval, lastFormattedTime }

// --- 유틸리티 함수 ---

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function drawFrame(element, frameIndex) {
  if (!element) return;
  const col = frameIndex % SHEET.cols;
  const row = Math.floor(frameIndex / SHEET.cols);
  const x = col * -SHEET.width;
  const y = row * -SHEET.height;
  element.style.backgroundPosition = `${x}px ${y}px`;
}

function playAnimation(agentId, element, animName) {
  const sequence = ANIM_SEQUENCES[animName];
  if (!sequence) return;

  const state = agentStates.get(agentId) || {};
  const prevAnim = state.animName;

  if (prevAnim === animName) return; // Already playing this animation

  // Clear previous interval
  if (state.interval) {
    clearInterval(state.interval);
  }

  // Update state
  state.animName = animName;
  state.frameIdx = 0;
  agentStates.set(agentId, state);

  // Draw first frame immediately
  drawFrame(element, sequence.frames[0]);

  // Start animation loop
  const interval = setInterval(() => {
    const currentState = agentStates.get(agentId);
    if (!currentState) {
      clearInterval(interval);
      return;
    }

    currentState.frameIdx++;

    if (currentState.frameIdx >= sequence.frames.length) {
      if (sequence.loop) {
        currentState.frameIdx = 0;
      } else {
        clearInterval(interval);
        return;
      }
    }

    drawFrame(element, sequence.frames[currentState.frameIdx]);
  }, 1000 / sequence.fps);

  // Store interval in state
  state.interval = interval;
  agentStates.set(agentId, state);
}

function updateAgentState(agentId, container, state) {
  const config = stateConfig[state] || stateConfig['Waiting'];
  const bubble = container.querySelector('.agent-bubble');
  const character = container.querySelector('.agent-character');

  // Update container class
  container.className = `agent-card ${config.class}`;

  // Play animation
  playAnimation(agentId, character, config.anim);

  // Get agent state
  let agentState = agentStates.get(agentId);
  if (!agentState) {
    agentState = {
      animName: null,
      frameIdx: 0,
      interval: null,
      startTime: null,
      timerInterval: null,
      lastFormattedTime: ''
    };
    agentStates.set(agentId, agentState);
  }

  // Timer logic
  if (config.anim === 'working') {
    if (!agentState.startTime) {
      agentState.startTime = Date.now();
      if (agentState.timerInterval) {
        clearInterval(agentState.timerInterval);
      }

      agentState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - agentState.startTime;
        agentState.lastFormattedTime = formatTime(elapsed);
        if (bubble) {
          bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
        }
      }, 1000);
    }

    // Immediate display
    const elapsed = Date.now() - agentState.startTime;
    agentState.lastFormattedTime = formatTime(elapsed);
    if (bubble) {
      bubble.textContent = `${config.label} (${agentState.lastFormattedTime})`;
    }

  } else if (config.anim === 'complete') {
    // Task complete - stop timer and keep final time
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    if (bubble) {
      const finalTime = agentState.lastFormattedTime || '00:00';
      bubble.textContent = `${config.label} (${finalTime})`;
    }
    agentState.startTime = null;

  } else {
    // Other states - clear timer
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    agentState.startTime = null;
    agentState.lastFormattedTime = '';
    if (bubble) {
      bubble.textContent = config.label;
    }
  }

  agentStates.set(agentId, agentState);
  console.log(`[Renderer] ${agentId.slice(0, 8)}: ${state} -> ${config.label}`);
}

// --- 에이전트 카드 생성/관리 ---

function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.agentId = agent.id;

  // Create bubble
  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';
  bubble.textContent = 'Waiting...';

  // Create character
  const character = document.createElement('div');
  character.className = 'agent-character';

  // Create dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'agent-dismiss';
  dismissBtn.textContent = '×';
  dismissBtn.title = 'Dismiss agent';
  dismissBtn.onclick = (e) => {
    e.stopPropagation();
    if (window.electronAPI) {
      window.electronAPI.dismissAgent(agent.id);
    }
  };

  // Assemble card
  card.appendChild(bubble);
  card.appendChild(character);
  card.appendChild(dismissBtn);

  // Click to focus terminal
  card.onclick = () => {
    if (window.electronAPI && agent.projectPath) {
      window.electronAPI.focusTerminal(agent.projectPath);
    }
  };

  return card;
}

function addAgent(agent) {
  // Check if already exists
  if (document.querySelector(`[data-agent-id="${agent.id}"]`)) {
    return;
  }

  const card = createAgentCard(agent);
  agentGrid.appendChild(card);

  // Set initial state
  updateAgentState(agent.id, card, agent.state || 'Waiting');

  // Update grid layout
  updateGridLayout();

  console.log(`[Renderer] Agent added: ${agent.displayName} (${agent.id.slice(0, 8)})`);
}

function updateAgent(agent) {
  const card = document.querySelector(`[data-agent-id="${agent.id}"]`);
  if (!card) return;

  updateAgentState(agent.id, card, agent.state || 'Waiting');
}

function removeAgent(data) {
  const card = document.querySelector(`[data-agent-id="${data.id}"]`);
  if (!card) return;

  // Clean up intervals
  const state = agentStates.get(data.id);
  if (state) {
    if (state.interval) clearInterval(state.interval);
    if (state.timerInterval) clearInterval(state.timerInterval);
    agentStates.delete(data.id);
  }

  card.remove();

  // Update grid layout
  updateGridLayout();

  console.log(`[Renderer] Agent removed: ${data.displayName} (${data.id.slice(0, 8)})`);
}

function cleanupAgents(data) {
  updateGridLayout();
  console.log(`[Renderer] Cleaned up ${data.count} agents`);
}

function updateGridLayout() {
  const agentCount = document.querySelectorAll('.agent-card').length;

  if (agentCount > 1) {
    agentGrid.classList.add('has-multiple');
  } else {
    agentGrid.classList.remove('has-multiple');
  }
}

// --- 이벤트 리스너 등록 ---

async function init() {
  if (!window.electronAPI) {
    console.error('[Renderer] electronAPI not available');
    return;
  }

  // Register event listeners
  window.electronAPI.onAgentAdded(addAgent);
  window.electronAPI.onAgentUpdated(updateAgent);
  window.electronAPI.onAgentRemoved(removeAgent);
  window.electronAPI.onAgentsCleaned(cleanupAgents);

  // Load existing agents
  try {
    const agents = await window.electronAPI.getAllAgents();
    console.log(`[Renderer] Loaded ${agents.length} existing agents`);
    for (const agent of agents) {
      addAgent(agent);
    }
    updateGridLayout();
  } catch (err) {
    console.error('[Renderer] Failed to load agents:', err);
  }

  // Signal renderer ready
  window.electronAPI.rendererReady();
  console.log('[Renderer] Initialized');
}

// --- Visibility handling ---

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause all animations when hidden
    for (const [agentId, state] of agentStates.entries()) {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
    }
  } else {
    // Resume animations when visible
    for (const [agentId, state] of agentStates.entries()) {
      if (state.animName) {
        const card = document.querySelector(`[data-agent-id="${agentId}"]`);
        const character = card?.querySelector('.agent-character');
        if (character) {
          const tempAnim = state.animName;
          state.animName = null; // Reset to force replay
          playAnimation(agentId, character, tempAnim);
        }
      }
    }
  }
});

// --- Start ---
init();
