import { useRef, useState, useCallback } from 'react'

/**
 * MultiSkeletonView — 여러 배우의 스켈레톤을 나란히 표시.
 *
 * 배치 로직:
 *   - 0명: 빈 상태
 *   - 1명: 중앙 크게 (관객 시점)
 *   - 2명 이상: 가로로 균등 분배
 *
 * 편집 로직:
 *   - 선택된 배우는 진한 색, 다른 배우는 흐림 (opacity 0.3)
 *   - 드래그 편집은 onUpdateSelected 콜백으로만 전달 (선택된 배우의 rig)
 *   - 선택되지 않은 배우의 관절은 클릭만 가능 (배우 전환)
 *
 * props:
 *   actors: [{id, name, color, gender, rigData}]
 *   selectedActorId
 *   onSelectActor(id)
 *   onUpdateSelectedRig(newRig)   선택된 배우의 rig 편집 시
 *   backgroundSrc: 뒤에 깔 앵커 이미지
 *   readonly: true면 드래그 비활성
 *   height
 */
export default function MultiSkeletonView({
  actors = [],
  selectedActorId = null,
  onSelectActor,
  onUpdateSelectedRig,
  onSelectJoint,
  selectedJointId = null,
  backgroundSrc = null,
  backgroundOpacity = 0.85,
  readonly = false,
  height = 500,
  showHeadForks = true,
  showSkeleton = true,
  hideMode = 'auto',   // 'auto' = visibility 기반 자동 / 'all' = 전신 강제 / 'visible' = 보이는것만 (vis≥0.3)
  manuallyHidden = {},  // {[jointId]: true} — 사용자가 수동으로 숨긴 관절
  onToggleHideJoint,    // (jointId) => void
  boneStates = {},      // {[fromId-toId]: 'dashed' | 'hidden'} — 본별 상태
  onToggleBone,         // (boneKey) => void  — 본 우클릭 시 cycle
}) {
  const svgRef = useRef(null)
  const [draggingJoint, setDraggingJoint] = useState(null)
  // 드래그 중 로컬 오버라이드 — 부모 state/IndexedDB에 매 프레임 쓰지 않음 → 즉각 반응
  const [localOverrides, setLocalOverrides] = useState({})  // {jointId: {x, y}}

  const selectedActor = actors.find(a => a.id === selectedActorId) || actors[0]

  // 배우별 슬롯 계산 (0..100 viewBox 안에서)
  const N = actors.length
  const slots = actors.map((a, i) => {
    // 1인 = full viewport (관절이 이미지 가장자리까지 이동 가능)
    if (N === 1) return { cx: 50, cy: 50, scale: 1.0 }
    if (N === 2) return { cx: 30 + i * 40, cy: 50, scale: 0.7 }
    if (N === 3) return { cx: 20 + i * 30, cy: 50, scale: 0.5 }
    return { cx: (100 / (N + 1)) * (i + 1), cy: 50, scale: 0.4 }
  })

  const toViewBox = useCallback((clientX, clientY) => {
    const svg = svgRef.current
    if (!svg) return { x: 50, y: 50 }
    // SVG 내장 좌표 변환 — preserveAspectRatio=meet이어도 정확
    const pt = svg.createSVGPoint()
    pt.x = clientX; pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 50, y: 50 }
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }, [])

  function handleJointDown(e, jointId) {
    if (readonly) return
    e.stopPropagation()
    setDraggingJoint(jointId)
    onSelectJoint?.(jointId)
    e.target.setPointerCapture(e.pointerId)
  }

  function handleMove(e) {
    if (!draggingJoint || readonly || !selectedActor) return
    const { x: vx, y: vy } = toViewBox(e.clientX, e.clientY)
    const slot = slots[actors.findIndex(a => a.id === selectedActor.id)]
    if (!slot) return
    const slotSize = 100 * slot.scale
    const localX = ((vx - (slot.cx - slotSize / 2)) / slotSize) * 100
    const localY = ((vy - (slot.cy - slotSize / 2)) / slotSize) * 100
    const nx = Math.max(0, Math.min(100, localX))
    const ny = Math.max(0, Math.min(100, localY))

    // ★ nose 드래그 시 — 얼굴 5점(eye/ear) + neck도 같은 변위로 함께 이동
    if (draggingJoint === 'nose') {
      const noseJoint = selectedActor.rigData.joints.find(j => j.id === 'nose')
      if (noseJoint) {
        const dx = nx - noseJoint.x
        const dy = ny - noseJoint.y
        const next = { ...localOverrides, nose: { x: nx, y: ny } }
        for (const id of ['r_eye', 'l_eye', 'r_ear', 'l_ear', 'neck']) {
          const j = selectedActor.rigData.joints.find(j => j.id === id)
          if (j) next[id] = { x: Math.max(0, Math.min(100, j.x + dx)), y: Math.max(0, Math.min(100, j.y + dy)) }
        }
        setLocalOverrides(next)
        return
      }
    }
    // 일반 관절
    setLocalOverrides(prev => ({ ...prev, [draggingJoint]: { x: nx, y: ny } }))
  }

  function handleUp() {
    // 드래그 끝 → 한 번만 부모(IndexedDB)에 커밋
    if (draggingJoint && Object.keys(localOverrides).length > 0 && selectedActor) {
      onUpdateSelectedRig?.({
        ...selectedActor.rigData,
        joints: selectedActor.rigData.joints.map(j =>
          localOverrides[j.id] ? { ...j, ...localOverrides[j.id] } : j
        ),
      })
    }
    setLocalOverrides({})
    setDraggingJoint(null)
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      width="100%"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      style={{
        background: '#0a0b10',
        border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'block',
        width: '100%',
        height: '100%',
        userSelect: 'none',
        cursor: draggingJoint ? 'grabbing' : 'default',
      }}
    >
      <defs>
        <pattern id="msvGrid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="0.15"/>
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#msvGrid)" />

      {backgroundSrc && (
        <image
          href={backgroundSrc}
          x="0" y="0" width="100" height="100"
          preserveAspectRatio="xMidYMid meet"
          opacity={backgroundOpacity}
        />
      )}

      {actors.length === 0 && (
        <text x="50" y="50" textAnchor="middle" fontSize="3" fill="var(--text-3)">
          배우가 없어요 · ＋ 인물 추가를 눌러주세요
        </text>
      )}

      {showSkeleton && actors.map((actor, idx) => {
        const slot = slots[idx]
        const isSel = actor.id === selectedActorId
        const alpha = isSel ? 1.0 : 0.35
        // 선택된 배우의 드래그 중 로컬 오버라이드 적용
        let renderActor = actor
        if (isSel && Object.keys(localOverrides).length > 0) {
          renderActor = {
            ...actor,
            rigData: {
              ...actor.rigData,
              joints: actor.rigData.joints.map(j =>
                localOverrides[j.id] ? { ...j, ...localOverrides[j.id] } : j
              ),
            },
          }
        }
        return (
          <g key={actor.id}
             transform={`translate(${slot.cx - (100 * slot.scale) / 2}, ${slot.cy - (100 * slot.scale) / 2}) scale(${slot.scale})`}
             style={{ opacity: alpha, transition: 'opacity 0.15s' }}>
            <ActorSkeleton
              actor={renderActor}
              isSelected={isSel}
              readonly={readonly || !isSel}
              onJointDown={handleJointDown}
              onSelectActor={() => onSelectActor?.(actor.id)}
              showHeadForks={showHeadForks}
              selectedJointId={isSel ? selectedJointId : null}
              hideMode={hideMode}
              manuallyHidden={isSel ? manuallyHidden : {}}
              onToggleHideJoint={isSel ? onToggleHideJoint : undefined}
              boneStates={isSel ? boneStates : {}}
              onToggleBone={isSel ? onToggleBone : undefined}
            />
          </g>
        )
      })}
    </svg>
  )
}

