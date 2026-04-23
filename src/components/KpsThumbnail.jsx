/**
 * 작은 SVG 스켈레톤 썸네일 — 클라우드 라이브러리/저장본 미리보기용.
 * COCO18 18-keypoint 또는 rigData를 받아서 OpenPose 컬러로 렌더.
 */
import { COCO18_LIMBS, COCO18_JOINT_NAMES, kps2DToRigData } from '../lib/skeleton/coco18.js'

export default function KpsThumbnail({ kps2D, rigData, size = 80, bg = '#0a0b10' }) {
  // kps2D 우선, 없으면 rigData에서 변환
  let rig = rigData
  if (!rig && Array.isArray(kps2D)) rig = kps2DToRigData(kps2D)
  if (!rig?.joints) {
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color: 'var(--text-3)', fontSize: 18 }}>?</div>
  }

  const jm = Object.fromEntries(rig.joints.map(j => [j.id, j]))

  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ background: bg, display: 'block' }}>
      {/* 본 */}
      {(rig.bones || COCO18_LIMBS).map(([from, to, color], i) => {
        const a = jm[from]; const b = jm[to]
        if (!a || !b) return null
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color || '#888'} strokeWidth="2.2" strokeLinecap="round" />
      })}
      {/* 관절 */}
      {rig.joints.map(j => {
        const isFace = j.type === 'eye' || j.type === 'ear' || j.type === 'head'
        return <circle key={j.id} cx={j.x} cy={j.y}
          r={isFace ? 1.2 : 1.8}
          fill={isFace ? '#ff00ff' : '#ef4444'}
          opacity={j.visibility ?? 1} />
      })}
    </svg>
  )
}
