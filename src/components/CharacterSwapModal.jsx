import { useState, useEffect, useRef } from 'react'
import { swapCharacter } from '../lib/ai/index.js'
import { getAll, STORES } from '../lib/storage.js'
import Lightbox from './Lightbox.jsx'

const GENDER_LABEL = {
  male: '남', female: '여', other: '기타', unspecified: '',
}
const GENDER_ICON = {
  male: '♂', female: '♀', other: '⚧', unspecified: '',
}

/**
 * CharacterSwapModal — 배우 이름 기반 다중 교체.
 *
 * props:
 *   sourceImage, sourceBlob  원본 이미지
 *   actors                   현재 프로젝트의 배우 목록 [{id, name, gender, color, slotNumber}]
 *   onClose
 *   onDone(result, meta)     생성 결과 + 메타
 *   onApplyAsAnchor(blob)    결과를 앵커로 교체
 */
export default function CharacterSwapModal({
  sourceImage, sourceBlob,
  actors = [],
  onClose, onDone, onApplyAsAnchor,
}) {
  const [swapMode, setSwapMode] = useState('prompt')
  const [targetDescription, setTargetDescription] = useState('')
  const [targetReference, setTargetReference] = useState(null)
  const [selectedActorIds, setSelectedActorIds] = useState(actors[0] ? [actors[0].id] : [])
  const [perActorDesc, setPerActorDesc] = useState({})
  const [useIndividualDesc, setUseIndividualDesc] = useState(false)
  const [strength, setStrength] = useState('medium')
  const [preserveBackground, setPreserveBackground] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [library, setLibrary] = useState([])
  const [showLightbox, setShowLightbox] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    getAll(STORES.skeletons).then(setLibrary).catch(() => setLibrary([]))
  }, [])

  function toggleActor(id) {
    setSelectedActorIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setTargetReference({ blob: file, url: URL.createObjectURL(file), name: file.name })
  }

  function handleRemoveReference() {
    if (targetReference?.url) URL.revokeObjectURL(targetReference.url)
    setTargetReference(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSwap() {
    if (selectedActorIds.length === 0) {
      setError('최소 1명 이상의 배우를 선택해주세요.')
      return
    }
    setError(null); setBusy(true); setResult(null); setProgress(null)
    try {
      // 배우 id → slot 번호(순서대로) + 개별 설명
      const targets = selectedActorIds.map(id => {
        const actor = actors.find(a => a.id === id)
        const slotIdx = actor?.slotNumber || (actors.findIndex(a => a.id === id) + 1)
        const desc = useIndividualDesc
          ? (perActorDesc[id] || targetDescription || '')
          : targetDescription
        return {
          slotIdx,
          description: desc,
          reference: targetReference?.blob || null,
          actorName: actor?.name,
        }
      })

      const res = await swapCharacter({
        sourceImage: sourceBlob || sourceImage,
        targets,
        strength,
        preserveBackground,
        onProgress: setProgress,
      })
      setResult(res)
    } catch (err) {
      setError('교체 실패: ' + err.message)
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  function handleAcceptToGallery() {
    if (result && onDone) {
      const names = selectedActorIds.map(id => actors.find(a => a.id === id)?.name).filter(Boolean)
      onDone(result, { targetActors: names, strength })
    }
  }

  async function handleApplyAsAnchor() {
    if (!result || !onApplyAsAnchor) return
    if (!confirm('이 교체 결과를 앵커 이미지로 덮어쓰시겠어요? (원본 앵커는 사라집니다.)')) return
    await onApplyAsAnchor(result.blob)
    onClose?.()
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🎭 캐릭터 교체 (배경 유지)</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16 }}>
          여러 명 선택 시 <b>순차 교체</b>로 모두 적용돼요 (이전엔 마지막만 반영되던 버그 해결).
          배우별 이름·성별로 구분. 원본 유지 문제는 <b>교체 강도</b>로 조절.
        </p>

        {/* 원본 + 결과 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>원본 이미지</label>
            <div style={imgBoxStyle}>
              {sourceImage && (
                <img src={sourceImage} alt="원본"
                  onClick={() => setShowLightbox('source')}
                  style={{ ...imgStyle, cursor: 'zoom-in' }} />
              )}
            </div>
          </div>
          <div>
            <label style={labelStyle}>
              교체 결과 {result && <span style={{ color: 'var(--accent-mint)' }}>✓ 클릭하여 확대</span>}
            </label>
            <div style={imgBoxStyle}>
              {busy && (
                <div style={{ color: 'var(--text-2)', fontSize: 12, textAlign: 'center' }}>
                  ⏳ 생성 중...
                  {progress && (
                    <div style={{ marginTop: 6 }}>
                      {progress.step}/{progress.total} · {progress.current?.actorName || ''}
                    </div>
                  )}
                </div>
              )}
              {!busy && result && (
                <img src={result.url} alt="결과"
                  onClick={() => setShowLightbox('result')}
                  style={{ ...imgStyle, cursor: 'zoom-in' }} />
              )}
              {!busy && !result && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>아래 설정 후 [교체] 클릭</div>}
            </div>
          </div>
        </div>

        {/* 🎯 배우 선택 (실제 이름) */}
        <label style={labelStyle}>🎯 교체할 배우 선택 (다중 가능)</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {actors.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>등록된 배우가 없어요</div>
          )}
          {actors.map((a, i) => {
            const sel = selectedActorIds.includes(a.id)
            const gLabel = GENDER_LABEL[a.gender] || ''
            const gIcon = GENDER_ICON[a.gender] || ''
            return (
              <label key={a.id} style={{
                flex: '1 1 140px',
                background: sel ? 'rgba(139,92,246,0.2)' : 'var(--bg-2)',
                border: '2px solid ' + (sel ? 'var(--accent-purple)' : 'var(--border)'),
                borderRadius: 8, padding: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <input type="checkbox" checked={sel} onChange={() => toggleActor(a.id)}
                  style={{ display: 'none' }} />
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: a.color,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {sel ? '✓ ' : ''}{i + 1}번 · {a.name} {gIcon && <span style={{ color: 'var(--text-3)' }}>{gIcon}</span>}
                  </div>
                  {gLabel && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{gLabel}</div>}
                </div>
              </label>
            )
          })}
        </div>

        {/* 교체 강도 */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>교체 강도</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { k: 'soft', l: '약 (살짝 수정)', d: '원본 상당 유지' },
              { k: 'medium', l: '중 (기본)', d: '얼굴·의상 바뀜' },
              { k: 'strong', l: '강 (완전 교체)', d: '완전히 새 사람' },
            ].map(s => (
              <button key={s.k} onClick={() => setStrength(s.k)}
                style={{
                  flex: 1,
                  background: strength === s.k ? 'var(--accent-purple)' : 'var(--bg-2)',
                  color: strength === s.k ? 'white' : 'var(--text-2)',
                  border: '1px solid ' + (strength === s.k ? 'transparent' : 'var(--border)'),
                  borderRadius: 6, padding: '8px 10px', fontSize: 11, cursor: 'pointer',
                  textAlign: 'left',
                }}>
                <div style={{ fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{s.d}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            💡 "원본이 너무 강하게 유지되어 머리만 바뀐다" 싶으면 <b>강</b>으로 설정
          </div>
        </div>

        {/* 소스 모드 탭 */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', padding: 4, borderRadius: 8, width: 'fit-content', marginBottom: 12 }}>
          <SwapModeBtn active={swapMode === 'prompt'} onClick={() => setSwapMode('prompt')}>📝 프롬프트</SwapModeBtn>
          <SwapModeBtn active={swapMode === 'library'} onClick={() => setSwapMode('library')}>📚 내 라이브러리</SwapModeBtn>
          <SwapModeBtn active={swapMode === 'upload'} onClick={() => setSwapMode('upload')}>📁 이미지 업로드</SwapModeBtn>
        </div>

        {swapMode === 'prompt' && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>
              설명 <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(선택 — 비워도 교체 동작)</span>
            </label>
            <textarea
              value={targetDescription}
              onChange={e => setTargetDescription(e.target.value)}
              placeholder="예: a tall blond man in black leather jacket"
              rows={3}
              style={textareaStyle}
            />

            {selectedActorIds.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={useIndividualDesc} onChange={e => setUseIndividualDesc(e.target.checked)} />
                  배우별로 다른 설명 입력
                </label>
                {useIndividualDesc && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {selectedActorIds.map(id => {
                      const a = actors.find(x => x.id === id)
                      return (
                        <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 80 }}>{a?.name}:</span>
                          <input type="text" value={perActorDesc[id] || ''}
                            onChange={e => setPerActorDesc({ ...perActorDesc, [id]: e.target.value })}
                            placeholder={`${a?.name} 교체 설명`}
                            style={{ ...inputStyle, marginTop: 0, flex: 1 }} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {swapMode === 'library' && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>저장된 스켈레톤 선택</label>
            {library.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: 10 }}>라이브러리가 비어있어요</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {library.slice(-8).map(s => (
                  <div key={s.id} onClick={() => setTargetDescription(s.name)}
                    style={{
                      background: '#0a0b10', aspectRatio: '3/4', borderRadius: 4,
                      cursor: 'pointer', overflow: 'hidden',
                      border: targetDescription === s.name ? '2px solid var(--accent-purple)' : '1px solid var(--border)',
                    }}
                    dangerouslySetInnerHTML={{ __html: s.svgPreview }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {swapMode === 'upload' && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>참조 이미지</label>
            {targetReference ? (
              <div style={{
                background: 'var(--bg-2)', border: '1px solid var(--accent-mint)',
                borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <img src={targetReference.url} alt="참조"
                  style={{ maxHeight: 80, maxWidth: 80, objectFit: 'contain', borderRadius: 4 }} />
                <div style={{ flex: 1, fontSize: 12 }}>
                  <div style={{ color: 'var(--accent-mint)' }}>✓ 등록됨</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 3 }}>
                    {targetReference.name || 'uploaded'}
                  </div>
                </div>
                <button onClick={handleRemoveReference}
                  style={{
                    background: 'transparent', border: '1px solid var(--danger)',
                    color: 'var(--danger)', padding: '4px 10px', borderRadius: 4,
                    fontSize: 11, cursor: 'pointer',
                  }}
                >✕ 삭제</button>
              </div>
            ) : (
              <div onClick={() => fileRef.current?.click()} style={{
                background: 'var(--bg-2)', border: '2px dashed var(--border)',
                borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer',
              }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>클릭해서 참조 이미지 선택</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={preserveBackground} onChange={e => setPreserveBackground(e.target.checked)} />
            배경·조명 엄격 유지
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
            선택: <b style={{ color: 'var(--accent-mint)' }}>{selectedActorIds.length}명</b>
          </span>
        </div>

        {error && <div className="note warn" style={{ fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleSwap} disabled={busy}>
              {busy ? '생성 중...' : (result ? '🔄 다시 생성' : '🎭 교체 실행')}
            </button>
            {result && (
              <>
                <button className="btn btn-primary" onClick={handleAcceptToGallery}>✓ 갤러리 저장</button>
                <button className="btn" onClick={handleApplyAsAnchor}
                  style={{ borderColor: 'var(--accent-mint)', color: 'var(--accent-mint)' }}>
                  🎯 앵커로 적용
                </button>
              </>
            )}
          </div>
        </div>

        <div className="explain" style={{ fontSize: 11, marginTop: 12 }}>
          <b>💡 팁</b>: "앵커로 적용"을 누르면 이 결과 이미지가 프로젝트의 <b>기준 앵커</b>로 교체됩니다.
          이후 포즈·스테이지·시트 작업은 이 새 인물 기준으로 돌아가요. (자동 저장됨)
        </div>
      </div>

      {showLightbox && (
        <Lightbox
          src={showLightbox === 'source' ? sourceImage : result?.url}
          caption={showLightbox === 'source' ? '원본' : '교체 결과'}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  )
}

const backdropStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
}
const modalStyle = {
  background: 'var(--bg-1)', border: '1px solid var(--border)',
  borderRadius: 14, padding: 24, width: '92%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto',
}
const closeBtnStyle = {
  background: 'transparent', border: 0, color: 'var(--text-2)',
  fontSize: 20, cursor: 'pointer',
}
const labelStyle = { display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }
const imgBoxStyle = {
  background: 'var(--bg-2)', border: '1px solid var(--border)',
  borderRadius: 8, height: 280, display: 'flex',
  alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
}
const imgStyle = {
  maxWidth: '100%', maxHeight: '100%',
  width: 'auto', height: 'auto', objectFit: 'contain',
  display: 'block',
}
const textareaStyle = {
  width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)',
  color: 'var(--text-1)', borderRadius: 6, padding: 10, fontSize: 13,
  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
}
const inputStyle = {
  width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)',
  color: 'var(--text-1)', borderRadius: 6, padding: 8, fontSize: 13,
  fontFamily: 'inherit', boxSizing: 'border-box', marginTop: 4,
}

function SwapModeBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'var(--accent-purple)' : 'transparent',
      color: active ? 'white' : 'var(--text-2)',
      border: 0, padding: '6px 12px', borderRadius: 6,
      fontSize: 12, cursor: 'pointer',
    }}>{children}</button>
  )
}
