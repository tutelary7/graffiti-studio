import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMode } from '../context/ModeContext.jsx'
import { useProject } from '../context/ProjectContext.jsx'

function ProgressDots({ project }) {
  const p = project?.progress || {}
  const states = [p.anchor, p.pose, p.stage, p.sheet, p.gallery]
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
      {states.map((done, i) => (
        <div key={i} style={{
          flex: 1, height: 3, borderRadius: 2,
          background: done ? 'var(--accent-mint)' : 'var(--bg-3)'
        }} />
      ))}
    </div>
  )
}

function ProjectCard({ project, onOpen, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [tempName, setTempName] = useState(project.name)

  const hasContent = project.cuts?.length > 0 || project.actors?.length > 0 || project.anchorBlob
  const statusText = hasContent
    ? `${project.cuts?.length || 0}컷 · ${project.actors?.length || 0}인${project.anchorBlob ? ' · 앵커' : ''}`
    : '앵커 먼저 설정하세요'

  async function handleSaveName() {
    if (tempName.trim() && tempName !== project.name) {
      await onRename(project.id, tempName.trim())
    }
    setEditing(false)
  }

  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 16, position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}>
        <button onClick={(e) => { e.stopPropagation(); setEditing(true) }} title="이름 편집" style={btnMini()}>✏</button>
        <button onClick={(e) => onDelete(e, project.id)} title="삭제" style={btnMini('var(--danger)')}>✕</button>
      </div>

      <div
        onClick={() => !editing && onOpen(project.id)}
        style={{
          aspectRatio: '3/4', cursor: editing ? 'default' : 'pointer',
          background: 'linear-gradient(135deg, var(--bg-2), var(--bg-3))',
          borderRadius: 8, marginBottom: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48,
          transition: 'border-color 0.15s',
        }}
      >{project.emoji}</div>

      {editing ? (
        <input
          autoFocus
          value={tempName}
          onChange={e => setTempName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSaveName()
            if (e.key === 'Escape') { setTempName(project.name); setEditing(false) }
          }}
          style={{
            width: '100%', background: 'var(--bg-2)', border: '1px solid var(--accent-purple)',
            color: 'var(--text-1)', borderRadius: 4, padding: '4px 8px', fontSize: 15,
            fontFamily: 'inherit', marginBottom: 6,
          }}
        />
      ) : (
        <h4 style={{ margin: '0 0 6px', fontSize: 15, cursor: 'pointer' }}
          onClick={() => onOpen(project.id)}>{project.name}</h4>
      )}
      <p style={{ margin: 0, fontSize: 12, color: hasContent ? 'var(--text-2)' : 'var(--text-3)' }}>
        {statusText}
      </p>
      <ProgressDots project={project} />
    </div>
  )
}

function btnMini(color) {
  return {
    background: 'rgba(0,0,0,0.6)', border: 0,
    color: color || 'var(--text-2)',
    width: 26, height: 26, borderRadius: 4, fontSize: 12, cursor: 'pointer',
  }
}

export default function HomePage() {
  const navigate = useNavigate()
  const { isIntegrated } = useMode()
  const { projects, createProject, updateProject, setCurrentProjectId, deleteProject, loading } = useProject()
  const [creating, setCreating] = useState(false)

  async function handleNewProject() {
    const name = prompt('새 캐릭터 이름:', '새 캐릭터')
    if (!name) return
    setCreating(true)
    try {
      await createProject(name.trim(), '🎨')
      navigate('/anchor')
    } finally { setCreating(false) }
  }

  function handleOpen(pid) {
    setCurrentProjectId(pid)
    navigate('/anchor')
  }

  async function handleDelete(e, pid) {
    e.stopPropagation()
    if (confirm('이 프로젝트를 삭제하시겠어요? 되돌릴 수 없습니다.')) {
      await deleteProject(pid)
    }
  }

  async function handleRename(pid, newName) {
    await updateProject(pid, { name: newName })
  }

  return (
    <div>
      <div className="screen-title">
        <h1>🏠 내 프로젝트</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {isIntegrated && (
            <button className="btn btn-ghost" onClick={() => alert('웹툰 연동은 Phase 2에서 구현됩니다.')}>
              📥 웹툰에서 캐릭터 가져오기
            </button>
          )}
          <button className="btn btn-primary" onClick={handleNewProject} disabled={creating}>
            {creating ? '...' : '＋ 새 캐릭터 시작'}
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
        한 캐릭터당 프로젝트 하나. 카드 우상단 <b>✏ 편집 · ✕ 삭제</b> · 카드 클릭으로 열기.
      </p>

      {loading ? (
        <div className="placeholder"><div className="ico">⏳</div><h2>로딩 중...</h2></div>
      ) : projects.length === 0 ? (
        <div className="placeholder">
          <div className="ico">🎨</div>
          <h2>아직 프로젝트가 없어요</h2>
          <p>＋ 새 캐릭터 시작 버튼을 눌러주세요.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p}
              onOpen={handleOpen} onDelete={handleDelete} onRename={handleRename} />
          ))}
        </div>
      )}
    </div>
  )
}
