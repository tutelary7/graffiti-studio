import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { loadUserAssets } from '../lib/handoff/index.js'

const TYPE_LABEL = {
  outfit:    { ko: '의상',     icon: '👗' },
  accessory: { ko: '악세서리', icon: '💍' },
  prop:      { ko: '소품',     icon: '🎯' },
  tool:      { ko: '도구',     icon: '🔧' },
  pose:      { ko: '포즈',     icon: '🤸' },
}

export default function AssetLibraryPage() {
  const { user } = useAuth()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    if (!user) { setLoading(false); return }
    setLoading(true); setErr(null)
    loadUserAssets(user.uid)
      .then(setAssets)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [user])

  // 타입 카운트 (필터 칩에 표시)
  const typeCounts = useMemo(() => {
    const map = { all: assets.length }
    for (const a of assets) map[a.type] = (map[a.type] || 0) + 1
    return map
  }, [assets])

  const filtered = useMemo(() => assets.filter(a => {
    if (search) {
      const q = search.toLowerCase()
      const hay = [
        a.name, a.koreanSummary, a.description,
        ...(a.tags || []),
      ].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (typeFilter !== 'all' && a.type !== typeFilter) return false
    return true
  }), [assets, search, typeFilter])

  if (!user) {
    return (
      <div>
        <div className="screen-title"><h1>📁 에셋 라이브러리</h1></div>
        <div className="placeholder" style={{ marginTop: 40 }}>
          <div className="ico" style={{ fontSize: 48 }}>🔐</div>
          <h2 style={{ marginTop: 16 }}>로그인이 필요합니다</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8 }}>
            상단의 로그인 버튼을 눌러 Google 계정으로 로그인하면<br />
            저장한 에셋이 여기에 표시됩니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}>
      <div className="screen-title">
        <h1>📁 에셋 라이브러리</h1>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {loading ? '로드 중...' : `${assets.length}개의 에셋`}
        </div>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 12 }}>
        모든 소설 작품에서 공유되는 의상·소품·도구·포즈 라이브러리
      </p>

      {/* 검색 + 타입 필터 */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
        background: 'var(--bg-1)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 10,
      }}>
        <input
          type="text"
          placeholder="🔍 이름·태그·설명 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: '1 1 200px', minWidth: 200,
            padding: '6px 10px', fontSize: 13,
            background: 'var(--bg-0)', border: '1px solid var(--border)',
            color: 'var(--text-1)', borderRadius: 6,
          }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['all', 'outfit', 'accessory', 'prop', 'tool', 'pose'].map(t => {
            const active = typeFilter === t
            const meta = TYPE_LABEL[t]
            const count = typeCounts[t] || 0
            return (
              <button key={t} onClick={() => setTypeFilter(t)} style={{
                padding: '6px 10px', fontSize: 11, borderRadius: 16,
                background: active ? 'var(--accent-purple)' : 'var(--bg-2)',
                color: active ? 'white' : 'var(--text-2)',
                border: '1px solid ' + (active ? 'var(--accent-purple)' : 'var(--border)'),
                cursor: 'pointer',
              }}>
                {t === 'all' ? `전체 ${count}` : `${meta.icon} ${meta.ko} ${count}`}
              </button>
            )
          })}
        </div>
      </div>

      {err && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)',
          color: 'var(--danger)', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 12,
        }}>⚠ 에셋 로드 실패: {err}</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="placeholder" style={{ marginTop: 40 }}>
          <div className="ico" style={{ fontSize: 36 }}>📦</div>
          <h2 style={{ marginTop: 12, fontSize: 14 }}>
            {assets.length === 0 ? '아직 등록된 에셋이 없습니다' : '검색 결과 없음'}
          </h2>
          {assets.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>
              novel-workstation의 에셋 라이브러리에서 추가해주세요
            </p>
          )}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
      }}>
        {filtered.map(asset => <AssetCard key={asset.id} asset={asset} />)}
      </div>
    </div>
  )
}

function AssetCard({ asset }) {
  const [imgIdx, setImgIdx] = useState(0)
  const previewUrl = asset.referenceImages?.[imgIdx] || asset.referenceImages?.[0]
  const meta = TYPE_LABEL[asset.type] || { ko: asset.type || '?', icon: '📦' }

  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
      transition: 'border-color 0.15s',
    }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-purple)'}
       onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
      <div style={{
        aspectRatio: '1/1', background: 'var(--bg-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {previewUrl ? (
          <img src={previewUrl} alt={asset.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none' }} />
        ) : (
          <span style={{ fontSize: 42, opacity: 0.5 }}>{meta.icon}</span>
        )}
        {asset.referenceImages && asset.referenceImages.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 6, right: 6,
            background: 'rgba(0,0,0,0.6)', color: 'white',
            fontSize: 10, padding: '2px 6px', borderRadius: 10,
          }}>{imgIdx + 1}/{asset.referenceImages.length}</div>
        )}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
          <h4 style={{
            fontSize: 13, margin: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{asset.name}</h4>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 8,
            background: 'var(--bg-3)', color: 'var(--text-2)',
          }}>{meta.icon} {meta.ko}</span>
        </div>
        {asset.koreanSummary && (
          <p style={{
            fontSize: 11, color: 'var(--text-2)', margin: 0,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', lineHeight: 1.4,
          }}>{asset.koreanSummary}</p>
        )}
        {asset.tags && asset.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {asset.tags.slice(0, 3).map((tag, i) => (
              <span key={i} style={{
                fontSize: 9, color: 'var(--text-3)',
                background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 3,
              }}>#{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
