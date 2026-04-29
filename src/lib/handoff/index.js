/**
 * src/lib/handoff/index.js
 * ────────────────────────────────────────────────
 * Graffiti Studio (메인 React 앱) → 외부 Prototype 도구 핸드오프 모듈
 *
 *   - public/stage-editor.html  ← 다인 무대 합성기
 *   - public/qwen-viewer.html   ← 1인 카메라 각도 변환기
 *
 * 데이터 모으기 → graffiti JSON 형식 → localStorage → window.open
 *
 * 데이터 소스:
 *   1. 현재 프로젝트의 8면 시트 (로컬 IndexedDB cuts store)
 *   2. novel-workstation의 소설 캐릭터 (Firestore: novels/{novelId}/characters)
 *   3. 사용자 에셋 (Firestore: users/{uid}/assets)
 *
 * Phase C-2 — 검증 완료 후 React 컴포넌트로 통합 예정.
 */
import { collection, getDocs, query, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { getAll, STORES } from '../storage.js'

// ─── 상수 ─────────────────────────────────────────
// graffiti SheetPage 슬롯 → prototype Stage Editor 8방위 매핑
const SHEET_KEY_TO_DIRECTION = {
  'front':       'S',   // 남 = 정면
  'front-right': 'SE',  // 남동 = 앞-우
  'right':       'E',   // 동 = 우측
  'back-right':  'NE',  // 북동 = 뒤-우
  'back':        'N',   // 북 = 뒤
  'back-left':   'NW',  // 북서 = 뒤-좌
  'left':        'W',   // 서 = 좌측
  'front-left':  'SW',  // 남서 = 앞-좌
}

// ─── 1. 현재 프로젝트의 8면 시트 캐릭터 로드 ──────
// cuts IndexedDB store에서 kind === 'sheet' 인 것들 모아 캐릭터 1명으로 합침
export async function loadEightSheetCharacter(currentProject) {
  if (!currentProject) return null
  try {
    const cuts = await getAll(STORES.cuts)
    const projectSheets = (cuts || [])
      .filter(c => c.projectId === currentProject.id && c.kind === 'sheet')

    if (projectSheets.length === 0) return null

    const sprites = {}
    for (const cut of projectSheets) {
      const angle = cut.meta?.sheetAngle
      const direction = SHEET_KEY_TO_DIRECTION[angle]
      if (!direction || !cut.imageBlob) continue
      // imageBlob → object URL (브라우저 메모리 안에서만 유효)
      sprites[direction] = URL.createObjectURL(cut.imageBlob)
    }

    if (Object.keys(sprites).length === 0) return null

    return {
      id: `sheet-${currentProject.id}`,
      name: currentProject.name,
      source: 'sheet8',
      role: '주인공',  // 기본값 (사용자 수정 가능 — 나중에 UI 추가)
      visualId: null,
      references: null,
      sprites,
      availableAssetIds: [],
    }
  } catch (e) {
    console.warn('[handoff] 8면 시트 로드 실패:', e)
    return null
  }
}

// ─── 2. 소설 캐릭터 로드 (Firestore) ──────────────
// users/{uid}/novel_list/* 에서 novelId 목록 가져온 후
// novels/{novelId}/characters/* 다 합쳐서 반환
export async function loadNovelCharacters(uid) {
  if (!uid) return []
  try {
    const novelListSnap = await getDocs(collection(db, 'users', uid, 'novel_list'))
    const novelEntries = novelListSnap.docs.map(d => ({
      novelId: d.data().novelId || d.id,
      novelTitle: d.data().title || d.data().name || d.id,
    }))

    const allChars = []
    for (const { novelId, novelTitle } of novelEntries) {
      try {
        // 소설 메타데이터(제목 보강용) 한 번 더 시도
        let title = novelTitle
        const novelDoc = await getDoc(doc(db, 'novels', novelId))
        if (novelDoc.exists()) {
          title = novelDoc.data().title || title
        }

        const charsSnap = await getDocs(collection(db, 'novels', novelId, 'characters'))
        for (const cd of charsSnap.docs) {
          const data = cd.data()
          allChars.push(adaptNovelCharacter(cd.id, data, novelId, title))
        }
      } catch (e) {
        console.warn(`[handoff] 소설 ${novelId} 캐릭터 로드 실패:`, e.message)
      }
    }
    return allChars
  } catch (e) {
    console.warn('[handoff] 소설 목록 로드 실패:', e)
    return []
  }
}

// 소설 캐릭터 doc → graffiti JSON 형식
function adaptNovelCharacter(charId, data, novelId, novelTitle) {
  const refs = data.visualId?.references || {}
  const referencesUrls = {}
  for (const [slotKey, slotData] of Object.entries(refs)) {
    // slotData = { url, path, mime, size, ext, uploadedAt } 또는 단순 URL string
    if (typeof slotData === 'string') {
      referencesUrls[slotKey] = slotData
    } else if (slotData && slotData.url) {
      referencesUrls[slotKey] = slotData.url
    }
  }
  return {
    id: charId,
    novelId,
    novelTitle,
    name: data.name || '(이름 없음)',
    source: 'novel',
    role: data.role || null,
    visualId: data.visualId || null,
    references: Object.keys(referencesUrls).length > 0 ? referencesUrls : null,
    sprites: null,
    availableAssetIds: data.availableAssetIds || data.assetIds || [],
  }
}

// ─── 3. 사용자 에셋 로드 (Firestore) ──────────────
export async function loadUserAssets(uid) {
  if (!uid) return []
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'assets'))
    return snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name || '(이름 없음)',
        type: data.type || 'prop',
        description: data.description || '',
        koreanSummary: data.koreanSummary || '',
        referenceImages: (data.referenceImages || []).map(r =>
          typeof r === 'string' ? r : (r?.url || null)
        ).filter(Boolean),
        tags: data.tags || [],
      }
    })
  } catch (e) {
    console.warn('[handoff] 에셋 로드 실패:', e)
    return []
  }
}

// ─── 4. 통합 핸드오프 페이로드 생성 ───────────────
export async function buildHandoffPayload({ currentProject, uid }) {
  const [sheetChar, novelChars, assets] = await Promise.all([
    loadEightSheetCharacter(currentProject),
    loadNovelCharacters(uid),
    loadUserAssets(uid),
  ])

  const characters = []
  if (sheetChar) characters.push(sheetChar)
  characters.push(...novelChars)

  return {
    scene: currentProject ? {
      id: currentProject.id,
      title: currentProject.name,
      characters_appearing: sheetChar ? [sheetChar.id] : [],
    } : null,
    characters,
    assets,
  }
}

// ─── 5. 새 탭에서 도구 열기 ───────────────────────
export function openInStageEditor(payload) {
  if (!payload) return
  try {
    localStorage.setItem('stage_scene_data', JSON.stringify(payload))
    window.open('/stage-editor.html', '_blank')
  } catch (e) {
    alert('Stage Editor 열기 실패: ' + e.message)
  }
}

export function openInQwenViewer(payload, focusCharId = null) {
  if (!payload) return
  try {
    localStorage.setItem('stage_scene_data', JSON.stringify(payload))
    if (focusCharId) localStorage.setItem('qwen_focus_char_id', focusCharId)
    window.open('/qwen-viewer.html', '_blank')
  } catch (e) {
    alert('Qwen Viewer 열기 실패: ' + e.message)
  }
}
