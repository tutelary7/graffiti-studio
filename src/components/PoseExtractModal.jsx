import { useState, useRef, useEffect } from 'react'
import { extractPoseFromImage } from '../lib/ai/extractPose.js'
import { put, STORES } from '../lib/storage.js'
import { rigToSVG } from '../lib/skeleton/rigs.js'

/**
 * 이미지 → 스켈레톤 자동 추출 모달
 *
 * props:
 *   anchorBlob?: 프로젝트 앵커 이미지 (있으면 기본 소스로 사용)
 *   targetActorName: 적용 대상 배우 이름 (UI 라벨용)
 *   onApply(rigData): 사용자가 "적용" 눌렀을 때
 *   onClose()
 */
export default function PoseExtractModal({ anchorBlob, targetActorName = '배우', onApply, onClose, onSavedToLibrary }) {
  const [sourceBlob, setSourceBlob] = useState(anchorBlob || null)
  const [sourceUrl, setSourceUrl] = useState(() => anchorBlob ? URL.createObjectURL(anchorBlob) : null)
  const [targetIdx, setTargetIdx] = useState(1)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // {rigData, confidence, notes}
  const [error, setError] = useState(null)
  const [saveToLib, setSaveToLib] = useState(true)
  const [libName, setLibName] = useState('')
  const fileRef = useRef(null)
  const autoExtractRef = useRef(false)

  // 이미지가 바뀌면 자동으로 추출 (모달 처음 열릴 때도 앵커가 있으면 자동 실행)
  useEffect(() => {
    if (!sourceBlob) return
    autoExtractRef.current = true
    handleExtract()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceBlob, targetIdx])

  function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // JSON 직접 import (AI 추출 스킵)
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result)
          // {rigId, rigData} 또는 {actors:[{rigData}]} 또는 {joints, bones} 지원
          let rigData = parsed.rigData
          if (!rigData && parsed.actors?.[0]?.rigData) rigData = parsed.actors[0].rigData
          if (!rigData && parsed.joints && parsed.bones) rigData = parsed
          if (!rigData) throw new Error('rigData 구조 없음 (joints/bones 필요)')
          setResult({ rigData, confidence: 1.0, notes: 'JSON import', isJson: true })
          setLibName(parsed.name || file.name.replace(/\.json$/, ''))
          setError(null)
        } catch (err) {
          setError('JSON 파싱 실패: ' + err.message)
        }
      }
      reader.readAsText(file)
      return
    }
    // 이미지 → AI 추출
    if (sourceUrl && !anchorBlob) URL.revokeObjectURL(sourceUrl)
    setSourceBlob(file)
    setSourceUrl(URL.createObjectURL(file))
    setResult(null); setError(null)
    setLibName(file.name.replace(/\.[^.]+$/, ''))
  }

  async function handleExtract() {
    if (!sourceBlob) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await extractPoseFromImage(sourceBlob, { targetActorIdx: targetIdx })
      setResult(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleApply() {
    if (!result?.rigData) return
    // 라이브러리에도 저장 (선택 시)
    if (saveToLib) {
      const name = libName.trim() || `추출-${new Date().toLocaleString('ko-KR')}`
      try {
        await put(STORES.skeletons, {
          name,
          actors: [{ name: targetActorName, gender: 'unspecified', rigId: 'human', rigData: result.rigData }],
          rigId: 'human',
          rigData: result.rigData,
          svgPreview: rigToSVG(result.rigData, { size: 200 }),
          source: result.isJson ? 'json-import' : 'image-extract',
          createdAt: new Date().toISOString(),
        })
        onSavedToLibrary?.()
      } catch (e) {
        console.error('라이브러리 저장 실패:', e)
      }
    }
    onApply?.(result.rigData)
    onClose?.()
  }

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-1)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 16, width: 720, maxWidth: '90vw',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>📤 이미지 → 스켈레톤 자동 추출</h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
          📷 <b style={{ color: 'var(--text-2)' }}>이미지 업로드</b> → Gemini AI가 15개 관절 좌표 자동 추출 (₩20 / 회) ·
          📄 <b style={{ color: 'var(--text-2)' }}>JSON 업로드</b> → 이전 저장한 스켈레톤(.json) 직접 불러오기 (무료) ·
          둘 다 "{targetActorName}"에 적용되고 원하면 라이브러리에도 저장
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* 좌: 원본 이미지 */}
          <div>
            <div style={sectionLabel}>원본 이미지</div>
            <div style={{
              aspectRatio: '3/4', background: '#0a0b10', border: '1px solid var(--border)',
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', position: 'relative',
            }}>
              {sourceUrl ? (
                <img src={sourceUrl} alt="원본"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
                  ＋ 이미지 업로드하거나<br/>기존 앵커 사용
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                📁 이미지/JSON 선택
              </button>
              {anchorBlob && (
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  setSourceBlob(anchorBlob)
                  setSourceUrl(URL.createObjectURL(anchorBlob))
                  setResult(null)
                }}>🎯 앵커 사용</button>
              )}
              <input ref={fileRef} type="file" accept="image/*,.json,application/json"
                style={{ display: 'none' }}
                onChange={handleUpload} />
            </div>
          </div>

          {/* 우: 추출 결과 */}
          <div>
            <div style={sectionLabel}>추출된 스켈레톤</div>
            <div style={{
              aspectRatio: '3/4', background: '#0a0b10', border: '1px solid var(--border)',
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', position: 'relative',
            }}>
              {result?.rigData ? (
                <SkeletonPreview rig={result.rigData} bgUrl={sourceUrl} />
              ) : busy ? (
                <div style={{ color: 'var(--accent-teal)', fontSize: 12 }}>⏳ AI 분석 중...</div>
              ) : (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>대기</div>
              )}
            </div>
            {result && (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-2)' }}>
                ✓ 신뢰도: <b style={{ color: result.confidence > 0.7 ? 'var(--accent-mint)' : 'var(--warn)' }}>
                  {Math.round(result.confidence * 100)}%
                </b>
                {result.mock && <span style={{ color: 'var(--warn)' }}> · mock (API 키 없음)</span>}
                {result.notes && <div style={{ marginTop: 3, color: 'var(--text-3)' }}>💬 {result.notes}</div>}
              </div>
            )}
          </div>
        </div>

        {/* 대상 인물 선택 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ color: 'var(--text-3)' }}>이미지에 여러 명 있으면 몇 번째?</span>
          {[1, 2, 3, 4].map(i => (
            <button key={i} onClick={() => setTargetIdx(i)}
              style={{
                background: targetIdx === i ? 'var(--accent-purple)' : 'var(--bg-2)',
                color: targetIdx === i ? 'white' : 'var(--text-2)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '4px 10px', fontSize: 11, cursor: 'pointer',
              }}>
              {i}번째
            </button>
          ))}
          <span style={{ color: 'var(--text-3)', marginLeft: 'auto', fontSize: 10 }}>
            왼쪽부터 · 가장 크고 중앙에 있는 사람
          </span>
        </div>

        {error && (
          <div style={{
            marginTop: 10, background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
            border: '1px solid var(--danger)', borderRadius: 5, padding: 8, fontSize: 11,
          }}>⚠ {error}</div>
        )}

        {/* 라이브러리 저장 옵션 */}
        {result && (
          <div style={{
            marginTop: 10, background: 'var(--bg-2)', border: '1px solid var(--border)',
            borderRadius: 5, padding: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-2)' }}>
              <input type="checkbox" checked={saveToLib} onChange={e => setSaveToLib(e.target.checked)} />
              💾 내 스켈레톤 라이브러리에 저장
            </label>
            {saveToLib && (
              <input value={libName} onChange={e => setLibName(e.target.value)}
                placeholder="라이브러리 이름"
                style={{
                  flex: 1, background: 'var(--bg-1)', border: '1px solid var(--border)',
                  color: 'var(--text-1)', borderRadius: 4, padding: '3px 8px', fontSize: 11,
                }} />
            )}
            <span style={{ color: 'var(--text-3)', fontSize: 10, whiteSpace: 'nowrap' }}>
              저장 위치: 브라우저 IndexedDB
            </span>
          </div>
        )}

        {/* 하단 버튼 */}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>취소</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={handleExtract}
              disabled={!sourceBlob || busy}>
              {busy ? '⏳ 분석 중...' : (result ? '🔄 다시 추출' : '✨ 추출 시작')}
            </button>
            <button className="btn btn-sm" onClick={handleApply}
              disabled={!result?.rigData}
              style={{
                background: result ? 'var(--accent-mint)' : undefined,
                color: result ? '#052e1f' : undefined,
                fontWeight: 700,
              }}>
              → {targetActorName}에 적용
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SkeletonPreview({ rig, bgUrl }) {
  const jointMap = Object.fromEntries(rig.joints.map(j => [j.id, j]))
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}
      preserveAspectRatio="xMidYMid meet">
      {bgUrl && (
        <image href={bgUrl} x="0" y="0" width="100" height="100"
          preserveAspectRatio="xMidYMid meet" opacity="0.4" />
      )}
      {rig.bones.map(([fromId, toId, color], i) => {
        const a = jointMap[fromId]; const b = jointMap[toId]
        if (!a || !b) return null
        const w = (a.type === 'spine' || b.type === 'spine') ? 1.6 : 1.0
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color || '#8b5cf6'} strokeWidth={w} strokeLinecap="round" />
      })}
      {rig.joints.map(j => (
        <circle key={j.id} cx={j.x} cy={j.y} r={j.type === 'head' ? 2.5 : 1.5}
          fill={j.type === 'head' ? '#ec4899' : '#ef4444'}
          stroke="white" strokeWidth="0.25" />
      ))}
    </svg>
  )
}

const closeBtn = {
  background: 'transparent', border: 0, color: 'var(--text-2)',
  width: 26, height: 26, fontSize: 14, cursor: 'pointer', borderRadius: 4,
}
const sectionLabel = {
  fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase',
  letterSpacing: 0.8, fontWeight: 600, marginBottom: 4,
}
