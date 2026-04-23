/**
 * Graffiti Studio — 포즈 프리셋 (COCO18)
 *
 * 각 포즈는 특정 리그 위에 적용되는 "관절 위치 오버라이드".
 * key: jointId (COCO18), value: {x, y}
 *
 * ⚠ L/R은 캐릭터 기준 (r_shoulder는 화면 왼쪽).
 */

export const POSES = {
  'T-pose': {
    label: 'T-pose',
    overrides: {
      r_shoulder: { x: 42, y: 24 }, l_shoulder: { x: 58, y: 24 },
      r_elbow: { x: 25, y: 24 }, l_elbow: { x: 75, y: 24 },
      r_wrist: { x: 10, y: 24 }, l_wrist: { x: 90, y: 24 },
      r_hip: { x: 45, y: 56 }, l_hip: { x: 55, y: 56 },
      r_knee: { x: 45, y: 74 }, l_knee: { x: 55, y: 74 },
      r_ankle: { x: 45, y: 92 }, l_ankle: { x: 55, y: 92 },
    }
  },
  'A-pose': {
    label: 'A-pose',
    overrides: {
      r_elbow: { x: 30, y: 40 }, l_elbow: { x: 70, y: 40 },
      r_wrist: { x: 22, y: 55 }, l_wrist: { x: 78, y: 55 },
    }
  },
  stand: {
    label: '기립',
    overrides: {
      r_elbow: { x: 40, y: 40 }, l_elbow: { x: 60, y: 40 },
      r_wrist: { x: 38, y: 55 }, l_wrist: { x: 62, y: 55 },
    }
  },
  sit: {
    label: '앉기',
    overrides: {
      r_hip: { x: 45, y: 62 }, l_hip: { x: 55, y: 62 },
      r_knee: { x: 35, y: 70 }, l_knee: { x: 65, y: 70 },
      r_ankle: { x: 33, y: 88 }, l_ankle: { x: 67, y: 88 },
    }
  },
  walk: {
    label: '걷기',
    overrides: {
      r_elbow: { x: 38, y: 38 }, l_elbow: { x: 62, y: 42 },
      r_wrist: { x: 35, y: 52 }, l_wrist: { x: 65, y: 56 },
      r_knee: { x: 42, y: 70 }, l_knee: { x: 58, y: 77 },
      r_ankle: { x: 38, y: 85 }, l_ankle: { x: 62, y: 92 },
    }
  },
  run: {
    label: '뛰기',
    overrides: {
      r_elbow: { x: 30, y: 35 }, l_elbow: { x: 70, y: 40 },
      r_wrist: { x: 25, y: 45 }, l_wrist: { x: 75, y: 55 },
      r_knee: { x: 35, y: 65 }, l_knee: { x: 65, y: 75 },
      r_ankle: { x: 28, y: 78 }, l_ankle: { x: 72, y: 92 },
    }
  },
  attack: {
    label: '공격',
    overrides: {
      l_shoulder: { x: 62, y: 22 }, l_elbow: { x: 78, y: 18 }, l_wrist: { x: 92, y: 12 },
      r_shoulder: { x: 42, y: 28 }, r_elbow: { x: 30, y: 40 }, r_wrist: { x: 28, y: 55 },
    }
  },
  defense: {
    label: '방어',
    overrides: {
      r_shoulder: { x: 45, y: 28 }, r_elbow: { x: 38, y: 35 }, r_wrist: { x: 42, y: 30 },
      l_shoulder: { x: 55, y: 28 }, l_elbow: { x: 62, y: 35 }, l_wrist: { x: 58, y: 30 },
    }
  },
  greet: {
    label: '인사',
    overrides: {
      neck: { x: 50, y: 26 }, nose: { x: 50, y: 16 },
      r_shoulder: { x: 42, y: 28 }, l_shoulder: { x: 58, y: 28 },
    }
  },
}

export function applyPose(rig, poseKey) {
  const pose = POSES[poseKey]
  if (!pose) return rig
  rig.joints.forEach(j => {
    const ov = pose.overrides[j.id]
    if (ov) {
      j.x = ov.x
      j.y = ov.y
    }
  })
  return rig
}

/**
 * 좌우 반전 (x축 미러) — COCO18 L/R 쌍 자동 스왑.
 */
export function flipHorizontal(rig) {
  rig.joints.forEach(j => { j.x = 100 - j.x })
  // 좌우 쌍 id 맞바꿈
  const pairs = [
    ['r_shoulder', 'l_shoulder'], ['r_elbow', 'l_elbow'], ['r_wrist', 'l_wrist'],
    ['r_hip', 'l_hip'], ['r_knee', 'l_knee'], ['r_ankle', 'l_ankle'],
    ['r_eye', 'l_eye'], ['r_ear', 'l_ear'],
    ['earTipR', 'earTipL'],
  ]
  pairs.forEach(([a, b]) => {
    const ja = rig.joints.find(j => j.id === a)
    const jb = rig.joints.find(j => j.id === b)
    if (ja && jb) {
      const tmp = { x: ja.x, y: ja.y }
      ja.x = jb.x; ja.y = jb.y
      jb.x = tmp.x; jb.y = tmp.y
    }
  })
  return rig
}
