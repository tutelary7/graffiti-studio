import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Stage3DView v2 — 이미지 평면 + 3D COCO18 스켈레톤 편집기
 *
 * 핵심 개념:
 *  - AI 생성 이미지(혹은 앵커)를 3D 공간에 평면(Plane)으로 띄움
 *  - 그 위에 배우들의 COCO18 스켈레톤을 3D로 오버레이 (z=0 평면 가정)
 *  - 카메라를 돌려서 스켈레톤을 다른 각도에서 확인·편집
 *  - 관절을 3D로 드래그 → 깊이(z)까지 편집 가능 → "기린목" 없는 머리 회전
 *  - 이 편집은 actor.rigData에 저장되어 PosePage와 공유됨
 *
 * 데이터 흐름:
 *  - 입력: actors(COCO18 joints x,y,z 0..100), imageUrl, selectedActorId
 *  - 출력(콜백):
 *      onSelectActor(actorId)
 *      onSelectJoint(actorId, jointId)
 *      onCommitJoint(actorId, jointId, {x,y,z})   - 드래그 종료 시
 *      onSnapshot(blob)                             - 생성용 카메라 스냅샷
 *
 * 좌표계:
 *  - 이미지 평면: z=0, 중앙 (0,0,0)
 *  - 이미지 폭 = IMAGE_W_M, 높이 = IMAGE_W_M * aspect(h/w)
 *  - 다중 배우: N명이면 폭을 N등분해서 배우마다 레인 할당
 *  - 관절 rig 좌표 0..100 → 레인 내부 좌표로 매핑
 */

const IMAGE_W_M = 4.0          // 이미지 평면 폭 (미터)
const DEFAULT_ASPECT = 4 / 3   // 이미지 없을 때 기본
const Z_RANGE_M = 2.0          // 관절 z는 rig 0..100 → -1.0 ~ +1.0 미터

const JOINT_COLORS = {
  nose:       0xff00aa,
  neck:       0xff0055,
  r_shoulder: 0xff0000, l_shoulder: 0x85ff00,
  r_elbow:    0xff8500, l_elbow:    0x00ff00,
  r_wrist:    0xffff00, l_wrist:    0x00ff85,
  r_hip:      0x00ffff, l_hip:      0x8500ff,
  r_knee:     0x0085ff, l_knee:     0xaa00ff,
  r_ankle:    0x0000ff, l_ankle:    0xff00ff,
  r_eye:      0xff00ff, l_eye:      0xff00ff,
  r_ear:      0xff5500, l_ear:      0xff5500,
}
const FACE_JOINTS = new Set(['nose', 'r_eye', 'l_eye', 'r_ear', 'l_ear'])
const SELECTED_JOINT_COLOR = 0xffffff

/** 배우 레인 레이아웃 — N명을 이미지 평면 폭 안에서 수평 분할 */
function getLayout(actorIdx, totalActors, imageW, imageH) {
  const laneW = imageW / Math.max(1, totalActors)
  const x0 = -imageW / 2 + actorIdx * laneW
  const y0 = -imageH / 2
  return { x0, y0, laneW, laneH: imageH }
}

function rigToWorld({ x = 50, y = 50, z = 50 }, layout) {
  return new THREE.Vector3(
    layout.x0 + (x / 100) * layout.laneW,
    layout.y0 + layout.laneH - (y / 100) * layout.laneH,   // y flip (이미지 좌표계)
    (z / 100 - 0.5) * Z_RANGE_M,
  )
}

function worldToRig(world, layout) {
  return {
    x: ((world.x - layout.x0) / layout.laneW) * 100,
    y: ((layout.y0 + layout.laneH - world.y) / layout.laneH) * 100,
    z: (world.z / Z_RANGE_M + 0.5) * 100,
  }
}

/** 두 점 사이를 잇는 얇은 실린더 본 */
function buildBone(posA, posB, color, radius = 0.014) {
  const dir = new THREE.Vector3().subVectors(posB, posA)
  const len = dir.length()
  if (len < 1e-6) return null
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.addVectors(posA, posB).multiplyScalar(0.5)
  const quat = new THREE.Quaternion()
  quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  mesh.quaternion.copy(quat)
  mesh.userData = { kind: 'bone', color }
  return mesh
}

