import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api, buildApiUrl } from './services/api';
import {
  SchoolSettings,
  ClassItem,
  SubjectItem,
  Teacher,
  Announcement,
  SchoolEvent,
  GalleryItem,
} from './types';
import { Navbar } from './components/Navbar';
import { NoticeBanner } from './components/NoticeBanner';
import { HeroSection } from './components/HeroSection';
import { AboutSection } from './components/AboutSection';
import { AcademicsSection } from './components/AcademicsSection';
import { AdmissionsSection } from './components/AdmissionsSection';
import { FacilitiesSection } from './components/FacilitiesSection';
import { TeachersSection } from './components/TeachersSection';
import { FeesSection } from './components/FeesSection';
import { NewsEventsSection } from './components/NewsEventsSection';
import { GallerySection } from './components/GallerySection';
import { ContactLocationSection } from './components/ContactLocationSection';
import { Footer } from './components/Footer';
import { LoginModal } from './components/LoginModal';
import { StudentPortal } from './components/StudentPortal';
import { TeacherPortal } from './components/TeacherPortal';
import { AdminDashboard } from './components/AdminDashboard';

function getScrollBehavior(): ScrollBehavior {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'auto';
  }
  return 'smooth';
}

function SchoolApp() {
  const { user } = useAuth();
  const [currentView, setCurrentView] = useState<'public' | 'portal' | 'admin' | 'teacher'>('public');
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [pendingResetToken, setPendingResetToken] = useState<string | null>(null);
  const [preselectedClass, setPreselectedClass] = useState<string>('Grade 9 - Matric');

  // School Public Data
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchPublicData = async () => {
    setLoading(true);
    setLoadError(null);
    let lastErr: any = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const [sets, cls, subs, tchs, anns, evs, gals] = await Promise.all([
          api.getSettings(),
          api.getClasses(),
          api.getSubjects(),
          api.getTeachers(),
          api.getAnnouncements(),
          api.getEvents(),
          api.getGallery(),
        ]);

        if (!sets || typeof sets !== 'object' || !sets.school_name) {
          throw new Error('Invalid school settings payload received from backend.');
        }

        setSettings(sets);
        setClasses(Array.isArray(cls) ? cls : []);
        setSubjects(Array.isArray(subs) ? subs : []);
        setTeachers(Array.isArray(tchs) ? tchs : []);
        setAnnouncements(Array.isArray(anns) ? anns : []);
        setEvents(Array.isArray(evs) ? evs : []);
        setGallery(Array.isArray(gals) ? gals : []);
        setLoading(false);
        return;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || '');
        const isTransientNetwork =
          err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg);
        if (isTransientNetwork && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        if (attempt === 0 && /temporarily unavailable/i.test(msg)) {
          try {
            const hRes = await fetch(buildApiUrl('/health'), { credentials: 'include' });
            const hJson = await hRes.json().catch(() => null);
            if (hJson?.connected === true || (hJson?.database?.state === 'connecting' && !hJson?.error)) {
              await new Promise(resolve => setTimeout(resolve, 1500));
              continue;
            }
          } catch {
            // Proceed to diagnostic error handling below
          }
        }
        break;
      }
    }

    let detailedMessage =
      'Unable to load school portal data at this moment. Please check your connection and retry.';
    try {
      const healthRes = await fetch(buildApiUrl('/health'), { credentials: 'include' });
      if (healthRes.status === 404 || (lastErr as any)?.status === 404) {
        detailedMessage =
          'Backend API endpoint not found (HTTP 404). If your frontend is hosted on Vercel, please add the VITE_API_BASE_URL environment variable pointing to your Railway backend URL (e.g. https://your-backend.up.railway.app) in Vercel Project Settings, then redeploy.';
      } else {
        const healthData = await healthRes.json().catch(() => null);
        if (healthData && healthData.connected === false) {
          if (healthData.error) {
            const errStr = String(healthData.error).toLowerCase();
            if (errStr.includes('bad auth') || errStr.includes('authentication failed')) {
              detailedMessage = `Database authentication failed (${healthData.error}). Please verify the MongoDB Atlas username and password in Railway environment variables and MongoDB Atlas Database Access.`;
            } else if (errStr.includes('timed out') || errStr.includes('whitelisted') || errStr.includes('network') || errStr.includes('enotfound')) {
              detailedMessage = `MongoDB Atlas network unreachable (${healthData.error}). Please ensure the server IP is allowlisted in MongoDB Atlas Network Access (or allow 0.0.0.0/0 for cloud deployments).`;
            } else {
              detailedMessage = `MongoDB Atlas connection error: ${healthData.error}. Please verify database configuration and retry.`;
            }
          } else {
            detailedMessage =
              'Database connection is currently unavailable or still initializing. Please verify MongoDB Atlas connectivity and retry.';
          }
        } else if (lastErr?.message) {
          detailedMessage = String(lastErr.message);
        }
      }
    } catch {
      if ((lastErr as any)?.status === 404) {
        detailedMessage =
          'Backend API endpoint not found (HTTP 404). If your frontend is hosted on Vercel, please add the VITE_API_BASE_URL environment variable pointing to your Railway backend URL (e.g. https://your-backend.up.railway.app) in Vercel Project Settings, then redeploy.';
      } else if (lastErr?.message) {
        detailedMessage = String(lastErr.message);
      }
    }

    setLoadError(detailedMessage);
    setLoading(false);
  };

  useEffect(() => {
    fetchPublicData();
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const queryToken = searchParams.get('reset_token');
      const hashMatch = window.location.hash.match(/reset_token=([a-fA-F0-9]{64})/);
      const detectedToken =
        queryToken && /^[a-fA-F0-9]{64}$/.test(queryToken.trim())
          ? queryToken.trim()
          : hashMatch
          ? hashMatch[1]
          : null;
      if (detectedToken) {
        setPendingResetToken(detectedToken);
        setLoginModalOpen(true);
        searchParams.delete('reset_token');
        const remainingQuery = searchParams.toString();
        const cleanUrl = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}`;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }
  }, []);

  useEffect(() => {
    if (settings || loading || !loadError) return;
    const pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(buildApiUrl('/health'), { credentials: 'include' });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.connected === true) {
          fetchPublicData();
        }
      } catch {
        // Ignore background poll errors while waiting for database connectivity
      }
    }, 10000);
    return () => window.clearInterval(pollTimer);
  }, [settings, loading, loadError]);

  const scrollToSection = (sectionId: string) => {
    setCurrentView('public');
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: getScrollBehavior() });
    }, 80);
  };

  const handleApplyForClass = (className: string) => {
    setPreselectedClass(className);
    scrollToSection('admissions');
  };

  const handleOpenAdmission = () => {
    scrollToSection('admissions');
  };

  const handleNavigateSection = (sectionId: string) => {
    scrollToSection(sectionId);
  };

  if (loading && !settings) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen bg-neutral-950 flex items-center justify-center p-4"
      >
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <h1 className="text-white text-lg font-bold font-display tracking-tight">
            Shawan School &amp; College
          </h1>
          <p className="text-neutral-400 text-xs">Paharpur, Dera Ismail Khan, Pakistan</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 sm:p-8 max-w-md w-full text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center mx-auto">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 font-display">Shawan School &amp; College</h1>
            <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
              {loadError || 'Unable to connect to the institutional server.'}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchPublicData}
            className="min-h-[40px] px-5 py-2.5 bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Connection</span>
          </button>
        </div>
      </div>
    );
  }

  // Render Student / Parent Portal View
  if (currentView === 'portal') {
    return <StudentPortal onBackToWebsite={() => setCurrentView('public')} />;
  }

  // Render Admin Console View
  if (currentView === 'admin') {
    return (
      <AdminDashboard
        onBackToWebsite={() => setCurrentView('public')}
        onRefreshSiteSettings={fetchPublicData}
      />
    );
  }

  // Render Teacher Portal View
  if (currentView === 'teacher') {
    return <TeacherPortal onBackToWebsite={() => setCurrentView('public')} />;
  }

  // Render Public Website
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-neutral-50 flex flex-col text-neutral-900 selection:bg-emerald-900 selection:text-white">
      {/* Keyboard Accessibility Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-emerald-950 focus:text-white focus:rounded-xl focus:text-xs focus:font-semibold focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Notice Banner */}
      <NoticeBanner
        announcements={announcements}
        onViewNotice={() => handleNavigateSection('news-events')}
      />

      {/* Top Navbar adhering to 3-zone contract */}
      <Navbar
        onOpenLogin={() => setLoginModalOpen(true)}
        onOpenPortal={() => {
          if (!user) {
            setLoginModalOpen(true);
          } else if (['super_admin', 'admin'].includes(user.role)) {
            setCurrentView('admin');
          } else if (user.role === 'teacher') {
            setCurrentView('teacher');
          } else {
            setCurrentView('portal');
          }
        }}
        onOpenAdmission={handleOpenAdmission}
        currentView={currentView}
        setCurrentView={setCurrentView}
      />

      {/* Main Website Sections */}
      <main id="main-content" className="w-full max-w-full overflow-x-clip flex-1">
        {/* 1. Hero */}
        <HeroSection
          settings={settings}
          onApplyClick={handleOpenAdmission}
          onExploreClick={() => handleNavigateSection('about')}
        />

        {/* 2. About & Leadership Message */}
        <AboutSection
          settings={settings}
          onExploreAcademics={() => handleNavigateSection('academics')}
        />

        {/* 3. Academics & Curricula */}
        <AcademicsSection
          classes={classes}
          subjects={subjects}
          onApplyForClass={handleApplyForClass}
        />

        {/* 4. Online Admissions & Tracking */}
        <AdmissionsSection
          classes={classes}
          preselectedClass={preselectedClass}
        />

        {/* 5. Campus Facilities */}
        <FacilitiesSection settings={settings} />

        {/* 6. Faculty & Mentors */}
        <TeachersSection teachers={teachers} />

        {/* 7. Fee Schedule */}
        <FeesSection classes={classes} onOpenAdmission={handleOpenAdmission} />

        {/* 8. News, Circulars & Upcoming Events */}
        <NewsEventsSection announcements={announcements} events={events} />

        {/* 9. Visual Gallery */}
        <GallerySection gallery={gallery} />

        {/* 10. Contact & Verified Google Maps Location */}
        <ContactLocationSection settings={settings} />
      </main>

      {/* Footer */}
      <Footer
        settings={settings}
        onNavigate={handleNavigateSection}
        onOpenPortal={() => {
          if (!user) setLoginModalOpen(true);
          else if (['super_admin', 'admin'].includes(user.role)) setCurrentView('admin');
          else if (user.role === 'teacher') setCurrentView('teacher');
          else setCurrentView('portal');
        }}
      />

      {/* Authentication Modal */}
      <LoginModal
        isOpen={loginModalOpen}
        initialResetToken={pendingResetToken}
        onClearResetToken={() => setPendingResetToken(null)}
        onClose={() => {
          setLoginModalOpen(false);
          setPendingResetToken(null);
        }}
        onSuccess={role => {
          if (['super_admin', 'admin'].includes(role)) {
            setCurrentView('admin');
          } else if (role === 'teacher') {
            setCurrentView('teacher');
          } else {
            setCurrentView('portal');
          }
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SchoolApp />
    </AuthProvider>
  );
}
