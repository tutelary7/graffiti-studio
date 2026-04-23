import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject } from '../context/ProjectContext.jsx'
import { useMode } from '../context/ModeContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import Stage3DView from '../components/Stage3DView.jsx'
import { generateImage } from '../lib/ai/index.js'
import Lightbox from '../components/Lightbox.jsx'
import { listPoseLibrary, normalizeToRig, syncLibrary, updatePoseLabel, deletePoseFromCloud, savePoseToCloud } from '../lib/firebase/poseLibrary.js'

const SHOT_TYPES = ['와이드', '풀샷', '버스트', '클로즈업', '익스트림', '오버숄더']
const CLOSEUP_PARTS = ['얼굴', '상반신', '손', '발', '목', '눈', '입', '머리']

const INTERACTIONS = {
  '🔄 마주보기': (actors) => {
    const r = [...actors]
    if (r[0]) r[0] = { ...r[0], position: { x: 35, z: 50, y: 0 }, rotation: { yaw: 90 } }
    if (r[1]) r[1] = { ...r[1], position: { x: 65, z: 50, y: 0 }, rotation: { yaw: -90 } }
    return r
  },
  '🔙 등지기': (actors) => {
    const r = [...actors]
    if (r[0]) r[0] = { ...r[0], position: { x: 40, z: 50, y: 0 }, rotation: { yaw: -90 } }
    if (r[1]) r[1] = { ...r[1], position: { x: 60, z: 50, y: 0 }, rotation: { yaw: 90 } }
    return r
  },
  '➡ 나란히': (actors) => actors.map((a, i) => ({
    ...a, position: { x: 30 + i * 15, z: 60, y: 0 }, rotation: { yaw: 0 }
  })),
}