function ActorSkeleton({ actor, isSelected, readonly, onJointDown, onSelectActor, showHeadForks, selectedJointId, hideMode = 'auto', manuallyHidden = {}, onToggleHideJoint, boneStates = {}, onToggleBone }) {
  const rig = actor.rigData
  const jointMap = Object.fromEntries(rig.joints.map(j => [j.id, j]))
  // COCO18: nose가 머리, 구 rig는 head
  const headJoint = jointMap.nose || jointMap.head
  const isCOCO18 = !!jointMap.nose

  return (
    <g onClick={!isSelected ? onSelectActor : undefined} style={{ cursor: !isSelected ? 'pointer' : 'default' }}>
      {/* 이름표 — 원형 배지 (선택된 배우만, 머리 위) */}
      {isSelected && (
        <g pointerEvents="none">
          <circle cx={50} cy={-3} r={3.2}
            fill={actor.color} fillOpacity="0.35"
            stroke={actor.color} strokeWidth="0.4" strokeOpacity="0.8" />
          <text x={50} y={-1.8} textAnchor="middle" fontSize="2.8"
            fill="white" fontWeight="700" opacity="0.95"
            style={{ letterSpacing: 0 }}>
            {actor.name?.slice(0, 1) || '●'}
          </text>
        </g>
      )}

      {/* 본 — hideMode/manuallyHidden + 본별 상태 (점선/숨김) 적용 */}
      {[...rig.bones]
        .map((bone, i) => ({ bone, i }))
        .sort((p, q) => {
          const pz = ((jointMap[p.bone[0]]?.z ?? 50) + (jointMap[p.bone[1]]?.z ?? 50)) / 2
          const qz = ((jointMap[q.bone[0]]?.z ?? 50) + (jointMap[q.bone[1]]?.z ?? 50)) / 2
          return pz - qz
        })
        .map(({ bone: [fromId, toId, color], i }) => {
        const a = jointMap[fromId]
        const b = jointMap[toId]
        if (!a || !b) return null
        if (manuallyHidden[fromId] || manuallyHidden[toId]) return null
        const boneKey = `${fromId}-${toId}`
        const userState = boneStates[boneKey]
        if (userState === 'hidden') return null
        const baseW = (a.type === 'spine' || b.type === 'spine') ? 1.0 : 0.7
        const avgZ = ((a.z ?? 50) + (b.z ?? 50)) / 2
        const zScale = 0.7 + (avgZ / 100) * 0.6
        const avgVis = ((a.visibility ?? 1) + (b.visibility ?? 1)) / 2
        if (hideMode === 'visible' && avgVis < 0.3) return null
        if (hideMode === 'auto' && avgVis < 0.15) return null
        // dash: 사용자 지정 'dashed' OR visibility 낮음
        const isUncertain = userState === 'dashed' || avgVis < 0.5
        return (
          <line
            key={`bone-${i}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color || '#8b5cf6'}
            strokeWidth={baseW * zScale * (userState === 'dashed' ? 1 : 1.5)}
            strokeLinecap="round"
            strokeOpacity={isUncertain ? 0.7 : 1}
            strokeDasharray={isUncertain ? '1.2 0.8' : 'none'}
            onContextMenu={readonly ? undefined : (e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleBone?.(boneKey)
            }}
            style={{ cursor: readonly ? 'default' : 'context-menu', pointerEvents: 'stroke' }}
          >
            <title>{`${fromId} → ${toId}\n우클릭: 실선 ⇄ 점선 (가려짐)`}</title>
          </line>
        )
      })}

      {/* (제거됨) 머리 방향 포크 — COCO18에 eye/ear 관절 들어있어서 중복이라 삭제 */}

      {/* 관절 — manuallyHidden만 완전 제외, 나머지는 항상 표시 (vis 낮으면 작게/흐리게) */}
      {[...rig.joints]
        .sort((a, b) => (a.z ?? 50) - (b.z ?? 50))
        .map(joint => {
        if (manuallyHidden[joint.id]) return null
        const vis = joint.visibility ?? 1.0
        // hideMode가 'visible'이고 vis가 매우 낮으면 화면에서만 숨김 (편집은 가능)
        // → 'visible' 모드에서도 endpoint는 보여야 편집 가능 → 그리되 매우 작게
        const isHiddenByMode = (hideMode === 'visible' && vis < 0.3)
                            || (hideMode === 'auto' && vis < 0.15)
        const isNose = joint.id === 'nose' || joint.type === 'head'
        const isEye = joint.type === 'eye'
        const isEar = joint.type === 'ear'
        const isFace = isNose || isEye || isEar
        const isJointSel = joint.id === selectedJointId
        const zScale = joint.z != null ? 0.7 + (joint.z / 100) * 0.6 : 1.0
        // hideMode로 숨겨진 건 매우 작게 (편집은 가능). 일반은 평소 크기.
        const baseR = isFace ? 0.8 : (isJointSel ? 1.6 : 1.1)
        const r = baseR * zScale * (isHiddenByMode ? 0.55 : 1)
        // 관절별 고유 색상 (OpenPose)
        let fill = '#ef4444'
        if (isJointSel) fill = '#fbbf24'
        else if (joint.id === 'nose') fill = '#ff00aa'
        else if (isEye) fill = '#ff00ff'
        else if (isEar) fill = '#ff5500'
        else if (joint.id === 'neck') fill = '#ff0055'
        else if (joint.id.includes('shoulder')) fill = joint.id.startsWith('r_') ? '#ff0000' : '#85ff00'
        else if (joint.id.includes('elbow'))    fill = joint.id.startsWith('r_') ? '#ff8500' : '#00ff00'
        else if (joint.id.includes('wrist'))    fill = joint.id.startsWith('r_') ? '#ffff00' : '#00ff85'
        else if (joint.id.includes('hip'))      fill = joint.id.startsWith('r_') ? '#00ffff' : '#8500ff'
        else if (joint.id.includes('knee'))     fill = joint.id.startsWith('r_') ? '#0085ff' : '#aa00ff'
        else if (joint.id.includes('ankle'))    fill = joint.id.startsWith('r_') ? '#0000ff' : '#ff00ff'
        // 가시성 — 실제 vis 0이면 점선 테두리만, 아니면 항상 풀 컬러로 그림
        const isUncertain = vis < 0.5
        return (
          <circle
            key={joint.id}
            cx={joint.x}
            cy={joint.y}
            r={r}
            fill={fill}
            stroke={isJointSel ? 'white' : (isSelected ? 'rgba(255,255,255,0.5)' : 'transparent')}
            strokeWidth={isJointSel ? 0.5 : 0.25}
            fillOpacity={isHiddenByMode ? 0.55 : 1}
            strokeDasharray={isUncertain && !isJointSel ? '0.6 0.4' : 'none'}
            onPointerDown={readonly ? undefined : (e) => onJointDown(e, joint.id)}
            onContextMenu={readonly ? undefined : (e) => {
              e.preventDefault()
              onToggleHideJoint?.(joint.id)
            }}
            style={{ cursor: readonly ? 'pointer' : 'grab' }}
          >
            <title>{`${joint.id}${isHiddenByMode ? ' (낮은 신뢰)' : ''}\n드래그=이동 · 우클릭=완전 숨김`}</title>
          </circle>
        )
      })}

      {/* 그라운딩 링 */}
      <ellipse cx={50} cy={170} rx={25} ry={3}
        fill="none"
        stroke={actor.color}
        strokeWidth={isSelected ? 1.2 : 0.6}
        strokeDasharray={isSelected ? 'none' : '1 0.5'}
      />
    </g>
  )
}
