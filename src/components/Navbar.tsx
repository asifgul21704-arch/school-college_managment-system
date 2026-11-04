import React, { useState, useEffect } from 'react';
import { Menu, X, User as UserIcon, Shield, LogOut, GraduationCap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  onOpenLogin: () => void;
  onOpenPortal: () => void;
  onOpenAdmission: () => void;
  currentView: 'public' | 'portal' | 'admin' | 'teacher';
  setCurrentView: (view: 'public' | 'portal' | 'admin' | 'teacher') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenLogin,
  onOpenAdmission,
  currentView,
  setCurrentView,
}) => {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const scrollBehavior = (): ScrollBehavior =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';

  const handleNavClick = (anchorId: string) => {
    if (currentView !== 'public') {
      setCurrentView('public');
      setTimeout(() => {
        const el = document.getElementById(anchorId);
        if (el) el.scrollIntoView({ behavior: scrollBehavior() });
      }, 80);
    } else {
      const el = document.getElementById(anchorId);
      if (el) el.scrollIntoView({ behavior: scrollBehavior() });
    }
    setMobileMenuOpen(false);
  };

  const resolveUserTargetView = (): 'admin' | 'teacher' | 'portal' => {
    if (!user) return 'portal';
    if (['super_admin', 'admin'].includes(user.role)) return 'admin';
    if (user.role === 'teacher') return 'teacher';
    return 'portal';
  };

  const resolvePortalLabel = (): string => {
    if (!user) return 'Portal Login';
    if (['super_admin', 'admin'].includes(user.role)) return 'Admin Console';
    if (user.role === 'teacher') return 'Teacher Portal';
    if (user.role === 'parent') return 'Parent Portal';
    return 'Student Portal';
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-18 flex items-center justify-between gap-3">
        {/* Zone 1: Institutional Wordmark */}
        <button
          type="button"
          onClick={() => {
            setCurrentView('public');
            window.scrollTo({ top: 0, behavior: scrollBehavior() });
            setMobileMenuOpen(false);
          }}
          className="text-left group cursor-pointer min-w-0 shrink"
        >
          <span className="block text-base sm:text-xl lg:text-2xl font-bold tracking-tight text-emerald-950 font-display transition-colors group-hover:text-emerald-800 truncate">
            Shawan School &amp; College
          </span>
        </button>

        {/* Zone 2: Primary Single-Line Navigation Links */}
        <nav
          aria-label="Primary school navigation"
          className="hidden lg:flex items-center gap-5 xl:gap-7 text-xs xl:text-sm font-medium text-neutral-600 shrink-0"
        >
          {[
            { id: 'about', label: 'About' },
            { id: 'academics', label: 'Academics' },
            { id: 'admissions', label: 'Admissions' },
            { id: 'facilities', label: 'Facilities' },
            { id: 'news-events', label: 'Notices & Events' },
            { id: 'contact', label: 'Contact' },
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className="hover:text-emerald-900 transition-colors cursor-pointer py-1.5 whitespace-nowrap"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Desktop Primary Actions */}
        <div className="hidden lg:flex items-center gap-2.5 shrink-0">
          {user ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentView(resolveUserTargetView())}
                className={`min-h-[38px] px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  currentView !== 'public'
                    ? 'bg-emerald-900 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-950 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                {['super_admin', 'admin'].includes(user.role) ? (
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{resolvePortalLabel()}</span>
              </button>

              <button
                type="button"
                onClick={logout}
                title="Sign Out"
                aria-label="Sign out of account"
                className="min-h-[38px] min-w-[38px] p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenLogin}
                className="min-h-[38px] px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
              >
                <UserIcon className="w-3.5 h-3.5 shrink-0" />
                <span>Portal Login</span>
              </button>
              <button
                type="button"
                onClick={onOpenAdmission}
                className="min-h-[38px] px-4 py-2 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              >
                Apply Online
              </button>
            </div>
          )}
        </div>

        {/* Mobile & Tablet Controls (<1024px) */}
        <div className="flex lg:hidden items-center gap-1.5 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => {
                setCurrentView(currentView === 'public' ? resolveUserTargetView() : 'public');
                setMobileMenuOpen(false);
              }}
              className="min-h-[40px] px-3 py-2 text-emerald-950 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              {currentView === 'public' ? resolvePortalLabel() : 'Website'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              className="min-h-[40px] px-2.5 sm:px-3 py-2 text-neutral-700 hover:text-neutral-900 bg-neutral-100 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              Portal
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            className="min-h-[40px] min-w-[40px] p-2 text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg flex items-center justify-center cursor-pointer"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Accessible Mobile & Tablet Drawer */}
      {mobileMenuOpen && (
        <nav
          id="mobile-navigation-drawer"
          aria-label="Mobile navigation"
          className="lg:hidden border-t border-neutral-200 bg-white px-4 pt-3 pb-5 space-y-1 shadow-lg"
        >
          {[
            { id: 'about', label: 'About School & Leadership' },
            { id: 'academics', label: 'Academic Programs & Classes' },
            { id: 'admissions', label: 'Online Admissions & Tracking' },
            { id: 'facilities', label: 'Campus Facilities' },
            { id: 'fees', label: 'Tuition & Fee Schedule' },
            { id: 'news-events', label: 'Notices & School Events' },
            { id: 'gallery', label: 'Campus Gallery' },
            { id: 'contact', label: 'Location & Contact' },
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className="block w-full text-left min-h-[42px] px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-700 hover:text-emerald-950 hover:bg-neutral-50 transition-colors cursor-pointer"
            >
              {item.label}
            </button>
          ))}

          <div className="pt-3 mt-2 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentView(resolveUserTargetView());
                    setMobileMenuOpen(false);
                  }}
                  className="min-h-[44px] w-full py-2.5 px-4 text-xs font-semibold text-center text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer"
                >
                  Open {resolvePortalLabel()}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  className="min-h-[44px] w-full py-2.5 px-4 text-xs font-semibold text-center text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
                >
                  Sign Out ({user.name})
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onOpenLogin();
                    setMobileMenuOpen(false);
                  }}
                  className="min-h-[44px] w-full py-2.5 px-4 text-xs font-semibold text-center text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
                >
                  Portal Login / Register
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenAdmission();
                    setMobileMenuOpen(false);
                  }}
                  className="min-h-[44px] w-full py-2.5 px-4 text-xs font-semibold text-center text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer"
                >
                  Apply for Admission
                </button>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
};
