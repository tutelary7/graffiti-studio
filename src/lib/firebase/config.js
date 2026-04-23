/**
 * Firebase 초기화 — novel-workstation과 같은 프로젝트 사용.
 *
 * 이유: users/{uid}/poseLibrary 컬렉션이 novel-workstation 프로젝트에 이미 있음.
 *       같은 프로젝트를 공유하면 로그인 한 번으로 같은 uid를 받아 기존 스켈레톤 접근 가능.
 *
 * ⚠ Firebase 콘솔에서 이 도메인(localhost:5180)을 Authentication → Authorized domains에 추가 필요.
 */
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            'AIzaSyDVmo7h3hI0zYFICHWUisDy6wcjjisuob4',
  authDomain:        'novel-workstation.firebaseapp.com',
  projectId:         'novel-workstation',
  storageBucket:     'novel-workstation.firebasestorage.app',
  messagingSenderId: '665097005887',
  appId:             '1:665097005887:web:601d03ab43ba60f7c0418a',
  measurementId:     'G-BE9V1FMG2L',
}

// HMR/double-init 방지
const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export default app
