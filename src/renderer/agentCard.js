/**
 * Agent Card — updateAgentState, createAgentCard
 */

function updateAgentState(agentId, container, agentOrState) {
  const isAgentObj = typeof agentOrState === 'object';
  const state = isAgentObj ? agentOrState.state : agentOrState;
  const isAggregated = isAgentObj && agentOrState.isAggregated;

  const baseConfig = stateConfig[state] || stateConfig['Waiting'];
  const config = { ...baseConfig };

  if (isAggregated) {
    config.label = "Managing...";
  }

  const currentTool = isAgentObj ? agentOrState.currentTool : null;
  if (currentTool && state === 'Working') {
    config.label = currentTool;
  }

  const bubble = container.querySelector('.agent-bubble');
  const character = container.querySelector('.agent-character');

  // ARIA 라벨 업데이트
  const agentDisplayName = container.querySelector('.agent-name')?.textContent || 'Agent';
  container.setAttribute('aria-label', `${agentDisplayName} - ${config.label}`);

  // Update container class + data-state for CSS selector targeting
  container.className = `agent-card ${config.class}`;
  container.setAttribute('data-state', state ? state.toLowerCase() : 'waiting');
  if (isAggregated) container.classList.add('is-aggregated');

  if (isAgentObj) {
    if (agentOrState.isSubagent) container.classList.add('is-subagent');
    else container.classList.remove('is-subagent');

    if (agentOrState.isTeammate) container.classList.add('is-teammate');
    else container.classList.remove('is-teammate');
  }

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

  // Timer element (createAgentCard에서 사전 생성됨)
  const timerEl = container.querySelector('.agent-timer');

  // Timer logic
  if (config.anim === 'working') {
    if (!agentState.startTime) {
      agentState.startTime = Date.now();
    }
    if (!agentState.timerInterval) {
      agentState.timerInterval = setInterval(() => {
        const elapsed = Date.now() - agentState.startTime;
        agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
        if (timerEl) timerEl.textContent = agentState.lastFormattedTime;
      }, 1000);
    }

    const elapsed = Date.now() - agentState.startTime;
    agentState.lastFormattedTime = window.electronAPI.formatTime(elapsed);
    if (bubble) bubble.textContent = config.label;
    if (timerEl) {
      timerEl.textContent = agentState.lastFormattedTime;
      timerEl.style.display = '';
    }

  } else if (config.anim === 'complete') {
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    if (bubble) bubble.textContent = config.label;
    if (timerEl) {
      timerEl.textContent = agentState.lastFormattedTime || '00:00';
      timerEl.style.display = '';
    }

  } else {
    if (agentState.timerInterval) {
      clearInterval(agentState.timerInterval);
      agentState.timerInterval = null;
    }
    agentState.startTime = null;
    agentState.lastFormattedTime = '';
    if (timerEl) timerEl.style.display = 'none';
    if (bubble) {
      // Thinking 상태: animated dots 표시
      if (state === 'Thinking' && !isAggregated) {
        bubble.innerHTML = '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
      } else {
        bubble.textContent = config.label;
      }
    }
  }

  agentStates.set(agentId, agentState);
}

