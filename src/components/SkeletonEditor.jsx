import { useRef, useState, useCallback } from 'react'

export default function SkeletonEditor({
  rig, onChange, selectedJointId, onSelectJoint,
  width = '100%', height = 500,
  showHeadForks = true, showLabels = false, readonly = false,
  backgroundSrc = null,
}) {
  const svgRef = useRef(null)
  const [draggingId, setDraggingId] = useState(null)

  const toViewBox = useCallback((cx, cy) => {
    const svg = svgRef.current
    if (!svg) return { x: 50, y: 50 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((cx - rect.left) / rect.width) * 100,
      y: ((cy - rect.top) / rect.height) * 100,
    }
  }, [])

  function handlePointerDown(e, joint) {
    if (readonly) return
    e.stopPropagation()
    setDraggingId(joint.id)
    onSelectJoint?.(joint.id)
    e.target.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e) {
    if (!draggingId || readonly) return
    const { x, y } = toViewBox(e.clientX, e.clientY)
    const nx = Math.max(0, Math.min(100, x))
    const ny = Math.max(0, Math.min(100, y))
    onChange?.({
      ...rig,
      joints: rig.joints.map(j => j.id === draggingId ? { ...j, x: nx, y: ny } : j)
    })
  }

  function handlePointerUp() { setDraggingId(null) }

  const jointMap = Object.fromEntries(rig.joints.map(j => [j.id, j]))
  const headJoint = rig.joints.find(j => j.type === 'head')

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{
        background: '#0a0b10',
        border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'block',
        userSelect: 'none',
        cursor: draggingId ? 'grabbing' : 'default',
      }}
    >
      <defs>
        <pattern id="gsGrid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="0.15"/>
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#gsGrid)" />

      {backgroundSrc && (
        <image
          href={backgroundSrc}
          x="10" y="5" width="80" height="90"
          preserveAspectRatio="xMidYMid meet"
          opacity="0.3"
        />
      )}

      {rig.bones.map(([fromId, toId, color], i) => {
        const a = jointMap[fromId]
        const b = jointMap[toId]
        if (!a || !b) return null
        const w = (a.type === 'spine' || b.type === 'spine') ? 1.1 : 0.75
        return (
          <line
            key={`bone-${i}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color || '#8b5cf6'}
            strokeWidth={w}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )
      })}

      {showHeadForks && headJoint && (() => {
        const { x, y } = headJoint
        const yaw = rig.headOrientation?.yaw || 0
        const pitch = rig.headOrientation?.pitch || 0
        const len = 4
        const forkLx = x - Math.cos((yaw + 30) * Math.PI / 180) * len
        const forkLy = y - Math.sin((pitch + 70) * Math.PI / 180) * len
        const forkRx = x + Math.cos((yaw - 30) * Math.PI / 180) * len
        const forkRy = y - Math.sin((pitch + 70) * Math.PI / 180) * len
        return (
          <g>
            <line x1={x} y1={y - 1.5} x2={forkLx} y2={forkLy} stroke="#10b981" strokeWidth="0.5" strokeLinecap="round" />
            <line x1={x} y1={y - 1.5} x2={forkRx} y2={forkRy} stroke="#10b981" strokeWidth="0.5" strokeLinecap="round" />
          </g>
        )
      })()}

      {rig.joints.map(joint => {
        const isSel = joint.id === selectedJointId
        const isHead = joint.type === 'head'
        const r = isHead ? 1.6 : (isSel ? 1.1 : 0.8)
        return (
          <g key={joint.id}>
            <circle
              cx={joint.x}
              cy={joint.y}
              r={r}
              fill={isHead ? '#ec4899' : (isSel ? '#fbbf24' : '#ef4444')}
              stroke={isSel ? '#fff' : 'transparent'}
              strokeWidth="0.3"
              onPointerDown={(e) => handlePointerDown(e, joint)}
              onClick={() => onSelectJoint?.(joint.id)}
              style={{ cursor: readonly ? 'pointer' : 'grab' }}
            />
            {showLabels && (
              <text x={joint.x + 1.5} y={joint.y - 1} fontSize="1.5" fill="rgba(255,255,255,0.6)" pointerEvents="none">
                {joint.id}
              </text>
            )}
          </g>
        )
      })}

      {selectedJointId && jointMap[selectedJointId] && (
        <circle
          cx={jointMap[selectedJointId].x}
          cy={jointMap[selectedJointId].y}
          r="2.5"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="0.2"
          strokeDasharray="0.6 0.4"
          pointerEvents="none"
        />
      )}
    </svg>
  )
}
