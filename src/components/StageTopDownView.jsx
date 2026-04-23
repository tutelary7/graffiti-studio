import { useRef, useState, useCallback } from 'react'

/**
 * StageTopDownView — 무대 위 배우 배치를 위한 2D 탑다운 뷰.
 *
 * Three.js 없이 실전 배치는 충분히 가능.
 * 실제 카메라 시점 이미지는 AI 생성 시에만 필요 (카메라 리그 값 + 배우 위치/회전을 프롬프트로 전달).
 *
 * 좌표계: (x, z) — x는 좌우, z는 앞뒤. 0..100 정규화.
 * 화살표 = 몸통 yaw 방향 (0°=N 정면).
 */
export default function StageTopDownView({
  actors = [],
  selectedActorId,
  onSelectActor,
  onMoveActor,      // (actorId, {x, z}) → void
  onRotateActor,    // (actorId, yaw) → void
  width = '100%',
  height = 380,
  cameraAz = 0,     // 카메라 방위각 (yaw) — 스테이지 위 점선 표시용
}) {
  const svgRef = useRef(null)
  const [draggingId, setDraggingId] = useState(null)

  const toStage = useCallback((clientX, clientY) => {
    const svg = svgRef.current
    if (!svg) return { x: 50, z: 50 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      z: ((clientY - rect.top) / rect.height) * 100,
    }
  }, [])

  function handlePointerDown(e, actor) {
    e.stopPropagation()
    setDraggingId(actor.id)
    onSelectActor?.(actor.id)
    e.target.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e) {
    if (!draggingId) return
    const { x, z } = toStage(e.clientX, e.clientY)
    onMoveActor?.(draggingId, {
      x: Math.max(10, Math.min(90, x)),
      z: Math.max(10, Math.min(90, z)),
    })
  }

  function handlePointerUp() {
    setDraggingId(null)
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      width={width}
      height={height}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      preserveAspectRatio="xMidYMid meet"
      style={{
        background: '#0a0b10',
        border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'block',
        width: '100%',
        height: '100%',
        cursor: draggingId ? 'grabbing' : 'default',
      }}
    >
      {/* 격자 */}
      <defs>
        <pattern id="stGrid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth="0.3"/>
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#stGrid)" />

      {/* 축 */}
      <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(139,92,246,0.15)" strokeWidth="0.3" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(139,92,246,0.15)" strokeWidth="0.3" />

      {/* 컴퍼스 N S E W */}
      <text x="50" y="6" textAnchor="middle" fontSize="4" fill="#34d399" fontWeight="700">N</text>
      <text x="50" y="96" textAnchor="middle" fontSize="4" fill="#9aa3b8" fontWeight="700">S</text>
      <text x="4" y="52" fontSize="4" fill="#9aa3b8" fontWeight="700">W</text>
      <text x="92" y="52" fontSize="4" fill="#9aa3b8" fontWeight="700">E</text>

      {/* 카메라 위치 표시 (az 각도) */}
      <g transform={`rotate(${cameraAz} 50 50)`}>
        <line x1="50" y1="50" x2="50" y2="12" stroke="#22d3ee" strokeWidth="0.3" strokeDasharray="2 1" opacity="0.6" />
        <circle cx="50" cy="10" r="2.5" fill="#22d3ee" />
        <text x="50" y="11.5" textAnchor="middle" fontSize="2.5" fill="#052e1f" fontWeight="700">📷</text>
      </g>

      {/* 배우들 */}
      {actors.map(actor => {
        const sel = actor.id === selectedActorId
        const x = actor.position?.x ?? 50
        const z = actor.position?.z ?? 50
        const yaw = actor.rotation?.yaw ?? 0

        return (
          <g key={actor.id}>
            {/* 그라운딩 원 */}
            <circle
              cx={x} cy={z}
              r={sel ? 5.5 : 4.5}
              fill="none"
              stroke={actor.color}
              strokeWidth={sel ? 0.8 : 0.5}
              strokeDasharray={sel ? 'none' : '1 0.5'}
            />
            {/* 몸통 원 */}
            <circle
              cx={x} cy={z} r={3}
              fill={actor.color}
              opacity="0.8"
              onPointerDown={(e) => handlePointerDown(e, actor)}
              style={{ cursor: 'grab' }}
            />
            {/* 방향 삼각형 (yaw) */}
            <g transform={`rotate(${yaw} ${x} ${z})`}>
              <polygon
                points={`${x},${z - 5.5} ${x - 1.5},${z - 3.5} ${x + 1.5},${z - 3.5}`}
                fill={actor.color}
                pointerEvents="none"
              />
            </g>
            {/* 이름표 — 첫 글자 한 글자만 */}
            {sel && (
              <text
                x={x} y={z + 5.5}
                pointerEvents="none"
                fontSize="2.5" fill={actor.color} textAnchor="middle" fontWeight="700"
                opacity="0.9"
              >
                {actor.name?.slice(0, 1) || '●'}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
