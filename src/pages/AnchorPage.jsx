import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject } from '../context/ProjectContext.jsx'
import { useMode } from '../context/ModeContext.jsx'
import { generateImage } from '../lib/ai/index.js'

export default function AnchorPage() {
  const navigate = useNavigate()
  const { currentProject, updateProject, addActor } = useProject()
  const { isIntegrated } = useMode()
  const [mode, setMode] = useState('upload')
  const [preview, setPreview] = useState(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  // 기존 앵커가 있으면 자동 미리보기
  useEffect(() => {
    if (currentProject?.anchorBlob && !preview) {
      const url = URL.createObjectURL(currentProject.anchorBlob)
      setPreview({ blob: currentProject.anchorBlob, url, source: currentProject.anchorSource })
      return () => URL.revokeObjectURL(url)
    }
  }, [currentProject?.anchorBlob])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>📥 앵커 설정</h1></div>
        <div className="placeholder">
          <div className="ico">⚠</div>
          <h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  function handleFile(e) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('이미지 파일만 가능해요'); return }
    setPreview({ blob: file, url: URL.createObjectURL(file), source: 'upload' })
  }

  async function handleGenerate() {
    if (!aiPrompt.trim()) { setError('프롬프트를 입력해주세요'); return }
    setError(null); setBusy(true)
    try {
      const result = await generateImage({
        prompt: aiPrompt + ', full body, front view, clean background, character design sheet style',
        model: 'auto', aspectRatio: '3:4',
      })
      setPreview({ blob: result.blob, url: result.url, source: 'ai', meta: result.meta })
    } catch (err) {
      setError('생성 실패: ' + err.message)
    } finally { setBusy(false) }
  }

  async function handleConfirm() {
    if (!preview) return
    setBusy(true)
    try {
      await updateProject(currentProject.id, {
        anchorBlob: preview.blob,
        anchorSource: preview.source,
        progress: { ...currentProject.progress, anchor: true },
      })
      if (currentProject.actors.length === 0) {
        await addActor({ name: '배우 1' })
      }
      navigate('/pose')
    } catch (err) {
      setError('저장 실패: ' + err.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="screen-title">
        <h1>📥 앵커 설정</h1>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {currentProject.name} · 한 프로젝트당 1회
        </span>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
        앞으로의 모든 작업(포즈/스테이지/시트)의 <b>기준점</b>이 됩니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <ModeCard active={mode === 'upload'} onClick={() => setMode('upload')}
          icon="📁" title="내 이미지 업로드" desc="직접 그린 컨셉 아트" />
        <ModeCard active={mode === 'ai'} onClick={() => setMode('ai')}
          icon="🤖" title="AI로 그리기" desc="프롬프트 → Gemini/Flux" />
        <ModeCard active={mode === 'webtoon'} onClick={() => setMode('webtoon')}
          icon="🎨" title="웹툰에서 가져오기"
          desc={isIntegrated ? 'novel-workstation' : '연동 모드 필요'}
          disabled={!isIntegrated} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          {mode === 'upload' && (
            <div onClick={() => fileRef.current?.click()} style={{
              background: 'var(--bg-1)', border: '2px dashed var(--border)',
              borderRadius: 10, padding: 40, textAlign: 'center', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
              <div style={{ fontSize: 14 }}>이미지 파일 선택</div>
              {preview?.source === 'upload' && (
                <div style={{ fontSize: 11, color: 'var(--accent-mint)', marginTop: 6 }}>
                  ✓ 현재: {preview.blob.name || 'uploaded'}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
            </div>
          )}

          {mode === 'ai' && (
            <div>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="예: a young woman with curly brown hair, blue cardigan"
                rows={6}
                style={{
                  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', borderRadius: 8, padding: 12, fontSize: 13,
                  fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <button className="btn btn-primary" onClick={handleGenerate}
                disabled={busy} style={{ width: '100%', marginTop: 12 }}>
                {busy ? '생성 중...' : '✨ 생성'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                API 키 없으면 mock 이미지로 대체
              </p>
            </div>
          )}

          {mode === 'webtoon' && (
            <div className="placeholder" style={{ padding: 30 }}>
              <div className="ico">🎨</div>
              <h2>웹툰 연동 (Phase 2)</h2>
              <p style={{ margin: 0, fontSize: 12 }}>novel-workstation API 연동 예정</p>
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <label style={{ fontSize: 13, color: 'var(--text-2)' }}>미리보기</label>
          <div style={{
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 10, height: 400, marginTop: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', position: 'relative',
          }}>
            {preview ? (
              <img src={preview.url} alt="미리보기"
                style={{
                  maxWidth: '100%', maxHeight: '100%',
                  width: 'auto', height: 'auto', objectFit: 'contain',
                  display: 'block',
                }} />
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>이미지가 여기에 표시됩니다</div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="note warn" style={{ marginTop: 16 }}>⚠ {error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← 홈으로</button>
        <button className="btn btn-primary" disabled={!preview || busy} onClick={handleConfirm}>
          {busy ? '저장 중...' : '앵커 확정 → 포즈 편집 →'}
        </button>
      </div>
    </div>
  )
}

function ModeCard({ active, onClick, disabled, icon, title, desc }) {
  return (
    <div onClick={disabled ? undefined : onClick} style={{
      background: active ? 'rgba(139, 92, 246, 0.08)' : 'var(--bg-1)',
      border: '2px solid ' + (active ? 'var(--accent-purple)' : 'var(--border)'),
      borderRadius: 10, padding: 20, textAlign: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
    }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>{title}</h4>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-2)' }}>{desc}</p>
    </div>
  )
}
