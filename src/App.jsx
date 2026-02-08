/*
 * App.jsx - Main Application Component (Terminal + Git only)
 *
 * Stripped to essentials for Overleaf integration:
 * - Terminal (Claude CLI via node-pty)
 * - Git panel
 * - Session sidebar
 * - Auto-select project from Overleaf iframe URL
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Settings as SettingsIcon, Sparkles } from 'lucide-react';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import MobileNav from './components/MobileNav';
import Settings from './components/Settings';

import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import { useVersionCheck } from './hooks/useVersionCheck';
import useLocalStorage from './hooks/useLocalStorage';
import { api, authenticatedFetch } from './utils/api';

function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const t = (key) => key;

  const { updateAvailable, latestVersion, currentVersion, releaseInfo } = useVersionCheck('siteboon', 'claudecodeui');

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [activeTab, setActiveTab] = useState('terminal');
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useLocalStorage('sidebarVisible', true);

  const { ws, sendMessage, latestMessage } = useWebSocket();
  const loadingProgressTimeoutRef = useRef(null);

  // Capture Overleaf URL params once on first render.
  // useRef ensures these persist across React Router navigate() calls
  // which would otherwise strip ?project=...&user=... from the URL.
  const overleafParamsRef = useRef(null);
  if (!overleafParamsRef.current) {
    const params = new URLSearchParams(window.location.search);
    overleafParamsRef.current = {
      projectId: params.get('project'),
      userId: params.get('user'),
    };
  }
  const overleafProjectId = overleafParamsRef.current.projectId;
  const overleafUserId = overleafParamsRef.current.userId;
  const isOverleafMode = !!overleafProjectId;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    fetchProjects(true);
  }, []);

  // Auto-select project based on Overleaf ?project= URL parameter
  useEffect(() => {
    if (!overleafProjectId || projects.length === 0) return;
    if (selectedProject) return;

    const resolveAndSelect = async () => {
      try {
        const response = await authenticatedFetch(
          `/api/projects/resolve-overleaf?id=${encodeURIComponent(overleafProjectId)}`
        );
        if (!response.ok) return;
        const { path: resolvedPath } = await response.json();

        let match = projects.find(
          (p) => p.fullPath === resolvedPath || p.path === resolvedPath
        );

        if (!match) {
          try {
            const addResponse = await authenticatedFetch('/api/projects/create-workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspaceType: 'existing', path: resolvedPath }),
            });
            if (addResponse.ok) {
              const { project } = await addResponse.json();
              match = project;
              await fetchProjects();
            }
          } catch {
            // Best-effort
          }
        }

        if (match) {
          setSelectedProject(match);
          setActiveTab('terminal');
        }
      } catch (err) {
        console.warn('Could not resolve Overleaf project:', err);
      }
    };

    resolveAndSelect();
  }, [projects]);

  // Handle WebSocket messages for real-time project updates
  useEffect(() => {
    if (latestMessage) {
      if (latestMessage.type === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }
        setLoadingProgress(latestMessage);
        if (latestMessage.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }
        return;
      }

      if (latestMessage.type === 'projects_updated' || latestMessage.type === 'projects_refresh') {
        // Re-fetch projects for proper per-user isolation
        fetchProjects();
      }
    }

    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, [latestMessage]);

  const fetchProjects = async (showLoading = false) => {
    try {
      if (showLoading) setIsLoadingProjects(true);
      const response = await api.projects();
      const data = await response.json();

      setProjects(prevProjects => {
        if (prevProjects.length === 0) return data;
        const hasChanges = data.some((newProject, index) => {
          const prevProject = prevProjects[index];
          if (!prevProject) return true;
          return (
            newProject.name !== prevProject.name ||
            newProject.displayName !== prevProject.displayName ||
            newProject.fullPath !== prevProject.fullPath ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta) ||
            JSON.stringify(newProject.sessions) !== JSON.stringify(prevProject.sessions)
          );
        }) || data.length !== prevProjects.length;
        return hasChanges ? data : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  window.refreshProjects = fetchProjects;

  // Handle URL-based session loading
  useEffect(() => {
    if (sessionId && projects.length > 0) {
      for (const project of projects) {
        let session = project.sessions?.find(s => s.id === sessionId);
        if (session) {
          setSelectedProject(project);
          setSelectedSession({ ...session, __provider: 'claude' });
          setActiveTab('terminal');
          return;
        }
      }
    }
  }, [sessionId, projects, navigate]);

  const handleProjectSelect = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    navigate('/');
    if (isMobile) setSidebarOpen(false);
  };

  const handleSessionSelect = (session) => {
    setSelectedSession(session);
    if (activeTab !== 'git') setActiveTab('terminal');
    if (isMobile) setSidebarOpen(false);
    navigate(`/session/${session.id}`);
  };

  const handleNewSession = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    setActiveTab('terminal');
    navigate('/');
    if (isMobile) setSidebarOpen(false);
  };

  const handleSessionDelete = (sessionId) => {
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      navigate('/');
    }
    setProjects(prevProjects =>
      prevProjects.map(project => ({
        ...project,
        sessions: project.sessions?.filter(session => session.id !== sessionId) || [],
        sessionMeta: {
          ...project.sessionMeta,
          total: Math.max(0, (project.sessionMeta?.total || 0) - 1)
        }
      }))
    );
  };

  const handleSidebarRefresh = async () => {
    try {
      const response = await api.projects();
      const freshProjects = await response.json();

      setProjects(prevProjects => {
        const hasChanges = freshProjects.some((newProject, index) => {
          const prevProject = prevProjects[index];
          if (!prevProject) return true;
          return (
            newProject.name !== prevProject.name ||
            newProject.displayName !== prevProject.displayName ||
            newProject.fullPath !== prevProject.fullPath ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta) ||
            JSON.stringify(newProject.sessions) !== JSON.stringify(prevProject.sessions)
          );
        }) || freshProjects.length !== prevProjects.length;
        return hasChanges ? freshProjects : prevProjects;
      });

      if (selectedProject) {
        const refreshedProject = freshProjects.find(p => p.name === selectedProject.name);
        if (refreshedProject) {
          if (JSON.stringify(refreshedProject) !== JSON.stringify(selectedProject)) {
            setSelectedProject(refreshedProject);
          }
          if (selectedSession) {
            const refreshedSession = refreshedProject.sessions?.find(s => s.id === selectedSession.id);
            if (refreshedSession && JSON.stringify(refreshedSession) !== JSON.stringify(selectedSession)) {
              setSelectedSession(refreshedSession);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  };

  const handleProjectDelete = (projectName) => {
    if (selectedProject?.name === projectName) {
      setSelectedProject(null);
      setSelectedSession(null);
      navigate('/');
    }
    setProjects(prevProjects =>
      prevProjects.filter(project => project.name !== projectName)
    );
  };

  // In Overleaf mode, only show the current project in the sidebar
  const displayProjects = isOverleafMode && selectedProject
    ? projects.filter(p => p.fullPath === selectedProject.fullPath)
    : projects;

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <div
          className={`h-full flex-shrink-0 border-r border-border bg-card transition-all duration-300 ${
            sidebarVisible ? 'w-80' : 'w-14'
          }`}
        >
          <div className="h-full overflow-hidden">
            {sidebarVisible ? (
              <Sidebar
                projects={displayProjects}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                onProjectSelect={handleProjectSelect}
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                onSessionDelete={handleSessionDelete}
                onProjectDelete={handleProjectDelete}
                isLoading={isLoadingProjects}
                loadingProgress={loadingProgress}
                onRefresh={handleSidebarRefresh}
                onShowSettings={() => setShowSettings(true)}
                updateAvailable={updateAvailable}
                latestVersion={latestVersion}
                currentVersion={currentVersion}
                releaseInfo={releaseInfo}
                isMobile={isMobile}
                onToggleSidebar={() => setSidebarVisible(false)}
              />
            ) : (
              <div className="h-full flex flex-col items-center py-4 gap-4">
                <button
                  onClick={() => setSidebarVisible(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200 group"
                  title="Show sidebar"
                >
                  <svg
                    className="w-5 h-5 text-foreground group-hover:scale-110 transition-transform"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200"
                  title="Settings"
                >
                  <SettingsIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && (
        <div className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
          sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}>
          <button
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border transform transition-transform duration-150 ease-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar
              projects={displayProjects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              onSessionDelete={handleSessionDelete}
              onProjectDelete={handleProjectDelete}
              isLoading={isLoadingProjects}
              loadingProgress={loadingProgress}
              onRefresh={handleSidebarRefresh}
              onShowSettings={() => setShowSettings(true)}
              updateAvailable={updateAvailable}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              releaseInfo={releaseInfo}
              isMobile={isMobile}
              onToggleSidebar={() => setSidebarVisible(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 ${isMobile && !isInputFocused ? 'pb-mobile-nav' : ''}`}>
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}

      {/* Settings Modal */}
      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        projects={projects}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <ProtectedRoute>
            <Router basename={window.__ROUTER_BASENAME__ || ''}>
              <Routes>
                <Route path="/" element={<AppContent />} />
                <Route path="/session/:sessionId" element={<AppContent />} />
              </Routes>
            </Router>
          </ProtectedRoute>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