function buildJointSphere(jointId, worldPos, isSelected, isActorSelected) {
  const r = FACE_JOINTS.has(jointId) ? 0.028 : 0.045
  const geo = new THREE.SphereGeometry(r, 16, 12)
  const baseColor = JOINT_COLORS[jointId] ?? 0xff0000
  const mat = new THREE.MeshStandardMaterial({
    color: isSelected ? SELECTED_JOINT_COLOR : baseColor,
    emissive: isSelected ? baseColor : 0x000000,
    emissiveIntensity: isSelected ? 0.5 : 0,
    roughness: 0.3,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(worldPos)
  mesh.userData = {
    kind: 'joint', jointId,
    baseColor,
    interactable: isActorSelected,
  }
  // 선택되지 않은 배우는 관절을 살짝 투명하게
  if (!isActorSelected) {
    mat.transparent = true
    mat.opacity = 0.55
  }
  return mesh
}

/** 텍스트 Sprite (라벨) */
function makeLabel(text, { bg = 'rgba(0,0,0,0.6)', fg = '#fff', size = 256 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size / 2
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = bg
  const r = 14
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r)
  ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r)
  ctx.arcTo(0, canvas.height, 0, 0, r)
  ctx.arcTo(0, 0, canvas.width, 0, r)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = fg
  ctx.font = 'bold 56px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  return new THREE.Sprite(mat)
}

export default function Stage3DView({
  actors = [],
  selectedActorId,
  selectedJointId,
  onSelectActor,
  onSelectJoint,
  onCommitJoint,
  onCommitHeadGroup,    // (actorId, {nose, r_eye, l_eye, r_ear, l_ear}) — 얼굴 5점 일괄 커밋
  imageUrl = null,
  imageAspect = null,
  height = '100%',
  onRendererReady,
}) {
  const mountRef = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const frameRef = useRef(null)

  const imagePlaneRef = useRef(null)        // 앞면 (밝음)
  const imagePlaneBackRef = useRef(null)    // 뒷면 (어둡게 — 그림자 암영)
  const skeletonsGroupRef = useRef(null)
  const jointMeshListRef = useRef([])
  const aspectRef = useRef(imageAspect || DEFAULT_ASPECT)

  // callback refs
  const onSelectActorRef = useRef(onSelectActor)
  const onSelectJointRef = useRef(onSelectJoint)
  const onCommitJointRef = useRef(onCommitJoint)
  const onCommitHeadGroupRef = useRef(onCommitHeadGroup)
  useEffect(() => { onSelectActorRef.current = onSelectActor }, [onSelectActor])
  useEffect(() => { onSelectJointRef.current = onSelectJoint }, [onSelectJoint])
  useEffect(() => { onCommitJointRef.current = onCommitJoint }, [onCommitJoint])
  useEffect(() => { onCommitHeadGroupRef.current = onCommitHeadGroup }, [onCommitHeadGroup])

  // current snapshot refs
  const actorsRef = useRef(actors)
  const selectedActorIdRef = useRef(selectedActorId)
  const selectedJointIdRef = useRef(selectedJointId)
  useEffect(() => { actorsRef.current = actors }, [actors])
  useEffect(() => { selectedActorIdRef.current = selectedActorId }, [selectedActorId])
  useEffect(() => { selectedJointIdRef.current = selectedJointId }, [selectedJointId])

  // ─ 초기화 ─
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x141621)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      45, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 500,
    )
    // 이미지 평면 앞쪽에서 조금 위로
    camera.position.set(0, 0, 6)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 조명 — 이미지 평면이 MeshBasic이라 영향 없지만 스켈레톤 실린더/스피어는 조명 받음
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const key = new THREE.DirectionalLight(0xffffff, 0.8)
    key.position.set(5, 8, 10)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x88aaff, 0.25)
    fill.position.set(-6, 4, -3)
    scene.add(fill)

    // 바닥 그리드 — 큰 원판(가이드). AI 스냅샷에서는 숨김 처리됨.
    const grid = new THREE.GridHelper(20, 20, 0x4a5068, 0x2a2e3a)
    grid.position.y = -2.5
    grid.userData = { kind: 'grid' }
    scene.add(grid)

    // 나침반 — N / W / S / E 스프라이트 (큰 원 둘레)
    const compass = [
      { txt: 'N', pos: new THREE.Vector3( 0, 0, -7) },
      { txt: 'S', pos: new THREE.Vector3( 0, 0,  7) },
      { txt: 'E', pos: new THREE.Vector3( 7, 0,  0) },
      { txt: 'W', pos: new THREE.Vector3(-7, 0,  0) },
    ]
    for (const c of compass) {
      const s = makeLabel(c.txt, { bg: 'rgba(20,30,55,0.85)', fg: '#22d3ee', size: 160 })
      s.scale.set(0.9, 0.45, 1)
      s.position.copy(c.pos)
      s.userData = { kind: 'compass' }
      scene.add(s)
    }

    // 이미지 평면 — 앞면(밝음) / 뒷면(어둡게) 두 장
    // 노트북 아크 방식: 뒷면은 그림자 암영 처리로 "뒤쪽임"을 시각적으로 구분
    const planeGeo = new THREE.PlaneGeometry(IMAGE_W_M, IMAGE_W_M * aspectRef.current)
    const planeMatFront = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.FrontSide, transparent: true, opacity: 1.0,
    })
    const plane = new THREE.Mesh(planeGeo, planeMatFront)
    plane.position.z = 0
    plane.userData = { kind: 'image-plane' }
    scene.add(plane)
    imagePlaneRef.current = plane

    // 뒷면 — 같은 texture지만 어둡게 (0x2a2a35 = 밝기 ~16%)
    const planeMatBack = new THREE.MeshBasicMaterial({
      color: 0x2a2a35, side: THREE.BackSide, transparent: true, opacity: 0.9,
    })
    const planeBack = new THREE.Mesh(planeGeo.clone(), planeMatBack)
    planeBack.position.z = 0
    planeBack.userData = { kind: 'image-plane' }   // hideImage 옵션에 함께 반응
    scene.add(planeBack)
    imagePlaneBackRef.current = planeBack

    // 스켈레톤 컨테이너
    const skeletonsGroup = new THREE.Group()
    skeletonsGroup.userData = { kind: 'skeletons' }
    scene.add(skeletonsGroup)
    skeletonsGroupRef.current = skeletonsGroup

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 1.5
    controls.maxDistance = 30
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

    // ─ 관절 피킹 + 드래그 ─
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const drag = {
      active: false, actorId: null, jointId: null, mesh: null,
      planeNormal: new THREE.Vector3(), planeAnchor: new THREE.Vector3(),
      moved: false,
      // ─ 얼굴 그룹 드래그 (nose 찍으면 얼굴 5점 같이) ─
      isHeadGroup: false,
      headMeshes: [],            // [{mesh, startPos, jointId}]
      startAnchorPos: new THREE.Vector3(),
    }

    function screenToMouse(e) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    }

    function onPointerDown(e) {
      if (e.button !== 0) return
      screenToMouse(e)
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(jointMeshListRef.current, false)
      if (hits.length > 0) {
        const hit = hits[0]
        const data = hit.object.userData
        if (!data?.interactable) {
          const actorId = data?.actorId
          if (actorId) onSelectActorRef.current?.(actorId)
          return
        }
        drag.active = true
        drag.actorId = data.actorId
        drag.jointId = data.jointId
        drag.mesh = hit.object
        drag.moved = false
        drag.planeNormal.copy(camera.getWorldDirection(new THREE.Vector3())).negate()
        drag.planeAnchor.copy(hit.object.position)
        drag.startAnchorPos.copy(hit.object.position)

        // ─ 얼굴 관절(nose/eye/ear) 중 아무거나 잡으면 얼굴 5점 전부 같이 움직이기 ─
        // 노트북 아크의 BONE_HIERARCHY 방식 단순화: r_eye/l_eye/r_ear/l_ear는 nose의 자식 = 머리 그룹
        drag.isHeadGroup = FACE_JOINTS.has(data.jointId)
        drag.headMeshes = []
        if (drag.isHeadGroup) {
          for (const m of jointMeshListRef.current) {
            if (m.userData?.actorId === data.actorId && FACE_JOINTS.has(m.userData?.jointId)) {
              drag.headMeshes.push({
                mesh: m,
                jointId: m.userData.jointId,
                startPos: m.position.clone(),
              })
            }
          }
        }

        controls.enabled = false
        onSelectActorRef.current?.(drag.actorId)
        onSelectJointRef.current?.(drag.actorId, drag.jointId)
      }
    }

    const _dragPlane = new THREE.Plane()
    const _intersect = new THREE.Vector3()

    function onPointerMove(e) {
      if (!drag.active) return
      screenToMouse(e)
      raycaster.setFromCamera(mouse, camera)
      _dragPlane.setFromNormalAndCoplanarPoint(drag.planeNormal, drag.planeAnchor)
      if (raycaster.ray.intersectPlane(_dragPlane, _intersect)) {
        if (drag.isHeadGroup) {
          // 얼굴 5점 일괄 이동 — 델타 계산해서 전부 적용
          const delta = _intersect.clone().sub(drag.startAnchorPos)
          for (const h of drag.headMeshes) {
            h.mesh.position.copy(h.startPos).add(delta)
          }
        } else {
          drag.mesh.position.copy(_intersect)
        }
        drag.moved = true
        rebuildBonesForActor(drag.actorId)
      }
    }

    function onPointerUp(e) {
      if (drag.active) {
        if (drag.moved) {
          const actors = actorsRef.current
          const actorIdx = actors.findIndex(a => a.id === drag.actorId)
          if (actorIdx >= 0) {
            const layout = getLayout(actorIdx, actors.length, IMAGE_W_M, IMAGE_W_M * aspectRef.current)
            if (drag.isHeadGroup && drag.headMeshes.length > 0) {
              // 얼굴 5점 일괄 커밋
              const updates = {}
              for (const h of drag.headMeshes) {
                updates[h.jointId] = worldToRig(h.mesh.position, layout)
              }
              onCommitHeadGroupRef.current?.(drag.actorId, updates)
            } else {
              const rigPos = worldToRig(drag.mesh.position, layout)
              onCommitJointRef.current?.(drag.actorId, drag.jointId, rigPos)
            }
          }
        }
        drag.active = false
        drag.mesh = null
        drag.isHeadGroup = false
        drag.headMeshes = []
        controls.enabled = true
        return
      }
      // 드래그 아닌 클릭 — 빈 공간 → 선택 해제(또는 배우 선택 시도)
      if (e.button !== 0) return
      screenToMouse(e)
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(jointMeshListRef.current, false)
      if (hits.length > 0) {
        const data = hits[0].object.userData
        if (data?.actorId) onSelectActorRef.current?.(data.actorId)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w > 0 && h > 0) {
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    ro.observe(mount)

    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      frameRef.current = requestAnimationFrame(loop)
    }
    loop()

    // 외부에서 스냅샷 찍을 수 있게 ready 콜백
    onRendererReady?.({ renderer, scene, camera })

    return () => {
      cancelAnimationFrame(frameRef.current)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose?.()
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.())
          else obj.material.dispose?.()
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─ 이미지 로드 (앞면 + 뒷면 둘 다 갱신) ─
  useEffect(() => {
    const plane = imagePlaneRef.current
    const planeBack = imagePlaneBackRef.current
    if (!plane || !planeBack) return
    if (!imageUrl) {
      // placeholder
      for (const p of [plane, planeBack]) {
        if (p.material.map) {
          p.material.map.dispose?.()
          p.material.map = null
        }
      }
      plane.material.color.set(0x2a2e3a); plane.material.opacity = 0.9
      planeBack.material.color.set(0x1a1a22); planeBack.material.opacity = 0.9
      plane.material.needsUpdate = true
      planeBack.material.needsUpdate = true
      return
    }
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      imageUrl,
      tex => {
        const oldMapF = plane.material.map
        const oldMapB = planeBack.material.map
        tex.colorSpace = THREE.SRGBColorSpace
        const img = tex.image
        const aspect = (img && img.height && img.width) ? (img.height / img.width) : DEFAULT_ASPECT
        aspectRef.current = aspect
        // geometry — 앞/뒤 둘 다 갱신
        const newGeo = new THREE.PlaneGeometry(IMAGE_W_M, IMAGE_W_M * aspect)
        plane.geometry.dispose(); plane.geometry = newGeo
        planeBack.geometry.dispose(); planeBack.geometry = newGeo.clone()
        // texture 공유 — 앞면: 밝음, 뒷면: 어둡게 (color multiplier로 암영 효과)
        plane.material.map = tex
        plane.material.color.set(0xffffff)
        plane.material.opacity = 1
        plane.material.needsUpdate = true
        planeBack.material.map = tex
        planeBack.material.color.set(0x2a2a35)   // ~16% 밝기 — 뚜렷한 그림자감
        planeBack.material.opacity = 0.92
        planeBack.material.needsUpdate = true
        if (oldMapF && oldMapF !== tex) oldMapF.dispose?.()
        if (oldMapB && oldMapB !== tex && oldMapB !== oldMapF) oldMapB.dispose?.()
        rebuildSkeletons()
      },
      undefined,
      err => console.warn('[Stage3D] 이미지 로드 실패', err),
    )
  }, [imageUrl])

  // ─ 스켈레톤 재구축 (actors / selected 변경 시) ─
  useEffect(() => {
    rebuildSkeletons()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actors, selectedActorId, selectedJointId])

  function rebuildSkeletons() {
    const group = skeletonsGroupRef.current
    if (!group) return
    // 기존 정리
    while (group.children.length) {
      const c = group.children.pop()
      c.traverse?.(o => {
        if (o.geometry) o.geometry.dispose?.()
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.())
          else o.material.dispose?.()
        }
      })
    }
    jointMeshListRef.current = []

    const imageW = IMAGE_W_M
    const imageH = IMAGE_W_M * aspectRef.current
    const N = actorsRef.current.length

    actorsRef.current.forEach((actor, actorIdx) => {
      if (!actor.rigData) return
      const layout = getLayout(actorIdx, N, imageW, imageH)
      const isActorSelected = actor.id === selectedActorIdRef.current
      const actorGroup = new THREE.Group()
      actorGroup.userData = { kind: 'actor-skel', actorId: actor.id }
      group.add(actorGroup)

      // joint world positions
      const jointWorld = {}
      actor.rigData.joints.forEach(j => {
        jointWorld[j.id] = rigToWorld(j, layout)
      })

      // bones 먼저 (joint 뒤에 깔리게)
      actor.rigData.bones.forEach(([fromId, toId, col]) => {
        const a = jointWorld[fromId]; const b = jointWorld[toId]
        if (!a || !b) return
        const color = (typeof col === 'string' && col.startsWith('#'))
          ? parseInt(col.slice(1), 16)
          : 0x888888
        const bone = buildBone(a, b, color, isActorSelected ? 0.016 : 0.010)
        if (bone) {
          if (!isActorSelected) {
            bone.material.transparent = true
            bone.material.opacity = 0.5
          }
          actorGroup.add(bone)
        }
      })

      // joints
      actor.rigData.joints.forEach(j => {
        const pos = jointWorld[j.id]
        const isSel = isActorSelected && j.id === selectedJointIdRef.current
        const mesh = buildJointSphere(j.id, pos, isSel, isActorSelected)
        mesh.userData.actorId = actor.id
        actorGroup.add(mesh)
        jointMeshListRef.current.push(mesh)
      })

      // 배우 이름 라벨 — 이미지 평면 위쪽 바깥(캐릭터 얼굴 가리지 않게)
      // 선택된 배우만 표시. 작게, 이미지 상단 바로 위에.
      if (isActorSelected && jointWorld.nose) {
        const label = makeLabel(actor.name || `배우`, {
          bg: 'rgba(139,92,246,0.9)', fg: '#fff',
        })
        label.scale.set(0.45, 0.18, 1)   // 기존 0.7x0.35 → 훨씬 작게
        // 이미지 평면 바로 위에 (얼굴 위가 아닌 이미지 상단 바깥)
        label.position.set(
          jointWorld.nose.x,
          imageH / 2 + 0.18,             // 이미지 top 위 18cm
          0.05,                          // 평면보다 살짝 앞으로
        )
        label.userData = { kind: 'actor-label', actorId: actor.id }
        actorGroup.add(label)
      }
    })
  }

  /** 드래그 중 실시간 본 재구축 (해당 배우만) — 관절 위치는 mesh에 이미 반영되어 있음 */
  function rebuildBonesForActor(actorId) {
    const group = skeletonsGroupRef.current
    if (!group) return
    const actorGroup = group.children.find(c => c.userData?.actorId === actorId)
    if (!actorGroup) return

    // 현재 관절 메시 맵
    const jointMeshes = {}
    for (const c of actorGroup.children) {
      if (c.userData?.kind === 'joint') jointMeshes[c.userData.jointId] = c
    }
    // 기존 본 제거
    const bones = actorGroup.children.filter(c => c.userData?.kind === 'bone')
    for (const b of bones) {
      actorGroup.remove(b)
      b.geometry?.dispose?.()
      b.material?.dispose?.()
    }
    // 새 본 추가
    const actor = actorsRef.current.find(a => a.id === actorId)
    if (!actor) return
    const isSel = actor.id === selectedActorIdRef.current
    actor.rigData.bones.forEach(([fromId, toId, col]) => {
      const a = jointMeshes[fromId]?.position
      const b = jointMeshes[toId]?.position
      if (!a || !b) return
      const color = (typeof col === 'string' && col.startsWith('#'))
        ? parseInt(col.slice(1), 16) : 0x888888
      const bone = buildBone(a, b, color, isSel ? 0.016 : 0.010)
      if (bone) actorGroup.add(bone)
    })
  }

  // 카메라 리셋 API (외부에서 호출할 수 있게 ref에 노출)
  useEffect(() => {
    if (typeof onRendererReady === 'function') {
      // 아무 것도 안 함 — 위에서 이미 호출됨
    }
  }, [onRendererReady])

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%', height, minHeight: 320,
        background: '#141621', borderRadius: 8, overflow: 'hidden', position: 'relative',
      }}
    >
      {/* 좌상단 경고 배너 — z=0 평면 가정 */}
      <div style={{
        position: 'absolute', left: 10, top: 10, zIndex: 2,
        background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.5)',
        color: '#cbd5e1', fontSize: 11, padding: '6px 10px', borderRadius: 6,
        pointerEvents: 'none', maxWidth: 260,
      }}>
        <div style={{ color: '#a78bfa', fontWeight: 'bold', marginBottom: 2 }}>🦴 3D 스켈레톤 편집</div>
        <div style={{ fontSize: 10, lineHeight: 1.4 }}>
          ⚠ z축(앞뒤 뎁스)은 <b>0평면 가정</b> — 카메라를 돌려 관절을 앞뒤로 드래그하면 깊이 편집
        </div>
      </div>

      {/* 우하단 조작 안내 */}
      <div style={{
        position: 'absolute', right: 10, bottom: 10, zIndex: 2,
        background: 'rgba(0,0,0,0.6)', color: '#cbd5e1', fontSize: 10,
        padding: '5px 9px', borderRadius: 4, pointerEvents: 'none',
        fontFamily: 'monospace',
      }}>
        🖱 드래그=회전 · 우클릭=이동 · 휠=줌 · 관절 드래그=편집
      </div>
    </div>
  )
}
