import React, { useState, useEffect } from 'react';
import {
  User as UserIcon,
  Calendar,
  Clock,
  Award,
  CreditCard,
  Bell,
  Printer,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  FileText,
  UserPlus,
  UserMinus,
  Search,
  Users,
  Check,
  Sparkles,
  Send,
  LogOut,
  ShieldCheck,
  Info,
  MapPin,
  Phone,
  Mail,
  GraduationCap,
  Filter,
  CheckCheck,
  RefreshCw,
  HelpCircle,
  BookOpen,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AiResponseRenderer } from './ui/AiResponseRenderer';
import { Student, AttendanceRecord, FeeRecord, TimetableEntry, ResultRecord, Announcement } from '../types';

interface StudentPortalProps {
  onBackToWebsite: () => void;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({ onBackToWebsite }) => {
  const { user, studentProfile, refreshUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'profile' | 'attendance' | 'timetable' | 'results' | 'fees' | 'notices' | 'notifications' | 'ai'
  >('overview');

  const [student, setStudent] = useState<Student | null>(studentProfile);
  const [linkedStudents, setLinkedStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(user?.linked_id || '');

  // Attendance filters: 'all' | 'month' | 'week' | 'custom'
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'month' | 'week' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Timetable day filter
  const [timetableDayFilter, setTimetableDayFilter] = useState<string>('all');

  // Real MongoDB Notifications state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifLoading, setNotifLoading] = useState<boolean>(false);

  // Portal AI Assistant state
  const [portalAiMessages, setPortalAiMessages] = useState<
    Array<{
      sender: 'user' | 'assistant';
      text: string;
      disambiguationRequired?: boolean;
      candidates?: any[];
      toolUsed?: string;
    }>
  >([
    {
      sender: 'assistant',
      text:
        user?.role === 'parent'
          ? `### Shawan Parent Portal Assistant\n\nAsk questions about verified academic records for your linked children.\n\n* **Attendance:** *"Show my children attendance"* or *"Which of my children have low attendance?"*\n* **Fees & Dues:** *"Which fees are pending?"*\n* **Exam Results:** *"Show my child's latest results"*\n* **Schedule:** *"Show class timetable"*`
          : `### Shawan Student Academic Assistant\n\nAsk questions regarding your personal academic profile, attendance, fees, and class schedule.\n\n* **Attendance:** *"What is my attendance?"* or *"When was I absent?"*\n* **Examination:** *"What are my latest results?"*\n* **Fees:** *"What is my fee balance?"*\n* **Classes:** *"When is my next class?"* or *"Show my timetable"*\n* **Notices:** *"What announcements are there?"*`,
    },
  ]);
  const [portalAiInput, setPortalAiInput] = useState<string>('');
  const [portalAiLoading, setPortalAiLoading] = useState<boolean>(false);

  // Child Linking Modal States
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [fatherName, setFatherName] = useState(user?.name || '');
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  type LinkModalStep = 'search' | 'confirm_single' | 'select_multiple';
  const [linkStep, setLinkStep] = useState<LinkModalStep>('search');
  const [foundStudents, setFoundStudents] = useState<
    Array<{
      id: string;
      full_name: string;
      class_name: string;
      section: string;
      roll_no: string;
    }>
  >([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');

  // Unlink Child Confirmation Modal States
  const [childToUnlink, setChildToUnlink] = useState<Student | null>(null);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [unlinkSuccess, setUnlinkSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!showLinkModal && !childToUnlink) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLinkModal && !linkLoading) {
          setShowLinkModal(false);
          setLinkError(null);
          setLinkStep('search');
        }
        if (childToUnlink && !unlinkLoading) {
          setChildToUnlink(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showLinkModal, childToUnlink, linkLoading, unlinkLoading]);

  const [attendanceData, setAttendanceData] = useState<{ summary: any; records: AttendanceRecord[] } | null>(null);
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalError, setPortalError] = useState<string | null>(null);

  // Print DMC and Fee Challan states
  const [printingResult, setPrintingResult] = useState<ResultRecord | null>(null);
  const [printingFee, setPrintingFee] = useState<FeeRecord | null>(null);

  // Load Real MongoDB Notifications
  const loadNotifications = async () => {
    try {
      setNotifLoading(true);
      const [notifs, unread] = await Promise.all([
        api.getNotifications().catch(() => []),
        api.getUnreadNotificationCount().catch(() => ({ unreadCount: 0 })),
      ]);
      setNotifications(Array.isArray(notifs) ? notifs : []);
      setUnreadCount(typeof unread?.unreadCount === 'number' ? unread.unreadCount : 0);
    } catch (err) {
      console.warn('Could not load notifications:', err);
    } finally {
      setNotifLoading(false);
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.warn('Failed to mark notification read:', err);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Failed to mark all notifications read:', err);
    }
  };

  const loadPortalData = async (targetStudentId: string) => {
    if (!targetStudentId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPortalError(null);
    try {
      const details = await api.getStudentById(targetStudentId);
      setStudent(details.student);
      setFees(details.fees || []);
      setResults(details.results || []);
      setTimetable(details.timetable || []);

      // Attendance summary & records
      try {
        const att = await api.getStudentAttendance(targetStudentId);
        setAttendanceData(att);
      } catch (attErr: any) {
        console.warn('Attendance load notice:', attErr);
        setPortalError(attErr?.message || 'Unable to load attendance summary.');
      }

      // Notices
      try {
        const anns = await api.getAnnouncements({ audience: 'Students' });
        setAnnouncements(anns);
      } catch (annErr) {
        console.warn('Notices load notice:', annErr);
      }

      // Notifications
      await loadNotifications();
    } catch (err: any) {
      console.warn('Student portal details notice:', err);
      setPortalError(err?.message || 'Unable to load student academic records at this time.');
    } finally {
      setLoading(false);
    }
  };

  const loadParentChildren = async () => {
    if (user?.role === 'parent') {
      setPortalError(null);
      try {
        const myKids = await api.getMyStudents();
        setLinkedStudents(myKids);
        if (myKids.length > 0) {
          const target =
            selectedStudentId && myKids.some(k => k.id === selectedStudentId) ? selectedStudentId : myKids[0].id;
          setSelectedStudentId(target);
          await loadPortalData(target);
        } else {
          setStudent(null);
          setLoading(false);
        }
      } catch (e: any) {
        console.warn('Could not load parent children:', e);
        setPortalError(e?.message || 'Unable to load linked children records.');
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (user.role === 'parent') {
      loadParentChildren();
    } else if (user.role === 'student') {
      const targetId = user.linked_id || studentProfile?.id || '';
      if (targetId) {
        setSelectedStudentId(targetId);
        loadPortalData(targetId);
      } else {
        setLoading(false);
      }
    } else {
      // Administrator or faculty inspecting portal
      const targetId = selectedStudentId || 'std_01';
      setSelectedStudentId(targetId);
      loadPortalData(targetId);
    }
  }, [user]);

  const handleSelectChild = (childId: string) => {
    setSelectedStudentId(childId);
    loadPortalData(childId);
  };

  // Find Child for linking
  const handleFindChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fatherName.trim() || !studentName.trim() || !className.trim() || !rollNo.trim()) {
      setLinkError(
        'Please fill in all required verification fields: Father/Guardian Name, Child Name, Class, and Roll Number.'
      );
      return;
    }

    setLinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);

    try {
      const res = await api.findChildToLink({
        father_name: fatherName.trim(),
        student_name: studentName.trim(),
        class_name: className.trim(),
        roll_no: rollNo.trim(),
      });

      if (!res.matches || res.matches.length === 0) {
        setLinkError('Student could not be verified. Please check the information or contact school administration.');
        return;
      }

      setFoundStudents(res.matches);
      if (res.matches.length === 1) {
        setSelectedCandidateId(res.matches[0].id);
        setLinkStep('confirm_single');
      } else {
        setSelectedCandidateId(res.matches[0].id);
        setLinkStep('select_multiple');
      }
    } catch (err: any) {
      setLinkError(
        err.message ||
          'Student could not be verified. Please check the information or contact school administration.'
      );
    } finally {
      setLinkLoading(false);
    }
  };

  // Confirm and Link Child
  const handleConfirmLink = async (targetId?: string) => {
    const studentIdToLink = targetId || selectedCandidateId;
    if (!studentIdToLink) {
      setLinkError('Please select a student to link.');
      return;
    }

    setLinkLoading(true);
    setLinkError(null);

    try {
      const res = await api.confirmLinkChild({
        student_id: studentIdToLink,
        father_name: fatherName.trim(),
      });

      setLinkSuccess(`Successfully linked ${res.student.full_name} to your guardian account!`);
      setLinkedStudents(res.linked_students);
      setSelectedStudentId(res.student.id);
      await loadPortalData(res.student.id);
      await refreshUser();

      setTimeout(() => {
        setShowLinkModal(false);
        setLinkStep('search');
        setLinkSuccess(null);
        setStudentName('');
        setClassName('');
        setRollNo('');
        setFoundStudents([]);
        setSelectedCandidateId('');
      }, 1400);
    } catch (err: any) {
      setLinkError(
        err.message ||
          'Student could not be verified. Please check the information or contact school administration.'
      );
    } finally {
      setLinkLoading(false);
    }
  };

  // Unlink Child
  const handleUnlinkChild = async () => {
    if (!childToUnlink) return;

    setUnlinkLoading(true);
    setUnlinkError(null);

    try {
      const res = await api.unlinkChild(childToUnlink.id);
      setUnlinkSuccess(res.message || `Successfully unlinked ${childToUnlink.full_name}.`);
      setLinkedStudents(res.linked_students);
      await refreshUser();

      if (res.linked_students.length > 0) {
        const nextId = res.active_child_id || res.linked_students[0].id;
        setSelectedStudentId(nextId);
        await loadPortalData(nextId);
      } else {
        setSelectedStudentId('');
        setStudent(null);
      }

      setTimeout(() => {
        setChildToUnlink(null);
        setUnlinkSuccess(null);
      }, 1000);
    } catch (err: any) {
      setUnlinkError(err.message || 'Failed to unlink child.');
    } finally {
      setUnlinkLoading(false);
    }
  };

  // Send query to Portal AI
  const handleSendPortalAi = async (textToSend?: string) => {
    const queryText = (textToSend || portalAiInput).trim();
    if (!queryText || portalAiLoading) return;

    setPortalAiMessages(prev => [...prev, { sender: 'user', text: queryText }]);
    setPortalAiInput('');
    setPortalAiLoading(true);

    try {
      const res = await api.queryPortalAi(queryText);
      setPortalAiMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: res.text,
          disambiguationRequired: res.disambiguationRequired,
          candidates: res.candidates,
          toolUsed: res.toolUsed,
        },
      ]);
    } catch (err: any) {
      setPortalAiMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: err.message || 'An error occurred while querying authorized academic records from the database.',
        },
      ]);
    } finally {
      setPortalAiLoading(false);
    }
  };

  // Filter Attendance Records based on attendanceFilter
  const getFilteredAttendance = () => {
    const allRecords = attendanceData?.records || [];
    if (attendanceFilter === 'all') {
      return allRecords;
    }

    const now = new Date();

    if (attendanceFilter === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      const threshold = sevenDaysAgo.toISOString().split('T')[0];
      return allRecords.filter(r => r.date >= threshold);
    }

    if (attendanceFilter === 'month') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      const threshold = thirtyDaysAgo.toISOString().split('T')[0];
      return allRecords.filter(r => r.date >= threshold);
    }

    if (attendanceFilter === 'custom') {
      return allRecords.filter(r => {
        if (customStartDate && r.date < customStartDate) return false;
        if (customEndDate && r.date > customEndDate) return false;
        return true;
      });
    }

    return allRecords;
  };

  const filteredAttendance = getFilteredAttendance();
  const filteredPresentCount = filteredAttendance.filter(r => r.status === 'Present').length;
  const filteredAbsentCount = filteredAttendance.filter(r => r.status === 'Absent').length;
  const filteredLateCount = filteredAttendance.filter(r => r.status === 'Late').length;
  const filteredLeaveCount = filteredAttendance.filter(r => r.status === 'Leave').length;
  const filteredPercentage =
    filteredAttendance.length > 0
      ? Math.round((filteredPresentCount / filteredAttendance.length) * 100)
      : attendanceData?.summary?.percentage || 100;

  // Filter Timetable by day
  const filteredTimetable =
    timetableDayFilter === 'all'
      ? timetable
      : timetable.filter(t => t.day.toLowerCase() === timetableDayFilter.toLowerCase());

  const handlePrint = () => {
    window.print();
  };

  const handleLogout = () => {
    logout();
    onBackToWebsite();
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 sm:p-8 max-w-md w-full text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-900 font-display">Authentication Required</h2>
            <p className="text-xs text-neutral-600 mt-1">
              Please sign in with an authorized student or guardian account to view academic records.
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToWebsite}
            className="w-full py-2.5 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer"
          >
            ← Back to School Website
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-neutral-600">Loading Verified Institutional Academic Records...</p>
        </div>
      </div>
    );
  }

  // Printable DMC / Report Card View
  if (printingResult && student) {
    return (
      <div className="min-h-screen bg-white p-8 max-w-4xl mx-auto print:p-0">
        <div className="no-print mb-6 flex justify-between items-center pb-4 border-b border-neutral-200">
          <button
            onClick={() => setPrintingResult(null)}
            className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 cursor-pointer"
          >
            ← Back to Portal
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-900 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print Official Result Card</span>
          </button>
        </div>

        {/* Official DMC Template */}
        <div className="border-4 border-emerald-950 p-8 rounded-xl relative">
          <div className="text-center pb-6 border-b-2 border-neutral-300">
            <h1 className="text-2xl font-bold font-display tracking-tight text-emerald-950 uppercase">
              Shawan School and College
            </h1>
            <p className="text-xs text-neutral-600">Rangpur Road, Paharpur, Dera Ismail Khan, Pakistan</p>
            <p className="text-[11px] font-semibold text-emerald-900 mt-1">
              Affiliated with BISE Dera Ismail Khan · Detailed Marks Certificate (DMC)
            </p>
            <h2 className="text-base font-bold text-neutral-900 mt-3 uppercase tracking-wider underline">
              {printingResult.exam_title}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 py-6 text-xs border-b border-neutral-200">
            <div>
              <p>
                Student Name: <strong>{student.full_name}</strong>
              </p>
              <p>
                Father’s Name: <strong>{student.father_name}</strong>
              </p>
              <p>
                Admission No: <strong className="font-mono">{student.admission_no}</strong>
              </p>
            </div>
            <div className="text-right">
              <p>
                Class & Section:{' '}
                <strong>
                  {student.class_name} ({student.section})
                </strong>
              </p>
              <p>
                Roll No: <strong className="font-mono">{student.roll_no}</strong>
              </p>
              <p>
                Issue Date: <strong>{new Date().toLocaleDateString()}</strong>
              </p>
            </div>
          </div>

          <table className="w-full text-xs my-6 border-collapse">
            <thead>
              <tr className="bg-neutral-100 border-y border-neutral-300">
                <th className="py-2 px-3 text-left">Subject</th>
                <th className="py-2 px-3 text-center">Total Marks</th>
                <th className="py-2 px-3 text-center">Marks Obtained</th>
                <th className="py-2 px-3 text-center">Grade</th>
                <th className="py-2 px-3 text-left">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {printingResult.subjects.map((sub, i) => (
                <tr key={`print-sub-${i}-${sub.subject_name}`}>
                  <td className="py-2.5 px-3 font-semibold">{sub.subject_name}</td>
                  <td className="py-2.5 px-3 text-center font-mono">{sub.total_marks}</td>
                  <td className="py-2.5 px-3 text-center font-mono font-bold text-neutral-900">{sub.obtained_marks}</td>
                  <td className="py-2.5 px-3 text-center font-bold">{sub.grade}</td>
                  <td className="py-2.5 px-3 text-neutral-600">
                    {sub.obtained_marks >= sub.total_marks * 0.8 ? 'Excellent' : 'Satisfactory'}
                  </td>
                </tr>
              ))}
              <tr className="bg-neutral-50 font-bold border-t-2 border-neutral-300">
                <td className="py-3 px-3">Aggregate Total</td>
                <td className="py-3 px-3 text-center font-mono">{printingResult.total_marks}</td>
                <td className="py-3 px-3 text-center font-mono text-emerald-950 text-sm">
                  {printingResult.obtained_marks}
                </td>
                <td className="py-3 px-3 text-center text-sm">{printingResult.overall_grade}</td>
                <td className="py-3 px-3">{printingResult.percentage}% Overall</td>
              </tr>
            </tbody>
          </table>

          <div className="bg-neutral-50 p-4 rounded border border-neutral-200 text-xs mb-10">
            <strong>Head Teacher Evaluation:</strong> {printingResult.remarks}
          </div>

          <div className="grid grid-cols-3 gap-6 pt-12 text-center text-xs">
            <div className="border-t border-neutral-400 pt-2 font-semibold">Class Teacher</div>
            <div className="border-t border-neutral-400 pt-2 font-semibold">Exam Controller</div>
            <div className="border-t border-neutral-400 pt-2 font-semibold">Principal Stamp & Signature</div>
          </div>
        </div>
      </div>
    );
  }

  // Printable Fee Challan Voucher View
  if (printingFee && student) {
    return (
      <div className="min-h-screen bg-white p-8 max-w-4xl mx-auto print:p-0">
        <div className="no-print mb-6 flex justify-between items-center pb-4 border-b border-neutral-200">
          <button
            onClick={() => setPrintingFee(null)}
            className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 cursor-pointer"
          >
            ← Back to Portal
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-900 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print Fee Challan / Receipt</span>
          </button>
        </div>

        {/* 2-Copy Bank Challan (Student copy & School Accounts copy) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          {['Student Copy', 'School Accounts Copy'].map((copyType, idx) => (
            <div key={`copy-${copyType}-${idx}`} className="border-2 border-neutral-800 p-5 rounded-lg space-y-4">
              <div className="text-center border-b border-neutral-300 pb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
                  {copyType}
                </span>
                <h2 className="text-sm font-bold font-display text-emerald-950 uppercase">
                  Shawan School and College
                </h2>
                <p className="text-[10px] text-neutral-600">Rangpur Road, Paharpur, DI Khan</p>
                <p className="text-[10px] font-mono text-neutral-500 mt-1">Challan / Receipt: #{printingFee.id}</p>
              </div>

              <div className="space-y-1 text-[11px]">
                <p>
                  Student: <strong>{student.full_name}</strong>
                </p>
                <p>
                  Father: <strong>{student.father_name}</strong>
                </p>
                <p>
                  Admission No: <strong className="font-mono">{student.admission_no}</strong>
                </p>
                <p>
                  Class:{' '}
                  <strong>
                    {student.class_name} ({student.section})
                  </strong>
                </p>
                <p>
                  Fee Month:{' '}
                  <strong>
                    {printingFee.fee_month} {printingFee.year}
                  </strong>
                </p>
                <p>
                  Due Date: <strong>{printingFee.due_date}</strong>
                </p>
              </div>

              <div className="border-t border-b border-neutral-200 py-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Tuition Fee</span>
                  <span className="font-mono">PKR {printingFee.tuition_fee}</span>
                </div>
                {printingFee.other_charges > 0 && (
                  <div className="flex justify-between">
                    <span>Lab / Other Charges</span>
                    <span className="font-mono">PKR {printingFee.other_charges}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-neutral-200">
                  <span>Total Amount</span>
                  <span className="font-mono">PKR {printingFee.total_amount}</span>
                </div>
                <div className="flex justify-between text-emerald-900 font-bold">
                  <span>Paid Amount</span>
                  <span className="font-mono">PKR {printingFee.paid_amount}</span>
                </div>
                <div className="flex justify-between text-rose-900 font-bold">
                  <span>Balance Payable</span>
                  <span className="font-mono">PKR {printingFee.pending_amount}</span>
                </div>
              </div>

              <div className="pt-8 flex justify-between text-[10px] text-neutral-500">
                <span className="border-t border-neutral-300 pt-1">Depositor Signature</span>
                <span className="border-t border-neutral-300 pt-1">Cashier / Bank Officer</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Calculate fee balance for overview
  const totalPendingFee = fees.filter(f => f.status !== 'Paid').reduce((sum, f) => sum + f.pending_amount, 0);

  // Portal tab definitions adhering to Phase 4 specifications
  const portalTabs = [
    { id: 'overview', label: 'Dashboard', icon: UserIcon },
    { id: 'profile', label: 'My Profile', icon: GraduationCap },
    { id: 'attendance', label: 'Attendance', icon: Calendar },
    { id: 'results', label: 'Results', icon: Award },
    { id: 'fees', label: 'Fees', icon: CreditCard },
    { id: 'timetable', label: 'Timetable', icon: Clock },
    { id: 'notices', label: 'Announcements', icon: FileText },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
    { id: 'ai', label: 'AI Assistant', icon: Sparkles },
  ];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-neutral-100 flex flex-col">
      {/* Portal Top Bar */}
      <header className="bg-emerald-950 text-white border-b border-emerald-900 py-2.5 px-3 sm:px-8 flex items-center justify-between gap-2 sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBackToWebsite}
            className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-emerald-900/60 hover:bg-emerald-900 flex items-center gap-1.5 text-xs font-semibold text-emerald-100 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer border border-emerald-800/80"
          >
            <ChevronLeft className="w-4 h-4 shrink-0" />
            <span>Website</span>
          </button>
          <span className="text-emerald-700 hidden sm:inline" aria-hidden="true">|</span>
          <span className="text-sm font-bold font-display tracking-tight text-white truncate hidden sm:inline">
            {user?.role === 'parent' ? 'Shawan Parent & Guardian Portal' : 'Shawan Student Academic Portal'}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-xs shrink-0">
          {/* Quick Notifications Button */}
          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            aria-label={`View notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            className="relative min-h-[38px] min-w-[38px] p-2 text-emerald-200 hover:text-white rounded-xl hover:bg-emerald-900/70 cursor-pointer transition-colors flex items-center justify-center"
            title="View Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-emerald-950" />
            )}
          </button>

          <strong className="text-white hidden md:inline truncate max-w-[160px]">{user?.name}</strong>
          <span className="text-[11px] font-mono uppercase font-semibold text-emerald-200">
            {user?.role}
          </span>

          {/* Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[38px] flex items-center gap-1.5 py-1.5 px-3 bg-emerald-900/80 hover:bg-rose-900 hover:text-white text-emerald-100 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer border border-emerald-800"
            title="Sign out from portal"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main id="main-content" className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1">
        {portalError && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{portalError}</span>
            </div>
            <button
              type="button"
              onClick={() => (user.role === 'parent' ? loadParentChildren() : loadPortalData(selectedStudentId))}
              className="px-3 py-1.5 bg-white hover:bg-rose-100 text-rose-900 border border-rose-200 rounded-lg font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Parent Guardian Section with My Children Selector */}
        {user?.role === 'parent' && (
          <div className="bg-white rounded-2xl p-5 sm:p-6 mb-6 shadow-xs border border-neutral-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-800" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                    Parent / Guardian Portal
                  </span>
                </div>
                <h2 className="text-lg font-bold text-neutral-900 font-display mt-0.5">
                  Linked Children ({linkedStudents.length})
                </h2>
                <p className="text-xs text-neutral-500">
                  Select a child to view their authorized academic attendance, results, fees, timetable, and records.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowLinkModal(true);
                  setLinkStep('search');
                  setLinkError(null);
                  setLinkSuccess(null);
                }}
                className="inline-flex items-center justify-center gap-2 py-2 px-4 bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-colors shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Link Another Child</span>
              </button>
            </div>

            {/* Children Cards List */}
            {linkedStudents.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-4">
                {linkedStudents.map((child, idx) => {
                  const isActive = selectedStudentId === child.id;
                  return (
                    <div
                      key={`linked-student-${child.id || child.admission_no || 'item'}-${idx}`}
                      onClick={() => handleSelectChild(child.id)}
                      className={`relative p-4 rounded-xl border text-left cursor-pointer transition-all ${
                        isActive
                          ? 'border-emerald-800 bg-emerald-50/50 ring-2 ring-emerald-800/20 shadow-xs'
                          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/50 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              isActive ? 'bg-emerald-900 text-white' : 'bg-neutral-100 text-neutral-700'
                            }`}
                          >
                            {idx + 1}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900 font-display">{child.full_name}</h4>
                            <p className="text-xs text-neutral-600 font-medium">
                              Class {child.class_name} {child.section ? `(${child.section})` : ''} - Roll No{' '}
                              {child.roll_no}
                            </p>
                          </div>
                        </div>

                        {isActive && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-900 text-white shrink-0">
                            <Check className="w-3 h-3" /> Active
                          </span>
                        )}
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between text-[11px]">
                        <span className="text-neutral-500 font-mono">Adm #{child.admission_no}</span>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setChildToUnlink(child);
                            setUnlinkError(null);
                            setUnlinkSuccess(null);
                          }}
                          className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 hover:underline cursor-pointer font-medium"
                          title="Unlink child from your guardian account"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          <span>Unlink</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto text-lg font-bold">
                  ℹ
                </div>
                <h3 className="text-sm font-bold text-neutral-900">No Student Profile Linked Yet</h3>
                <p className="text-xs text-neutral-500 max-w-md mx-auto">
                  Click the button below to link your child using Father/Guardian Name, Child Name, Class, and Roll Number.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowLinkModal(true);
                    setLinkStep('search');
                    setLinkError(null);
                  }}
                  className="px-4 py-2 bg-emerald-900 text-white rounded-xl text-xs font-bold hover:bg-emerald-800 cursor-pointer shadow-xs inline-flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Link My Child</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Link Child Modal */}
        {showLinkModal && (
          <div
            className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => {
              if (!linkLoading) {
                setShowLinkModal(false);
                setLinkError(null);
                setLinkStep('search');
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Link child academic record"
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-7 shadow-2xl border border-neutral-200 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                type="button"
                aria-label="Close link child dialog"
                onClick={() => {
                  setShowLinkModal(false);
                  setLinkError(null);
                  setLinkStep('search');
                }}
                className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              {linkStep === 'search' && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <UserPlus className="w-5 h-5 text-emerald-800" />
                    <h3 className="text-lg font-bold font-display text-neutral-900">Link My Child</h3>
                  </div>
                  <p className="text-xs text-neutral-500 mb-5">
                    Enter your guardian and child information below to find and link your child's academic record.
                  </p>

                  {linkError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-4 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{linkError}</span>
                    </div>
                  )}

                  {linkSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{linkSuccess}</span>
                    </div>
                  )}

                  <form onSubmit={handleFindChild} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Father/Guardian Name *</label>
                      <input
                        type="text"
                        placeholder="e.g. Asif or Muhammad Tariq Khan"
                        value={fatherName}
                        onChange={e => setFatherName(e.target.value)}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                      <p className="text-[10px] text-neutral-400 mt-1">
                        Must match the guardian/father name registered in school records.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Child/Student Name *</label>
                      <input
                        type="text"
                        placeholder="e.g. Usman Ghani or Ahmad Khan"
                        value={studentName}
                        onChange={e => setStudentName(e.target.value)}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">Class *</label>
                        <input
                          type="text"
                          placeholder="e.g. Grade 9 or Grade 5"
                          value={className}
                          onChange={e => setClassName(e.target.value)}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">Roll Number *</label>
                        <input
                          type="text"
                          placeholder="e.g. 110 or 12"
                          value={rollNo}
                          onChange={e => setRollNo(e.target.value)}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLinkModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={linkLoading}
                        className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors shadow-xs"
                      >
                        {linkLoading ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Verifying...</span>
                          </>
                        ) : (
                          <>
                            <Search className="w-3.5 h-3.5" />
                            <span>Verify Child</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {linkStep === 'confirm_single' && foundStudents.length === 1 && (
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full mb-3">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Student Verified</span>
                  </div>

                  <h3 className="text-base font-bold font-display text-neutral-900 mb-1">Confirm Student Link</h3>
                  <p className="text-xs text-neutral-500 mb-4">
                    The following student record matches your provided guardian and enrollment details:
                  </p>

                  <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-200 space-y-2 mb-5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Student Name:</span>
                      <strong className="text-neutral-900">{foundStudents[0].full_name}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Class & Section:</span>
                      <strong className="text-neutral-900">
                        {foundStudents[0].class_name} ({foundStudents[0].section})
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Roll Number:</span>
                      <strong className="text-neutral-900 font-mono">{foundStudents[0].roll_no}</strong>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLinkStep('search')}
                      disabled={linkLoading}
                      className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmLink(foundStudents[0].id)}
                      disabled={linkLoading}
                      className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors shadow-xs"
                    >
                      {linkLoading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Linking...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm & Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {linkStep === 'select_multiple' && foundStudents.length > 0 && (
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full mb-3">
                    <span>Multiple Records Found ({foundStudents.length})</span>
                  </div>

                  <h3 className="text-base font-bold font-display text-neutral-900 mb-1">Select Your Child</h3>
                  <p className="text-xs text-neutral-500 mb-4">
                    Multiple students matched your search criteria. Please select the correct child to confirm and link:
                  </p>

                  <div className="space-y-2.5 mb-5 max-h-60 overflow-y-auto">
                    {foundStudents.map((child, idx) => {
                      const isSelected = selectedCandidateId === child.id;
                      return (
                        <div
                          key={`candidate-child-${child.id || child.roll_no || 'item'}-${idx}`}
                          onClick={() => setSelectedCandidateId(child.id)}
                          className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? 'border-emerald-700 bg-emerald-50/60 ring-2 ring-emerald-700/20'
                              : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/50'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-bold text-neutral-900">{child.full_name}</div>
                            <div className="text-[11px] text-neutral-600 mt-0.5">
                              Class: {child.class_name} {child.section ? `(${child.section})` : ''} · Roll No:{' '}
                              {child.roll_no}
                            </div>
                          </div>
                          <input
                            type="radio"
                            name="candidateChild"
                            checked={isSelected}
                            onChange={() => setSelectedCandidateId(child.id)}
                            className="w-4 h-4 text-emerald-900 border-neutral-300 focus:ring-emerald-700 cursor-pointer"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLinkStep('search')}
                      disabled={linkLoading}
                      className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmLink()}
                      disabled={linkLoading || !selectedCandidateId}
                      className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors shadow-xs"
                    >
                      {linkLoading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Linking...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm & Link Selected Child</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unlink Child Confirmation Modal */}
        {childToUnlink && (
          <div
            className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => {
              if (!unlinkLoading) setChildToUnlink(null);
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="unlink-child-title"
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200"
            >
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3">
                <UserMinus className="w-6 h-6" />
              </div>

              <h3 id="unlink-child-title" className="text-base font-bold font-display text-neutral-900 text-center mb-1">
                Unlink Child from Guardian Account
              </h3>

              <p className="text-xs text-neutral-600 text-center mb-4">
                Are you sure you want to unlink <strong className="text-neutral-900">{childToUnlink.full_name}</strong>{' '}
                (Class: {childToUnlink.class_name}, Roll No: {childToUnlink.roll_no}) from your parent account?
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 mb-5">
                <strong>Notice:</strong> This only removes the parent-child relationship from your account. The student's
                institutional record will not be permanently deleted.
              </div>

              {unlinkError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{unlinkError}</span>
                </div>
              )}

              {unlinkSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{unlinkSuccess}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChildToUnlink(null)}
                  disabled={unlinkLoading}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleUnlinkChild}
                  disabled={unlinkLoading}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 transition-colors shadow-xs"
                >
                  {unlinkLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Unlinking...</span>
                    </>
                  ) : (
                    <>
                      <UserMinus className="w-3.5 h-3.5" />
                      <span>Unlink Child</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Student Profile Identity Card */}
        {student ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-7 shadow-xs mb-6 sm:mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-900 text-white font-bold text-2xl flex items-center justify-center shrink-0 shadow-sm">
                {student.full_name ? student.full_name.charAt(0) : 'S'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-neutral-900 font-display">{student.full_name}</h2>
                  <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {student.academic_status || 'Active'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 mt-1">
                  <span>
                    Adm No: <strong className="font-mono text-neutral-800">{student.admission_no}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Roll No: <strong className="font-mono text-neutral-800">{student.roll_no}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Class:{' '}
                    <strong className="text-neutral-800">
                      {student.class_name} ({student.section})
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs text-neutral-600 bg-neutral-50 p-4 rounded-xl border border-neutral-200/80 w-full md:w-auto">
              <div>
                <span className="text-neutral-400 block text-[10px] uppercase font-semibold">Father Name</span>
                <span className="font-semibold text-neutral-900">{student.father_name || 'Not available'}</span>
              </div>
              <div>
                <span className="text-neutral-400 block text-[10px] uppercase font-semibold">Attendance</span>
                <span className="font-bold text-emerald-800 font-mono">
                  {attendanceData?.summary ? `${attendanceData.summary.percentage}%` : 'Not available'}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-neutral-400 block text-[10px] uppercase font-semibold">Fee Status</span>
                <span className="font-bold text-neutral-900">
                  {totalPendingFee === 0 ? (
                    <span className="text-emerald-700">All Cleared</span>
                  ) : (
                    <span className="text-rose-700">Due: PKR {totalPendingFee.toLocaleString()}</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-neutral-500 mb-8">
            <p className="text-sm font-semibold">No active student profile loaded.</p>
            <p className="text-xs mt-1">Please select or link a child to view academic records.</p>
          </div>
        )}

        {/* Portal Module Navigation Tabs (Responsive & Sticky Horizontal Bar) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 sm:mb-8 no-scrollbar scroll-smooth">
          {portalTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-white text-neutral-700 hover:bg-neutral-50 border border-neutral-200'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-neutral-500'}`} />
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500 text-white">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ==================================================== */}
        {/* TAB 1: DASHBOARD (OVERVIEW)                          */}
        {/* ==================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Metric 1: Attendance */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Attendance Rate</span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-emerald-950">
                    {attendanceData?.summary ? `${attendanceData.summary.percentage}%` : 'Not available'}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {attendanceData?.summary
                      ? `${attendanceData.summary.present || 0} Present / ${attendanceData.summary.absent || 0} Absent`
                      : 'Not available in the database.'}
                  </p>
                </div>
              </div>

              {/* Metric 2: Examination Results */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Latest Examination</span>
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-800 flex items-center justify-center">
                    <Award className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-neutral-900">
                    {results.length > 0 ? results[0].overall_grade : 'N/A'}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1 truncate">
                    {results.length > 0
                      ? `${results[0].exam_title} (${results[0].percentage}%)`
                      : 'Not available in the database.'}
                  </p>
                </div>
              </div>

              {/* Metric 3: Fee Balance */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Fee Balance</span>
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div
                    className={`text-2xl font-bold font-mono ${
                      totalPendingFee > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    PKR {totalPendingFee.toLocaleString()}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {totalPendingFee > 0 ? 'Outstanding dues pending' : 'All institutional fees cleared'}
                  </p>
                </div>
              </div>

              {/* Metric 4: Classes Today / Timetable */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Scheduled Periods</span>
                  <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-800 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-neutral-900">{timetable.length} Periods</div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {student ? `Class ${student.class_name} (${student.section})` : 'Weekly schedule'}
                  </p>
                </div>
              </div>
            </div>

            {/* Dashboard 2-Column Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
              {/* Left Column (8 cols): Latest Results + Today Timetable */}
              <div className="lg:col-span-8 space-y-6">
                {/* Latest Examination Assessment Card */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 font-display">
                        Latest Examination Assessment
                      </h3>
                      <p className="text-xs text-neutral-500">Official published evaluation from examination board.</p>
                    </div>
                    {results.length > 0 && (
                      <button
                        onClick={() => setActiveTab('results')}
                        className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                      >
                        View Complete DMC
                      </button>
                    )}
                  </div>

                  {results.length > 0 ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold text-neutral-900 block">{results[0].exam_title}</span>
                          <span className="text-xs text-neutral-500">
                            Aggregate Score: <strong className="font-mono text-neutral-800">{results[0].obtained_marks}/{results[0].total_marks}</strong> · Grade:{' '}
                            <strong className="text-emerald-800">{results[0].overall_grade}</strong> ({results[0].percentage}%)
                          </span>
                          {results[0].remarks && (
                            <p className="text-[11px] text-neutral-600 mt-1 italic">"{results[0].remarks}"</p>
                          )}
                        </div>
                        <button
                          onClick={() => setPrintingResult(results[0])}
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shadow-xs"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print DMC</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-500">
                      Not available in the database.
                    </div>
                  )}
                </div>

                {/* Upcoming Schedule / Timetable Preview */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 font-display">Weekly Timetable Schedule</h3>
                      <p className="text-xs text-neutral-500">Class periods, teachers, and allocated classrooms.</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('timetable')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      View All Days
                    </button>
                  </div>

                  {timetable.length > 0 ? (
                    <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden">
                      {timetable.slice(0, 4).map((tt, idx) => (
                        <div
                          key={`tt-preview-${tt.id || 'item'}-${idx}`}
                          className="p-3.5 bg-neutral-50/50 hover:bg-neutral-50 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-neutral-900 w-20">{tt.day}</span>
                            <div>
                              <span className="font-semibold text-emerald-950 block">{tt.subject}</span>
                              <span className="text-[11px] text-neutral-500">
                                Teacher: {tt.teacher_name} · Room: {tt.room}
                              </span>
                            </div>
                          </div>
                          <span className="font-mono text-neutral-600 bg-white px-2 py-1 rounded border border-neutral-200">
                            {tt.start_time} - {tt.end_time}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-500">
                      Not available in the database.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (4 cols): Recent Circulars & Notifications */}
              <div className="lg:col-span-4 space-y-6">
                {/* Official Announcements */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-neutral-900 font-display">Recent Announcements</h3>
                    <button
                      onClick={() => setActiveTab('notices')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      All Notices
                    </button>
                  </div>

                  {announcements.length > 0 ? (
                    <div className="space-y-3">
                      {announcements.slice(0, 3).map((ann, idx) => (
                        <div key={`ann-preview-${ann.id || 'item'}-${idx}`} className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span className="font-semibold text-emerald-900">{ann.category}</span>
                            <span>{ann.date}</span>
                          </div>
                          <h4 className="text-xs font-bold text-neutral-900 leading-snug">{ann.title}</h4>
                          <p className="text-[11px] text-neutral-600 line-clamp-2">{ann.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500 italic">Not available in the database.</p>
                  )}
                </div>

                {/* Real MongoDB Notifications Preview */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-neutral-900 font-display">System Notifications</h3>
                    <button
                      onClick={() => setActiveTab('notifications')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      View All ({notifications.length})
                    </button>
                  </div>

                  {notifications.length > 0 ? (
                    <div className="space-y-2.5">
                      {notifications.slice(0, 3).map((notif, idx) => (
                        <div
                          key={`notif-preview-${notif.id || notif._id || 'item'}-${idx}`}
                          onClick={() => {
                            if (!notif.read) handleMarkNotificationRead(notif.id || notif._id);
                          }}
                          className={`p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                            notif.read
                              ? 'bg-neutral-50 border-neutral-200 text-neutral-600'
                              : 'bg-emerald-50/60 border-emerald-200 text-neutral-900 font-medium'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] text-neutral-400 mb-1">
                            <span>{notif.category || 'System'}</span>
                            <span>{notif.created_at ? new Date(notif.created_at).toLocaleDateString() : 'Recent'}</span>
                          </div>
                          <div className="font-bold text-neutral-900 text-xs">{notif.title}</div>
                          <div className="text-[11px] text-neutral-600 mt-0.5 line-clamp-2">{notif.message}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500 italic">No notifications found in the database.</p>
                  )}
                </div>

                {/* AI Assistant Quick Trigger */}
                <div className="bg-emerald-950 text-white rounded-2xl p-5 shadow-xs border border-emerald-900 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      Portal Intelligence Assistant
                    </h4>
                  </div>
                  <p className="text-xs text-neutral-200 leading-relaxed">
                    Have questions regarding your fee balance, recent exam marks, attendance records, or class schedule?
                  </p>
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="w-full py-2 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                  >
                    <span>Launch AI Assistant</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: MY PROFILE                                    */}
        {/* ==================================================== */}
        {activeTab === 'profile' && student && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Student Verification Dossier</h3>
                  <p className="text-xs text-neutral-500">
                    Official personal, academic, and guardian records verified by the school administration.
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>Verified Mongoose Database Record</span>
                </div>
              </div>

              {/* Comprehensive Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-xs">
                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Full Name</span>
                  <span className="text-sm font-bold text-neutral-900 block">{student.full_name}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Father / Guardian</span>
                  <span className="text-sm font-bold text-neutral-900 block">{student.father_name}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Admission Number</span>
                  <span className="text-sm font-bold font-mono text-neutral-900 block">{student.admission_no}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Roll Number</span>
                  <span className="text-sm font-bold font-mono text-neutral-900 block">{student.roll_no}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Class & Section</span>
                  <span className="text-sm font-bold text-neutral-900 block">
                    {student.class_name} ({student.section})
                  </span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Academic Status</span>
                  <span className="text-sm font-bold text-emerald-800 block">{student.academic_status}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Date of Birth</span>
                  <span className="font-semibold text-neutral-900 block">{student.dob || 'Not recorded'}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Gender</span>
                  <span className="font-semibold text-neutral-900 block">{student.gender || 'Not recorded'}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Enrollment Date</span>
                  <span className="font-semibold text-neutral-900 block">
                    {student.admission_date || 'Not recorded'}
                  </span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Guardian Contact Phone</span>
                  <span className="font-semibold text-neutral-900 font-mono block">
                    {student.contact_no || 'Not recorded'}
                  </span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Emergency Contact</span>
                  <span className="font-semibold text-neutral-900 font-mono block">
                    {student.emergency_contact || 'Not recorded'}
                  </span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Residential Address</span>
                  <span className="font-semibold text-neutral-900 block">{student.address || 'Not recorded'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: ATTENDANCE                                    */}
        {/* ==================================================== */}
        {activeTab === 'attendance' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">Official Attendance Register</h3>
                <p className="text-xs text-neutral-500">
                  Recorded morning register entries marked by the classroom faculty and headmaster.
                </p>
              </div>
              <div className="text-xs font-semibold px-3 py-1.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg">
                Filtered Rate: {filteredPercentage}% ({filteredPresentCount}/{filteredAttendance.length} days)
              </div>
            </div>

            {/* Attendance Filter Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-neutral-500" />
                <span className="text-xs font-bold text-neutral-700">Filter Range:</span>
                {(['all', 'week', 'month', 'custom'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAttendanceFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      attendanceFilter === f
                        ? 'bg-emerald-900 text-white shadow-xs'
                        : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
                    }`}
                  >
                    {f === 'all' ? 'All Time' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'Custom'}
                  </button>
                ))}
              </div>

              {attendanceFilter === 'custom' && (
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="py-1 px-2 border border-neutral-300 rounded-lg text-xs"
                    placeholder="Start Date"
                  />
                  <span className="text-neutral-400">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="py-1 px-2 border border-neutral-300 rounded-lg text-xs"
                    placeholder="End Date"
                  />
                </div>
              )}
            </div>

            {/* Attendance Metrics Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <span className="text-xs text-emerald-800 font-medium block">Present</span>
                <span className="text-xl font-bold font-mono text-emerald-950">{filteredPresentCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                <span className="text-xs text-rose-800 font-medium block">Absent</span>
                <span className="text-xl font-bold font-mono text-rose-950">{filteredAbsentCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                <span className="text-xs text-amber-800 font-medium block">Late</span>
                <span className="text-xl font-bold font-mono text-amber-950">{filteredLateCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                <span className="text-xs text-blue-800 font-medium block">Leave</span>
                <span className="text-xl font-bold font-mono text-blue-950">{filteredLeaveCount}</span>
              </div>
            </div>

            {/* Attendance Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Class / Section</th>
                    <th className="py-3 px-4">Marked By</th>
                    <th className="py-3 px-4">Remarks / Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {filteredAttendance.length > 0 ? (
                    filteredAttendance.map((rec, idx) => (
                      <tr key={`att-row-${rec.id || rec.date || 'item'}-${idx}`} className="hover:bg-neutral-50">
                        <td className="py-3 px-4 font-mono font-medium text-neutral-900">{rec.date}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              rec.status === 'Present'
                                ? 'bg-emerald-50 text-emerald-800'
                                : rec.status === 'Absent'
                                ? 'bg-rose-50 text-rose-800'
                                : rec.status === 'Late'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-blue-50 text-blue-800'
                            }`}
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-600">
                          {rec.class_name} {rec.section ? `(${rec.section})` : ''}
                        </td>
                        <td className="py-3 px-4 text-neutral-600">{rec.marked_by || 'Headmaster'}</td>
                        <td className="py-3 px-4 text-neutral-500">{rec.remarks || 'Regular daily register entry'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-neutral-500 italic">
                        Not available in the database for the selected date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-neutral-400 italic">
              Note: Attendance records are authoritative institutional registers and cannot be altered by students or parents.
            </p>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 4: RESULTS                                       */}
        {/* ==================================================== */}
        {activeTab === 'results' && (
          <div className="space-y-6">
            {results.length > 0 ? (
              results.map((res, idx) => (
                <div
                  key={`res-card-${res.id || 'item'}-${idx}`}
                  className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                    <div>
                      <h3 className="text-base font-bold text-neutral-900 font-display">{res.exam_title}</h3>
                      <div className="flex items-center gap-2 text-xs text-neutral-500 mt-1">
                        <span>
                          Total Marks:{' '}
                          <strong className="font-mono text-neutral-800">
                            {res.obtained_marks}/{res.total_marks}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Percentage: <strong className="font-mono text-neutral-800">{res.percentage}%</strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Overall Grade: <strong className="text-emerald-800 font-bold">{res.overall_grade}</strong>
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => setPrintingResult(res)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 self-start sm:self-auto cursor-pointer shadow-xs"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Detailed Marks Certificate (DMC)</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                        <tr>
                          <th className="py-2.5 px-4">Subject</th>
                          <th className="py-2.5 px-4 text-center">Max Marks</th>
                          <th className="py-2.5 px-4 text-center">Obtained Marks</th>
                          <th className="py-2.5 px-4 text-center">Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {res.subjects.map((sub, sIdx) => (
                          <tr key={`res-sub-${idx}-${sIdx}-${sub.subject_name}`} className="hover:bg-neutral-50">
                            <td className="py-2.5 px-4 font-semibold text-neutral-900">{sub.subject_name}</td>
                            <td className="py-2.5 px-4 text-center font-mono text-neutral-600">{sub.total_marks}</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-neutral-900">
                              {sub.obtained_marks}
                            </td>
                            <td className="py-2.5 px-4 text-center font-bold text-emerald-900">{sub.grade}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 text-xs">
                    <strong>Faculty Remarks:</strong> {res.remarks || 'Satisfactory academic evaluation.'}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-neutral-500">
                <Award className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-neutral-900">No Examination Results Published</h4>
                <p className="text-xs mt-1">Not available in the database for the current academic session.</p>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 5: FEES                                          */}
        {/* ==================================================== */}
        {activeTab === 'fees' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Fee Vouchers & Payment History</h3>
                  <p className="text-xs text-neutral-500">
                    Official challans, monthly tuition dues, and bank deposit records.
                  </p>
                </div>
                <div
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${
                    totalPendingFee > 0
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {totalPendingFee > 0
                    ? `Total Dues Outstanding: PKR ${totalPendingFee.toLocaleString()}`
                    : 'All Dues Cleared (PKR 0)'}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                    <tr>
                      <th className="py-3 px-4">Fee Month</th>
                      <th className="py-3 px-4">Total Amount</th>
                      <th className="py-3 px-4">Paid Amount</th>
                      <th className="py-3 px-4">Remaining Balance</th>
                      <th className="py-3 px-4">Due Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {fees.length > 0 ? (
                      fees.map((f, idx) => (
                        <tr key={`fee-row-${f.id || 'item'}-${idx}`} className="hover:bg-neutral-50">
                          <td className="py-3 px-4 font-bold text-neutral-900">
                            {f.fee_month} {f.year}
                          </td>
                          <td className="py-3 px-4 font-mono">PKR {f.total_amount.toLocaleString()}</td>
                          <td className="py-3 px-4 font-mono text-emerald-800 font-bold">
                            PKR {f.paid_amount.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 font-mono text-rose-800 font-bold">
                            PKR {f.pending_amount.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-600">{f.due_date}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                f.status === 'Paid'
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : f.status === 'Partial'
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-rose-50 text-rose-800'
                              }`}
                            >
                              {f.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => setPrintingFee(f)}
                              className="px-3 py-1 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md cursor-pointer"
                            >
                              Print Challan Slip
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-neutral-500 italic">
                          Not available in the database.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 6: TIMETABLE                                     */}
        {/* ==================================================== */}
        {activeTab === 'timetable' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">
                  Weekly Class Timetable & Room Allocation
                </h3>
                <p className="text-xs text-neutral-500">
                  Schedule for {student?.class_name} ({student?.section})
                </p>
              </div>

              {/* Day filter selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {['all', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                  <button
                    key={day}
                    onClick={() => setTimetableDayFilter(day)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      timetableDayFilter === day
                        ? 'bg-emerald-900 text-white'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {day === 'all' ? 'All Week' : day.substring(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                  <tr>
                    <th className="py-3 px-4">Day</th>
                    <th className="py-3 px-4">Time Slot</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">Teacher</th>
                    <th className="py-3 px-4">Room / Classroom</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {filteredTimetable.length > 0 ? (
                    filteredTimetable.map((tt, idx) => (
                      <tr key={`tt-row-${tt.id || 'item'}-${idx}`} className="hover:bg-neutral-50">
                        <td className="py-3 px-4 font-bold text-neutral-900">{tt.day}</td>
                        <td className="py-3 px-4 font-mono text-neutral-700">
                          {tt.start_time} - {tt.end_time}
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-950">{tt.subject}</td>
                        <td className="py-3 px-4 text-neutral-600">{tt.teacher_name}</td>
                        <td className="py-3 px-4 text-neutral-500">{tt.room}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-neutral-500 italic">
                        Not available in the database for the selected day.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 7: ANNOUNCEMENTS / NOTICES                       */}
        {/* ==================================================== */}
        {activeTab === 'notices' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-neutral-900 font-display mb-2">Official Student Circulars</h3>
            <p className="text-xs text-neutral-500 mb-4">
              Institutional notices issued by the administration for students and guardians.
            </p>

            <div className="space-y-3">
              {announcements.length > 0 ? (
                announcements.map((ann, idx) => (
                  <div key={`ann-card-${ann.id || 'item'}-${idx}`} className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                      <span className="font-semibold text-emerald-900">{ann.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{ann.date}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Priority: <strong>{ann.priority}</strong>
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-neutral-900">{ann.title}</h4>
                    <p className="text-xs text-neutral-600 leading-relaxed">{ann.content}</p>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-neutral-500 italic">Not available in the database.</div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 8: NOTIFICATIONS (REAL MONGODB)                  */}
        {/* ==================================================== */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">System Notifications</h3>
                <p className="text-xs text-neutral-500">
                  Institutional alerts, fee reminders, and academic notifications stored in MongoDB.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadNotifications}
                  disabled={notifLoading}
                  className="px-3 py-1.5 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${notifLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllNotificationsRead}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Mark All Read</span>
                  </button>
                )}
              </div>
            </div>

            {notifications.length > 0 ? (
              <div className="space-y-3">
                {notifications.map((notif, idx) => (
                  <div
                    key={`notif-card-${notif.id || notif._id || 'item'}-${idx}`}
                    className={`p-4 rounded-xl border transition-all flex items-start justify-between gap-4 ${
                      notif.read ? 'bg-neutral-50 border-neutral-200' : 'bg-emerald-50/50 border-emerald-200 shadow-xs'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                        <span className="font-semibold text-emerald-900">{notif.category || 'Notification'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{notif.created_at ? new Date(notif.created_at).toLocaleString() : 'Recent'}</span>
                        {!notif.read && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-800 text-white">
                            New
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-bold text-neutral-900">{notif.title}</h4>
                      <p className="text-xs text-neutral-600 leading-relaxed">{notif.message}</p>
                    </div>

                    {!notif.read && (
                      <button
                        type="button"
                        onClick={() => handleMarkNotificationRead(notif.id || notif._id)}
                        className="px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 rounded-lg cursor-pointer shrink-0 transition-colors"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-neutral-500 space-y-2">
                <Bell className="w-8 h-8 text-neutral-300 mx-auto" />
                <p className="text-xs font-medium">No notifications found in the database.</p>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 9: PORTAL AI ASSISTANT                           */}
        {/* ==================================================== */}
        {activeTab === 'ai' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-8 shadow-xs space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-900 text-white flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">
                    {user?.role === 'parent' ? 'Parent Portal AI Assistant' : 'Student Academic AI Assistant'}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Grounded in verified institutional records with role-isolated privacy protection.
                  </p>
                </div>
              </div>
            </div>

            {/* Suggested Quick Prompts */}
            <div>
              <span className="text-xs font-semibold text-neutral-500 block mb-2">
                Suggested Inquiries:
              </span>
              <div className="flex flex-wrap gap-2">
                {(user?.role === 'parent'
                  ? [
                      'Show my children attendance',
                      'Which of my children have low attendance?',
                      'Which fees are pending across my children?',
                      'Show latest examination results',
                      'Show class timetable',
                    ]
                  : [
                      'What is my attendance percentage?',
                      'When was I absent?',
                      'What are my latest examination results?',
                      'What is my fee balance?',
                      'When is my next class?',
                      'What announcements are there?',
                    ]
                ).map((prompt, i) => (
                  <button
                    key={`quick-prompt-${i}`}
                    type="button"
                    onClick={() => handleSendPortalAi(prompt)}
                    disabled={portalAiLoading}
                    className="min-h-[34px] px-3 py-1.5 text-xs font-medium bg-neutral-50 hover:bg-emerald-50 text-neutral-700 hover:text-emerald-900 border border-neutral-200 hover:border-emerald-300 rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat History Container */}
            <div className="space-y-4 max-h-[520px] overflow-y-auto p-3 sm:p-5 rounded-2xl bg-neutral-50 border border-neutral-200">
              {portalAiMessages.map((msg, idx) => (
                <div
                  key={`chat-msg-${idx}`}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`${
                      msg.sender === 'user'
                        ? 'max-w-[90%] sm:max-w-[75%] px-4 py-3 rounded-2xl bg-emerald-900 text-white rounded-br-xs text-xs sm:text-sm'
                        : 'w-full sm:max-w-[92%] p-4 sm:p-5 rounded-2xl bg-white border border-neutral-200 text-neutral-800 rounded-bl-xs shadow-2xs space-y-3'
                    }`}
                  >
                    {msg.sender === 'user' ? (
                      <div className="whitespace-pre-wrap leading-relaxed break-words">{msg.text}</div>
                    ) : (
                      <AiResponseRenderer
                        text={msg.text}
                        showStatusBanner={idx > 0}
                        intentLabel={msg.toolUsed}
                      />
                    )}

                    {/* Disambiguation Candidates Selection Cards */}
                    {msg.disambiguationRequired && msg.candidates && msg.candidates.length > 0 && (
                      <div className="pt-3 border-t border-neutral-200 space-y-2">
                        <span className="text-xs font-bold text-amber-900 block">
                          Multiple linked children matched &mdash; select child:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.candidates.map((candidate, cIdx) => (
                            <button
                              key={`candidate-chip-${candidate.id || candidate.admission_no || 'c'}-${cIdx}`}
                              type="button"
                              onClick={() => handleSendPortalAi(`Show records for ${candidate.name}`)}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl text-left text-xs font-bold bg-emerald-50/70 text-emerald-950 border border-emerald-200 hover:bg-emerald-100 cursor-pointer transition-colors"
                            >
                              {candidate.name} <span className="font-normal text-neutral-600">({candidate.class_name})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {portalAiLoading && (
                <div className="flex items-center gap-2 text-xs text-neutral-600 p-2" role="status" aria-live="polite">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-800 animate-spin" />
                  <span>Verifying your academic records...</span>
                </div>
              )}
            </div>

            {/* AI Query Input Bar */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendPortalAi();
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1"
            >
              <label htmlFor="portal-ai-query-input" className="sr-only">
                Ask Portal AI Assistant
              </label>
              <input
                id="portal-ai-query-input"
                type="text"
                value={portalAiInput}
                onChange={e => setPortalAiInput(e.target.value)}
                placeholder={
                  user?.role === 'parent'
                    ? 'Ask about your children attendance, fees, results, or timetable...'
                    : 'Ask about your attendance, fees, marks, or timetable schedule...'
                }
                disabled={portalAiLoading}
                className="flex-1 min-h-[42px] text-xs sm:text-sm py-2.5 px-4 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 bg-white"
              />
              <button
                type="submit"
                disabled={portalAiLoading || !portalAiInput.trim()}
                className="min-h-[42px] px-5 py-2.5 bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask Assistant</span>
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
};