export default function StagePage() {
  const navigate = useNavigate()
  const { currentProject, updateProject, updateActor, addActor, addCut } = useProject()
  const { isIntegrated } = useMode()
  const { user } = useAuth()

  const [selectedActorId, setSelectedActorId] = useState(null)
  const [selectedJointId, setSelectedJointId] = useState(null)
  const [shotType, setShotType] = useState('풀샷')
  const [closeupPart, setCloseupPart] = useState(null)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [aiModel, setAiModel] = useState('nano-banana-3.1')  // 'nano-banana-3.1' | 'nano-banana-3-pro' | 'auto'
  const [stylePreset, setStylePreset] = useState('auto')     // 'auto' | 'manga' | 'anime' | 'realistic' | 'illustration'
  const [busy, setBusy] = useState(false)
  const [anchorUrl, setAnchorUrl] = useState(null)
  const [stageSourceUrl, setStageSourceUrl] = useState(null)

  // 3D 스테이지 자체 히스토리 (원본 / 편집1 / 편집2 ...)
  const [stageHistory, setStageHistory] = useState([])
  const [selectedStageId, setSelectedStageId] = useState(null)

  // 포즈 라이브러리 (클라우드)
  const [cloudPoses, setCloudPoses] = useState([])
  const [cloudLoading, setCloudLoading] = useState(false)

  const snapshotRef = useRef(null)
  const cameraInfoRef = useRef(null)   // () => {az, el, distance}
  const hydratedRef = useRef(null)

  // Lightbox용 현재 보여줄 엔트리 (null이면 닫힘)
  const [lightboxEntry, setLightboxEntry] = useState(null)

  // ── 앵커 URL ──
  useEffect(() => {
    if (currentProject?.anchorBlob) {
      const url = URL.createObjectURL(currentProject.anchorBlob)
      setAnchorUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setAnchorUrl(null)
    }
  }, [currentProject?.anchorBlob])

  // ── 포즈 편집에서 넘어온 "스테이지 소스 이미지" URL ──
  // 우선순위:
  //   1) 명시적으로 🎬 버튼 눌러 보낸 stageSourceImage
  //   2) 없으면 포즈편집에서 현재 선택된 편집본(selectedHistoryId) 의 blob 자동 사용
  useEffect(() => {
    // 1) 명시적 전송
    if (currentProject?.stageSourceImage) {
      const url = URL.createObjectURL(currentProject.stageSourceImage)
      setStageSourceUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    // 2) 포즈편집의 현재 선택된 편집본
    const selHistId = currentProject?.selectedHistoryId
    const edits = currentProject?.editHistory || []
    const selEdit = selHistId ? edits.find(h => h.id === selHistId) : null
    if (selEdit?.blob) {
      const url = URL.createObjectURL(selEdit.blob)
      setStageSourceUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setStageSourceUrl(null)
  }, [currentProject?.stageSourceImage, currentProject?.selectedHistoryId, currentProject?.editHistory])

  // ── 첫 배우 자동 선택 ──
  useEffect(() => {
    if (currentProject && !selectedActorId && currentProject.actors.length > 0) {
      setSelectedActorId(currentProject.actors[0].id)
    }
  }, [currentProject, selectedActorId])

  // ── stageHistory 하이드레이션 (프로젝트 전환 시 1회) ──
  useEffect(() => {
    if (!currentProject) return
    if (hydratedRef.current === currentProject.id) return
    hydratedRef.current = currentProject.id
    const saved = (currentProject.stageHistory || []).map(h => ({
      ...h,
      url: h.blob ? URL.createObjectURL(h.blob) : '',
    }))
    setStageHistory(saved)
    if (currentProject.selectedStageId) setSelectedStageId(currentProject.selectedStageId)
  }, [currentProject?.id])

  // ── stageHistory 변화 시 프로젝트에 영구 저장 ──
  useEffect(() => {
    if (!currentProject) return
    if (hydratedRef.current !== currentProject.id) return
    const plain = stageHistory.map(({ url, ...rest }) => rest)
    updateProject(currentProject.id, {
      stageHistory: plain,
      selectedStageId,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageHistory, selectedStageId])

  // ── 클라우드 포즈 자동 로드 ──
  useEffect(() => {
    if (!user) return
    let alive = true
    ;(async () => {
      try {
        setCloudLoading(true)
        const docs = await listPoseLibrary(user.uid, { max: 50 })
        if (alive) setCloudPoses(docs)
      } catch (e) { console.warn('[stage] cloud pose 로드 실패', e) }
      finally { if (alive) setCloudLoading(false) }
    })()
    return () => { alive = false }
  }, [user?.uid])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>🎬 3D 스테이지</h1></div>
        <div className="placeholder"><div className="ico">⚠</div><h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  const actor = currentProject.actors.find(a => a.id === selectedActorId)

  // ── 3D 뷰에 띄울 이미지 결정 (우선순위: 선택된 히스토리 > stageSource > anchor) ──
  const selStageEntry = stageHistory.find(h => h.id === selectedStageId)
  const imageToShow = selStageEntry?.url || stageSourceUrl || anchorUrl
  // 현재 "원본"이 어디서 왔는지 파악 (표시용)
  const poseSelEditForLabel = (() => {
    if (currentProject?.stageSourceImage) return null  // 명시 전송이 우선
    const selHistId = currentProject?.selectedHistoryId
    const edits = currentProject?.editHistory || []
    return selHistId ? edits.find(h => h.id === selHistId) : null
  })()
  const imageLabel = selStageEntry
    ? selStageEntry.label
    : currentProject?.stageSourceImage
    ? (currentProject.stageSourceMeta?.label || '🎬 포즈편집 전송')
    : poseSelEditForLabel
    ? `포즈편집 · ${poseSelEditForLabel.label}`
    : anchorUrl
    ? '앵커'
    : null

  // ── #4: 관절 드래그 commit — 땅 아래 허용 (넓은 범위) ──
  async function handleCommitJoint(actorId, jointId, rigPos) {
    const a = currentProject.actors.find(a => a.id === actorId)
    if (!a || !a.rigData) return
    const clamped = {
      x: Math.max(-200, Math.min(300, rigPos.x)),
      y: Math.max(-200, Math.min(300, rigPos.y)),
      z: Math.max(-200, Math.min(300, rigPos.z)),
    }
    const newJoints = a.rigData.joints.map(j =>
      j.id === jointId ? { ...j, ...clamped } : j
    )
    await updateActor(actorId, { rigData: { ...a.rigData, joints: newJoints } })
  }

  // ── 얼굴 리그 일괄 commit (nose 드래그 시 얼굴 5점 모두) ──
  async function handleCommitHeadGroup(actorId, updates) {
    // updates: { nose: {x,y,z}, r_eye: {...}, l_eye: {...}, r_ear: {...}, l_ear: {...} }
    const a = currentProject.actors.find(a => a.id === actorId)
    if (!a || !a.rigData) return
    const newJoints = a.rigData.joints.map(j => {
      const u = updates[j.id]
      if (!u) return j
      return {
        ...j,
        x: Math.max(-200, Math.min(300, u.x)),
        y: Math.max(-200, Math.min(300, u.y)),
        z: Math.max(-200, Math.min(300, u.z)),
      }
    })
    await updateActor(actorId, { rigData: { ...a.rigData, joints: newJoints } })
  }

  function handleSelectActor(actorId) {
    setSelectedActorId(actorId)
    setSelectedJointId(null)
  }
  function handleSelectJoint(actorId, jointId) {
    setSelectedActorId(actorId)
    setSelectedJointId(jointId)
  }

  async function handleInteraction(key) {
    const fn = INTERACTIONS[key]
    if (!fn) return
    const result = fn(currentProject.actors)
    for (const a of result) await updateActor(a.id, { position: a.position, rotation: a.rotation })
  }

  async function updateJointField(actorId, jointId, field, val) {
    const a = currentProject.actors.find(a => a.id === actorId)
    if (!a || !a.rigData) return
    const v = Math.max(-200, Math.min(300, val))
    const newJoints = a.rigData.joints.map(j => j.id === jointId ? { ...j, [field]: v } : j)
    await updateActor(actorId, { rigData: { ...a.rigData, joints: newJoints } })
  }

  // ── 클라우드 포즈 적용 ──
  async function handleLoadCloudPose(doc) {
    if (!actor) { alert('먼저 배우를 선택하세요'); return }
    const rigData = normalizeToRig(doc)
    await updateActor(actor.id, { rigId: 'human', rigData: JSON.parse(JSON.stringify(rigData)) })
  }

  async function handleSyncCloud() {
    if (!user) return
    setCloudLoading(true)
    try {
      await syncLibrary(user.uid)
      const docs = await listPoseLibrary(user.uid, { max: 100 })
      setCloudPoses(docs)
    } catch (e) { alert('동기화 실패: ' + e.message) }
    finally { setCloudLoading(false) }
  }

  async function handleRenameCloud(doc) {
    if (!user) return
    const current = doc.label || doc.name || ''
    const next = prompt(`이름 변경 (현재: "${current}"):`, current)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    try {
      await updatePoseLabel(user.uid, doc.id, trimmed)
      setCloudPoses(prev => prev.map(d => d.id === doc.id ? { ...d, label: trimmed, name: trimmed } : d))
    } catch (e) { alert('이름 변경 실패: ' + e.message) }
  }

  async function handleDeleteCloud(doc) {
    if (!user) return
    if (!confirm(`"${doc.label || doc.name || doc.id}" 클라우드에서 삭제?`)) return
    try {
      await deletePoseFromCloud(user.uid, doc.id)
      setCloudPoses(prev => prev.filter(d => d.id !== doc.id))
    } catch (e) { alert('삭제 실패: ' + e.message) }
  }

  async function handlePushToCloud() {
    if (!user) { alert('먼저 상단 Google 로그인'); return }
    if (!actor) return
    const name = prompt('클라우드에 저장할 이름:', `${actor.name} - ${new Date().toLocaleString('ko-KR')}`)
    if (!name) return
    try {
      await savePoseToCloud(user.uid, { name, rigData: actor.rigData, source: 'graffiti-stage' })
      setCloudPoses(await listPoseLibrary(user.uid, { max: 50 }))
      alert('✓ 저장 완료')
    } catch (e) { alert('저장 실패: ' + e.message) }
  }

  // ── #2: AI 생성 → stageHistory에 편집N 추가 ──
  async function handleGenerate() {
    if (!snapshotRef.current) {
      alert('3D 뷰가 아직 준비되지 않았어요.')
      return
    }
    setBusy(true)
    try {
      const compBlob = await snapshotRef.current({ hideImage: false, hideLabels: true, hideCompass: true, hideGrid: true })
      const skelBlob = await snapshotRef.current({ hideImage: true, hideLabels: true, hideCompass: true, hideGrid: true, blackBg: true })

      // 현재 카메라 각도 파악
      const camInfo = cameraInfoRef.current?.() || { az: 0, el: 0, distance: 6 }
      const angleDesc = describeViewAngle(camInfo.az, camInfo.el)

      const actorDesc = currentProject.actors.map(a => a.name).join(', ')
      const styleRule = stylePreset === 'auto'
        ? 'Match IMAGE 1\'s art style exactly (if it\'s manga/anime/illustration, keep it — do NOT convert to photorealism; if it\'s a photo, keep it photorealistic).'
        : stylePreset === 'manga'
        ? 'Render in MANGA style — black-and-white or limited palette, bold inked outlines, screentones, cel-shading. Do NOT photorealistic.'
        : stylePreset === 'anime'
        ? 'Render in ANIME/CARTOON style — clean line art, flat colors with cel-shading, stylized features. Do NOT photorealistic.'
        : stylePreset === 'illustration'
        ? 'Render as a digital ILLUSTRATION / painting — painterly, stylized, NOT a photograph.'
        : 'Render in PHOTOREALISTIC style — photographic quality, realistic lighting and textures.'

      const prompt = [
        `Generate a character scene based on TWO reference images. POSE TRANSFER + CAMERA-ANGLE CHANGE task.`,
        `IMAGE 1 = IDENTITY + STYLE source (face, hair, clothing, ART STYLE must match — DO NOT copy its pose or camera)`,
        `IMAGE 2 = POSE + CAMERA source (OpenPose skeleton rendered from the TARGET camera angle)`,
        ``,
        `Characters: ${actorDesc}.`,
        `Target camera view: ${angleDesc} (azimuth ${camInfo.az.toFixed(0)}°, elevation ${camInfo.el.toFixed(0)}°).`,
        `Shot type: ${shotType}${closeupPart ? ' / ' + closeupPart + ' closeup' : ''}.`,
        ``,
        `STYLE RULE: ${styleRule}`,
        extraPrompt.trim() ? `User direction: ${extraPrompt.trim()}.` : '',
        ``,
        `CRITICAL RULES:`,
        `1. RENDER FROM THE NEW CAMERA ANGLE from IMAGE 2's skeleton — NOT from IMAGE 1's angle.`,
        `   - Back-view skeleton → draw character's BACK.`,
        `   - 3/4 skeleton → 3/4 perspective.`,
        `2. Reproduce the POSE from IMAGE 2's skeleton.`,
        `3. STRICTLY PRESERVE THE ART STYLE of IMAGE 1 — if it's a drawing/manga/anime/illustration, the OUTPUT MUST remain the same style (never convert drawings to photos).`,
        `4. NO colored lines, NO dots, NO stick figures, NO skeleton overlay in the output. Clean final art only.`,
        `5. NO ground grid, NO floor lines, NO wireframe — just the character and natural background.`,
      ].filter(Boolean).join('\n')

      const refs = [compBlob, skelBlob]
      const result = await generateImage({ prompt, references: refs, model: aiModel, aspectRatio: '3:4' })

      // 히스토리 추가
      setStageHistory(prev => {
        const editNum = prev.filter(h => !h.isOriginal).length + 1
        const entry = {
          id: 'stage-' + Date.now(),
          url: result.url, blob: result.blob,
          label: `편집${editNum}`,
          timestamp: Date.now(),
          actorId: actor?.id, actorName: actor?.name,
          rigSnapshot: actor ? JSON.parse(JSON.stringify(actor.rigData)) : null,
          meta: { shotType, closeupPart, extraPrompt },
        }
        setSelectedStageId(entry.id)
        return [...prev, entry]
      })

      await addCut({
        imageBlob: result.blob, kind: 'stage',
        tags: [shotType, ...(closeupPart ? [closeupPart] : []), '스테이지-3D'],
        meta: { shotType, closeupPart, extraPrompt, source: '3d-stage' },
      })
      await updateProject(currentProject.id, { progress: { ...currentProject.progress, stage: true, gallery: true } })
    } catch (err) {
      alert('생성 실패: ' + err.message)
    } finally { setBusy(false) }
  }

  // ── 히스토리 항목 선택 ──
  async function handleSelectStageEntry(entry) {
    setSelectedStageId(entry.id)
    // rigSnapshot 있으면 복원
    if (entry.rigSnapshot && entry.actorId) {
      const target = currentProject.actors.find(a => a.id === entry.actorId) || actor
      if (target) await updateActor(target.id, { rigData: JSON.parse(JSON.stringify(entry.rigSnapshot)) })
    }
  }

  // ── #3: 선택된 이미지를 포즈편집의 편집N으로 보내기 (이미지만) ──
  async function handleSendToPoseEditor() {
    let blob, label
    if (selStageEntry) {
      // 저장된 AI 결과 사용 — 이미 스켈레톤이 제거된 이미지
      blob = selStageEntry.blob
      label = selStageEntry.label
    } else {
      // 저장 안 한 상태 — 3D 뷰 스냅샷 (스켈레톤 반드시 숨기고 이미지만)
      if (!snapshotRef.current) { alert('스냅샷을 찍을 수 없어요'); return }
      blob = await snapshotRef.current({
        hideSkeleton: true,
        hideLabels: true,
        hideCompass: true,
        hideGrid: true,
      })
      label = '3D 스테이지 스냅샷'
    }
    if (!blob) return

    // 포즈편집의 editHistory에 추가 — rigSnapshot 없이 이미지만
    // (rigSnapshot 넣으면 포즈편집이 스켈레톤을 복원해서 "이미지에 붙은 것처럼" 보임)
    const prior = currentProject.editHistory || []
    const editNum = prior.length + 1
    const newEntry = {
      id: 'gen-from-stage-' + Date.now(),
      blob,
      label: `편집${editNum}`,
      timestamp: Date.now(),
      actorId: actor?.id,
      actorName: actor?.name,
      // rigSnapshot 생략 — 이미지만 전달. 포즈편집은 현재 rig를 유지하거나
      // 사용자가 자동추출 버튼으로 새로 뽑아낼 수 있음.
      meta: { source: 'stage-3d', sourceLabel: label, imageOnly: true },
    }
    await updateProject(currentProject.id, {
      editHistory: [...prior, newEntry],
      selectedHistoryId: newEntry.id,
    })
    navigate('/pose')
  }

  async function handleApplyAsAnchor(blob) {
    await updateProject(currentProject.id, { anchorBlob: blob, anchorSource: 'stage' })
    alert('✓ 앵커 교체됨')
  }

  async function handleDownloadCurrent() {
    if (selStageEntry?.url) {
      const a = document.createElement('a')
      a.href = selStageEntry.url; a.download = `graffiti-stage-${selStageEntry.label}-${Date.now()}.png`; a.click()
      return
    }
    if (snapshotRef.current) {
      const blob = await snapshotRef.current({ hideLabels: false })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `graffiti-3d-view-${Date.now()}.png`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  function handleClearStageSource() {
    updateProject(currentProject.id, { stageSourceImage: null, stageSourceMeta: null })
  }

  return (
    <div className="edit-page">
      <div className="screen-title">
        <h1>🎬 3D 스테이지 v2 <span style={{ fontSize: 10, background: '#f59e0b', color: '#2d1b00', padding: '1px 6px', borderRadius: 3, marginLeft: 4 }}>BETA</span></h1>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/gallery')}>갤러리 {currentProject.cuts.length} →</button>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 11, marginBottom: 10 }}>
        이미지 + 스켈레톤을 3D로 보고 편집 → 관절을 앞뒤로 당겨 깊이 조정 → [✨ 이 구도로 변환]
      </p>

      {/* ===== 상단 툴바 ===== */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 10, fontSize: 11 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/pose')}>← 포즈 편집</button>
        <span style={tbDivider}></span>

        <span style={{ color: 'var(--text-3)' }}>선택:</span>
        <select value={selectedActorId || ''} onChange={e => handleSelectActor(e.target.value)}
          style={{ background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 11 }}>
          {currentProject.actors.length === 0 && <option>(배우 없음)</option>}
          {currentProject.actors.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => addActor({})}>＋ 사람 추가</button>

        <span style={tbDivider}></span>

        <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
          🔄 이미지 교체
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return
            await updateProject(currentProject.id, { anchorBlob: f, anchorSource: 'upload' })
            e.target.value = ''
          }} />
        </label>
        {stageSourceUrl && (
          <button className="btn btn-sm btn-ghost" onClick={handleClearStageSource} title="포즈편집에서 온 이미지 해제">
            ✕ 소스 해제
          </button>
        )}
      </div>

      {/* 스테이지 소스 배지 */}
      {stageSourceUrl && (
        <div style={{
          marginBottom: 8, padding: '6px 10px',
          background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.35)',
          borderRadius: 6, fontSize: 11, color: 'var(--accent-mint)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          🎭 <b>
            {currentProject.stageSourceImage
              ? `포즈 편집에서 전송됨 · ${currentProject.stageSourceMeta?.label || '이미지'}`
              : poseSelEditForLabel
              ? `포즈 편집에서 선택 중 · ${poseSelEditForLabel.label} (자동 연동)`
              : '이미지 연동 중'}
          </b>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 10 }}>
            포즈편집의 현재 선택이 바뀌면 여기도 자동 반영됩니다
          </span>
        </div>
      )}

      <div className="edit-grid" style={{ gridTemplateColumns: '1fr 280px' }}>
        <div className="edit-viewport-col">
          <div className="edit-viewport" style={{ position: 'relative', minHeight: 500 }}>
            <Stage3DView
              actors={currentProject.actors}
              selectedActorId={selectedActorId}
              selectedJointId={selectedJointId}
              onSelectActor={handleSelectActor}
              onSelectJoint={handleSelectJoint}
              onCommitJoint={handleCommitJoint}
              onCommitHeadGroup={handleCommitHeadGroup}
              imageUrl={imageToShow}
              height="100%"
              onRendererReady={({ renderer, scene, camera }) => {
                cameraInfoRef.current = () => {
                  // 카메라가 이미지 평면(원점)을 기준으로 어디서 보고 있는지 계산
                  const p = camera.position
                  const r = Math.max(0.001, Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z))
                  // az: 0=정면(+Z), 90=우측(+X), 180=뒤, -90=좌측
                  const az = Math.atan2(p.x, p.z) * 180 / Math.PI
                  // el: 0=수평, +=위에서, -=아래에서
                  const el = Math.asin(Math.max(-1, Math.min(1, p.y / r))) * 180 / Math.PI
                  return { az, el, distance: r }
                }
                snapshotRef.current = async (opts = {}) => {
                  const hidden = []
                  const setVis = (obj, vis) => {
                    if (obj.visible !== vis) {
                      hidden.push([obj, obj.visible])
                      obj.visible = vis
                    }
                  }
                  scene.traverse(o => {
                    if (opts.hideImage && o.userData?.kind === 'image-plane') setVis(o, false)
                    if (opts.hideLabels && o.userData?.kind === 'actor-label') setVis(o, false)
                    if (opts.hideCompass && o.userData?.kind === 'compass') setVis(o, false)
                    if (opts.hideSkeleton && o.userData?.kind === 'skeletons') setVis(o, false)
                    if (opts.hideSkeleton && o.userData?.kind === 'actor-skel') setVis(o, false)
                    if (opts.hideGrid && o.userData?.kind === 'grid') setVis(o, false)
                    if (opts.hideGrid && o.isAxesHelper) setVis(o, false)
                  })
                  const prevBgHex = scene.background?.getHex?.()
                  if (opts.blackBg && scene.background?.setHex) scene.background.setHex(0x000000)
                  renderer.render(scene, camera)
                  const blob = await new Promise(res => renderer.domElement.toBlob(res, 'image/png'))
                  for (const [obj, vis] of hidden) obj.visible = vis
                  if (opts.blackBg && scene.background?.setHex && prevBgHex != null) scene.background.setHex(prevBgHex)
                  return blob
                }
              }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
            🧊 3D 뷰 · <b style={{ color: imageLabel ? 'var(--accent-mint)' : 'var(--text-3)' }}>
              {imageLabel || '이미지 없음'}
            </b>
            {selectedJointId && <> · 선택 관절: <b style={{ color: 'var(--accent-mint)' }}>{selectedJointId}</b></>}
          </div>

          {/* ===== 히스토리 썸네일 (원본 / 편집1 / 편집2 ...) ===== */}
          {stageHistory.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {/* "원본" 슬롯 — 첫 클릭=선택(편집), 선택된 상태에서 재클릭=확대 */}
              {(() => {
                const originalUrl = stageSourceUrl || anchorUrl
                const isSel = !selectedStageId
                return (
                  <div
                    onClick={() => {
                      if (isSel && originalUrl) {
                        // 이미 선택됨 → Lightbox 확대
                        setLightboxEntry({ id: 'original', url: originalUrl, label: '원본', isOriginal: true })
                      } else {
                        // 선택되지 않음 → 원본으로 돌아가기
                        setSelectedStageId(null)
                      }
                    }}
                    style={{
                      flex: '0 0 auto', width: 70, cursor: 'pointer',
                      border: isSel ? '2px solid var(--accent-mint)' : '1px solid var(--border)',
                      borderRadius: 4, overflow: 'hidden', background: 'var(--bg-0)',
                      position: 'relative',
                    }}
                    title={isSel ? '편집중 — 재클릭으로 확대' : '클릭하면 원본으로 복귀'}>
                    <div style={{ width: '100%', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-2)' }}>
                      {originalUrl ? (
                        <img src={originalUrl} alt="원본" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>이미지 없음</span>
                      )}
                    </div>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(52,211,153,0.85)', color: '#052e1f',
                      fontSize: 9, padding: '2px 4px', textAlign: 'center', fontWeight: 700,
                    }}>원본</div>
                    {isSel && (
                      <div style={{
                        position: 'absolute', top: 2, left: 2,
                        background: 'var(--accent-mint)', color: '#052e1f',
                        padding: '1px 4px', borderRadius: 2, fontSize: 8, fontWeight: 700,
                      }}>✓ 편집중</div>
                    )}
                  </div>
                )
              })()}
              {stageHistory.map(entry => {
                const isSel = selectedStageId === entry.id
                return (
                  <div key={entry.id}
                    onClick={() => {
                      if (isSel) {
                        // 이미 선택됨 → Lightbox 확대
                        setLightboxEntry(entry)
                      } else {
                        // 선택되지 않음 → 선택 (편집 모드로 전환)
                        handleSelectStageEntry(entry)
                      }
                    }}
                    style={{
                      flex: '0 0 auto', width: 70, cursor: 'pointer',
                      border: isSel ? '2px solid var(--accent-purple)' : '1px solid var(--border)',
                      borderRadius: 4, overflow: 'hidden', background: 'var(--bg-0)',
                      position: 'relative',
                    }}
                    title={isSel ? `${entry.label} · 편집중 — 재클릭으로 확대` : `${entry.label} · 클릭으로 이 편집본 복원`}>
                    <img src={entry.url} alt={entry.label}
                      style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(139,92,246,0.85)', color: 'white',
                      fontSize: 9, padding: '2px 4px', textAlign: 'center', fontWeight: 700,
                    }}>{entry.label}</div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (!confirm(`${entry.label} 삭제?`)) return
                        setStageHistory(prev => prev.filter(h => h.id !== entry.id))
                        if (selectedStageId === entry.id) setSelectedStageId(null)
                      }}
                      title="삭제"
                      style={{
                        position: 'absolute', top: 2, right: 2,
                        background: 'rgba(0,0,0,0.7)', color: 'var(--danger)',
                        border: 0, width: 16, height: 16, borderRadius: 3,
                        fontSize: 10, cursor: 'pointer', lineHeight: 1,
                      }}>✕</button>
                    {isSel && (
                      <div style={{
                        position: 'absolute', top: 2, left: 2,
                        background: 'var(--accent-purple)', color: 'white',
                        padding: '1px 4px', borderRadius: 2, fontSize: 8, fontWeight: 700,
                      }}>✓ 편집중</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ===== 액션바 ===== */}
          <div style={{
            marginTop: 8, display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap',
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 8px',
          }}>
            <button className="btn btn-sm btn-ghost" onClick={handleDownloadCurrent}>💾 PC 저장</button>
            <button className="btn btn-sm" onClick={handleSendToPoseEditor}
              title="현재 선택된 이미지를 포즈편집의 편집N으로 추가하고 이동">
              🦴 포즈 편집으로 (편집N 추가)
            </button>
            {selStageEntry && (
              <button className="btn btn-sm btn-ghost" onClick={() => handleApplyAsAnchor(selStageEntry.blob)}
                title="이 이미지를 프로젝트 앵커(원본)로 교체">
                🎯 앵커 교체
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={handleGenerate}
              disabled={busy || currentProject.actors.length === 0}>
              {busy ? '⏳ 생성 중...' : '✨ 이 구도로 변환'}
            </button>
          </div>
        </div>

        <div className="edit-side">
          {/* 등장인물 */}
          <SectionHead right="＋추가"><b>👥 등장인물 ({currentProject.actors.length})</b></SectionHead>
          {currentProject.actors.map(a => (
            <div key={a.id}>
              <div onClick={() => handleSelectActor(a.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                borderRadius: 5, marginBottom: 2, fontSize: 11, cursor: 'pointer',
                background: a.id === selectedActorId ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-2)',
                border: a.id === selectedActorId ? '1px solid var(--accent-purple)' : '1px solid transparent',
                color: a.id === selectedActorId ? 'var(--text-1)' : 'var(--text-2)',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                {a.name}
              </div>
            </div>
          ))}
          {currentProject.actors.length === 0 && (
            <button className="btn btn-sm" onClick={() => addActor({})} style={{ width: '100%', marginTop: 4 }}>＋ 첫 배우 추가</button>
          )}

          {/* 선택된 관절 Z편집 */}
          {actor && selectedJointId && (() => {
            const j = actor.rigData?.joints?.find(x => x.id === selectedJointId)
            if (!j) return null
            return (
              <>
                <SectionHead><b>🎯 선택 관절: {selectedJointId}</b></SectionHead>
                <Slider label="X (좌우)" value={j.x || 50} min={-100} max={200}
                  onChange={v => updateJointField(actor.id, selectedJointId, 'x', v)} />
                <Slider label="Y (위아래 · 음수=위/땅아래)" value={j.y || 50} min={-100} max={200}
                  onChange={v => updateJointField(actor.id, selectedJointId, 'y', v)} />
                <Slider label="Z (앞뒤 깊이)" value={j.z ?? 50} min={-100} max={200}
                  onChange={v => updateJointField(actor.id, selectedJointId, 'z', v)} />
                <button className="btn btn-sm btn-ghost" onClick={() => updateJointField(actor.id, selectedJointId, 'z', 50)}
                  style={{ width: '100%', fontSize: 10 }}>Z를 0평면(50)으로 리셋</button>
              </>
            )
          })()}

          {/* 다중 인물 프리셋 */}
          {currentProject.actors.length > 1 && (
            <>
              <SectionHead><b>👥 다중 인물 배치</b></SectionHead>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                {Object.keys(INTERACTIONS).map(k => (
                  <button key={k} onClick={() => handleInteraction(k)} style={presetBtn(false)}>{k}</button>
                ))}
              </div>
            </>
          )}

          {/* AI 모델 선택 */}
          <SectionHead>
            <span>🤖 AI 모델</span>
            <span style={{ color: 'var(--text-3)', fontSize: 9 }}>
              {MODEL_META[aiModel]?.modelId || ''}
            </span>
          </SectionHead>
          <select value={aiModel} onChange={e => setAiModel(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-2)', color: 'var(--text-1)',
              border: '1px solid var(--border)', borderRadius: 5, padding: '5px 7px', fontSize: 11,
            }}>
            <optgroup label="Google Nano Banana (Gemini)">
              <option value="nano-banana-3.1">🍌 Nano Banana 3.1 Flash — 빠름·기본·포즈전송 최적</option>
              <option value="nano-banana-3-pro">🍌 Nano Banana 3 Pro — 고품질·느림</option>
              <option value="gemini">🍌 자동 (3.1 → 3 Pro 폴백)</option>
            </optgroup>
            <optgroup label="다른 모델 (API 키 필요)">
              <option value="grok">🤖 Grok Aurora (xAI)</option>
              <option value="flux">🌀 Flux 1.1 Pro (fal.ai)</option>
              <option value="qwen">🧧 Qwen wan2.2 (fal.ai · Flux 키 공용)</option>
            </optgroup>
            <optgroup label="개발">
              <option value="mock">🧪 Mock (테스트·키 없어도 됨)</option>
            </optgroup>
          </select>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 3 }}>
            {MODEL_META[aiModel]?.note || ''}
          </div>

          {/* 스타일 고정 */}
          <SectionHead><b>🎨 스타일 고정</b></SectionHead>
          <select value={stylePreset} onChange={e => setStylePreset(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-2)', color: 'var(--text-1)',
              border: '1px solid var(--border)', borderRadius: 5, padding: '5px 7px', fontSize: 11,
            }}
            title="원본이 만화인데 실사로 나올 때 강제로 맞추기">
            <option value="auto">자동 감지 (원본 스타일 따라감)</option>
            <option value="manga">📚 만화 (흑백·톤)</option>
            <option value="anime">🌸 애니 / 카툰</option>
            <option value="illustration">🎨 일러스트·디지털 페인팅</option>
            <option value="realistic">📷 실사 / 사진</option>
          </select>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 3, marginBottom: 4 }}>
            💡 만화가 실사로 변할 때: "📚 만화" 선택
          </div>

          {/* 샷 타입 */}
          <SectionHead><b>샷 타입</b></SectionHead>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {SHOT_TYPES.map(s => (
              <button key={s} onClick={() => setShotType(s)} style={presetBtn(shotType === s)}>{s}</button>
            ))}
          </div>

          {/* 클로즈업 */}
          <SectionHead><b>🔍 부위 클로즈업</b></SectionHead>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            <button onClick={() => setCloseupPart(null)} style={presetBtn(!closeupPart)}>없음</button>
            {CLOSEUP_PARTS.map(p => (
              <button key={p} onClick={() => setCloseupPart(p)} style={presetBtn(closeupPart === p)}>{p}</button>
            ))}
          </div>

          {/* 추가 프롬프트 */}
          <SectionHead><b>✏ 추가 지시 (선택)</b></SectionHead>
          <textarea value={extraPrompt} onChange={e => setExtraPrompt(e.target.value)}
            placeholder="예: 슬픈 표정, 역광, 비 오는 거리..."
            style={{
              width: '100%', minHeight: 60, background: 'var(--bg-2)',
              color: 'var(--text-1)', border: '1px solid var(--border)',
              borderRadius: 5, padding: 6, fontSize: 11, resize: 'vertical',
            }} />

          {/* 🧍 포즈 라이브러리 */}
          <SectionHead>
            <span style={{ color: 'var(--accent-teal)' }}>
              🧍 라이브러리 ({cloudPoses.length}){cloudLoading && ' ⏳'}
            </span>
            {user && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={handlePushToCloud}
                  style={{ background: 'var(--bg-3)', color: 'var(--accent-mint)', border: '1px solid var(--accent-mint)', padding: '1px 5px', borderRadius: 3, fontSize: 9, cursor: 'pointer' }}
                  title="현재 배우 포즈를 클라우드에 저장">
                  💾
                </button>
                <button onClick={handleSyncCloud}
                  style={{ background: 'var(--bg-3)', color: 'var(--accent-teal)', border: '1px solid var(--accent-teal)', padding: '1px 5px', borderRadius: 3, fontSize: 9, cursor: 'pointer' }}
                  title="클라우드 동기화">
                  ☁
                </button>
              </div>
            )}
          </SectionHead>
          {!user && (
            <div style={{ color: 'var(--warn)', fontSize: 9, padding: 4 }}>
              🔑 상단 "Google 로그인" 후 사용 가능
            </div>
          )}
          {cloudPoses.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4,
              maxHeight: 200, overflowY: 'auto',
              background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, padding: 2,
            }}>
              {cloudPoses.map(doc => {
                const name = doc.label || doc.name || doc.title || `#${(doc.id || '').slice(-8)}`
                return (
                  <div key={doc.id} style={{
                    display: 'flex', alignItems: 'center', gap: 2,
                    padding: '3px 4px', borderRadius: 3, background: 'var(--bg-2)',
                  }}>
                    <button onClick={() => handleLoadCloudPose(doc)}
                      title={`적용: ${name}`}
                      style={{
                        flex: 1, textAlign: 'left',
                        background: 'transparent', border: 0,
                        color: 'var(--text-1)', fontSize: 11,
                        padding: '3px 4px', cursor: 'pointer',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                      <span style={{ color: 'var(--accent-teal)', marginRight: 4 }}>☁</span>{name}
                    </button>
                    <button onClick={() => handleRenameCloud(doc)} title="이름 변경"
                      style={{ background: 'transparent', border: 0, color: 'var(--text-3)', width: 18, height: 18, fontSize: 11, cursor: 'pointer', padding: 0 }}>✏</button>
                    <button onClick={() => handleDeleteCloud(doc)} title="삭제"
                      style={{ background: 'transparent', border: 0, color: 'var(--danger)', width: 18, height: 18, fontSize: 11, cursor: 'pointer', padding: 0 }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* 도움말 */}
          <div style={{
            marginTop: 12, padding: 8, background: 'rgba(139,92,246,0.08)',
            border: '1px solid rgba(139,92,246,0.3)', borderRadius: 5, fontSize: 10, lineHeight: 1.5,
            color: 'var(--text-2)',
          }}>
            <div style={{ color: 'var(--accent-purple)', fontWeight: 'bold', marginBottom: 4 }}>💡 사용법</div>
            • 관절 <b>구슬을 드래그</b>해서 위치 편집 (앞뒤 포함)<br/>
            • <b>코(nose)를 드래그</b>하면 얼굴(눈·귀) 5점이 함께 이동<br/>
            • 카메라를 옆으로 돌리면 <b>앞뒤 깊이(z)</b>를 확인<br/>
            • 히스토리에서 이미지 선택 → <b>포즈 편집으로</b> 전송 가능<br/>
            • 여기서 편집한 건 <b>포즈 편집</b>에도 자동 반영
          </div>
        </div>
      </div>

      {lightboxEntry && (
        <Lightbox
          src={lightboxEntry.url}
          caption={lightboxEntry.isOriginal ? '원본 이미지' : `3D 스테이지 · ${lightboxEntry.label}`}
          onClose={() => setLightboxEntry(null)}
          actions={[
            { label: 'PC 저장', icon: '💾', onClick: () => {
              const a = document.createElement('a')
              a.href = lightboxEntry.url
              a.download = `graffiti-stage-${lightboxEntry.label || 'image'}-${Date.now()}.png`
              a.click()
            }},
            ...(!lightboxEntry.isOriginal ? [
              { label: '이 편집으로 복원', icon: '✓', variant: 'primary', onClick: () => {
                handleSelectStageEntry(lightboxEntry)
                setLightboxEntry(null)
              }},
              { label: '포즈 편집으로', icon: '🦴', onClick: () => {
                setSelectedStageId(lightboxEntry.id)
                setLightboxEntry(null)
                setTimeout(() => handleSendToPoseEditor(), 100)
              }},
            ] : []),
          ]}
        />
      )}
    </div>
  )
}

// ─ 헬퍼 ─
function SectionHead({ children, right }) {
  return (
    <div style={{
      fontSize: 9, color: 'var(--text-3)', letterSpacing: 0.8,
      textTransform: 'uppercase', margin: '10px 0 4px', fontWeight: 600,
      display: 'flex', justifyContent: 'space-between',
    }}>
      {children}
      {right && <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{right}</span>}
    </div>
  )
}

function Slider({ label, value, onChange, min, max, suffix = '' }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-2)', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--accent-mint)', fontWeight: 600 }}>{Math.round(value)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </div>
  )
}

function presetBtn(active) {
  return {
    background: active ? 'var(--accent-purple)' : 'var(--bg-2)',
    color: active ? 'white' : 'var(--text-2)',
    border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
    padding: 4, borderRadius: 4, fontSize: 9, cursor: 'pointer',
  }
}

const tbDivider = { width: 1, height: 16, background: 'var(--border)', margin: '0 3px' }

const MODEL_META = {
  'nano-banana-3.1': {
    modelId: 'gemini-3.1-flash-image-preview',
    note: '⚡ 참조 이미지 + 포즈 스켈레톤 동시 입력 가능. 주력 모델.',
  },
  'nano-banana-3-pro': {
    modelId: 'gemini-3-pro-image-preview',
    note: '🎨 고품질 · 참조 다중 지원. 포즈전송 잘됨.',
  },
  'gemini': {
    modelId: '3.1 → 3 Pro 자동',
    note: '🔁 1순위 실패 시 자동 폴백',
  },
  'grok': {
    modelId: 'grok-2-image',
    note: '⚠ VITE_GROK_API_KEY 필요. 현재 참조 이미지 지원 제한적 (텍스트 주력).',
  },
  'flux': {
    modelId: 'flux-pro-1.1 via fal.ai',
    note: '⚠ VITE_FAL_API_KEY 필요. 텍스트→이미지 only, 포즈 전송 약함.',
  },
  'qwen': {
    modelId: 'qwen-image via fal.ai',
    note: '⚠ VITE_FAL_API_KEY 사용 (Flux와 공유). 텍스트→이미지, 포즈 전송 제한적.',
  },
  'mock': {
    modelId: 'canvas placeholder',
    note: '🧪 API 키 없이 레이아웃 테스트용 더미 이미지 반환.',
  },
}


// 카메라 az/el → 자연어 방향 설명
function describeViewAngle(az, el) {
  // az: 0=정면(+Z에서 봄), 90=캐릭터 우측에서, 180=뒤에서, -90=좌측에서
  const a = ((az + 360) % 360)
  let dir
  if (a < 22.5 || a >= 337.5) dir = 'front view'
  else if (a < 67.5) dir = '3/4 right front view'
  else if (a < 112.5) dir = 'right side view (profile)'
  else if (a < 157.5) dir = '3/4 right back view'
  else if (a < 202.5) dir = 'back view (from behind)'
  else if (a < 247.5) dir = '3/4 left back view'
  else if (a < 292.5) dir = 'left side view (profile)'
  else dir = '3/4 left front view'

  let vertical = ''
  if (el > 30) vertical = ', high-angle (looking down from above)'
  else if (el > 10) vertical = ', slight high-angle'
  else if (el < -30) vertical = ', low-angle (looking up from below)'
  else if (el < -10) vertical = ', slight low-angle'
  return dir + vertical
}

