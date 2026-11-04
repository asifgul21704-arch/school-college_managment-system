import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Mail,
  AlertCircle,
  Shield,
  GraduationCap,
  UserCheck,
  Users,
  CheckCircle2,
  Calendar,
  Phone,
  Home,
  User,
  BookOpen,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, establishAuthenticatedSession } from '../services/api';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (role: string) => void;
  initialTab?: 'signin' | 'student-signup' | 'parent-signup';
  initialResetToken?: string | null;
  onClearResetToken?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'signin',
  initialResetToken = null,
  onClearResetToken,
}) => {
  const { login, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'signin' | 'student-signup' | 'parent-signup'>(initialTab);
  const [signinMode, setSigninMode] = useState<'login' | 'forgot' | 'confirm-reset'>(
    initialResetToken ? 'confirm-reset' : 'login'
  );
  const [showPassword, setShowPassword] = useState(false);

  // Sign In & Password Recovery State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetTokenInput, setResetTokenInput] = useState(initialResetToken || '');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // Student Signup State
  const [stdFullName, setStdFullName] = useState('');
  const [stdEmail, setStdEmail] = useState('');
  const [stdPassword, setStdPassword] = useState('');
  const [stdConfirmPassword, setStdConfirmPassword] = useState('');
  const [stdDob, setStdDob] = useState('2010-05-15');
  const [stdGender, setStdGender] = useState<'Male' | 'Female'>('Male');
  const [stdFatherName, setStdFatherName] = useState('');
  const [stdPhone, setStdPhone] = useState('');
  const [stdAddress, setStdAddress] = useState('Paharpur, Dera Ismail Khan');
  const [stdClassName, setStdClassName] = useState('Grade 9 - Matric');
  const [stdSection, setStdSection] = useState('A');

  // Parent Signup State
  const [parFullName, setParFullName] = useState('');
  const [parEmail, setParEmail] = useState('');
  const [parPassword, setParPassword] = useState('');
  const [parConfirmPassword, setParConfirmPassword] = useState('');
  const [parPhone, setParPhone] = useState('');
  const [parAddress, setParAddress] = useState('Paharpur, Dera Ismail Khan');
  const [childAdmNo, setChildAdmNo] = useState('');
  const [childDob, setChildDob] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialResetToken) {
        setActiveTab('signin');
        setSigninMode('confirm-reset');
        setResetTokenInput(initialResetToken);
      } else {
        setActiveTab(initialTab);
        setSigninMode('login');
      }
      setError(null);
      setSuccessNotice(null);
    }
  }, [isOpen, initialTab, initialResetToken]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  // Handle Sign In Submit
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both your registered email address and password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      onSuccess(user.role);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Please verify your email and password.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Student Registration Submit
  const handleStudentSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stdFullName || !stdEmail || !stdPassword || !stdFatherName || !stdClassName) {
      setError('Please complete all required student fields marked with (*).');
      return;
    }

    if (stdPassword !== stdConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (stdPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.registerStudent({
        full_name: stdFullName.trim(),
        email: stdEmail.trim().toLowerCase(),
        password: stdPassword,
        confirm_password: stdConfirmPassword,
        dob: stdDob,
        gender: stdGender,
        father_name: stdFatherName.trim(),
        phone: stdPhone.trim(),
        address: stdAddress.trim(),
        class_name: stdClassName,
        section: stdSection,
      });

      await establishAuthenticatedSession(res.token);
      await refreshUser();
      setSuccessNotice('Student account created. Opening your Student Portal...');
      setTimeout(() => {
        onSuccess('student');
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Student registration failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Parent Registration Submit
  const handleParentSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parFullName || !parEmail || !parPassword) {
      setError('Guardian name, email address, and password are required.');
      return;
    }

    if (parPassword !== parConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (parPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.registerParent({
        full_name: parFullName.trim(),
        email: parEmail.trim().toLowerCase(),
        password: parPassword,
        confirm_password: parConfirmPassword,
        phone: parPhone.trim(),
        address: parAddress.trim(),
        child_admission_no: childAdmNo.trim() || undefined,
        child_dob: childDob.trim() || undefined,
      });

      await establishAuthenticatedSession(res.token);
      await refreshUser();
      setSuccessNotice('Guardian account registered. Opening Parent Portal...');
      setTimeout(() => {
        onSuccess('parent');
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Parent registration failed. Please verify the entered details.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = forgotEmail.trim().toLowerCase();
    if (!targetEmail) {
      setError('Please enter your registered email address.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const res = await api.requestPasswordReset(targetEmail);
      setSuccessNotice(res.message);
    } catch (err: any) {
      setError(err.message || 'Unable to process password reset request.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTokenInput.trim()) {
      setError('Password reset token is missing.');
      return;
    }
    if (resetNewPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('New password and confirmation password do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const res = await api.confirmPasswordReset({
        token: resetTokenInput.trim(),
        new_password: resetNewPassword,
        confirm_password: resetConfirmPassword,
      });
      setResetTokenInput('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      onClearResetToken?.();
      setSigninMode('login');
      setSuccessNotice(res.message);
    } catch (err: any) {
      setError(err.message || 'Unable to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-auth-modal-title"
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-8 shadow-2xl border border-neutral-200 relative my-auto max-h-[92vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Close portal authentication dialog"
          className="absolute top-4 right-4 sm:top-5 sm:right-5 min-h-[36px] min-w-[36px] flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg cursor-pointer transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-5 pr-8">
          <div className="text-[11px] font-semibold text-emerald-800 tracking-wider uppercase mb-1">
            Institutional Portal · Paharpur, D.I. Khan
          </div>
          <h2 id="portal-auth-modal-title" className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
            Shawan School &amp; College
          </h2>
          <p className="text-xs text-neutral-600 mt-1">
            Authorized portal access for students, parents, faculty members, and administration.
          </p>
        </div>

        {/* 320px-safe Segmented Tab Switcher */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-3 gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200 mb-5"
        >
          {[
            { id: 'signin' as const, label: 'Sign In' },
            { id: 'student-signup' as const, label: 'Student Signup' },
            { id: 'parent-signup' as const, label: 'Parent Signup' },
          ].map(tab => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setActiveTab(tab.id);
                  setError(null);
                  setSuccessNotice(null);
                }}
                className={`min-h-[38px] px-2 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer text-center leading-tight ${
                  selected
                    ? 'bg-white text-emerald-950 shadow-2xs border border-neutral-200/80'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Status Alerts */}
        {error && (
          <div
            role="alert"
            className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-5 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successNotice && (
          <div
            role="status"
            className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 mb-5 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* 1. SIGN IN TAB */}
        {activeTab === 'signin' && (
          <div>
            {signinMode === 'login' && (
              <>
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <label htmlFor="signin-email" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                      <input
                        id="signin-email"
                        type="email"
                        autoComplete="email"
                        placeholder="name@shawanschool.edu.pk"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full text-xs py-2.5 pl-9.5 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="signin-password" className="block text-xs font-semibold text-neutral-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(email.trim());
                          setError(null);
                          setSuccessNotice(null);
                          setSigninMode('forgot');
                        }}
                        className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 hover:underline cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                      <input
                        id="signin-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full text-xs py-2.5 pl-9.5 pr-10 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-2 p-1 text-neutral-400 hover:text-neutral-700 rounded cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    {loading ? 'Signing in to Portal...' : 'Sign In to Portal'}
                  </button>
                </form>

                {/* Quick Institutional Role Accounts (Development Only — Stripped from Production Builds) */}
                {import.meta.env.DEV && (
                  <div className="mt-6 pt-5 border-t border-neutral-200">
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2.5 text-center">
                      Quick Role Selection (Demo Credentials)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <button
                        type="button"
                        onClick={() => handleQuickLogin('admin@shawanschool.edu.pk', 'AdminPassword123!')}
                        className="p-2.5 rounded-xl bg-neutral-50 hover:bg-emerald-50 hover:border-emerald-300 border border-neutral-200 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-900">
                          <Shield className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                          <span>Admin</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Principal Office</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleQuickLogin('teacher@shawanschool.edu.pk', 'TeacherPassword123!')}
                        className="p-2.5 rounded-xl bg-neutral-50 hover:bg-emerald-50 hover:border-emerald-300 border border-neutral-200 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-900">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                          <span>Teacher</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Faculty Portal</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleQuickLogin('student@shawanschool.edu.pk', 'StudentPassword123!')}
                        className="p-2.5 rounded-xl bg-neutral-50 hover:bg-emerald-50 hover:border-emerald-300 border border-neutral-200 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-900">
                          <GraduationCap className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                          <span>Student</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Student Portal</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleQuickLogin('parent@shawanschool.edu.pk', 'ParentPassword123!')}
                        className="p-2.5 rounded-xl bg-neutral-50 hover:bg-emerald-50 hover:border-emerald-300 border border-neutral-200 text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-900">
                          <Users className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                          <span>Parent</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Guardian Portal</div>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {signinMode === 'forgot' && (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Enter the email address registered with your portal account. If an active account matches, a single-use password reset link valid for 15 minutes will be sent.
                </p>
                <div>
                  <label htmlFor="forgot-email" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    Registered Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                    <input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@shawanschool.edu.pk"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      className="w-full text-xs py-2.5 pl-9.5 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  {loading ? 'Sending Reset Instructions...' : 'Send Password Reset Link'}
                </button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSuccessNotice(null);
                      setSigninMode('login');
                    }}
                    className="text-xs font-semibold text-neutral-600 hover:text-emerald-900 cursor-pointer"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}

            {signinMode === 'confirm-reset' && (
              <form onSubmit={handleConfirmResetSubmit} className="space-y-4">
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Enter your new portal password below. Completing this reset immediately signs out any previous sessions.
                </p>
                <div>
                  <label htmlFor="reset-new-password" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                    <input
                      id="reset-new-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Minimum 6 characters"
                      value={resetNewPassword}
                      onChange={e => setResetNewPassword(e.target.value)}
                      className="w-full text-xs py-2.5 pl-9.5 pr-10 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-2 p-1 text-neutral-400 hover:text-neutral-700 rounded cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="reset-confirm-password" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                    <input
                      id="reset-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Re-enter new password"
                      value={resetConfirmPassword}
                      onChange={e => setResetConfirmPassword(e.target.value)}
                      className="w-full text-xs py-2.5 pl-9.5 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  {loading ? 'Updating Password...' : 'Confirm New Password'}
                </button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSuccessNotice(null);
                      setResetTokenInput('');
                      onClearResetToken?.();
                      setSigninMode('login');
                    }}
                    className="text-xs font-semibold text-neutral-600 hover:text-emerald-900 cursor-pointer"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* 2. STUDENT SIGNUP TAB */}
        {activeTab === 'student-signup' && (
          <form onSubmit={handleStudentSignup} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="std-fullname" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Student Full Name *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-fullname"
                    type="text"
                    placeholder="e.g. Muhammad Bilal"
                    value={stdFullName}
                    onChange={e => setStdFullName(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="std-father" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Father / Guardian Name *
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-father"
                    type="text"
                    placeholder="e.g. Tariq Mehmood"
                    value={stdFatherName}
                    onChange={e => setStdFatherName(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="std-email" className="block text-xs font-semibold text-neutral-700 mb-1">
                Student Email Address (Portal Login) *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  id="std-email"
                  type="email"
                  placeholder="bilal.student@shawanschool.edu.pk"
                  value={stdEmail}
                  onChange={e => setStdEmail(e.target.value)}
                  className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="std-pass" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-pass"
                    type="password"
                    placeholder="Min 6 characters"
                    value={stdPassword}
                    onChange={e => setStdPassword(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="std-confirm" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Confirm Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-confirm"
                    type="password"
                    placeholder="Re-enter password"
                    value={stdConfirmPassword}
                    onChange={e => setStdConfirmPassword(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="std-dob" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Date of Birth *
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-dob"
                    type="date"
                    value={stdDob}
                    onChange={e => setStdDob(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="std-gender" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Gender *
                </label>
                <select
                  id="std-gender"
                  value={stdGender}
                  onChange={e => setStdGender(e.target.value as 'Male' | 'Female')}
                  className="w-full text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="std-class" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Class / Program *
                </label>
                <div className="relative">
                  <BookOpen className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <select
                    id="std-class"
                    value={stdClassName}
                    onChange={e => setStdClassName(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  >
                    <option value="Playgroup & Nursery">Playgroup &amp; Nursery</option>
                    <option value="Kindergarten (KG)">Kindergarten (KG)</option>
                    <option value="Grade 1 - Primary">Grade 1 - Primary</option>
                    <option value="Grade 5 - Primary">Grade 5 - Primary</option>
                    <option value="Grade 8 - Middle">Grade 8 - Middle</option>
                    <option value="Grade 9 - Matric">Grade 9 - Matric (Science)</option>
                    <option value="Grade 10 - Matric">Grade 10 - Matric (Science)</option>
                    <option value="F.Sc Pre-Medical (Part-I)">F.Sc Pre-Medical</option>
                    <option value="F.Sc Pre-Engineering (Part-I)">F.Sc Pre-Engineering</option>
                    <option value="ICS (Computer Science Part-I)">ICS Computer Science</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="std-section" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Section
                </label>
                <input
                  id="std-section"
                  type="text"
                  placeholder="A"
                  value={stdSection}
                  onChange={e => setStdSection(e.target.value)}
                  className="w-full text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="std-phone" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Phone / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-phone"
                    type="tel"
                    placeholder="+92 300 0000000"
                    value={stdPhone}
                    onChange={e => setStdPhone(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="std-address" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Residential Address
                </label>
                <div className="relative">
                  <Home className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="std-address"
                    type="text"
                    placeholder="Paharpur, Dera Ismail Khan"
                    value={stdAddress}
                    onChange={e => setStdAddress(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer mt-2"
            >
              {loading ? 'Creating Student Account...' : 'Complete Student Registration'}
            </button>
          </form>
        )}

        {/* 3. PARENT SIGNUP TAB */}
        {activeTab === 'parent-signup' && (
          <form onSubmit={handleParentSignup} className="space-y-3.5">
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs text-emerald-950 leading-relaxed">
              <strong>Guardian Portal Access:</strong> Register to monitor your children&apos;s attendance, examination DMC results, fee vouchers, and class timetable.
            </div>

            <div>
              <label htmlFor="par-fullname" className="block text-xs font-semibold text-neutral-700 mb-1">
                Parent / Guardian Full Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  id="par-fullname"
                  type="text"
                  placeholder="e.g. Haji Ghulam Mustafa"
                  value={parFullName}
                  onChange={e => setParFullName(e.target.value)}
                  className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="par-email" className="block text-xs font-semibold text-neutral-700 mb-1">
                Guardian Email Address *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  id="par-email"
                  type="email"
                  placeholder="guardian@example.com"
                  value={parEmail}
                  onChange={e => setParEmail(e.target.value)}
                  className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="par-pass" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="par-pass"
                    type="password"
                    placeholder="Min 6 characters"
                    value={parPassword}
                    onChange={e => setParPassword(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="par-confirm" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Confirm Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="par-confirm"
                    type="password"
                    placeholder="Re-enter password"
                    value={parConfirmPassword}
                    onChange={e => setParConfirmPassword(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="par-phone" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Phone / WhatsApp Contact
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="par-phone"
                    type="tel"
                    placeholder="+92 300 1234567"
                    value={parPhone}
                    onChange={e => setParPhone(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="par-address" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Home Address
                </label>
                <div className="relative">
                  <Home className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    id="par-address"
                    type="text"
                    placeholder="Paharpur, Dera Ismail Khan"
                    value={parAddress}
                    onChange={e => setParAddress(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>
            </div>

            {/* Optional Child Custody Verification */}
            <div className="border-t border-neutral-200 pt-3">
              <span className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider block mb-1">
                Optional Immediate Child Link
              </span>
              <p className="text-[11px] text-neutral-500 mb-2.5">
                You may also link one or more children after signing in from your Parent Portal dashboard.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="par-admno" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Child Admission No
                  </label>
                  <input
                    id="par-admno"
                    type="text"
                    placeholder="e.g. SSC-2026-001"
                    value={childAdmNo}
                    onChange={e => setChildAdmNo(e.target.value)}
                    className="w-full text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div>
                  <label htmlFor="par-childdob" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Child Date of Birth
                  </label>
                  <input
                    id="par-childdob"
                    type="date"
                    value={childDob}
                    onChange={e => setChildDob(e.target.value)}
                    className="w-full text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer mt-2"
            >
              {loading ? 'Registering Guardian Account...' : 'Complete Parent Registration'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
