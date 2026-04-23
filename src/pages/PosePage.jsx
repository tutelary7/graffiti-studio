import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject } from '../context/ProjectContext.jsx'
import { cloneRig, RIG_LIST, addJoint, removeJoint, rigToSVG } from '../lib/skeleton/rigs.js'
import { POSES, applyPose, flipHorizontal } from '../lib/skeleton/poses.js'
import { put, getAll, STORES, settings } from '../lib/storage.js'
import { generateImage, renderSkeletonToBlob } from '../lib/ai/index.js'
import MultiSkeletonView from '../components/MultiSkeletonView.jsx'
import CharacterSwapModal from '../components/CharacterSwapModal.jsx'
import Lightbox from '../components/Lightbox.jsx'
import KpsThumbnail from '../components/KpsThumbnail.jsx'
import { extractPoseFromImage } from '../lib/ai/extractPose.js'
import { useAuth } from '../context/AuthContext.jsx'
import { listPoseLibrary, normalizeToRig, savePoseToCloud, updatePoseLabel, deletePoseFromCloud } from '../lib/firebase/poseLibrary.js'

const GENDERS = [
  { k: 'unspecified', l: '미지정', icon: '' },
  { k: 'female', l: '여', icon: '♀' },
  { k: 'male', l: '남', icon: '♂' },
  { k: 'other', l: '기타', icon: '⚧' },
]

