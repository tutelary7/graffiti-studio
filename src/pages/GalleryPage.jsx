import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProject } from '../context/ProjectContext.jsx'
import Lightbox from '../components/Lightbox.jsx'

const CLOSEUP_TAGS = ['얼굴', '상반신', '손', '발', '목', '눈', '입', '머리']

const FILTER_TAGS = [
  { key: 'all', label: '전체' },
  { key: 'pose', label: '포즈', match: c => c.kind === 'pose' },
  { key: 'stage', label: '스테이지', match: c => c.kind === 'stage' },
  { key: 'sheet', label: '8면 시트', match: c => c.kind === 'sheet' },
  { key: 'swap', label: '캐릭터 교체', match: c => c.kind === 'character-swap' },
  { key: 'multi', label: '다중 인물', match: c => c.tags?.includes('다중인물') },
  { key: 'face-cu', label: '얼굴 클로즈업', match: c => c.tags?.includes('얼굴') },
  { key: 'hand-cu', label: '손 클로즈업', match: c => c.tags?.includes('손') },
  { key: 'closeup', label: '기타 클로즈업', match: c => c.tags?.some(t => CLOSEUP_TAGS.includes(t) && t !== '얼굴' && t !== '손') },
]

export default function GalleryPage() {
  const navigate = useNavigate()
  const { currentProject, removeCut, updateProject } = useProject()
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [urls, setUrls] = useState({})
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    if (!currentProject) return
    const map = {}
    for (const c of currentProject.cuts) {
      if (c.imageBlob instanceof Blob) map[c.id] = URL.createObjectURL(c.imageBlob)
    }
    setUrls(map)
    return () => Object.values(map).forEach(url => URL.revokeObjectURL(url))
  }, [currentProject?.id, currentProject?.cuts.length])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>🖼️ 갤러리</h1></div>
        <div className="placeholder"><div className="ico">⚠</div><h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  const allCuts = currentProject.cuts || []
  const filtered = useMemo(() => {
    const f = FILTER_TAGS.find(t => t.key === filter)
    if (!f || f.key === 'all') return allCuts
    return allCuts.filter(f.match)
  }, [allCuts, filter])

  const counts = useMemo(() => {
    const c = { all: allCuts.length }
    FILTER_TAGS.forEach(t => { if (t.match) c[t.key] = allCuts.filter(t.match).length })
    return c
  }, [allCuts])

  function toggle(id, e) {
    e?.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleDelete() {
    if (!confirm(`${selected.size}장 삭제?`)) return
    for (const id of selected) await removeCut(id)
    setSelected(new Set())
  }

  async function handleApplyAsAnchor(cut) {
    if (!cut?.imageBlob) return
    if (!confirm('이 이미지를 앵커로 교체하시겠어요?')) return
    await updateProject(currentProject.id, { anchorBlob: cut.imageBlob, anchorSource: 'gallery' })
    setLightbox(null)
    alert('✓ 앵커 교체됨')
  }

  return (
    <div>
      <div className="screen-title">
        <h1>🖼️ 갤러리 <span style={{ fontSize: 13, color: 'var(--text-3)' }}>— {currentProject.name} · {allCuts.length}컷</span></h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {selected.size > 0 && (
            <>
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>선택 해제</button>
              <button className="btn" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={handleDelete}>🗑 삭제</button>
              <button className="btn btn-primary" onClick={() => navigate('/export')}>내보내기 ({selected.size}) →</button>
            </>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
        이미지 클릭으로 <b>확대 보기</b> · 우상단 ✓로 다중 선택
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTER_TAGS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} style={{
            background: filter === t.key ? 'var(--accent-purple)' : 'var(--bg-2)',
            color: filter === t.key ? 'white' : 'var(--text-2)',
            border: '1px solid ' + (filter === t.key ? 'transparent' : 'var(--border)'),
            padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
          }}>{t.label} {counts[t.key] !== undefined && `(${counts[t.key]})`}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder">
          <div className="ico">🖼️</div>
          <h2>{allCuts.length === 0 ? '아직 컷이 없어요' : '필터에 해당하는 컷이 없어요'}</h2>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => navigate('/stage')}>🎥 스테이지로</button>
            <button className="btn btn-ghost" onClick={() => navigate('/sheet')}>📐 시트로</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {filtered.map(cut => {
            const isSel = selected.has(cut.id)
            return (
              <div key={cut.id}
                onClick={() => setLightbox({ cut, url: urls[cut.id] })}
                style={{
                  aspectRatio: '3/4', background: 'var(--bg-2)',
                  border: isSel ? '2px solid var(--accent-purple)' : '1px solid var(--border)',
                  borderRadius: 8, position: 'relative', overflow: 'hidden', cursor: 'zoom-in',
                }}>
                {urls[cut.id] && <img src={urls[cut.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                <button onClick={(e) => toggle(cut.id, e)} style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 24, height: 24, borderRadius: '50%',
                  background: isSel ? 'var(--accent-purple)' : 'rgba(0,0,0,0.6)',
                  color: 'white', border: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                }}>{isSel ? '✓' : '○'}</button>
                <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(139,92,246,0.8)', color: 'white', fontSize: 9, padding: '2px 6px', borderRadius: 3 }}>
                  {cut.kind}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {lightbox && (
        <Lightbox
          src={lightbox.url}
          caption={`${lightbox.cut.kind} · ${(lightbox.cut.tags || []).join(', ')} · ${new Date(lightbox.cut.createdAt).toLocaleString('ko-KR')}`}
          onClose={() => setLightbox(null)}
          actions={[
            { label: 'PC 저장', icon: '💾', onClick: () => {
              const a = document.createElement('a')
              a.href = lightbox.url; a.download = `graffiti-${lightbox.cut.kind}-${lightbox.cut.id.slice(-8)}.png`; a.click()
            }},
            { label: '앵커로 적용', icon: '🎯', variant: 'primary', onClick: () => handleApplyAsAnchor(lightbox.cut) },
            { label: '삭제', icon: '🗑', onClick: async () => {
              if (confirm('이 컷을 삭제하시겠어요?')) {
                await removeCut(lightbox.cut.id)
                setLightbox(null)
              }
            }},
          ]}
        />
      )}
    </div>
  )
}
