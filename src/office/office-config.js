/**
 * Office Config — Constants, sprite frame map, seat configs, state mappings
 * Ported from pixel_office spriteSheet.ts, types.ts, seatConfigs.ts
 */

/* eslint-disable no-unused-vars */

const OFFICE = {
  TILE_SIZE: 32,
  FRAME_W: 48,
  FRAME_H: 64,
  COLS: 8,  // 384px / 48px = 8 cols × 9 rows = 72 frames
  ANIM_FPS: 8,
  ANIM_INTERVAL: 1000 / 8,
  IDLE_ANIM_INTERVAL: 1000 / 2,
  MOVE_SPEED: 110,
  ARRIVE_THRESHOLD: 2,
};

// Sprite frame map (avatar_*.webp — 384x576, 8cols x 9rows, 48x64px/frame)
// Row 0: front_idle(0-3)  front_walk(4-7)
// Row 1: front_sit_idle(8-11)  front_sit_work(12-15)
// Row 2: left_idle(16-19)  left_walk(20-23)
// Row 3: left_sit_idle(24-27)  left_sit_work(28-31)
// Row 4: right_idle(32-35)  right_walk(36-39)
// Row 5: right_sit_idle(40-43)  right_sit_work(44-47)
// Row 6: back_idle(48-51)  back_walk(52-55)
// Row 7: back_sit_idle(56-59)  back_sit_work(60-63)
// Row 8: front_done_dance(64-67)  front_alert_jump(68-71)
const SPRITE_FRAMES = {
  down_idle:      [0, 1, 2, 3],
  walk_down:      [4, 5, 6, 7],
  left_idle:      [16, 17, 18, 19],
  walk_left:      [20, 21, 22, 23],
  right_idle:     [32, 33, 34, 35],
  walk_right:     [36, 37, 38, 39],
  up_idle:        [48, 49, 50, 51],
  walk_up:        [52, 53, 54, 55],
  dance:          [64, 65, 66, 67],
  alert_jump:     [68, 69, 70, 71],
  sit_down:       [8,  9,  10, 11],
  sit_left:       [24, 25, 26, 27],
  sit_right:      [40, 41, 42, 43],
  sit_up:         [56, 57, 58, 59],
  sit_work_down:  [12, 13, 14, 15],
  sit_work_left:  [28, 29, 30, 31],
  sit_work_right: [44, 45, 46, 47],
  sit_work_up:    [60, 61, 62, 63],
};

// Animation keys that use the slower idle FPS (vs active/walk FPS)
const IDLE_ANIM_KEYS = new Set([
  'down_idle', 'left_idle', 'right_idle', 'up_idle',
  'sit_down', 'sit_left', 'sit_right', 'sit_up',
  'dance',
]);

// Seat direction/pose config (global ID → pose)
const SEAT_MAP = {
  10: { dir: 'right', animType: 'sit' },
  12: { dir: 'right', animType: 'sit' },
  18: { dir: 'right', animType: 'sit' },
  28: { dir: 'right', animType: 'sit' },

  11: { dir: 'left', animType: 'sit' },
  13: { dir: 'left', animType: 'sit' },
  19: { dir: 'left', animType: 'sit' },
  29: { dir: 'left', animType: 'sit' },

  24: { dir: 'up', animType: 'stand' },

  4:  { dir: 'up', animType: 'sit' },
  5:  { dir: 'up', animType: 'sit' },
  6:  { dir: 'up', animType: 'sit' },
  7:  { dir: 'up', animType: 'sit' },
  14: { dir: 'up', animType: 'sit' },
  15: { dir: 'up', animType: 'sit' },
};

function getSeatConfig(id) {
  return SEAT_MAP[id] || { dir: 'down', animType: 'sit' };
}

// Idle zone spot → resting animation ('dance' or sit direction)
const IDLE_SEAT_MAP = {
  18: 'right',
  28: 'right',
  24: 'dance',
  19: 'left',
  29: 'left',
  // all others default to 'down' (front_sit_idle)
};

// Dashboard status → office zone mapping
const STATE_ZONE_MAP = {
  'working':   'desk',
  'thinking':  'desk',
  'waiting':   'idle',
  'completed': 'idle',
  'help':      'desk',
  'error':     'desk',
};

// State colors for nametags (unified palette — synced with styles.css, dashboard.html)
const STATE_COLORS = {
  idle:      '#94a3b8',
  working:   '#f97316',
  thinking:  '#8b5cf6',
  meeting:   '#3b82f6',
  wandering: '#a855f7',
  error:     '#ef4444',
  done:      '#22c55e',
  completed: '#22c55e',
  waiting:   '#94a3b8',
  help:      '#ef4444',
};

// All available avatar filenames (must match public/characters/)
var AVATAR_FILES = [
  'avatar_0.webp','avatar_1.webp','avatar_2.webp','avatar_3.webp',
  'avatar_4.webp','avatar_5.webp','avatar_6.webp','avatar_7.webp',
  'avatar_8.webp','avatar_9.webp','avatar_09.webp',
  'avatar_10.webp','avatar_11.webp','avatar_12.webp','avatar_13.webp',
  'avatar_14.webp','avatar_15.webp','avatar_16.webp','avatar_17.webp',
  'avatar_18.webp','avatar_19.webp','avatar_20.webp','avatar_21.webp',
  'avatar_22.webp',
];

/**
 * Deterministic avatar index from agentId (same result for same id, everywhere)
 * Used by both taskbar renderer and office to sync avatars.
 */
function avatarIndexFromId(id) {
  let hash = 0;
  const str = id || '';
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  return Math.abs(hash) % AVATAR_FILES.length;
}

// Laptop index → seat ID mapping
const LAPTOP_ID_MAP = {
  0: 10, 1: 8, 2: 9, 3: 11,
  4: 0, 5: 1, 6: 2, 7: 3,
  8: 12, 9: 14, 10: 15, 11: 13,
  12: 4, 13: 5, 14: 6, 15: 7,
};