export default function PosePage() {
  const navigate = useNavigate()
  const { currentProject, updateProject, updateActor, addActor, removeActor, addCut } = useProject()
  const [selectedActorId, setSelectedActorId] = useState(null)
  const [selectedJointId, setSelectedJointId] = useState(null)
  const [anchorUrl, setAnchorUrl] = useState(null)
  const [showSwap, setShowSwap] = useState(false)
  const [saved, setSaved] = useState([])
  const [genBusy, setGenBusy] = useState(false)
  const [genResult, setGenResult] = useState(null)
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [showGenderPicker, setShowGenderPicker] = useState(null)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [anchorOpacity, setAnchorOpacity] = useState(0.85)
  const [hideMode, setHideMode] = useState('auto')   // 'auto' | 'all' | 'visible'
  const [manuallyHidden, setManuallyHidden] = useState({})
  const [boneStates, setBoneStates] = useState({})   // {[boneKey]: 'dashed'|'hidden'}
  const [boneAddMode, setBoneAddMode] = useState(false)
  const [boneAddFirstJoint, setBoneAddFirstJoint] = useState(null)
  const [extraPrompt, setExtraPrompt] = useState('')
  // Eye gaze (시선 방향 — 머리 회전은 제거됨, 노트북 아크가 3D 방식 정리해주면 다시 구현 예정)
  const [eyeGaze, setEyeGaze] = useState('forward')

  function toggleHideJoint(jointId) {
    setManuallyHidden(prev => {
      const next = { ...prev }
      if (next[jointId]) delete next[jointId]
      else next[jointId] = true
      return next
    })
  }

  async function handleAddBoneClick(jointId) {
    if (!actor) return
    if (!boneAddFirstJoint) {
      setBoneAddFirstJoint(jointId)
      setExtractNotes(`선 추가: "${jointId}" 선택됨 → 두 번째 관절을 클릭하세요`)
      return
    }
    if (boneAddFirstJoint === jointId) {
      setBoneAddFirstJoint(null)
      setExtractNotes('같은 관절 — 취소됨')
      setTimeout(() => setExtractNotes(''), 2000)
      return
    }
    // 이미 존재하는 본인지 확인
    const exists = actor.rigData.bones.some(([f, t]) =>
      (f === boneAddFirstJoint && t === jointId) || (f === jointId && t === boneAddFirstJoint)
    )
    if (exists) {
      setExtractNotes('이미 존재하는 선')
      setBoneAddFirstJoint(null)
      setTimeout(() => setExtractNotes(''), 2000)
      return
    }
    // 본 추가
    const newBones = [...actor.rigData.bones, [boneAddFirstJoint, jointId, '#ffffff']]
    await updateActor(actor.id, { rigData: { ...actor.rigData, bones: newBones } })
    setExtractNotes(`✓ 선 추가됨: ${boneAddFirstJoint} → ${jointId}`)
    setBoneAddFirstJoint(null)
    setBoneAddMode(false)
    setTimeout(() => setExtractNotes(''), 3000)
  }

  function toggleBone(boneKey) {
    setBoneStates(prev => {
      const cur = prev[boneKey]
      const next = { ...prev }
      // cycle: 실선(보임) ⇄ 점선 — 삭제는 🗑 버튼으로만 (실수 방지)
      if (cur === 'dashed') delete next[boneKey]
      else next[boneKey] = 'dashed'
      return next
    })
  }

  // 선 완전 삭제 — rig.bones에서 제거 (되돌릴 수 없음)
  async function handleDeleteBone(boneKey) {
    if (!actor) return
    const [fromId, toId] = boneKey.split('-')
    const newBones = actor.rigData.bones.filter(([f, t]) => !(f === fromId && t === toId))
    await updateActor(actor.id, { rigData: { ...actor.rigData, bones: newBones } })
    // boneStates에서도 제거
    setBoneStates(prev => {
      const next = { ...prev }
      delete next[boneKey]
      return next
    })
  }

  // ESC 키로 선 추가 모드 취소
  useEffect(() => {
    if (!boneAddMode) return
    const handler = (e) => {
      if (e.key === 'Escape') {
        setBoneAddMode(false)
        setBoneAddFirstJoint(null)
        setExtractNotes('선 추가 취소')
        setTimeout(() => setExtractNotes(''), 1500)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [boneAddMode])
  const [extractBusy, setExtractBusy] = useState(false)
  const [extractNotes, setExtractNotes] = useState('')
  const lastAutoExtractedBlobRef = useRef(null)
  const hydratedProjectIdRef = useRef(null)
  // 이미지 생성 히스토리: [{ id, url, blob, rigSnapshot, actorName, timestamp, isOriginal }]
  const [genHistory, setGenHistory] = useState([])
  const [selectedGenId, setSelectedGenId] = useState(null)
  const { user } = useAuth()
  const [cloudPoses, setCloudPoses] = useState([])
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudError, setCloudError] = useState(null)
  const [cloudUidOverride, setCloudUidOverride] = useState(() => settings.get('cloudUidOverride', ''))

  async function loadCloud(uid) {
    if (!uid) { setCloudPoses([]); return }
    setCloudLoading(true); setCloudError(null)
    try {
      const docs = await listPoseLibrary(uid, { max: 50 })
      setCloudPoses(docs)
      console.log('[cloud pose] 로드 성공:', docs.length, '건 from uid:', uid)
      if (docs.length > 0) console.log('[cloud pose] 샘플 첫 문서:', docs[0])
    } catch (err) {
      const msg = err.code ? `${err.code}: ${err.message}` : err.message
      console.error('[cloud pose] 로드 실패:', err)
      setCloudError(msg)
      setCloudPoses([])
    } finally {
      setCloudLoading(false)
    }
  }

  useEffect(() => {
    const uid = cloudUidOverride || user?.uid
    if (uid) loadCloud(uid)
    else { setCloudPoses([]); setCloudError(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, cloudUidOverride])

  useEffect(() => {
    if (currentProject?.anchorBlob) {
      const url = URL.createObjectURL(currentProject.anchorBlob)
      setAnchorUrl(url)
      // 앵커 이미지를 "원본" 히스토리 엔트리로 (이미 있으면 교체)
      setGenHistory(prev => {
        const origIdx = prev.findIndex(h => h.isOriginal)
        const origEntry = {
          id: 'original-' + Date.now(),
          url, blob: currentProject.anchorBlob,
          label: '원본', isOriginal: true,
          timestamp: Date.now(),
        }
        if (origIdx >= 0) {
          const next = [...prev]; next[origIdx] = origEntry
          return next
        }
        return [origEntry, ...prev]
      })
      return () => URL.revokeObjectURL(url)
    }
  }, [currentProject?.anchorBlob])

  useEffect(() => {
    getAll(STORES.skeletons).then(setSaved).catch(() => setSaved([]))
  }, [])

  useEffect(() => {
    if (currentProject && !selectedActorId && currentProject.actors.length > 0) {
      setSelectedActorId(currentProject.actors[0].id)
    }
  }, [currentProject, selectedActorId])

  // ⚠ 모든 hooks는 early return 위에 있어야 함 (Rules of Hooks)
  const actor = currentProject?.actors.find(a => a.id === selectedActorId) || null

  // 앵커 이미지가 바뀌면 1회 자동 추출 (모달 없이 배경에서 실행)
  useEffect(() => {
    if (!currentProject?.anchorBlob || !actor) return
    if (lastAutoExtractedBlobRef.current === currentProject.anchorBlob) return
    lastAutoExtractedBlobRef.current = currentProject.anchorBlob
    runExtraction(currentProject.anchorBlob, 1, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.anchorBlob, actor?.id])

  // ── 프로젝트 전환 시 저장된 편집 히스토리 복원 (한 번만) ──
  useEffect(() => {
    if (!currentProject) return
    if (hydratedProjectIdRef.current === currentProject.id) return
    hydratedProjectIdRef.current = currentProject.id
    const savedEdits = (currentProject.editHistory || []).map(h => ({
      ...h,
      url: h.blob ? URL.createObjectURL(h.blob) : '',
    }))
    if (savedEdits.length > 0) {
      console.log(`[hydrate] 편집 히스토리 ${savedEdits.length}건 복원`)
      setGenHistory(prev => {
        // 원본은 anchorBlob 변경 effect가 처리. 편집본만 합침.
        const original = prev.find(h => h.isOriginal)
        return [...(original ? [original] : []), ...savedEdits]
      })
    }
    if (currentProject.selectedHistoryId) {
      setSelectedGenId(currentProject.selectedHistoryId)
    }
  }, [currentProject?.id])

  // ── 편집 히스토리 변경 시 자동 저장 (hydration 끝난 후만) ──
  useEffect(() => {
    if (!currentProject) return
    if (hydratedProjectIdRef.current !== currentProject.id) return
    const edits = genHistory
      .filter(h => !h.isOriginal)
      .map(({ url, ...rest }) => rest)  // url은 매 hydrate마다 재생성
    updateProject(currentProject.id, {
      editHistory: edits,
      selectedHistoryId: selectedGenId,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genHistory, selectedGenId])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>🎭 포즈 편집</h1></div>
        <div className="placeholder"><div className="ico">⚠</div><h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  async function runExtraction(blob, targetIdx = 1, silent = false) {
    if (!blob || !actor) return
    setExtractBusy(true); setExtractNotes(silent ? '앵커 이미지에서 자동 추출 중...' : '추출 중...')
    try {
      const r = await extractPoseFromImage(blob, { targetActorIdx: targetIdx })
      const clonedRig = JSON.parse(JSON.stringify(r.rigData))
      await updateActor(actor.id, { rigId: 'human', rigData: clonedRig })
      const engineEmoji = r.engine === 'mediapipe' ? '🎯' : r.engine === 'gemini' ? '🤖' : '⚠'
      setExtractNotes(`${engineEmoji} ${r.engine} · ${Math.round(r.confidence * 100)}% · ${r.notes || ''}${r.facing ? ` · ${r.facing}` : ''}`)

      // 현재 선택된 히스토리 엔트리에 이 rigSnapshot 저장 (독립 유지)
      if (selectedGenId) {
        setGenHistory(prev => prev.map(h =>
          h.id === selectedGenId ? { ...h, rigSnapshot: clonedRig } : h
        ))
      } else {
        // 선택된게 없으면 원본에 적용
        setGenHistory(prev => prev.map(h =>
          h.isOriginal ? { ...h, rigSnapshot: clonedRig } : h
        ))
      }
    } catch (e) {
      setExtractNotes('⚠ ' + e.message)
    } finally {
      setExtractBusy(false)
      setTimeout(() => setExtractNotes(''), 8000)
    }
  }

  async function handleReExtract() {
    // 현재 선택된 히스토리 엔트리 우선, 없으면 원본 앵커
    const selEntry = genHistory.find(h => h.id === selectedGenId)
    const sourceBlob = selEntry?.blob || currentProject.anchorBlob
    const sourceLabel = selEntry?.label || '원본 앵커'
    if (!sourceBlob) { alert('이미지가 없어요. 홈 → 앵커 설정에서 등록하세요.'); return }
    const targetIdx = prompt(
      `"${sourceLabel}" 이미지에서 포즈 재추출 — 여러 명 있으면 몇 번째? (1부터)`,
      '1'
    )
    if (!targetIdx) return
    const n = parseInt(targetIdx, 10)
    if (!n || n < 1) return
    console.log(`[handleReExtract] "${sourceLabel}"에서 추출`)
    runExtraction(sourceBlob, n, false)
  }

  async function handleImportJson(e) {
    const file = e.target.files?.[0]
    if (!file || !actor) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result)
        let rigData = parsed.rigData
        if (!rigData && parsed.actors?.[0]?.rigData) rigData = parsed.actors[0].rigData
        if (!rigData && parsed.joints && parsed.bones) rigData = parsed
        if (!rigData) throw new Error('rigData 구조 없음')
        await updateActor(actor.id, { rigId: 'human', rigData: JSON.parse(JSON.stringify(rigData)) })
        setExtractNotes('✓ JSON에서 불러옴: ' + (parsed.name || file.name))
        setTimeout(() => setExtractNotes(''), 5000)
      } catch (err) {
        alert('JSON 불러오기 실패: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleChangeRig(rigId) {
    if (!actor) return
    await updateActor(actor.id, { rigId, rigData: cloneRig(rigId) })
  }
  async function handleRigUpdate(newRig) {
    if (!actor) return
    await updateActor(actor.id, { rigData: newRig })
  }
  async function handlePose(key) {
    if (!actor) return
    const clone = JSON.parse(JSON.stringify(actor.rigData))
    applyPose(clone, key)
    await updateActor(actor.id, { rigData: clone })
  }
  async function handleFlip() {
    if (!actor) return
    const clone = JSON.parse(JSON.stringify(actor.rigData))
    flipHorizontal(clone)
    await updateActor(actor.id, { rigData: clone })
  }
  async function handleAddJoint() {
    if (!actor) return
    const newId = `joint-${Date.now()}`
    const clone = JSON.parse(JSON.stringify(actor.rigData))
    addJoint(clone, { id: newId, parentId: selectedJointId || undefined, x: 50, y: 50 })
    await updateActor(actor.id, { rigData: clone })
    setSelectedJointId(newId)
  }
  async function handleRemoveJoint() {
    if (!actor || !selectedJointId) return
    const clone = JSON.parse(JSON.stringify(actor.rigData))
    removeJoint(clone, selectedJointId)
    await updateActor(actor.id, { rigData: clone })
    setSelectedJointId(null)
  }
  async function handleRemoveActor() {
    if (!actor) return
    if (!confirm(`${actor.name} 삭제?`)) return
    const remainIds = currentProject.actors.filter(a => a.id !== actor.id).map(a => a.id)
    await removeActor(actor.id)
    setSelectedActorId(remainIds[0] || null)
  }
  async function handleRenameActor() {
    if (!actor) return
    const name = prompt(`배우 이름 변경 (현재: "${actor.name}"):`, actor.name)
    if (name === null) return   // 취소
    const trimmed = name.trim()
    if (!trimmed) { alert('빈 이름은 저장 안 됩니다'); return }
    if (trimmed === actor.name) return
    await updateActor(actor.id, { name: trimmed })
    setExtractNotes(`✓ "${trimmed}"로 변경됨`)
    setTimeout(() => setExtractNotes(''), 3000)
  }
  async function handleSetGender(g) {
    if (!actor) return
    await updateActor(actor.id, { gender: g })
    setShowGenderPicker(null)
  }
  async function handleSave() {
    if (!currentProject.actors.length || !actor) return
    const defaultName = `${actor.name} 포즈`
    const name = prompt('이 스켈레톤 이름:', defaultName)
    if (!name) return

    // 로그인 상태면 클라우드로 (노트북과 공유), 아니면 로컬
    if (user) {
      try {
        await savePoseToCloud(user.uid, {
          name,
          rigData: actor.rigData,
          source: 'graffiti-studio',
        })
        setCloudPoses(await listPoseLibrary(user.uid, { max: 50 }))
        setExtractNotes(`✓ "${name}" 클라우드 저장`)
        setTimeout(() => setExtractNotes(''), 3000)
      } catch (e) {
        alert('클라우드 저장 실패: ' + e.message + '\n로컬에 저장합니다.')
        await saveToLocal(name)
      }
    } else {
      await saveToLocal(name)
      setExtractNotes(`✓ "${name}" 로컬 저장 (로그인하면 클라우드 공유)`)
      setTimeout(() => setExtractNotes(''), 4000)
    }
  }

  async function saveToLocal(name) {
    const actorsSnapshot = currentProject.actors.map(a => ({
      name: a.name, gender: a.gender, color: a.color,
      rigId: a.rigId, rigData: JSON.parse(JSON.stringify(a.rigData)),
    }))
    const svgPreview = rigToSVG(currentProject.actors[0].rigData, { size: 200 })
    await put(STORES.skeletons, {
      name,
      actors: actorsSnapshot,
      rigId: currentProject.actors[0].rigId,
      rigData: currentProject.actors[0].rigData,
      svgPreview,
      createdAt: new Date().toISOString(),
    })
    setSaved(await getAll(STORES.skeletons))
  }
  async function handleExport() {
    if (!currentProject.actors.length) return
    // JSON은 장면 전체 + 각 배우별 SVG
    const payload = {
      project: currentProject.name,
      exportedAt: new Date().toISOString(),
      actors: currentProject.actors.map(a => ({
        name: a.name, gender: a.gender, rigId: a.rigId, rigData: a.rigData,
      })),
    }
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
             `${currentProject.name}-scene.json`)
    // 각 배우별 SVG도 개별 저장
    for (const a of currentProject.actors) {
      const svg = rigToSVG(a.rigData, { size: 512 })
      download(new Blob([svg], { type: 'image/svg+xml' }), `${a.name}.svg`)
    }
  }
  async function handleLoadCloudPose(cloudDoc) {
    if (!actor) return
    const rigData = normalizeToRig(cloudDoc)
    if (rigData._unknownSchema) {
      if (!confirm(`"${cloudDoc.label || cloudDoc.name || cloudDoc.id}" 포맷 인식 실패. T-pose로 적용?`)) return
      console.warn('[cloud pose] 알 수 없는 스키마:', cloudDoc)
    }
    await updateActor(actor.id, { rigId: 'human', rigData: JSON.parse(JSON.stringify(rigData)) })
    setExtractNotes(`✓ "${cloudDoc.label || cloudDoc.name || '포즈'}" 적용`)
    setTimeout(() => setExtractNotes(''), 3000)
  }

  async function handleSyncCloud() {
    if (!user) return
    setCloudLoading(true)
    try {
      const { syncLibrary } = await import('../lib/firebase/poseLibrary.js')
      const { mergedCount, pushedCount, pulledCount } = await syncLibrary(user.uid).then(r => ({
        mergedCount: r.merged2D.length,
        pushedCount: r.pushedCount,
        pulledCount: r.pulledCount,
      }))
      const docs = await listPoseLibrary(user.uid, { max: 100 })
      setCloudPoses(docs)
      setExtractNotes(`✓ 동기화 — 올림 ${pushedCount} / 내려받음 ${pulledCount}`)
      setTimeout(() => setExtractNotes(''), 4000)
    } catch (e) { alert('동기화 실패: ' + e.message) }
    finally { setCloudLoading(false) }
  }

  async function handlePushToCloud() {
    if (!user) { alert('먼저 상단 Google 로그인'); return }
    if (!actor) return
    const name = prompt('클라우드에 저장할 이름:', `${actor.name} - ${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
    if (!name) return
    try {
      await savePoseToCloud(user.uid, { name, rigData: actor.rigData, source: 'graffiti-studio' })
      setCloudPoses(await listPoseLibrary(user.uid, { max: 30 }))
      alert('✓ 클라우드 저장 완료 (novel-workstation에서도 같은 라이브러리 공유)')
    } catch (e) { alert('저장 실패: ' + e.message) }
  }

  async function handleRenameCloud(doc) {
    if (!user) return
    const current = doc.label || doc.name || ''
    const next = prompt(`이름 변경 (현재: "${current}"):`, current)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed) return
    if (trimmed === current) return
    try {
      await updatePoseLabel(user.uid, doc.id, trimmed)
      // 즉시 로컬 상태 반영 (Firestore 재조회 안 해도)
      setCloudPoses(prev => prev.map(d => d.id === doc.id ? { ...d, label: trimmed, name: trimmed } : d))
    } catch (e) { alert('이름 변경 실패: ' + e.message) }
  }

  async function handleDeleteCloud(doc) {
    if (!user) return
    if (!confirm(`"${doc.label || doc.name || doc.id}" 클라우드에서 삭제? 노트북에서도 사라집니다.`)) return
    try {
      await deletePoseFromCloud(user.uid, doc.id)
      setCloudPoses(prev => prev.filter(d => d.id !== doc.id))
    } catch (e) { alert('삭제 실패: ' + e.message) }
  }

  async function handleLoadSavedSkeleton(s) {
    if (!actor) return
    // 신규: 장면 저장본 — 여러 명이면 confirm, 1명이면 바로 적용
    if (s.actors && s.actors.length > 0) {
      const multiTarget = s.actors.length > 1 || currentProject.actors.length > 1
      if (multiTarget) {
        if (!confirm(`"${s.name}" 불러오기 — 현재 ${currentProject.actors.length}명의 포즈를 저장본 ${s.actors.length}명으로 교체?`)) return
      }
      for (let i = 0; i < s.actors.length; i++) {
        const sa = s.actors[i]
        const existing = currentProject.actors[i]
        if (existing) {
          await updateActor(existing.id, {
            rigId: sa.rigId || 'human',
            rigData: JSON.parse(JSON.stringify(sa.rigData)),
          })
        } else {
          await addActor({ name: sa.name, gender: sa.gender, rigId: sa.rigId, rigData: JSON.parse(JSON.stringify(sa.rigData)) })
        }
      }
    } else {
      // 단일 — 바로 적용
      await updateActor(actor.id, {
        rigId: s.rigId || 'human',
        rigData: JSON.parse(JSON.stringify(s.rigData)),
      })
    }
    setExtractNotes(`✓ "${s.name}" 불러옴`)
    setTimeout(() => setExtractNotes(''), 3000)
  }

  async function handleGenerateImage() {
    if (!actor) return
    setGenBusy(true); setGenResult(null)
    try {
      // 스켈레톤 PNG — OpenPose 18-point, 검정 배경 + COCO 컬러 본
      const hiddenBoneSet = new Set(
        Object.entries(boneStates).filter(([, v]) => v === 'hidden').map(([k]) => k)
      )
      const dashedBoneSet = new Set(
        Object.entries(boneStates).filter(([, v]) => v === 'dashed').map(([k]) => k)
      )
      const dashedBones = Object.entries(boneStates)
        .filter(([, v]) => v === 'dashed')
        .map(([k]) => k.replace('-', '→'))
      const skeletonBlob = await renderSkeletonToBlob(actor.rigData, {
        size: 512,
        hiddenJoints: manuallyHidden,
        hiddenBones: hiddenBoneSet,
        dashedBones: dashedBoneSet,
      })

      // 신체축 분석 — 역방향 포즈 힌트
      const rig = actor.rigData
      const jm = Object.fromEntries(rig.joints.map(j => [j.id, j]))
      const headY = jm.nose?.y ?? jm.head?.y ?? 10
      const footY = Math.max(jm.r_ankle?.y ?? 90, jm.l_ankle?.y ?? 90)
      let axisNote = ''
      if (headY > footY + 10) axisNote = 'BODY AXIS: head is BELOW feet → UPSIDE-DOWN / handstand pose. Do NOT draw the character upright.'
      else if (Math.abs(headY - footY) < 15) axisNote = 'BODY AXIS: head and feet at similar height → character is LYING DOWN or FLYING HORIZONTALLY. Do NOT stand the character up.'

      const gender = actor.gender && actor.gender !== 'unspecified' ? `Character gender: ${actor.gender}. ` : ''
      const facing = rig.facing ? `Facing: ${rig.facing}. ` : ''

      // 관절 각도 요약 (Gemini에 텍스트로도 힌트 제공)
      const pose2Lines = [
        `r_shoulder(${(jm.r_shoulder?.x||0).toFixed(0)},${(jm.r_shoulder?.y||0).toFixed(0)}) → r_wrist(${(jm.r_wrist?.x||0).toFixed(0)},${(jm.r_wrist?.y||0).toFixed(0)})`,
        `l_shoulder(${(jm.l_shoulder?.x||0).toFixed(0)},${(jm.l_shoulder?.y||0).toFixed(0)}) → l_wrist(${(jm.l_wrist?.x||0).toFixed(0)},${(jm.l_wrist?.y||0).toFixed(0)})`,
        `r_hip → r_ankle(${(jm.r_ankle?.x||0).toFixed(0)},${(jm.r_ankle?.y||0).toFixed(0)})`,
        `l_hip → l_ankle(${(jm.l_ankle?.x||0).toFixed(0)},${(jm.l_ankle?.y||0).toFixed(0)})`,
      ].join('; ')

      const prompt = `Generate a character photo based on TWO reference images. This is a POSE TRANSFER task.

IMAGE 1 = IDENTITY source (character appearance: face, hair, clothing, body type, art style)
IMAGE 2 = POSE source (OpenPose skeleton on black background — the EXACT pose to reproduce)

WEIGHT: 80% pose from IMAGE 2, 20% identity from IMAGE 1.
Do NOT copy IMAGE 1's pose. Do NOT copy IMAGE 2's style.

${gender}${facing}${axisNote}

${eyeGaze && eyeGaze !== 'forward' ?
  `EYE GAZE OVERRIDE: pupils looking ${eyeGaze.replace('-', ' & ')} (head orientation unchanged, ONLY eyeball direction shifts).\n` : ''}
${extraPrompt.trim() ? `USER DIRECTION (장면/감정/스타일/연기): ${extraPrompt.trim()}\n` : ''}
${dashedBones.length > 0 ?
  `OCCLUDED BODY PARTS (these bones are drawn as DASHED/faded lines in the skeleton — they are HIDDEN behind body, clothing, objects, or outside the frame): ${dashedBones.join(', ')}. Draw these parts as occluded — partially visible, tucked behind other elements, covered by clothing, or cropped out. Do NOT render them fully visible.\n` : ''}
JOINT POSITIONS (COCO18, x/y 0..100 relative to image):
${pose2Lines}

${axisNote ? 'The body axis is NOT vertical. Follow IMAGE 2 precisely.' : ''}

CRITICAL RULES:
1. The character in the output must be in the pose shown in IMAGE 2 (the colored skeleton).
2. Arms, legs, torso, and head orientation MUST match IMAGE 2.
3. Do NOT render any colored lines, dots, stick figures, or skeleton overlay in the output.
4. Preserve IMAGE 1's face and outfit, but reshape the body pose to match IMAGE 2.

REMEMBER: If the output pose looks like IMAGE 1's pose, the generation is WRONG.
Pose comes from IMAGE 2. Identity comes from IMAGE 1.`

      const refs = []
      if (currentProject.anchorBlob) refs.push(currentProject.anchorBlob)
      refs.push(skeletonBlob)
      console.log('[pose-gen] 2장 전송 (refs, skeleton) + 황금률 프롬프트')
      const result = await generateImage({ prompt, references: refs, model: 'gemini', aspectRatio: '3:4' })
      setGenResult(result)
      // 히스토리에 추가 — 편집1, 편집2, ...
      setGenHistory(prev => {
        const editNum = prev.filter(h => !h.isOriginal).length + 1
        const entry = {
          id: 'gen-' + Date.now(),
          url: result.url, blob: result.blob,
          label: `편집${editNum}`,
          rigSnapshot: JSON.parse(JSON.stringify(actor.rigData)),
          actorId: actor.id, actorName: actor.name,
          timestamp: Date.now(),
        }
        setSelectedGenId(entry.id)
        return [...prev, entry]
      })
      await addCut({
        imageBlob: result.blob, kind: 'pose',
        tags: ['포즈', actor.name, actor.rigId],
        meta: { ...result.meta, actorId: actor.id, rigId: actor.rigId },
      })
      await updateProject(currentProject.id, {
        progress: { ...currentProject.progress, pose: true, gallery: true }
      })
    } catch (err) {
      alert('생성 실패: ' + err.message)
    } finally { setGenBusy(false) }
  }

  async function handleSelectHistory(entry) {
    setSelectedGenId(entry.id)
    if (!actor) return

    // 해당 엔트리의 rigSnapshot으로 배우 복원 (원본/편집본 무관, 각자 독립)
    if (entry.rigSnapshot) {
      const targetActor = currentProject.actors.find(a => a.id === entry.actorId) || actor
      await updateActor(targetActor.id, {
        rigId: 'human',
        rigData: JSON.parse(JSON.stringify(entry.rigSnapshot)),
      })
      setExtractNotes(`✓ "${entry.label}" 스켈레톤 복원`)
      setTimeout(() => setExtractNotes(''), 3000)
    }
    // 원본 선택이고 rigSnapshot 없으면: anchor를 유지 (현재 rig 유지, 자동 추출이 한 번 돌기 때문)
  }

  async function handleApplyAsAnchor(newBlob) {
    await updateProject(currentProject.id, {
      anchorBlob: newBlob,
      anchorSource: 'character-swap',
    })
  }

  return (
    <div className="edit-page">
      <div className="screen-title">
        <h1>🎭 포즈 편집 <span style={{ fontSize: 10, background: 'var(--accent-mint)', color: '#052e1f', padding: '1px 6px', borderRadius: 3, marginLeft: 4 }}>범용</span></h1>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-sm btn-ghost" onClick={handleExport}>📤 스켈레톤 내보내기</button>
          <button className="btn btn-sm btn-primary" onClick={handleGenerateImage}
            disabled={genBusy || !anchorUrl}>
            {genBusy ? '⏳ 생성 중...' : '✨ 이 포즈로 이미지 생성'}
          </button>
          {(() => {
            const selEntry = genHistory.find(h => h.id === selectedGenId)
            if (!selEntry || selEntry.isOriginal) return null
            return (
              <button className="btn btn-sm" onClick={() => {
                const a = document.createElement('a')
                a.href = selEntry.url
                a.download = `graffiti-${selEntry.label}-${Date.now()}.png`
                a.click()
              }} title={`${selEntry.label} PC에 저장`}>
                💾 PC 저장
              </button>
            )
          })()}
          <button className="btn btn-sm" onClick={() => { updateProject(currentProject.id, { progress: { ...currentProject.progress, pose: true } }); navigate('/stage') }}>
            3D 스테이지로 →
          </button>
        </div>
      </div>

      {/* ===== 상단 툴바 — 배우 선택(드롭다운) + 편집 액션 ===== */}
      <div style={{
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        background: 'var(--bg-1)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '6px 10px', marginBottom: 10, fontSize: 11,
      }}>
        <span style={{ color: 'var(--text-3)' }}>선택:</span>
        <select
          value={selectedActorId || ''}
          onChange={e => setSelectedActorId(e.target.value)}
          style={{
            background: 'var(--bg-3)', color: 'var(--text-1)',
            border: '1px solid var(--border)', borderRadius: 5,
            padding: '4px 8px', fontSize: 11, cursor: 'pointer',
          }}>
          {currentProject.actors.length === 0 && <option>(배우 없음)</option>}
          {currentProject.actors.map(a => {
            const gIcon = GENDERS.find(g => g.k === a.gender)?.icon || ''
            return <option key={a.id} value={a.id}>● {a.name} {gIcon}</option>
          })}
        </select>
        <button className="btn btn-sm" onClick={() => addActor({})}>＋ 인물 추가</button>
        {actor && (
          <>
            <button className="btn btn-sm" onClick={handleRenameActor}
              title="배우 이름 변경"
              style={{ borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>
              ✏ 이름변경
            </button>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowGenderPicker(s => s === actor.id ? null : actor.id)}>
                👤 {GENDERS.find(g => g.k === actor.gender)?.l || '미지정'}
              </button>
              {showGenderPicker === actor.id && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: 'var(--bg-1)', border: '1px solid var(--border)',
                  borderRadius: 5, padding: 3, zIndex: 10, minWidth: 90,
                }}>
                  {GENDERS.map(g => (
                    <button key={g.k} onClick={() => handleSetGender(g.k)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: 'transparent', border: 0, color: 'var(--text-2)',
                        padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 3,
                      }}>
                      {g.icon} {g.l}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {currentProject.actors.length > 1 && (
              <button className="btn btn-sm" onClick={handleRemoveActor}
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>− 삭제</button>
            )}
          </>
        )}
        <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }}></span>
        <button className="btn btn-sm" onClick={() => setShowSkeleton(s => !s)}
          style={{ borderColor: showSkeleton ? 'var(--border)' : 'var(--accent-mint)', color: showSkeleton ? 'var(--text-2)' : 'var(--accent-mint)' }}
          title="데이터는 그대로 유지, 화면에서만 숨김">
          {showSkeleton ? '👁 스켈레톤 숨기기' : '👁‍🗨 스켈레톤 보이기'}
        </button>
        {/* hideMode 토글 */}
        <select value={hideMode} onChange={e => setHideMode(e.target.value)}
          title="잘린/가려진 부분 처리"
          style={{ background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 6px', fontSize: 10, cursor: 'pointer' }}>
          <option value="auto">🔍 자동 (낮은 신뢰만 숨김)</option>
          <option value="visible">👁 보이는 부분만</option>
          <option value="all">📐 전신 강제 표시</option>
        </select>
        {Object.keys(manuallyHidden).length > 0 && (
          <button className="btn btn-sm" onClick={() => setManuallyHidden({})}
            title={`수동 숨김 관절 ${Object.keys(manuallyHidden).length}개 모두 풀기`}
            style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>
            🚫 관절 숨김 해제 ({Object.keys(manuallyHidden).length})
          </button>
        )}
        {Object.keys(boneStates).length > 0 && (
          <button className="btn btn-sm" onClick={() => setBoneStates({})}
            title={`점선 ${Object.keys(boneStates).length}개 전부 실선으로`}
            style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>
            🦴 점선 초기화 ({Object.keys(boneStates).length})
          </button>
        )}
        {anchorUrl && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)', fontSize: 10 }} title="원본 이미지 진하기">
            🖼
            <input type="range" min="0" max="1" step="0.05"
              value={anchorOpacity} onChange={e => setAnchorOpacity(Number(e.target.value))}
              style={{ width: 70 }} />
          </label>
        )}
        <button className="btn btn-sm" onClick={() => setShowSwap(true)} disabled={!anchorUrl}
          style={{ borderColor: 'var(--accent-teal)', color: 'var(--accent-teal)' }}>🎭 캐릭터 교체</button>
        <button className="btn btn-sm" onClick={handleSave}
          title="현재 화면의 모든 배우 스켈레톤을 하나의 장면으로 저장">
          💾 장면 저장 ({currentProject.actors.length}명)
        </button>
        <button className="btn btn-sm"
          onClick={handleReExtract}
          disabled={!actor || extractBusy || !currentProject.anchorBlob}
          style={{ borderColor: 'var(--accent-mint)', color: 'var(--accent-mint)' }}
          title="앵커 이미지에서 포즈 재추출 (여러 명 있을 때 대상 번호 지정 가능)">
          {extractBusy ? '⏳ 추출 중...' : '🔄 포즈 재추출'}
        </button>
        <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }} title="이전 저장한 .json 스켈레톤 파일 불러오기">
          📄 JSON 불러오기
          <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportJson} />
        </label>
        <button className="btn btn-sm btn-ghost"
          onClick={() => alert('💡 오른쪽 "📚 내 스켈레톤"에서 저장된 포즈를 클릭해서 불러올 수 있어요')}>
          📂 저장된 스켈레톤 불러오기
        </button>
        <button className="btn btn-sm btn-ghost"
          onClick={() => alert('⚠ Phase 2에서 구현 예정 (다른 배우의 포즈 복사)')}>
          📋 다른 배우 포즈 복사
        </button>
      </div>

      {actor && (
        <div className="edit-grid" style={{ gridTemplateColumns: '1fr 230px' }}>
          <div className="edit-viewport-col">
            <div className="edit-viewport">
              <MultiSkeletonView
                actors={currentProject.actors}
                selectedActorId={selectedActorId}
                onSelectActor={setSelectedActorId}
                onUpdateSelectedRig={handleRigUpdate}
                onSelectJoint={(jointId) => {
                  if (boneAddMode) {
                    handleAddBoneClick(jointId)
                  } else {
                    setSelectedJointId(jointId)
                  }
                }}
                selectedJointId={selectedJointId}
                backgroundSrc={(genHistory.find(h => h.id === selectedGenId)?.url) || anchorUrl}
                backgroundOpacity={anchorOpacity}
                showSkeleton={showSkeleton}
                hideMode={hideMode}
                manuallyHidden={manuallyHidden}
                onToggleHideJoint={toggleHideJoint}
                boneStates={boneStates}
                onToggleBone={toggleBone}
                height="100%"
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🖱 {actor.name}만 편집 · 다른 배우 클릭하면 전환 · 자동 배치 ({currentProject.actors.length}명)</span>
              {(extractBusy || extractNotes) && (
                <span style={{ color: extractBusy ? 'var(--accent-teal)' : (extractNotes.startsWith('⚠') ? 'var(--danger)' : 'var(--accent-mint)'), fontSize: 10 }}>
                  {extractBusy ? '⏳ ' : ''}{extractNotes}
                </span>
              )}
            </div>
            {/* 생성 프롬프트 — 스켈레톤 + 텍스트 같이 전송 */}
            <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', paddingTop: 4 }}>
                💬 연기/감정:
              </span>
              <textarea
                value={extraPrompt}
                onChange={e => setExtraPrompt(e.target.value)}
                placeholder="예: 결연한 표정, 차가운 시선 / 슬프게 우는 / 다이나믹 액션 / 빛이 강하게 비치는"
                rows={2}
                style={{
                  flex: 1, fontSize: 11, padding: '4px 6px',
                  background: 'var(--bg-1)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', borderRadius: 4, fontFamily: 'inherit',
                  resize: 'vertical', minHeight: 28,
                }}
              />
              {extraPrompt && (
                <button onClick={() => setExtraPrompt('')}
                  title="비우기"
                  style={{ background: 'transparent', border: 0, color: 'var(--text-3)',
                    fontSize: 12, cursor: 'pointer', padding: 4 }}>✕</button>
              )}
            </div>

            {/* 이미지 히스토리 썸네일 — 원본 + 편집1 + 편집2 ... */}
            {genHistory.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {genHistory.map(entry => {
                  const isSel = selectedGenId === entry.id
                  return (
                    <div key={entry.id}
                      onClick={() => handleSelectHistory(entry)}
                      style={{
                        flex: '0 0 auto', width: 70, cursor: 'pointer',
                        border: isSel ? '2px solid var(--accent-mint)' : '1px solid var(--border)',
                        borderRadius: 4, overflow: 'hidden', background: 'var(--bg-0)',
                        position: 'relative',
                      }}
                      title={`${entry.label} · 클릭으로 복원${entry.isOriginal ? '' : ' (스켈레톤도 함께)'}`}>
                      <img src={entry.url} alt={entry.label}
                        style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: entry.isOriginal ? 'rgba(52,211,153,0.85)' : 'rgba(139,92,246,0.85)',
                        color: entry.isOriginal ? '#052e1f' : 'white',
                        fontSize: 9, padding: '2px 4px', textAlign: 'center', fontWeight: 700,
                      }}>{entry.label}</div>
                      {!entry.isOriginal && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (!confirm(`${entry.label} 삭제?`)) return
                            setGenHistory(prev => prev.filter(h => h.id !== entry.id))
                            if (selectedGenId === entry.id) setSelectedGenId(null)
                          }}
                          title="삭제"
                          style={{
                            position: 'absolute', top: 2, right: 2,
                            background: 'rgba(0,0,0,0.7)', color: 'var(--danger)',
                            border: 0, width: 16, height: 16, borderRadius: 3,
                            fontSize: 10, cursor: 'pointer', lineHeight: 1,
                          }}>✕</button>
                      )}
                      {/* 🎬 3D 스테이지로 보내기 */}
                      <button
                        onClick={async e => {
                          e.stopPropagation()
                          if (!entry.blob) {
                            // 원본은 anchorBlob에서 가져오기
                            if (entry.isOriginal && currentProject.anchorBlob) {
                              await updateProject(currentProject.id, {
                                stageSourceImage: currentProject.anchorBlob,
                                stageSourceMeta: { label: '원본', sourceId: entry.id },
                              })
                            } else {
                              alert('이미지 데이터가 없어요')
                              return
                            }
                          } else {
                            await updateProject(currentProject.id, {
                              stageSourceImage: entry.blob,
                              stageSourceMeta: { label: entry.label, sourceId: entry.id },
                            })
                          }
                          navigate('/stage')
                        }}
                        title={`${entry.label}을 3D 스테이지로 보내기`}
                        style={{
                          position: 'absolute', top: 2, left: 2,
                          background: 'rgba(245,158,11,0.9)', color: '#2d1b00',
                          border: 0, width: 20, height: 16, borderRadius: 3,
                          fontSize: 9, cursor: 'pointer', lineHeight: 1, fontWeight: 700,
                        }}>🎬</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="edit-side">
            <SectionHead>🐉 리그 템플릿</SectionHead>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
              {RIG_LIST.map(r => (
                <button key={r.id} onClick={() => handleChangeRig(r.id)}
                  style={btnStyle(actor.rigId === r.id)}>{r.icon} {r.label}</button>
              ))}
            </div>
            <SectionHead>🦴 포즈 프리셋</SectionHead>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
              {Object.entries(POSES).map(([k, p]) => (
                <button key={k} onClick={() => handlePose(k)} style={btnStyle(false)}>{p.label}</button>
              ))}
            </div>
            <SectionHead>편집 도구</SectionHead>
            <button className="btn btn-sm" style={{ width: '100%', marginBottom: 3 }} onClick={handleFlip}>↔ 좌우 반전</button>
            <button className="btn btn-sm" style={{ width: '100%', marginBottom: 3 }} onClick={handleAddJoint}>＋ 관절 추가</button>
            <button className="btn btn-sm" style={{ width: '100%', marginBottom: 3, opacity: selectedJointId ? 1 : 0.4 }}
              onClick={handleRemoveJoint} disabled={!selectedJointId}>− 관절 삭제</button>
            {/* 선 추가 모드 토글 */}
            <button className="btn btn-sm"
              onClick={() => {
                setBoneAddMode(m => !m)
                setBoneAddFirstJoint(null)
                if (!boneAddMode) setExtractNotes('선 추가: 첫 번째 관절 클릭')
                else { setExtractNotes(''); }
              }}
              style={{
                width: '100%', marginBottom: 3,
                borderColor: boneAddMode ? 'var(--accent-mint)' : 'var(--border)',
                color: boneAddMode ? 'var(--accent-mint)' : 'var(--text-2)',
                fontWeight: boneAddMode ? 700 : 400,
              }}
              title="두 관절을 차례로 클릭해서 새 선 추가">
              {boneAddMode ? '🔗 선 추가 중... (ESC/재클릭으로 취소)' : '🔗 선 추가'}
            </button>
            <div style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1.4, padding: '2px 4px' }}>
              💡 <b>선 우클릭</b> → 점선(가려짐) ↻ 숨김 ↻ 보임<br/>
              💡 <b>관절 우클릭</b> → 관절+연결된 선 완전 숨김
            </div>

            {/* 선 목록 (편집·삭제) */}
            <SectionHead>🦴 선 편집 ({actor.rigData.bones.length})</SectionHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto',
                          background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}>
              {actor.rigData.bones.map(([fromId, toId, color]) => {
                const boneKey = `${fromId}-${toId}`
                const state = boneStates[boneKey] || 'visible'
                const short = id => id.replace('_', '').slice(0, 4)
                return (
                  <div key={boneKey} style={{
                    display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px',
                    background: 'var(--bg-2)', borderRadius: 2, fontSize: 9,
                  }}>
                    <span style={{ width: 8, height: 8, background: color, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      {short(fromId)}→{short(toId)}
                    </span>
                    <button onClick={() => toggleBone(boneKey)}
                      title={state === 'dashed' ? '점선 (가려짐) — 클릭하면 실선' : '실선 (보임) — 클릭하면 점선'}
                      style={{
                        background: 'transparent', border: 0, cursor: 'pointer', padding: '0 3px',
                        color: state === 'dashed' ? 'var(--warn)' : 'var(--accent-mint)',
                        fontSize: 11,
                      }}>
                      {state === 'dashed' ? '┅' : '━'}
                    </button>
                    <button onClick={() => handleDeleteBone(boneKey)}
                      title="이 선 완전 삭제"
                      style={{ background: 'transparent', border: 0, color: 'var(--danger)',
                               cursor: 'pointer', padding: '0 3px', fontSize: 10 }}>
                      🗑
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Eye Gaze — 9방향 그리드 */}
            <SectionHead>👁 시선 (Eye Gaze)</SectionHead>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
              {[
                ['↖', 'up-left'], ['↑', 'up'], ['↗', 'up-right'],
                ['←', 'left'], ['●', 'forward'], ['→', 'right'],
                ['↙', 'down-left'], ['↓', 'down'], ['↘', 'down-right'],
              ].map(([icon, val]) => (
                <button key={val} onClick={() => setEyeGaze(val)}
                  title={val}
                  style={{
                    background: eyeGaze === val ? 'var(--accent-purple)' : 'var(--bg-2)',
                    color: eyeGaze === val ? 'white' : 'var(--text-2)',
                    border: '1px solid ' + (eyeGaze === val ? 'transparent' : 'var(--border)'),
                    padding: 4, borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  }}>{icon}</button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>
              머리 회전과 별개로 눈동자만 어디 봄. 프롬프트에 자동 합성.
            </div>
            {/* ── 통합 스켈레톤 라이브러리 (클라우드 + 로컬, 텍스트 리스트) ── */}
            <SectionHead>
              <span style={{ color: 'var(--accent-teal)' }}>
                🧍 라이브러리 ({cloudPoses.length}){cloudLoading && ' ⏳'}
              </span>
              {user && (
                <button onClick={handleSyncCloud}
                  style={{ background: 'var(--bg-3)', color: 'var(--accent-teal)', border: '1px solid var(--accent-teal)', padding: '1px 5px', borderRadius: 3, fontSize: 9, cursor: 'pointer' }}
                  title="클라우드와 양방향 동기화 (노트북 변경분도 받아옴)">
                  ☁ 동기화
                </button>
              )}
            </SectionHead>

            {!user && (
              <div style={{ color: 'var(--warn)', fontSize: 9, padding: 4, marginBottom: 4 }}>
                🔑 상단 "Google 로그인"하면 노트북과 공유됩니다 (지금은 이 PC 로컬만)
              </div>
            )}

            {cloudError && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)',
                borderRadius: 4, padding: 6, fontSize: 9, color: 'var(--danger)', marginBottom: 4,
              }}>⚠ {cloudError}</div>
            )}

            {cloudPoses.length === 0 && !cloudLoading && (
              <div style={{ fontSize: 9, color: 'var(--text-3)', padding: 6 }}>
                저장된 포즈 없음. 위 "💾 장면 저장"으로 추가하세요.
              </div>
            )}

            {cloudPoses.length > 0 && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4,
                maxHeight: 320, overflowY: 'auto',
                background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 4, padding: 2,
              }}>
                {cloudPoses.map(doc => {
                  const name = doc.label || doc.name || doc.title || `#${(doc.id||'').slice(-8)}`
                  const isCloud = doc._src === 'cloud' || doc.id?.startsWith('pose_2d_') || doc.id?.startsWith('skel2d_')
                  return (
                    <div key={doc.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 2,
                        padding: '3px 4px', borderRadius: 3,
                        background: 'var(--bg-2)',
                      }}>
                      <button
                        onClick={() => handleLoadCloudPose(doc)}
                        title={`적용: ${name}`}
                        style={{
                          flex: 1, textAlign: 'left',
                          background: 'transparent', border: 0,
                          color: 'var(--text-1)', fontSize: 11,
                          padding: '3px 4px', cursor: 'pointer',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                        <span style={{ color: isCloud ? 'var(--accent-teal)' : 'var(--text-3)', marginRight: 4 }}>
                          {isCloud ? '☁' : '💾'}
                        </span>
                        {name}
                      </button>
                      <button
                        onClick={() => handleRenameCloud(doc)}
                        title="이름 변경"
                        style={{
                          background: 'transparent', border: 0, color: 'var(--text-3)',
                          width: 18, height: 18, fontSize: 11, cursor: 'pointer', padding: 0,
                        }}>✏</button>
                      <button
                        onClick={() => handleDeleteCloud(doc)}
                        title="삭제"
                        style={{
                          background: 'transparent', border: 0, color: 'var(--danger)',
                          width: 18, height: 18, fontSize: 11, cursor: 'pointer', padding: 0,
                        }}>✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showSwap && (
        <CharacterSwapModal
          sourceImage={anchorUrl}
          sourceBlob={currentProject.anchorBlob}
          actors={currentProject.actors}
          onClose={() => setShowSwap(false)}
          onDone={async (result, meta) => {
            await addCut({
              imageBlob: result.blob, kind: 'character-swap',
              tags: ['교체', ...(meta?.targetActors || []), meta?.strength || 'medium'],
              meta: { ...result.meta, ...meta },
            })
            setShowSwap(false)
            alert('✓ 갤러리에 저장됐어요')
          }}
          onApplyAsAnchor={async (newBlob) => {
            await handleApplyAsAnchor(newBlob)
            alert('✓ 앵커로 교체됐어요')
          }}
        />
      )}

      {lightboxSrc && (
        <Lightbox
          src={lightboxSrc}
          caption="포즈 기반 생성 결과"
          onClose={() => setLightboxSrc(null)}
          actions={[
            { label: 'PC 저장', icon: '💾', onClick: () => {
              const a = document.createElement('a')
              a.href = lightboxSrc; a.download = `graffiti-pose-${Date.now()}.png`; a.click()
            }},
            { label: '앵커로 적용', icon: '🎯', variant: 'primary', onClick: async () => {
              if (genResult && confirm('이 이미지를 앵커로 교체?')) {
                await handleApplyAsAnchor(genResult.blob)
                setLightboxSrc(null)
                alert('✓ 앵커 교체됨')
              }
            }},
          ]}
        />
      )}
    </div>
  )
}

function SectionHead({ children }) {
  return <div style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: 0.8, textTransform: 'uppercase', margin: '10px 0 4px', fontWeight: 600 }}>{children}</div>
}
function btnStyle(active) {
  return {
    background: active ? 'var(--accent-purple)' : 'var(--bg-2)',
    color: active ? 'white' : 'var(--text-2)',
    border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
    padding: 4, borderRadius: 4, fontSize: 9, cursor: 'pointer',
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
