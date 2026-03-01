const container = document.getElementById('container');
const speechBubble = document.getElementById('speech-bubble');

// 상태 설정 통합 (클래스 + 라벨)
const stateConfig = {
  'Start': { class: 'state-start', label: 'Starting...' },
  'UserPromptSubmit': { class: 'state-thinking', label: 'Working...' },
  'PostToolUse': { class: 'state-thinking', label: 'Working...' },
  'PreToolUse': { class: 'state-working', label: 'Working...' },
  'Stop': { class: 'state-complete', label: 'Done!' },
  'Error': { class: 'state-error', label: 'Error!' },
  'Notification': { class: 'state-alert', label: 'Notification' },
  'Idle': { class: 'state-Idle', label: 'Idle' },
  'Thinking': { class: 'state-thinking', label: 'Working...' },
  'Working': { class: 'state-working', label: 'Working...' },
  'Complete': { class: 'state-complete', label: 'Complete!' },
  'Alert': { class: 'state-alert', label: 'Alert!' }
};

// 상태 업데이트
function updateState(state, message) {
  console.log(`상태 업데이트: ${state} -> ${stateConfig[state]?.label}`);

  // 이전 상태 클래스 제거
  container.className = 'container';

  // 새로운 상태 클래스 추가
  const config = stateConfig[state] || stateConfig['Complete'];
  container.classList.add(config.class);

  // 말풍선 업데이트 (상태 라벨만 표시)
  speechBubble.textContent = config.label;
}

// IPC로 상태 업데이트 수신
if (window.electronAPI) {
  window.electronAPI.onStateUpdate((data) => {
    const { state, message } = data;
    updateState(state, message);
  });
}

// 백그라운드에서 애니메이션 일시 정지
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.body.classList.add('paused');
  } else {
    document.body.classList.remove('paused');
  }
});
