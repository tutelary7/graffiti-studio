import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject } from '../context/ProjectContext.jsx'
import { generateEightViewSheet } from '../lib/ai/index.js'
import Lightbox from '../components/Lightbox.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { buildHandoffPayload, openInStageEditor, openInQwenViewer } from '../lib/handoff/index.js'

const SLOTS = [
  { key: 'front', label: '1. 정면' }, { key: 'front-right', label: '2. 우3/4' },
  { key: 'right', label: '3. 우측면' }, { key: 'back-right', label: '4. 뒤우3/4' },
  { key: 'back', label: '5. 뒷면' }, { key: 'back-left', label: '6. 뒤좌3/4' },
  { key: 'left', label: '7. 좌측면' }, { key: 'front-left', label: '8. 좌3/4' },
]

export default function SheetPage() {
  const navigate = useNavigate()
  const { currentProject, updateProject, addCut } = useProject()
  const { user } = useAuth()
  const [handoffBusy, setHandoffBusy] = useState(false)

  async function handleOpenStageEditor() {
    if (!user) { alert('Stage Editor를 사용하려면 먼저 로그인해주세요.'); return }
    setHandoffBusy(true)
    try {
      const payload = await buildHandoffPayload({ currentProject, uid: user.uid })
      openInStageEditor(payload)
    } finally {
      setHandoffBusy(false)
    }
  }

  async function handleOpenQwenViewer() {
    if (!user) { alert('Qwen Viewer를 사용하려면 먼저 로그인해주세요.'); return }
    setHandoffBusy(true)
    try {
      const payload = await buildHandoffPayload({ currentProject, uid: user.uid })
      const focusCharId = payload.scene?.characters_appearing?.[0] || null
      openInQwenViewer(payload, focusCharId)
    } finally {
      setHandoffBusy(false)
    }
  }
  const [mode, setMode] = useState('auto')
  const [sheet, setSheet] = useState({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [characterDNA, setCharacterDNA] = useState('')
  const [style, setStyle] = useState('Korean webtoon style, soft cel shading')
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const fileRefs = useRef({})

  useEffect(() => {
    if (currentProject?.name && !characterDNA) {
      setCharacterDNA(`character: ${currentProject.name}`)
    }
  }, [currentProject])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>📐 8면 시트</h1></div>
        <div className="placeholder"><div className="ico">⚠</div><h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  async function handleAuto() {
    if (!currentProject.anchorBlob) { alert('앵커 이미지 필요'); navigate('/anchor'); return }
    if (!confirm('자동 생성: API 8회 호출 ≈ ₩480 예상. 진행?')) return
    setBusy(true); setSheet({})
    try {
      const results = await generateEightViewSheet({
        anchorImage: currentProject.anchorBlob,
        character_dna: characterDNA,
        style,
        onProgress: setProgress,
      })
      const newSheet = {}
      for (const r of results) {
        newSheet[r.key] = { url: r.url, blob: r.blob }
        await addCut({ imageBlob: r.blob, kind: 'sheet', tags: ['시트', r.label], meta: { sheetAngle: r.key } })
      }
      setSheet(newSheet)
      await updateProject(currentProject.id, { progress: { ...currentProject.progress, sheet: true, gallery: true } })
    } catch (err) { alert('실패: ' + err.message) }
    finally { setBusy(false); setProgress(null) }
  }

  function handleManual(key, file) {
    if (!file) return
    setSheet(prev => ({ ...prev, [key]: { url: URL.createObjectURL(file), blob: file } }))
  }

  async function handleSaveManual() {
    let count = 0
    for (const slot of SLOTS) {
      const s = sheet[slot.key]
      if (s?.blob) {
        await addCut({ imageBlob: s.blob, kind: 'sheet', tags: ['시트', '수동', slot.label], meta: { sheetAngle: slot.key, manual: true } })
        count++
      }
    }
    if (count > 0) {
      await updateProject(currentProject.id, { progress: { ...currentProject.progress, sheet: true, gallery: true } })
      alert(`${count}장 저장됨`)
    } else alert('등록된 이미지가 없어요')
  }

  const phase2 = () => alert('⚠ Phase 2에서 구현 예정')

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}>
      <div className="screen-title">
        <h1>📐 8면 시트</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={handleOpenStageEditor}
            disabled={handoffBusy}
            title="현재 8면 시트 + 소설 캐릭터 + 에셋을 외부 Stage Editor로 보내기"
          >🎬 Stage Editor</button>
          <button
            className="btn btn-ghost"
            onClick={handleOpenQwenViewer}
            disabled={handoffBusy}
            title="현재 8면 시트 캐릭터를 외부 Qwen Viewer로 보내기"
          >📐 Qwen Viewer</button>
          <button className="btn btn-ghost" onClick={phase2} title="Phase 2에서 구현 예정">📥 가져오기 (JSON)</button>
          <button className="btn btn-primary" onClick={mode === 'manual' ? handleSaveManual : phase2}>💾 시트 저장</button>
        </div>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 12 }}>
        {currentProject.name} · 캐릭터 디자인 시트 · 웹툰/영상 일관성 가이드 + Phase 3 3D 메시 재료
      </p>

      {/* 모드 토글 */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', padding: 4, borderRadius: 8, width: 'fit-content', marginBottom: 16 }}>
        <button onClick={() => setMode('auto')} style={tabBtn(mode === 'auto')}>⚡ 자동 (유료)</button>
        <button onClick={() => setMode('manual')} style={tabBtn(mode === 'manual')}>📥 수동 (무료)</button>
      </div>

      {mode === 'auto' && (
        <>
          {/* 비용 배너 + 생성 버튼 */}
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warn)', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <b style={{ color: 'var(--warn)' }}>⚠ 자동 생성은 API 요금 발생</b><br />
              <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
                Gemini 8회 호출 ≈ <b style={{ color: 'var(--warn)' }}>₩480</b> · API 키 없으면 mock (무료)
              </span>
            </div>
            <button className="btn btn-primary" onClick={handleAuto} disabled={busy}>
              {busy ? '⏳ 생성 중...' : '✨ 8면 자동 생성 시작'}
            </button>
          </div>

          {/* 캐릭터 DNA + 스타일 Lock (자리 선점) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-2)' }}>캐릭터 DNA (프롬프트)</label>
              <input value={characterDNA} onChange={e => setCharacterDNA(e.target.value)}
                style={inputStyle} placeholder="외형 설명 (영문 권장)" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-2)' }}>스타일 Lock</label>
              <input value={style} onChange={e => setStyle(e.target.value)}
                style={inputStyle} placeholder="예: Korean webtoon style" />
            </div>
          </div>

          {/* 검수 배지 (자리 선점) */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={badgeStyle('var(--accent-mint)')}>✓ Y축 정렬 체크 (자동)</span>
            <span style={badgeStyle('var(--accent-mint)')}>✓ 색상 히스토그램 검수 (자동)</span>
            <span style={badgeStyle('var(--text-3)')}>Sequential Reference 방식</span>
          </div>

          {progress && (
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--accent-purple)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>⏳ {progress.angle} {progress.step}/{progress.total}</div>
              <div style={{ height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(progress.step / progress.total) * 100}%`, height: '100%', background: 'var(--accent-purple)' }} />
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'manual' && (
        <div className="note mint" style={{ marginBottom: 12 }}>
          <b>💰 수동 등록 — 무료</b> · Midjourney/Nano Banana로 뽑아둔 이미지를 슬롯에 드래그앤드롭
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {SLOTS.map(slot => {
          const s = sheet[slot.key]
          return (
            <div key={slot.key}
              onClick={() => {
                if (s) setLightboxSrc(s.url)
                else if (mode === 'manual') fileRefs.current[slot.key]?.click()
              }}
              style={{
                aspectRatio: '1/1',
                background: s ? '#0a0b10' : 'linear-gradient(160deg, var(--bg-2), var(--bg-3))',
                border: s ? '1px solid var(--border)' : '2px dashed var(--border)',
                borderRadius: 8, position: 'relative', display: 'flex',
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                cursor: (s || mode === 'manual') ? 'pointer' : 'default',
              }}>
              <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, color: 'var(--text-2)', background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: 3, zIndex: 1 }}>{slot.label}</span>
              {s ? (
                <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{mode === 'manual' ? '＋ 업로드' : '대기'}</div>
              )}
              {mode === 'manual' && (
                <input ref={el => fileRefs.current[slot.key] = el} type="file" accept="image/*"
                  style={{ display: 'none' }} onChange={e => handleManual(slot.key, e.target.files?.[0])} />
              )}
            </div>
          )
        })}
      </div>

      {handoffBusy && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>📡 핸드오프 데이터 수집 중...</div>}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" onClick={() => navigate('/stage')}>← 스테이지로</button>
        <button className="btn btn-primary" onClick={() => navigate('/gallery')}>갤러리에서 확인 →</button>
      </div>

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)}
          actions={[
            { label: 'PC 저장', icon: '💾', onClick: () => {
              const a = document.createElement('a')
              a.href = lightboxSrc; a.download = `sheet-${Date.now()}.png`; a.click()
            }},
          ]} />
      )}
    </div>
  )
}

function tabBtn(active) {
  return {
    background: active ? 'var(--accent-purple)' : 'transparent',
    color: active ? 'white' : 'var(--text-2)',
    border: 0, padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  }
}
function badgeStyle(color) {
  return {
    background: 'var(--bg-2)', border: '1px solid ' + color, color,
    padding: '4px 10px', borderRadius: 6, fontSize: 11,
  }
}
const inputStyle = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)',
  color: 'var(--text-1)', borderRadius: 6, padding: 8, fontSize: 12,
  fontFamily: 'inherit', marginTop: 4, boxSizing: 'border-box',
}
