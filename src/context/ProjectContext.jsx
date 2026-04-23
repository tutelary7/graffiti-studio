import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { cloneRig } from '../lib/skeleton/rigs.js'
import { settings, put, getAll, remove as removeFromDB, STORES } from '../lib/storage.js'

const ProjectContext = createContext(null)

const DEFAULT_ACTOR_COLORS = ['#34d399', '#8b5cf6', '#f59e0b', '#22d3ee', '#ec4899', '#84cc16']

function makeActor(slotNumber, opts = {}) {
  return {
    id: `actor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    slotNumber,
    name: opts.name || `배우 ${slotNumber}`,
    gender: opts.gender || 'unspecified',  // 'male' | 'female' | 'other' | 'unspecified'
    rigId: opts.rigId || 'human',
    rigData: opts.rigData || cloneRig(opts.rigId || 'human'),
    color: DEFAULT_ACTOR_COLORS[(slotNumber - 1) % DEFAULT_ACTOR_COLORS.length],
    position: { x: 30 + ((slotNumber - 1) * 15), y: 0, z: 50 },
    rotation: { yaw: 0 },
    headYaw: 0, headPitch: 0,
    scale: { overall: 100, head: 100, arm: 100, leg: 100 },
    isLinked: opts.isLinked || false,
    linkedCharId: opts.linkedCharId || null,
  }
}

function makeProject(name, emoji) {
  return {
    id: `prj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || '새 프로젝트',
    emoji: emoji || '🎨',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    anchorBlob: null,
    anchorSource: null,
    actors: [],
    cuts: [],
    progress: {
      anchor: false, pose: false, stage: false, sheet: false, gallery: false,
    },
  }
}

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(() => settings.get('currentProjectId', null))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const stored = await getAll(STORES.projects)
        setProjects(stored || [])
      } catch (e) {
        console.warn('프로젝트 로드 실패', e)
      } finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => { settings.set('currentProjectId', currentProjectId) }, [currentProjectId])

  const currentProject = projects.find(p => p.id === currentProjectId) || null

  const createProject = useCallback(async (name, emoji) => {
    const p = makeProject(name, emoji)
    await put(STORES.projects, p)
    setProjects(prev => [...prev, p])
    setCurrentProjectId(p.id)
    return p
  }, [])

  const updateProject = useCallback(async (id, patch) => {
    const updated = projects.map(p => p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)
    const newProj = updated.find(p => p.id === id)
    if (newProj) await put(STORES.projects, newProj)
    setProjects(updated)
  }, [projects])

  const deleteProject = useCallback(async (id) => {
    await removeFromDB(STORES.projects, id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (currentProjectId === id) setCurrentProjectId(null)
  }, [currentProjectId])

  const addActor = useCallback(async (opts = {}) => {
    if (!currentProject) return null
    const slotNumber = (currentProject.actors.length || 0) + 1
    const actor = makeActor(slotNumber, opts)
    const updated = { ...currentProject, actors: [...currentProject.actors, actor], updatedAt: new Date().toISOString() }
    await put(STORES.projects, updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    return actor
  }, [currentProject])

  const updateActor = useCallback(async (actorId, patch) => {
    // functional setState — stale closure 방지
    let latest
    setProjects(prev => {
      const next = prev.map(p => {
        if (p.id !== currentProjectId) return p
        return {
          ...p,
          actors: p.actors.map(a => a.id === actorId ? { ...a, ...patch } : a),
          updatedAt: new Date().toISOString(),
        }
      })
      latest = next.find(p => p.id === currentProjectId)
      return next
    })
    // DB에도 즉시 반영
    if (latest) {
      try { await put(STORES.projects, latest) }
      catch (e) { console.error('[updateActor] DB 저장 실패:', e) }
    }
  }, [currentProjectId])

  const removeActor = useCallback(async (actorId) => {
    if (!currentProject) return
    const updated = {
      ...currentProject,
      actors: currentProject.actors.filter(a => a.id !== actorId),
      updatedAt: new Date().toISOString(),
    }
    await put(STORES.projects, updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
  }, [currentProject])

  const addCut = useCallback(async (cutData) => {
    if (!currentProject) return
    const cut = {
      id: `cut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      ...cutData,
    }
    const updated = {
      ...currentProject,
      cuts: [...currentProject.cuts, cut],
      progress: { ...currentProject.progress, gallery: true },
      updatedAt: new Date().toISOString(),
    }
    await put(STORES.projects, updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    return cut
  }, [currentProject])

  const removeCut = useCallback(async (cutId) => {
    if (!currentProject) return
    const updated = {
      ...currentProject,
      cuts: currentProject.cuts.filter(c => c.id !== cutId),
      updatedAt: new Date().toISOString(),
    }
    await put(STORES.projects, updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
  }, [currentProject])

  const value = {
    projects, currentProject, currentProjectId, loading,
    setCurrentProjectId,
    createProject, updateProject, deleteProject,
    addActor, updateActor, removeActor,
    addCut, removeCut,
  }

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider')
  return ctx
}
