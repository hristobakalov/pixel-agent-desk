/**
 * Renderer Init — 초기화, visibility 핸들링
 */

async function init() {
  if (!window.electronAPI) {
    console.error('[Renderer] electronAPI not available');
    return;
  }

  setupKeyboardShortcuts();
  setupContextMenu();

  // 아바타 리스트 로드
  if (window.electronAPI.getAvatars) {
    try {
      const files = await window.electronAPI.getAvatars();
      const validFiles = files.filter(f => f.match(/\.(png|jpe?g|webp|gif)$/i));
      const zero = validFiles.find(f => f.includes('0.') || f.includes('_0.'));
      if (zero) idleAvatar = zero;

      availableAvatars = validFiles.filter(f => f !== idleAvatar);
      if (availableAvatars.length === 0 && idleAvatar) {
        availableAvatars.push(idleAvatar);
      }
    } catch (e) {
      console.warn('Failed to load avatars', e);
    }
  }

  // 대기 아바타 표시
  if (idleContainer) {
    idleContainer.style.display = 'flex';
    if (idleCharacter && idleAvatar) {
      idleCharacter.style.backgroundImage = `url('./public/characters/${idleAvatar}')`;
    }
    startIdleAnimation();
  }

  // Dashboard button — 아바타 바로 위에 배치 (toolbar 컨테이너)
  const toolbar = document.createElement('div');
  toolbar.className = 'avatar-toolbar';
  toolbar.appendChild(createWebDashboardButton());
  document.body.insertBefore(toolbar, document.getElementById('agent-grid'));

  // Register event listeners
  window.electronAPI.onAgentAdded(addAgent);
  window.electronAPI.onAgentUpdated(updateAgent);
  window.electronAPI.onAgentRemoved(removeAgent);
  window.electronAPI.onAgentsCleaned(cleanupAgents);

  if (window.electronAPI.onErrorOccurred) {
    window.electronAPI.onErrorOccurred(createErrorUI);
  }

  // Load existing agents
  try {
    const agents = await window.electronAPI.getAllAgents();
    window.lastAgents = [...agents];
    for (const agent of agents) {
      addAgent(agent);
    }
    updateGridLayout();
  } catch (err) {
    console.error('[Renderer] Failed to load agents:', err);
  }

  window.electronAPI.rendererReady();
}

// --- Visibility handling ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const [agentId, state] of agentStates.entries()) {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
    }
  } else {
    for (const [agentId, state] of agentStates.entries()) {
      if (state.animName) {
        const card = document.querySelector(`[data-agent-id="${agentId}"]`);
        const character = card?.querySelector('.agent-character');
        if (character) {
          const tempAnim = state.animName;
          state.animName = null;
          playAnimation(agentId, character, tempAnim);
        }
      }
    }
  }
});

// --- Start ---
init();
