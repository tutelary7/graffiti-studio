import { Routes, Route } from 'react-router-dom'
import { ModeProvider } from './context/ModeContext.jsx'
import { ProjectProvider } from './context/ProjectContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import TopBar from './components/TopBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import HomePage from './pages/HomePage.jsx'
import AnchorPage from './pages/AnchorPage.jsx'
import PosePage from './pages/PosePage.jsx'
import StagePage from './pages/StagePage.jsx'
import ScenePage from './pages/ScenePage.jsx'
import SheetPage from './pages/SheetPage.jsx'
import GalleryPage from './pages/GalleryPage.jsx'
import ExportPage from './pages/ExportPage.jsx'
import AssetLibraryPage from './pages/AssetLibraryPage.jsx'

export default function App() {
  return (
    <AuthProvider>
    <ModeProvider>
      <ProjectProvider>
        <div className="app-shell">
          <TopBar />
          <div className="app-body">
            <Sidebar />
            <main className="content">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/anchor" element={<AnchorPage />} />
                <Route path="/pose" element={<PosePage />} />
                <Route path="/stage" element={<StagePage />} />
                <Route path="/scene" element={<ScenePage />} />
                <Route path="/sheet" element={<SheetPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/assets" element={<AssetLibraryPage />} />
                <Route path="/export" element={<ExportPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </ProjectProvider>
    </ModeProvider>
    </AuthProvider>
  )
}