function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.agentId = agent.id;
  card.tabIndex = 0;

  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `${agent.displayName || 'Agent'} - ${agent.state || 'Waiting'}`);

  if (agent.isSubagent) {
    card.classList.add('is-subagent');
    card.setAttribute('aria-label', `Subagent ${agent.displayName || 'Agent'} - ${agent.state || 'Waiting'}`);
  }

  // Create bubble
  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';
  bubble.textContent = 'Waiting...';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');

  // Create character
  const character = document.createElement('div');
  character.className = 'agent-character';

  // 에이전트별 아바타 배정 — 서버 할당 avatarIndex 우선, 폴백: 해시 계산
  let assignedAvatar = agentAvatars.get(agent.id);
  if (!assignedAvatar) {
    if (agent.avatarIndex !== undefined && agent.avatarIndex !== null && AVATAR_FILES[agent.avatarIndex]) {
      assignedAvatar = AVATAR_FILES[agent.avatarIndex];
    } else {
      assignedAvatar = avatarFromAgentId(agent.id);
    }
    agentAvatars.set(agent.id, assignedAvatar);
  }

  if (assignedAvatar) {
    character.style.backgroundImage = `url('./public/characters/${assignedAvatar}')`;
  }

  // 카드 타입 구분 (배지 및 테두리)
  let typeLabel = 'Main';
  let typeClass = 'type-main';
  if (agent.isSubagent) {
    typeLabel = agent.agentType ? agent.agentType : 'Sub';
    typeClass = 'type-sub';
  } else if (agent.isTeammate) {
    typeLabel = agent.teammateName || 'Team';
    typeClass = 'type-team';
  }
  card.classList.add(typeClass);

  // 상단 배지
  const typeTag = document.createElement('span');
  typeTag.className = `type-tag ${typeClass}`;
  typeTag.textContent = typeLabel;
  typeTag.title = agent.projectPath || '';
  card.appendChild(typeTag);

  // 에이전트 이름 — slug 기반 이름만 표시 (프로젝트 폴더명은 생략)
  const nameBadge = document.createElement('div');
  nameBadge.className = 'agent-name';
  const hasSlugName = agent.slug && agent.displayName && agent.displayName !== 'Agent';
  nameBadge.textContent = hasSlugName ? agent.displayName : '';
  nameBadge.title = agent.projectPath || '';
  if (!hasSlugName) nameBadge.style.display = 'none';

  // Timer element (사전 생성 — updateAgentState에서 동적 DOM 삽입 방지)
  const timerEl = document.createElement('div');
  timerEl.className = 'agent-timer';
  timerEl.style.display = 'none';

  // Assemble card
  card.appendChild(bubble);
  card.appendChild(timerEl);
  card.appendChild(character);
  card.appendChild(nameBadge);

  // 터미널 포커스 버튼
  const focusBtn = document.createElement('button');
  focusBtn.className = 'focus-terminal-btn';
  focusBtn.innerHTML = '<span class="focus-icon">&#xF0;</span>';
  focusBtn.title = '터미널 포커스 (클릭하면 해당 터미널로 이동)';
  focusBtn.setAttribute('aria-label', `Focus terminal for ${agent.displayName || 'Agent'}`);
  focusBtn.onclick = async (e) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.focusTerminal) {
      const result = await window.electronAPI.focusTerminal(agent.id);
      if (result && result.success) {
        focusBtn.classList.add('clicked');
        setTimeout(() => focusBtn.classList.remove('clicked'), 300);
      } else {
        // 실패 시 shake 애니메이션
        focusBtn.style.animation = 'shake 0.3s ease';
        focusBtn.title = 'PID를 찾을 수 없습니다';
        setTimeout(() => {
          focusBtn.style.animation = '';
          focusBtn.title = '터미널 포커스';
        }, 1500);
      }
    }
  };
  card.appendChild(focusBtn);

  // 캐릭터 찌르기(Poke) 상호작용
  character.style.cursor = 'pointer';
  const pokeMessages = [
    "앗, 깜짝이야!",
    "열심히 일하는 중입니다!",
    "코드 짜는 중...",
    "커피가 필요해요",
    "이 부분 버그 아니죠?",
    "간지러워요!",
    "제 타수 엄청 빠르죠?",
    "칭찬해주세요!"
  ];

  let pokeTimeout = null;
  character.onclick = (e) => {
    e.stopPropagation();
    if (pokeTimeout) return;
    const originalText = bubble.textContent;
    const randomMsg = pokeMessages[Math.floor(Math.random() * pokeMessages.length)];
    bubble.textContent = randomMsg;
    bubble.style.borderColor = '#ff4081';
    pokeTimeout = setTimeout(() => {
      bubble.style.borderColor = '';
      pokeTimeout = null;
      bubble.textContent = originalText;
    }, 2000);
  };

  return card;
}
