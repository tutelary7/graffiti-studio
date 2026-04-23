import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMode } from '../context/ModeContext.jsx'
import { useProject } from '../context/ProjectContext.jsx'

export default function ExportPage() {
  const navigate = useNavigate()
  const { isIntegrated } = useMode()
  const { currentProject } = useProject()
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [urls, setUrls] = useState({})
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!currentProject) return
    const map = {}
    for (const c of currentProject.cuts) {
      if (c.imageBlob instanceof Blob) map[c.id] = URL.createObjectURL(c.imageBlob)
    }
    setUrls(map)
    setSelectedIds(new Set(currentProject.cuts.map(c => c.id)))
    return () => Object.values(map).forEach(url => URL.revokeObjectURL(url))
  }, [currentProject?.id, currentProject?.cuts.length])

  if (!currentProject) {
    return (
      <div>
        <div className="screen-title"><h1>📤 내보내기</h1></div>
        <div className="placeholder"><div className="ico">⚠</div><h2>프로젝트를 먼저 선택하세요</h2>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>← 홈으로</button>
        </div>
      </div>
    )
  }

  const selectedCuts = useMemo(() => (currentProject.cuts || []).filter(c => selectedIds.has(c.id)), [currentProject.cuts, selectedIds])

  async function handlePC() {
    if (selectedCuts.length === 0) return
    setStatus('PC 다운로드 중...')
    for (const cut of selectedCuts) {
      const url = urls[cut.id]
      if (!url) continue
      const a = document.createElement('a')
      a.href = url; a.download = `graffiti-${cut.kind}-${cut.id.slice(-8)}.png`
      a.click()
      await new Promise(r => setTimeout(r, 100))
    }
    setStatus(`✓ ${selectedCuts.length}장 다운 완료`)
    setTimeout(() => setStatus(null), 3000)
  }

  function handlePromptPack() {
    const pack = selectedCuts.map(c => ({
      id: c.id, kind: c.kind, tags: c.tags, meta: c.meta, createdAt: c.createdAt,
    }))
    const json = JSON.stringify({ project: currentProject.name, cuts: pack }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${currentProject.name}-prompts.json`; a.click()
    URL.revokeObjectURL(url)
    setStatus('✓ 프롬프트 팩 다운로드 완료')
    setTimeout(() => setStatus(null), 3000)
  }

  const phase2 = (msg) => { setStatus(msg || '⚠ Phase 2에서 결정 예정'); setTimeout(() => setStatus(null), 3500) }

  return (
    <div>
      <div className="screen-title">
        <h1>📤 내보내기</h1>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {isIntegrated ? '🔧 개발자 모드 · 모든 경로 가능' : '💳 구독형 모드 · PC/3D만'}
        </span>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 16 }}>
        {currentProject.name} · 선택 <b>{selectedCuts.length}장</b> / 총 {(currentProject.cuts || []).length}장
      </p>

      {selectedCuts.length === 0 && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <b>⚠ 선택된 컷이 없어요.</b>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }} onClick={() => navigate('/gallery')}>갤러리로 →</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        <Card icon="💾" title="PC 다운로드" desc="ZIP (이미지 + 메타 JSON)" enabled={selectedCuts.length > 0} onClick={handlePC} />
        <Card icon="📖" title="웹툰 콘티로 전송" desc="novel-workstation 컷 목록 등록"
          enabled={isIntegrated && selectedCuts.length > 0}
          disabled={!isIntegrated && 'standalone 모드 비활성'}
          onClick={() => phase2('⚠ 웹툰 전송 프로토콜 Phase 2 예정')} />
        <Card icon="🎬" title="영상 콘티로 전송" desc="hbd-app VideoGeneratePage로 전송"
          enabled={isIntegrated && selectedCuts.length > 0}
          disabled={!isIntegrated && 'standalone 모드 비활성'}
          onClick={() => phase2('⚠ 영상 전송 프로토콜 Phase 2 예정')} />
        <Card icon="🧊" title="3D 메시 변환" desc="Tripo / Meshy (GLB · STL)"
          enabled={false} badge="Phase 3"
          onClick={() => phase2('🧊 3D 변환은 Phase 3 구독형 SaaS')} />
        <Card icon="🎭" title="에셋 라이브러리 등록" desc="novel-workstation 캐릭터 시트"
          enabled={isIntegrated && selectedCuts.length > 0}
          disabled={!isIntegrated && 'standalone 모드 비활성'}
          onClick={() => phase2('⚠ 에셋 연동 Phase 2 예정')} />
        <Card icon="📋" title="프롬프트 팩 내보내기" desc="각 컷의 생성 메타 JSON"
          enabled={selectedCuts.length > 0} onClick={handlePromptPack} />
      </div>

      {status && <div className="note" style={{ marginTop: 20 }}>{status}</div>}

      {!isIntegrated && (
        <div className="note warn" style={{ marginTop: 20 }}>
          <b>💡 구독형 모드에선 외부 전송이 막혀 있어요.</b> 좌측 하단 토글을 🔧 개발자로 바꾸면 열립니다.
        </div>
      )}
    </div>
  )
}

function Card({ icon, title, desc, enabled, onClick, badge, disabled }) {
  return (
    <div onClick={enabled ? onClick : (badge ? onClick : undefined)} style={{
      background: 'var(--bg-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 20, textAlign: 'center',
      cursor: (enabled || badge) ? 'pointer' : 'not-allowed',
      opacity: enabled ? 1 : (badge ? 0.7 : 0.5), position: 'relative',
      transition: 'all 0.15s',
    }}
      onMouseEnter={e => { if (enabled) e.currentTarget.style.borderColor = 'var(--accent-mint)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
      {badge && (
        <span style={{ position: 'absolute', top: 8, right: 8, background: 'var(--warn)', color: '#2d1b00', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>{badge}</span>
      )}
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>{title}</h4>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-2)' }}>{desc}</p>
      {disabled && <div style={{ marginTop: 8, fontSize: 10, color: 'var(--warn)' }}>🔒 {disabled}</div>}
    </div>
  )
}
