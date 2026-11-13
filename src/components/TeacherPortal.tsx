import React, { useState, useEffect } from 'react';
import {
  User as UserIcon,
  Calendar,
  Clock,
  Award,
  BookOpen,
  Bell,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  FileText,
  Users,
  Check,
  Sparkles,
  Send,
  LogOut,
  ShieldCheck,
  Info,
  Filter,
  CheckCheck,
  RefreshCw,
  Search,
  Edit,
  GraduationCap,
  Save,
  X,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  Briefcase,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AiResponseRenderer } from './ui/AiResponseRenderer';
import { Teacher, Student, AttendanceRecord, TimetableEntry, Exam, ResultRecord, Announcement, TeacherTask, HomeworkItem } from '../types';

interface TeacherPortalProps {
  onBackToWebsite: () => void;
}

export const TeacherPortal: React.FC<TeacherPortalProps> = ({ onBackToWebsite }) => {
  const { user, teacherProfile, refreshUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'tasks' | 'homework' | 'profile' | 'classes' | 'students' | 'attendance' | 'marks' | 'timetable' | 'notices' | 'notifications' | 'ai'
  >('overview');

  // Teacher State
  const [teacher, setTeacher] = useState<Teacher | null>(teacherProfile);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [assignedClasses, setAssignedClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedSection, setSelectedSection] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState<string>('');

  // Attendance State
  const [attendanceDate, setAttendanceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<any>(null);
  const [attendanceFilter, setAttendanceFilter] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [markingAttendance, setMarkingAttendance] = useState<boolean>(false);
  const [attendanceRoster, setAttendanceRoster] = useState<Array<{
    student_id: string;
    student_name: string;
    status: 'Present' | 'Absent' | 'Late' | 'Leave';
    remarks: string;
  }>>([]);
  const [attendanceSaveLoading, setAttendanceSaveLoading] = useState<boolean>(false);
  const [attendanceMsg, setAttendanceMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Marks / Results State
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [resultsData, setResultsData] = useState<{ summary: any; results: ResultRecord[] }>({
    summary: null,
    results: [],
  });
  const [showMarksModal, setShowMarksModal] = useState<boolean>(false);
  const [marksForm, setMarksForm] = useState<{
    exam_id: string;
    student_id: string;
    subject_name: string;
    total_marks: number;
    obtained_marks: number;
    remarks: string;
  }>({
    exam_id: '',
    student_id: '',
    subject_name: '',
    total_marks: 100,
    obtained_marks: 0,
    remarks: '',
  });
  const [marksSaveLoading, setMarksSaveLoading] = useState<boolean>(false);
  const [marksMsg, setMarksMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Timetable State
  const [teacherTimetable, setTeacherTimetable] = useState<TimetableEntry[]>([]);
  const [todayDay, setTodayDay] = useState<string>('');
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('all');

  // Announcements & Notifications
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifLoading, setNotifLoading] = useState<boolean>(false);

  // Profile Edit Modal State
  const [showEditProfileModal, setShowEditProfileModal] = useState<boolean>(false);
  const [editBio, setEditBio] = useState<string>('');
  const [editContact, setEditContact] = useState<string>('');
  const [profileSaving, setProfileSaving] = useState<boolean>(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Teacher AI Assistant State
  const [teacherAiMessages, setTeacherAiMessages] = useState<Array<{
    sender: 'user' | 'assistant';
    text: string;
    toolUsed?: string;
    disambiguationRequired?: boolean;
    candidates?: any[];
    requiresConfirmation?: boolean;
    pendingAction?: any;
  }>>([
    {
      sender: 'assistant',
      text: `### Shawan Faculty Academic Assistant\n\nQuery live classroom records for your assigned classes and enrolled students.\n\n* **Classes & Students:** *"What classes do I teach?"* or *"How many students are in my Grade 9 class?"*\n* **Attendance:** *"Which students were absent today?"* or *"Show students with attendance below 75%"*\n* **Schedule:** *"Show my timetable today"* or *"When is my next class?"*\n* **Examination & Marks:** *"Show my students' latest Physics results"* or *"Show class performance"*\n* **Daily Tasks:** *"Show my pending attendance tasks"*`,
    },
  ]);
  const [teacherAiInput, setTeacherAiInput] = useState<string>('');
  const [teacherAiLoading, setTeacherAiLoading] = useState<boolean>(false);
  const [actionExecuting, setActionExecuting] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    if (!markingAttendance && !showMarksModal && !showEditProfileModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (markingAttendance && !attendanceSaveLoading) setMarkingAttendance(false);
        if (showMarksModal && !marksSaveLoading) setShowMarksModal(false);
        if (showEditProfileModal && !profileSaving) setShowEditProfileModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    markingAttendance,
    showMarksModal,
    showEditProfileModal,
    attendanceSaveLoading,
    marksSaveLoading,
    profileSaving,
  ]);

  // Responsibilities & Tasks State
  const [tasks, setTasks] = useState<TeacherTask[]>([]);
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [taskUpdatingId, setTaskUpdatingId] = useState<string | null>(null);

  // Homework State
  const [homeworkList, setHomeworkList] = useState<HomeworkItem[]>([]);
  const [showCreateHomeworkModal, setShowCreateHomeworkModal] = useState<boolean>(false);
  const [homeworkClassFilter, setHomeworkClassFilter] = useState<string>('all');
  const [homeworkForm, setHomeworkForm] = useState({
    title: '',
    description: '',
    class_name: '',
    section: 'A',
    subject: '',
    due_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
    total_marks: 10,
    instructions: '',
  });
  const [homeworkSaveLoading, setHomeworkSaveLoading] = useState<boolean>(false);
  const [homeworkMsg, setHomeworkMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleUpdateTaskStatus = async (taskId: string, newStatus: 'Pending' | 'In Progress' | 'Completed') => {
    setTaskUpdatingId(taskId);
    try {
      const res = await api.updateTeacherTask(taskId, { status: newStatus });
      setTasks(prev => prev.map(t => (t.task_id === taskId || t.id === taskId ? res.task : t)));
    } catch {
      // safe fallback
    } finally {
      setTaskUpdatingId(null);
    }
  };

  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeworkForm.title.trim() || !homeworkForm.class_name || !homeworkForm.subject || !homeworkForm.due_date) {
      setHomeworkMsg({ type: 'error', text: 'Please fill all required homework fields.' });
      return;
    }
    setHomeworkSaveLoading(true);
    setHomeworkMsg(null);
    try {
      const res = await api.createTeacherHomework({
        title: homeworkForm.title.trim(),
        description: homeworkForm.description.trim() || homeworkForm.title.trim(),
        class_name: homeworkForm.class_name,
        section: homeworkForm.section || 'A',
        subject: homeworkForm.subject,
        due_date: homeworkForm.due_date,
        total_marks: Number(homeworkForm.total_marks) || 10,
        instructions: homeworkForm.instructions.trim(),
      });
      setHomeworkList(prev => [res.homework, ...prev]);
      setShowCreateHomeworkModal(false);
      setHomeworkMsg({ type: 'success', text: 'Homework assigned to students successfully!' });
      setHomeworkForm({
        title: '',
        description: '',
        class_name: assignedClasses[0]?.name || '',
        section: 'A',
        subject: teacher?.subject || '',
        due_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
        total_marks: 10,
        instructions: '',
      });
    } catch (err: any) {
      setHomeworkMsg({ type: 'error', text: err?.message || 'Failed to post homework assignment.' });
    } finally {
      setHomeworkSaveLoading(false);
    }
  };

  const handleDeleteHomework = async (hwId: string) => {
    try {
      await api.deleteTeacherHomework(hwId);
      setHomeworkList(prev => prev.filter(h => h.homework_id !== hwId && h.id !== hwId));
    } catch {
      // safe fallback
    }
  };

  // 1. Initial Load of Teacher Dashboard and Academic Data
  const loadInitialData = async () => {
    if (!user || !['teacher', 'admin', 'super_admin'].includes(user.role)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setPortalError(null);
    try {
      const [dashRes, profRes, classes, ttable, exms, anns, notifs, unread, taskRes, hwkRes] = await Promise.all([
        api.getTeacherDashboard().then(v => ({ ok: true as const, v })).catch((e: any) => ({ ok: false as const, e })),
        api.getTeacherProfile().then(v => ({ ok: true as const, v })).catch((e: any) => ({ ok: false as const, e })),
        api.getTeacherClasses().catch(() => []),
        api.getTeacherTimetable().catch(() => ({ today: '', timetable: [] })),
        api.getTeacherExams().catch(() => []),
        api.getAnnouncements({ audience: 'Teachers' }).catch(() => []),
        api.getNotifications().catch(() => []),
        api.getUnreadNotificationCount().catch(() => ({ unreadCount: 0 })),
        api.getTeacherTasks().catch(() => ({ tasks: [] })),
        api.getTeacherHomework().catch(() => ({ homework: [] })),
      ]);

      const dash = dashRes.ok ? dashRes.v : null;
      const prof = profRes.ok ? profRes.v : null;

      if (!dashRes.ok && !profRes.ok) {
        setPortalError(dashRes.e?.message || profRes.e?.message || 'Unable to load faculty portal data.');
      }

      if (dash) {
        setDashboardData(dash);
        setTeacher(dash.teacher || prof);
        if (dash.assignedClasses && dash.assignedClasses.length > 0) {
          setSelectedClass(dash.assignedClasses[0]);
        }
      } else if (prof) {
        setTeacher(prof);
        if (prof.classes && prof.classes.length > 0) {
          setSelectedClass(prof.classes[0]);
        }
      }

      setAssignedClasses(classes || []);
      setTeacherTimetable(ttable.timetable || []);
      setTodayDay(ttable.today || '');
      setExams(exms || []);
      if (exms && exms.length > 0) {
        setSelectedExamId(exms[0].id);
      }
      setAnnouncements(anns || []);
      setNotifications(notifs || []);
      setUnreadCount(unread.unreadCount || 0);
      setTasks(taskRes?.tasks || dash?.tasks || []);
      setHomeworkList(hwkRes?.homework || []);

      // Load initial students for the default selected class
      const targetClass = dash?.assignedClasses?.[0] || prof?.classes?.[0];
      if (targetClass) {
        loadStudents(targetClass);
        loadAttendance(targetClass);
        loadResults(targetClass);
      }
    } catch (err: any) {
      console.warn('Teacher portal initial load notice:', err);
      setPortalError(err?.message || 'Unable to load teacher portal data.');
    } finally {
      setLoading(false);
    }
  };

  const loadStudents = async (className?: string) => {
    try {
      const stdList = await api.getTeacherStudents({
        class_name: className || selectedClass,
        section: selectedSection,
        search: studentSearch,
      });
      setStudents(stdList || []);
    } catch (err) {
      console.warn('Could not load teacher students:', err);
    }
  };

  const loadAttendance = async (className?: string) => {
    try {
      const att = await api.getTeacherAttendance({
        class_name: className || selectedClass,
        section: selectedSection,
        filter: attendanceFilter,
        date: attendanceFilter === 'today' ? attendanceDate : undefined,
        start_date: customStartDate,
        end_date: customEndDate,
      });
      setAttendanceRecords(att.records || []);
      setAttendanceSummary(att.summary || null);
    } catch (err: any) {
      console.warn('Could not load teacher attendance:', err);
      setAttendanceMsg({ type: 'error', text: err?.message || 'Failed to load class attendance records.' });
    }
  };

  const loadResults = async (className?: string, examId?: string) => {
    try {
      const res = await api.getTeacherResults({
        class_name: className || selectedClass,
        exam_id: examId || selectedExamId,
      });
      setResultsData(res);
    } catch (err: any) {
      console.warn('Could not load teacher results:', err);
      setMarksMsg({ type: 'error', text: err?.message || 'Failed to load class examination results.' });
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [user]);

  // When selected class changes, refresh students, attendance, and results
  const handleClassChange = (newClass: string) => {
    setSelectedClass(newClass);
    loadStudents(newClass);
    loadAttendance(newClass);
    loadResults(newClass);
  };

  // Setup Attendance Marking Roster
  const handleOpenMarkAttendance = () => {
    const roster = students.map(s => ({
      student_id: s.id,
      student_name: s.full_name,
      status: 'Present' as const,
      remarks: '',
    }));
    setAttendanceRoster(roster);
    setMarkingAttendance(true);
    setAttendanceMsg(null);
  };

  const handleUpdateRosterStatus = (studentId: string, status: 'Present' | 'Absent' | 'Late' | 'Leave') => {
    setAttendanceRoster(prev =>
      prev.map(r => (r.student_id === studentId ? { ...r, status } : r))
    );
  };

  const handleMarkAllRoster = (status: 'Present' | 'Absent') => {
    setAttendanceRoster(prev => prev.map(r => ({ ...r, status })));
  };

  const handleSaveAttendance = async () => {
    if (!selectedClass || attendanceRoster.length === 0) return;
    setAttendanceSaveLoading(true);
    setAttendanceMsg(null);
    try {
      const res = await api.saveTeacherAttendance({
        date: attendanceDate,
        class_name: selectedClass,
        section: selectedSection || 'A',
        records: attendanceRoster,
      });
      setAttendanceMsg({ type: 'success', text: res.message });
      setMarkingAttendance(false);
      loadAttendance(selectedClass);
      // Refresh dashboard to update pending tasks
      api.getTeacherDashboard().then(dash => setDashboardData(dash)).catch(() => {});
    } catch (err: any) {
      setAttendanceMsg({ type: 'error', text: err.message || 'Failed to save attendance.' });
    } finally {
      setAttendanceSaveLoading(false);
    }
  };

  // Open Marks Modal for a Student
  const handleOpenMarksModal = (student?: any) => {
    setMarksForm({
      exam_id: selectedExamId || (exams[0]?.id || 'ex_term1'),
      student_id: student?.id || (students[0]?.id || ''),
      subject_name: teacher?.subject || 'Physics',
      total_marks: 100,
      obtained_marks: 75,
      remarks: '',
    });
    setMarksMsg(null);
    setShowMarksModal(true);
  };

  const handleSaveMarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marksForm.student_id || !marksForm.exam_id) return;
    setMarksSaveLoading(true);
    setMarksMsg(null);
    try {
      const examTitle = exams.find(e => e.id === marksForm.exam_id)?.title || 'Term Assessment';
      const res = await api.saveTeacherResults({
        ...marksForm,
        exam_title: examTitle,
      });
      setMarksMsg({ type: 'success', text: res.message });
      setTimeout(() => {
        setShowMarksModal(false);
        setMarksMsg(null);
      }, 1200);
      loadResults(selectedClass);
    } catch (err: any) {
      setMarksMsg({ type: 'error', text: err.message || 'Failed to record marks.' });
    } finally {
      setMarksSaveLoading(false);
    }
  };

  // Profile Edit
  const handleOpenEditProfile = () => {
    setEditBio(teacher?.bio || '');
    setEditContact(teacher?.contact_no || '');
    setProfileMsg(null);
    setShowEditProfileModal(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await api.updateTeacherProfile({
        bio: editBio,
        contact_no: editContact,
      });
      setTeacher(res.teacher);
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
      setTimeout(() => {
        setShowEditProfileModal(false);
        setProfileMsg(null);
      }, 1000);
      refreshUser();
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile.' });
    } finally {
      setProfileSaving(false);
    }
  };

  // Notifications
  const handleMarkNotifRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.warn('Mark notif read notice:', err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Mark all notifs read notice:', err);
    }
  };

  // Send Query to Teacher AI Assistant
  const handleSendTeacherAi = async (promptToSend?: string) => {
    const query = (promptToSend || teacherAiInput).trim();
    if (!query || teacherAiLoading) return;

    setTeacherAiMessages(prev => [...prev, { sender: 'user', text: query }]);
    setTeacherAiInput('');
    setTeacherAiLoading(true);

    try {
      const res = await api.queryTeacherAi(query);
      setTeacherAiMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: res.text,
          toolUsed: res.toolUsed,
          disambiguationRequired: res.disambiguationRequired,
          candidates: res.candidates,
          requiresConfirmation: res.requiresConfirmation,
          pendingAction: res.pendingAction,
        },
      ]);
    } catch (err: any) {
      setTeacherAiMessages(prev => [
        ...prev,
        {
          sender: 'assistant',
          text: err.message || 'An error occurred while querying authorized academic records from MongoDB.',
        },
      ]);
    } finally {
      setTeacherAiLoading(false);
    }
  };

  // Execute Sensitive Teacher Action via AI Confirmation
  const handleExecutePendingAction = async (msgIndex: number, pendingAction: any) => {
    setActionExecuting(true);
    try {
      const res = await api.executeTeacherAiAction(pendingAction.actionType, pendingAction.payload, true);
      setTeacherAiMessages(prev =>
        prev.map((m, idx) =>
          idx === msgIndex
            ? {
                ...m,
                requiresConfirmation: false,
                text: `${m.text}\n\n✅ **Action Confirmed & Executed:** ${res.message}`,
              }
            : m
        )
      );
      // Refresh relevant data
      loadAttendance(selectedClass);
      loadResults(selectedClass);
    } catch (err: any) {
      setTeacherAiMessages(prev =>
        prev.map((m, idx) =>
          idx === msgIndex
            ? {
                ...m,
                text: `${m.text}\n\n❌ **Execution Error:** ${err.message || 'Failed to execute action.'}`,
              }
            : m
        )
      );
    } finally {
      setActionExecuting(false);
    }
  };

  const handleLogout = () => {
    logout();
    onBackToWebsite();
  };

  if (!user || !['teacher', 'admin', 'super_admin'].includes(user.role)) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 sm:p-8 max-w-md w-full text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-900 font-display">Faculty Authorization Required</h2>
            <p className="text-xs text-neutral-600 mt-1">
              {user
                ? `Your account (${user.role}) does not have faculty portal permissions.`
                : 'Please sign in with an authorized faculty account to access classroom attendance and marks.'}
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
          <p className="text-xs font-semibold text-neutral-600">Loading Teacher Academic Portal & Class Roster...</p>
        </div>
      </div>
    );
  }

  // Filter timetable
  const filteredTimetable =
    selectedDayFilter === 'all'
      ? teacherTimetable
      : teacherTimetable.filter(t => t.day.toLowerCase() === selectedDayFilter.toLowerCase());

  const pendingTasksCount = tasks.filter(t => t.status !== 'Completed').length;

  const teacherTabs = [
    { id: 'overview', label: 'Dashboard', icon: UserIcon },
    { id: 'tasks', label: 'My Responsibilities', icon: ClipboardList, badge: pendingTasksCount },
    { id: 'homework', label: 'Homework', icon: Briefcase },
    { id: 'classes', label: 'Assigned Classes', icon: BookOpen },
    { id: 'students', label: 'Student Roster', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: Calendar },
    { id: 'marks', label: 'Exams & Marks', icon: Award },
    { id: 'timetable', label: 'Timetable', icon: Clock },
    { id: 'profile', label: 'My Profile', icon: GraduationCap },
    { id: 'notices', label: 'Announcements', icon: FileText },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
    { id: 'ai', label: 'Teacher AI', icon: Sparkles },
  ];

  return (
    <div className="ssc-portal-shell ssc-teacher-shell min-h-screen w-full max-w-full overflow-x-hidden flex flex-col text-neutral-900">
      {/* Top Navigation Bar */}
      <header className="ssc-portal-topbar text-white border-b py-2.5 px-3 sm:px-8 flex items-center justify-between gap-2 sticky top-0 z-40 shadow-sm">
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
            Shawan Faculty &amp; Academic Portal
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

          <strong className="text-white hidden md:inline truncate max-w-[160px]">
            {teacher?.name || user?.name}
          </strong>
          <span className="text-[11px] font-mono uppercase font-semibold text-emerald-200">
            FACULTY
          </span>

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

      {/* Main Container */}
      <main id="main-content" className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1">
        <aside className="ssc-role-sidebar" aria-label="Teacher portal navigation">
          <div className="ssc-role-sidebar-brand"><span className="ssc-brand-mark"><GraduationCap size={19}/></span><div><strong>Teacher Panel</strong><small>Faculty workspace</small></div></div>
          <nav className="ssc-role-nav">
            {[
              {id:'overview',label:'Dashboard',icon:BookOpen},
              {id:'classes',label:'My Classes',icon:Users},
              {id:'students',label:'My Students',icon:GraduationCap},
              {id:'attendance',label:'Attendance',icon:Calendar},
              {id:'marks',label:'Marks & Results',icon:Award},
              {id:'timetable',label:'Timetable',icon:Clock},
              {id:'homework',label:'Homework',icon:FileText},
              {id:'tasks',label:'Duties & Tasks',icon:ClipboardList},
              {id:'profile',label:'My Profile',icon:UserIcon},
              {id:'notices',label:'Announcements',icon:Bell},
              {id:'notifications',label:'Notifications',icon:CheckCheck},
              {id:'ai',label:'AI Assistant',icon:Sparkles},
            ].map(item => {
              const Icon = item.icon;
              return <button type="button" key={item.id} onClick={() => setActiveTab(item.id as typeof activeTab)} className={`ssc-role-nav-item ${activeTab === item.id ? 'active' : ''}`}><Icon size={17}/><span>{item.label}</span></button>;
            })}
          </nav>
          <div className="ssc-sidebar-foot"><span className="ssc-online-dot"/> Faculty workspace</div>
        </aside>
        <div className="ssc-role-content min-w-0 space-y-5">
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
              onClick={loadInitialData}
              className="px-3 py-1.5 bg-white hover:bg-rose-100 text-rose-900 border border-rose-200 rounded-lg font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Teacher Identity Hero Card */}
        {teacher && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-7 shadow-xs mb-6 sm:mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-900 text-white font-bold text-2xl flex items-center justify-center shrink-0 shadow-sm">
                {teacher.name ? teacher.name.charAt(0) : 'T'}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-neutral-900 font-display">{teacher.name}</h2>
                  <span className="text-xs font-semibold text-emerald-800">
                    &middot; {teacher.status || 'Active'}
                  </span>
                  {dashboardData?.isClassTeacher && (
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-0.5 rounded-full text-[10px] flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      <span>Class Incharge: {dashboardData.classTeacherAssignments?.map((a: any) => `${a.class_name}-${a.section}`).join(', ') || 'Assigned'}</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 mt-1">
                  <span>
                    Subject: <strong className="text-neutral-800">{teacher.subject}</strong>
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <span>
                    Teacher ID: <strong className="font-mono text-neutral-800">{teacher.id}</strong>
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <span>
                    Qualification: <strong className="text-neutral-800">{teacher.qualification}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-neutral-600 bg-neutral-50 p-4 rounded-xl border border-neutral-200/80 w-full md:w-auto">
              <div>
                <span className="text-neutral-500 block text-[11px] font-semibold">Assigned Classes</span>
                <span className="font-bold text-emerald-900 tabular-nums">{teacher.classes?.length || 0} Classes</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[11px] font-semibold">Total Students</span>
                <span className="font-bold text-neutral-900 font-mono tabular-nums">
                  {dashboardData?.totalStudents || students.length || 0}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[11px] font-semibold">Duties &amp; Tasks</span>
                <span className="font-bold text-neutral-900">
                  {pendingTasksCount > 0 ? (
                    <span className="text-amber-800 font-bold tabular-nums">{pendingTasksCount} Pending</span>
                  ) : (
                    <span className="text-emerald-800 font-semibold">All Done</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[11px] font-semibold">Attendance Today</span>
                <span className="font-bold text-neutral-900">
                  {dashboardData?.attendanceStatus?.markedToday ? (
                    <span className="inline-flex items-center gap-1 text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>All Marked</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-800 tabular-nums">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{dashboardData?.attendanceStatus?.pendingClasses?.length || 0} Pending</span>
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Portal Module Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 sm:mb-8 no-scrollbar scroll-smooth">
          {teacherTabs.map(tab => {
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
        {/* TAB 1: TEACHER DASHBOARD (OVERVIEW)                  */}
        {/* ==================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Pending Attendance Warning Banner */}
            {dashboardData?.attendanceStatus?.pendingClasses && dashboardData.attendanceStatus.pendingClasses.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-900">Pending Daily Attendance Roll Call</h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      You have not yet marked attendance for today ({dashboardData.attendanceStatus.date}) for:{' '}
                      <strong>{dashboardData.attendanceStatus.pendingClasses.join(', ')}</strong>.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setActiveTab('attendance');
                    handleOpenMarkAttendance();
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-800 hover:bg-amber-900 rounded-xl cursor-pointer self-start sm:self-auto shrink-0 shadow-xs transition-colors"
                >
                  Mark Attendance Now
                </button>
              </div>
            )}

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Assigned Classes</span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
                    <BookOpen className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-emerald-950">
                    {teacher?.classes?.length || 0}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1 truncate">
                    {teacher?.classes?.slice(0, 2).join(', ') || 'None assigned'}
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Authorized Students</span>
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-800 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-neutral-900">
                    {dashboardData?.totalStudents || students.length}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">Across all assigned classes</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Today's Schedule</span>
                  <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-800 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-neutral-900">
                    {dashboardData?.todayTimetable?.length || 0} Periods
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {todayDay ? `Scheduled for ${todayDay}` : 'Weekly schedule'}
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Academic Status</span>
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-bold font-mono text-emerald-800">
                    {teacher?.status || 'Active'}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">{teacher?.experience || 'Faculty Member'}</p>
                </div>
              </div>
            </div>

            {/* Dashboard 2-Column Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
              {/* Left Column (8 cols): Today Schedule + Class Roster Quick Access */}
              <div className="lg:col-span-8 space-y-6">
                {/* Today's Timetable */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 font-display">
                        Today's Teaching Schedule ({todayDay || 'Today'})
                      </h3>
                      <p className="text-xs text-neutral-500">Assigned periods, classes, and allocated laboratories/rooms.</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('timetable')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      View Weekly Plan
                    </button>
                  </div>

                  {dashboardData?.todayTimetable && dashboardData.todayTimetable.length > 0 ? (
                    <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden">
                      {dashboardData.todayTimetable.map((tt: TimetableEntry) => (
                        <div key={tt.id} className="p-3.5 bg-neutral-50/50 hover:bg-neutral-50 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-neutral-900 block text-xs">
                              {tt.subject} · {tt.class_name} ({tt.section})
                            </span>
                            <span className="text-[11px] text-neutral-500 mt-0.5 block">
                              Room: <strong>{tt.room}</strong>
                            </span>
                          </div>
                          <span className="font-mono text-xs text-emerald-950 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                            {tt.start_time} - {tt.end_time}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-500 text-center">
                      No teaching periods scheduled for today ({todayDay || 'today'}).
                    </div>
                  )}
                </div>

                {/* Assigned Classes Quick Cards */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 font-display">Assigned Teaching Classes</h3>
                      <p className="text-xs text-neutral-500">Direct academic oversight for enrolled student sections.</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('classes')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      Manage Classes
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {assignedClasses.map((cls, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl border border-neutral-200 hover:border-emerald-800/40 hover:bg-emerald-50/30 transition-all text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-neutral-900 font-display text-sm">{cls.class_name}</h4>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              cls.todayAttendanceMarked
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {cls.todayAttendanceMarked ? 'Attendance Marked' : 'Attendance Pending'}
                          </span>
                        </div>
                        <p className="text-neutral-500 text-[11px]">
                          Enrolled: <strong className="text-neutral-800">{cls.student_count} Students</strong> · Stream:{' '}
                          {cls.stream}
                        </p>
                        <div className="flex gap-2 pt-1 border-t border-neutral-100">
                          <button
                            onClick={() => {
                              setSelectedClass(cls.class_name);
                              setActiveTab('students');
                              loadStudents(cls.class_name);
                            }}
                            className="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer"
                          >
                            View Students →
                          </button>
                          <span className="text-neutral-300">·</span>
                          <button
                            onClick={() => {
                              setSelectedClass(cls.class_name);
                              setActiveTab('attendance');
                              handleOpenMarkAttendance();
                            }}
                            className="text-[11px] font-semibold text-emerald-800 hover:underline cursor-pointer"
                          >
                            Roll Call
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column (4 cols): Announcements & AI Widget */}
              <div className="lg:col-span-4 space-y-6">
                {/* School Circulars */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-neutral-900 font-display">Faculty Announcements</h3>
                    <button
                      onClick={() => setActiveTab('notices')}
                      className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                    >
                      All Circulars
                    </button>
                  </div>

                  {announcements.length > 0 ? (
                    <div className="space-y-3">
                      {announcements.slice(0, 3).map(ann => (
                        <div key={ann.id} className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-1">
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

                {/* AI Assistant Quick Trigger */}
                <div className="bg-emerald-950 text-white rounded-2xl p-5 shadow-xs border border-emerald-900 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      Teacher Intelligence Assistant
                    </h4>
                  </div>
                  <p className="text-xs text-neutral-200 leading-relaxed">
                    Instantly query class attendance rates, examine student performance, or prepare marks entries using real MongoDB data.
                  </p>
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="w-full py-2 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                  >
                    <span>Launch Teacher AI</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: TEACHER PROFILE                               */}
        {/* ==================================================== */}
        {activeTab === 'profile' && teacher && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Faculty Institutional Dossier</h3>
                  <p className="text-xs text-neutral-500">
                    Official faculty credentials, assigned classes, and contact records verified by the school administration.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenEditProfile}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit Contact & Bio</span>
                  </button>
                </div>
              </div>

              {/* Profile Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-xs">
                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Full Name</span>
                  <span className="text-sm font-bold text-neutral-900 block">{teacher.name}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Teacher / Employee ID</span>
                  <span className="text-sm font-bold font-mono text-neutral-900 block">{teacher.id}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Primary Subject</span>
                  <span className="text-sm font-bold text-emerald-900 block">{teacher.subject}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Academic Qualification</span>
                  <span className="font-semibold text-neutral-900 block">{teacher.qualification}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Teaching Experience</span>
                  <span className="font-semibold text-neutral-900 block">{teacher.experience}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Employment Status</span>
                  <span className="font-bold text-emerald-800 block">{teacher.status || 'Active'}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Official Email</span>
                  <span className="font-semibold text-neutral-900 font-mono block">{teacher.email || 'Not assigned'}</span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Contact Number</span>
                  <span className="font-semibold text-neutral-900 font-mono block">
                    {teacher.contact_no || 'Not recorded'}
                  </span>
                </div>

                <div className="space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Joining Date</span>
                  <span className="font-semibold text-neutral-900 block">{teacher.joining_date || 'Not recorded'}</span>
                </div>

                <div className="md:col-span-2 lg:col-span-3 space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Assigned Classes</span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {teacher.classes?.map((c, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg text-xs font-semibold"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2 lg:col-span-3 space-y-1 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="text-neutral-400 uppercase font-semibold text-[10px] block">Faculty Biography</span>
                  <p className="text-neutral-700 leading-relaxed pt-1">
                    {teacher.bio || 'Experienced faculty member dedicated to quality education at Shawan School and College.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Edit Profile Modal */}
            {showEditProfileModal && (
              <div
                className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => {
                  if (!profileSaving) setShowEditProfileModal(false);
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="edit-profile-modal-title"
                  onClick={e => e.stopPropagation()}
                  className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-neutral-200 space-y-4"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
                    <h3 id="edit-profile-modal-title" className="text-sm font-bold text-neutral-900 font-display">
                      Update Contact &amp; Bio
                    </h3>
                    <button
                      type="button"
                      aria-label="Close edit profile modal"
                      onClick={() => setShowEditProfileModal(false)}
                      className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {profileMsg && (
                    <div
                      className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                        profileMsg.type === 'success'
                          ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                          : 'bg-rose-50 text-rose-900 border border-rose-200'
                      }`}
                    >
                      {profileMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      <span>{profileMsg.text}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Contact Phone</label>
                      <input
                        type="text"
                        value={editContact}
                        onChange={e => setEditContact(e.target.value)}
                        placeholder="e.g. +92 312 9876543"
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Professional Bio</label>
                      <textarea
                        rows={3}
                        value={editBio}
                        onChange={e => setEditBio(e.target.value)}
                        placeholder="Brief summary of academic background and specialization..."
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowEditProfileModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={profileSaving}
                        className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        {profileSaving ? 'Saving...' : 'Save Profile'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: ASSIGNED CLASSES                              */}
        {/* ==================================================== */}
        {activeTab === 'classes' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Assigned Academic Classes</h3>
                  <p className="text-xs text-neutral-500">
                    Classes and student sections officially assigned to your instructional schedule.
                  </p>
                </div>
                <div className="text-xs font-semibold text-emerald-900 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  Total Classes: {assignedClasses.length}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {assignedClasses.map((cls, idx) => (
                  <div key={idx} className="p-5 rounded-2xl border border-neutral-200 bg-neutral-50/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-base font-bold text-neutral-900 font-display">{cls.class_name}</h4>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {cls.grade_level}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-neutral-600">
                      <div className="flex justify-between">
                        <span>Enrolled Students:</span>
                        <strong className="text-neutral-900 font-mono">{cls.student_count}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Sections:</span>
                        <strong className="text-neutral-900">{cls.sections?.join(', ') || 'A'}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Instructional Subject:</span>
                        <strong className="text-emerald-900">{cls.subject}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Today's Attendance:</span>
                        <strong className={cls.todayAttendanceMarked ? 'text-emerald-700' : 'text-amber-700'}>
                          {cls.todayAttendanceMarked ? '✅ Marked' : '⚠️ Pending'}
                        </strong>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-neutral-200/80 flex items-center justify-between text-xs">
                      <button
                        onClick={() => {
                          setSelectedClass(cls.class_name);
                          setActiveTab('students');
                          loadStudents(cls.class_name);
                        }}
                        className="font-semibold text-emerald-800 hover:underline cursor-pointer"
                      >
                        Student List ({cls.student_count})
                      </button>
                      <button
                        onClick={() => {
                          setSelectedClass(cls.class_name);
                          setActiveTab('attendance');
                          handleOpenMarkAttendance();
                        }}
                        className="px-3 py-1 font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer text-[11px] shadow-xs"
                      >
                        Roll Call
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 4: STUDENT ROSTER (AUTHORIZED STUDENTS ONLY)    */}
        {/* ==================================================== */}
        {activeTab === 'students' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">Student Class Roster</h3>
                <p className="text-xs text-neutral-500">
                  Enrolled students in your assigned classes. Restricted from accessing financial records.
                </p>
              </div>

              {/* Class Filter Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-500">Class:</span>
                <select
                  value={selectedClass}
                  onChange={e => handleClassChange(e.target.value)}
                  className="py-1.5 px-3 border border-neutral-300 rounded-lg text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                >
                  {assignedClasses.map((cls, idx) => (
                    <option key={idx} value={cls.class_name}>
                      {cls.class_name} ({cls.student_count} students)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Search Input Bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search students by name, roll number, or admission number..."
                  value={studentSearch}
                  onChange={e => {
                    setStudentSearch(e.target.value);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') loadStudents(selectedClass);
                  }}
                  className="w-full text-xs py-2 pl-9 pr-4 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-neutral-50/50"
                />
              </div>
              <button
                onClick={() => loadStudents(selectedClass)}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer shadow-xs"
              >
                Search
              </button>
            </div>

            {/* Students Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                  <tr>
                    <th className="py-3 px-4">Roll No</th>
                    <th className="py-3 px-4">Student Name</th>
                    <th className="py-3 px-4">Father Name</th>
                    <th className="py-3 px-4">Class & Section</th>
                    <th className="py-3 px-4">Attendance Rate</th>
                    <th className="py-3 px-4">Academic Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {students.length > 0 ? (
                    students.map(s => (
                      <tr key={s.id} className="hover:bg-neutral-50">
                        <td className="py-3 px-4 font-mono font-bold text-neutral-900">{s.roll_no}</td>
                        <td className="py-3 px-4 font-semibold text-neutral-900">{s.full_name}</td>
                        <td className="py-3 px-4 text-neutral-600">{s.father_name}</td>
                        <td className="py-3 px-4 text-neutral-600">
                          {s.class_name} ({s.section})
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`font-mono font-bold ${
                              s.attendance_percentage >= 75 ? 'text-emerald-800' : 'text-rose-700'
                            }`}
                          >
                            {s.attendance_percentage}% ({s.presents}/{s.total_days} days)
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {s.academic_status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleOpenMarksModal(s)}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md cursor-pointer"
                          >
                            Enter Marks
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-neutral-500 italic">
                        No students found for this class in the database.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 5: ATTENDANCE MANAGEMENT & HISTORY              */}
        {/* ==================================================== */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Class Attendance Management</h3>
                  <p className="text-xs text-neutral-500">
                    Mark morning register and review historical logs for assigned classes.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenMarkAttendance}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Mark Class Roll Call</span>
                  </button>
                </div>
              </div>

              {/* Attendance Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-700">Class:</span>
                  <select
                    value={selectedClass}
                    onChange={e => {
                      handleClassChange(e.target.value);
                    }}
                    className="py-1 px-2 border border-neutral-300 rounded-lg bg-white"
                  >
                    {assignedClasses.map((cls, idx) => (
                      <option key={idx} value={cls.class_name}>
                        {cls.class_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-neutral-500" />
                  {(['today', 'week', 'month', 'custom'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => {
                        setAttendanceFilter(f);
                        setTimeout(() => loadAttendance(selectedClass), 50);
                      }}
                      className={`px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                        attendanceFilter === f
                          ? 'bg-emerald-900 text-white'
                          : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
                      }`}
                    >
                      {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'Custom'}
                    </button>
                  ))}
                </div>

                {attendanceFilter === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={e => setCustomStartDate(e.target.value)}
                      className="py-1 px-2 border border-neutral-300 rounded-lg text-xs"
                    />
                    <span className="text-neutral-400">to</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={e => setCustomEndDate(e.target.value)}
                      className="py-1 px-2 border border-neutral-300 rounded-lg text-xs"
                    />
                    <button
                      onClick={() => loadAttendance(selectedClass)}
                      className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-900 rounded-lg"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>

              {/* Attendance Summary Metrics */}
              {attendanceSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="text-xs text-emerald-800 font-medium block">Present</span>
                    <span className="text-xl font-bold font-mono text-emerald-950">{attendanceSummary.present}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="text-xs text-rose-800 font-medium block">Absent</span>
                    <span className="text-xl font-bold font-mono text-rose-950">{attendanceSummary.absent}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <span className="text-xs text-amber-800 font-medium block">Late</span>
                    <span className="text-xl font-bold font-mono text-amber-950">{attendanceSummary.late}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <span className="text-xs text-blue-800 font-medium block">Rate</span>
                    <span className="text-xl font-bold font-mono text-blue-950">{attendanceSummary.percentage}%</span>
                  </div>
                </div>
              )}

              {/* History Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Marked By</th>
                      <th className="py-3 px-4">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {attendanceRecords.length > 0 ? (
                      attendanceRecords.map(rec => (
                        <tr key={rec.id} className="hover:bg-neutral-50">
                          <td className="py-3 px-4 font-mono font-medium text-neutral-900">{rec.date}</td>
                          <td className="py-3 px-4 font-semibold text-neutral-900">{rec.student_name}</td>
                          <td className="py-3 px-4 text-neutral-600">{rec.class_name}</td>
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
                          <td className="py-3 px-4 text-neutral-600">{rec.marked_by}</td>
                          <td className="py-3 px-4 text-neutral-500">{rec.remarks || 'Regular daily register entry'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-neutral-500 italic">
                          No attendance records found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mark Attendance Modal */}
            {markingAttendance && (
              <div
                className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
                onClick={() => {
                  if (!attendanceSaveLoading) setMarkingAttendance(false);
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="roll-call-modal-title"
                  onClick={e => e.stopPropagation()}
                  className="bg-white rounded-2xl max-w-2xl w-full p-4 sm:p-7 shadow-2xl border border-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-neutral-200">
                    <div className="min-w-0">
                      <h3 id="roll-call-modal-title" className="text-base font-bold text-neutral-900 font-display truncate">
                        Mark Roll Call: {selectedClass}
                      </h3>
                      <p className="text-xs text-neutral-500">Record daily morning attendance for authorized class.</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close roll call modal"
                      onClick={() => setMarkingAttendance(false)}
                      className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer shrink-0"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {attendanceMsg && (
                    <div
                      role={attendanceMsg.type === 'error' ? 'alert' : 'status'}
                      className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                        attendanceMsg.type === 'success'
                          ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                          : 'bg-rose-50 text-rose-900 border border-rose-200'
                      }`}
                    >
                      {attendanceMsg.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{attendanceMsg.text}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <label htmlFor="roll-call-date" className="font-semibold text-neutral-700 shrink-0">
                        Date:
                      </label>
                      <input
                        id="roll-call-date"
                        type="date"
                        value={attendanceDate}
                        onChange={e => setAttendanceDate(e.target.value)}
                        className="min-h-[36px] py-1.5 px-2.5 border border-neutral-300 rounded-xl text-xs"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleMarkAllRoster('Present')}
                        className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 whitespace-nowrap cursor-pointer"
                      >
                        All Present
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMarkAllRoster('Absent')}
                        className="min-h-[34px] px-3 py-1.5 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 whitespace-nowrap cursor-pointer"
                      >
                        All Absent
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 max-h-80 overflow-y-auto divide-y divide-neutral-100 border border-neutral-200 rounded-xl p-2 sm:p-3">
                    {attendanceRoster.map(item => (
                      <div
                        key={item.student_id}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2"
                      >
                        <span className="font-semibold text-neutral-900 truncate">{item.student_name}</span>
                        <div className="grid grid-cols-4 sm:flex items-center gap-1.5 shrink-0">
                          {(['Present', 'Absent', 'Late', 'Leave'] as const).map(st => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => handleUpdateRosterStatus(item.student_id, st)}
                              className={`min-h-[32px] px-2 sm:px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                                item.status === st
                                  ? st === 'Present'
                                    ? 'bg-emerald-900 text-white'
                                    : st === 'Absent'
                                    ? 'bg-rose-700 text-white'
                                    : st === 'Late'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-blue-600 text-white'
                                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setMarkingAttendance(false)}
                      className="min-h-[40px] px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAttendance}
                      disabled={attendanceSaveLoading}
                      className="min-h-[40px] px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {attendanceSaveLoading ? 'Saving...' : 'Save & Finalize Roll Call'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 6: EXAMS & MARKS MANAGEMENT                      */}
        {/* ==================================================== */}
        {activeTab === 'marks' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Academic Examination & Marks</h3>
                  <p className="text-xs text-neutral-500">
                    Record assessment scores and examine performance summaries for assigned classes.
                  </p>
                </div>

                <button
                  onClick={() => handleOpenMarksModal()}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>Enter Student Marks</span>
                </button>
              </div>

              {/* Exam & Class Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-700">Exam:</span>
                  <select
                    value={selectedExamId}
                    onChange={e => {
                      setSelectedExamId(e.target.value);
                      loadResults(selectedClass, e.target.value);
                    }}
                    className="py-1 px-2.5 border border-neutral-300 rounded-lg bg-white"
                  >
                    {exams.map(ex => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title} ({ex.academic_year})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-700">Class:</span>
                  <select
                    value={selectedClass}
                    onChange={e => {
                      handleClassChange(e.target.value);
                    }}
                    className="py-1 px-2.5 border border-neutral-300 rounded-lg bg-white"
                  >
                    {assignedClasses.map((cls, idx) => (
                      <option key={idx} value={cls.class_name}>
                        {cls.class_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Class Summary Analytics */}
              {resultsData.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 text-center">
                  <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200">
                    <span className="text-[11px] text-neutral-500 font-semibold block">Tested</span>
                    <span className="text-xl font-bold font-mono text-neutral-900">
                      {resultsData.summary.totalStudentsTested}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="text-[11px] text-emerald-800 font-semibold block">Average Score</span>
                    <span className="text-xl font-bold font-mono text-emerald-950">
                      {resultsData.summary.averagePercentage}%
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <span className="text-[11px] text-blue-800 font-semibold block">Highest</span>
                    <span className="text-xl font-bold font-mono text-blue-950">
                      {resultsData.summary.highestScore}%
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <span className="text-[11px] text-amber-800 font-semibold block">Pass Count</span>
                    <span className="text-xl font-bold font-mono text-amber-950">
                      {resultsData.summary.passCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="text-[11px] text-rose-800 font-semibold block">Fail Count</span>
                    <span className="text-xl font-bold font-mono text-rose-950">
                      {resultsData.summary.failCount}
                    </span>
                  </div>
                </div>
              )}

              {/* Results Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                    <tr>
                      <th className="py-3 px-4">Student</th>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4">Subject</th>
                      <th className="py-3 px-4">Marks Obtained</th>
                      <th className="py-3 px-4">Grade</th>
                      <th className="py-3 px-4">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {resultsData.results.length > 0 ? (
                      resultsData.results.map(r => (
                        <tr key={r.id} className="hover:bg-neutral-50">
                          <td className="py-3 px-4 font-semibold text-neutral-900">{r.student_name}</td>
                          <td className="py-3 px-4 text-neutral-600">{r.class_name}</td>
                          <td className="py-3 px-4 text-neutral-700">
                            {r.subjects.map(s => s.subject_name).join(', ')}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-neutral-900">
                            {r.obtained_marks}/{r.total_marks} ({r.percentage}%)
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200">
                              {r.overall_grade}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-neutral-500">{r.remarks || 'Recorded assessment'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-neutral-500 italic">
                          No results recorded for this exam and class combination.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Enter Marks Modal */}
            {showMarksModal && (
              <div
                className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => {
                  if (!marksSaveLoading) setShowMarksModal(false);
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="marks-modal-title"
                  onClick={e => e.stopPropagation()}
                  className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-7 shadow-2xl border border-neutral-200 space-y-4"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
                    <div>
                      <h3 id="marks-modal-title" className="text-base font-bold text-neutral-900 font-display">
                        Record Student Marks
                      </h3>
                      <p className="text-xs text-neutral-500">Record score for your assigned teaching subject.</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close record marks modal"
                      onClick={() => setShowMarksModal(false)}
                      className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {marksMsg && (
                    <div
                      className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                        marksMsg.type === 'success'
                          ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                          : 'bg-rose-50 text-rose-900 border border-rose-200'
                      }`}
                    >
                      {marksMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      <span>{marksMsg.text}</span>
                    </div>
                  )}

                  <form onSubmit={handleSaveMarks} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-semibold text-neutral-700 mb-1">Select Student *</label>
                      <select
                        value={marksForm.student_id}
                        onChange={e => setMarksForm({ ...marksForm, student_id: e.target.value })}
                        className="w-full py-2 px-3 border border-neutral-300 rounded-lg text-xs"
                        required
                      >
                        {students.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} (Roll #{s.roll_no} - {s.class_name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-neutral-700 mb-1">Subject *</label>
                      <input
                        type="text"
                        value={marksForm.subject_name}
                        onChange={e => setMarksForm({ ...marksForm, subject_name: e.target.value })}
                        placeholder="e.g. Physics"
                        className="w-full py-2 px-3 border border-neutral-300 rounded-lg text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-neutral-700 mb-1">Total Marks *</label>
                        <input
                          type="number"
                          value={marksForm.total_marks}
                          onChange={e => setMarksForm({ ...marksForm, total_marks: Number(e.target.value) })}
                          min={1}
                          className="w-full py-2 px-3 border border-neutral-300 rounded-lg text-xs font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-neutral-700 mb-1">Obtained Marks *</label>
                        <input
                          type="number"
                          value={marksForm.obtained_marks}
                          onChange={e => setMarksForm({ ...marksForm, obtained_marks: Number(e.target.value) })}
                          min={0}
                          max={marksForm.total_marks}
                          className="w-full py-2 px-3 border border-neutral-300 rounded-lg text-xs font-mono"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-neutral-700 mb-1">Remarks</label>
                      <input
                        type="text"
                        value={marksForm.remarks}
                        onChange={e => setMarksForm({ ...marksForm, remarks: e.target.value })}
                        placeholder="e.g. Good theoretical grasp, needs lab work"
                        className="w-full py-2 px-3 border border-neutral-300 rounded-lg text-xs"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowMarksModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={marksSaveLoading}
                        className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        {marksSaveLoading ? 'Saving...' : 'Save Marks'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 7: TIMETABLE                                     */}
        {/* ==================================================== */}
        {activeTab === 'timetable' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">Faculty Teaching Timetable</h3>
                <p className="text-xs text-neutral-500">
                  Weekly schedule for {teacher?.name} ({teacher?.subject}).
                </p>
              </div>

              {/* Day filter selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {['all', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                  <button
                    key={day}
                    onClick={() => setSelectedDayFilter(day)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      selectedDayFilter === day
                        ? 'bg-emerald-900 text-white'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {day === 'all' ? 'Full Week' : day.substring(0, 3)}
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
                    <th className="py-3 px-4">Class & Section</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">Room / Lab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {filteredTimetable.length > 0 ? (
                    filteredTimetable.map(tt => {
                      const isToday = tt.day.toLowerCase() === todayDay.toLowerCase();
                      return (
                        <tr key={tt.id} className={isToday ? 'bg-emerald-50/40 font-semibold' : 'hover:bg-neutral-50'}>
                          <td className="py-3 px-4 font-bold text-neutral-900">
                            {tt.day} {isToday && <span className="text-[10px] text-emerald-800 ml-1">(Today)</span>}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-700">
                            {tt.start_time} - {tt.end_time}
                          </td>
                          <td className="py-3 px-4 text-neutral-900">
                            {tt.class_name} ({tt.section})
                          </td>
                          <td className="py-3 px-4 text-emerald-950 font-bold">{tt.subject}</td>
                          <td className="py-3 px-4 text-neutral-600">{tt.room}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-neutral-500 italic">
                        No timetable periods found for this selection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 8: ANNOUNCEMENTS                                 */}
        {/* ==================================================== */}
        {activeTab === 'notices' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-neutral-900 font-display mb-2">Faculty Official Circulars</h3>
            <p className="text-xs text-neutral-500 mb-4">
              Institutional notices and administrative directives issued for faculty members.
            </p>

            <div className="space-y-3">
              {announcements.length > 0 ? (
                announcements.map(ann => (
                  <div key={ann.id} className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1.5">
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
        {/* TAB 9: NOTIFICATIONS (REAL MONGODB)                  */}
        {/* ==================================================== */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
              <div>
                <h3 className="text-base font-bold text-neutral-900 font-display">Faculty System Notifications</h3>
                <p className="text-xs text-neutral-500">
                  Institutional alerts, academic reminders, and system notifications from MongoDB.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setNotifLoading(true);
                    const notifs = await api.getNotifications().catch(() => []);
                    setNotifications(notifs);
                    setNotifLoading(false);
                  }}
                  disabled={notifLoading}
                  className="px-3 py-1.5 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${notifLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllNotifsRead}
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
                    key={notif.id || notif._id || `teacher-notif-${idx}`}
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
                        onClick={() => handleMarkNotifRead(notif.id)}
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
        {/* TAB 10: TEACHER AI ASSISTANT                         */}
        {/* ==================================================== */}
        {activeTab === 'ai' && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-8 shadow-xs space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-900 text-white flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 font-display">Faculty Academic AI Assistant</h3>
                  <p className="text-xs text-neutral-500">
                    Grounded classroom queries for your assigned classes with explicit confirmation safeguards.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Query Suggestions */}
            <div>
              <span className="text-xs font-semibold text-neutral-500 block mb-2">
                Suggested Faculty Inquiries:
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  'What classes do I teach?',
                  'Show my timetable today',
                  'How many students are in my Grade 9 class?',
                  'Which students were absent today?',
                  'Show students with attendance below 75%',
                  "Show my students' latest Physics results",
                  'Show my pending attendance tasks',
                ].map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendTeacherAi(prompt)}
                    disabled={teacherAiLoading}
                    className="min-h-[34px] px-3 py-1.5 text-xs font-medium bg-neutral-50 hover:bg-emerald-50 text-neutral-700 hover:text-emerald-900 border border-neutral-200 hover:border-emerald-300 rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat History Box */}
            <div className="space-y-4 max-h-[520px] overflow-y-auto p-3 sm:p-5 rounded-2xl bg-neutral-50 border border-neutral-200">
              {teacherAiMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
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

                    {/* Disambiguation Candidate Cards */}
                    {msg.disambiguationRequired && msg.candidates && msg.candidates.length > 0 && (
                      <div className="pt-3 border-t border-neutral-200 space-y-2">
                        <span className="text-xs font-bold text-amber-900 block">
                          Multiple matching students &mdash; select student:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.candidates.map(candidate => (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => handleSendTeacherAi(`Show records for ${candidate.name}`)}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl text-left text-xs font-bold bg-emerald-50/70 text-emerald-950 border border-emerald-200 hover:bg-emerald-100 cursor-pointer transition-colors"
                            >
                              {candidate.name} <span className="font-normal text-neutral-600">({candidate.class_name})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sensitive Action Confirmation Box */}
                    {msg.requiresConfirmation && msg.pendingAction && (
                      <div className="p-3.5 sm:p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 mt-2">
                        <div className="flex items-center gap-1.5 text-amber-950 font-bold text-xs">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>Action Confirmation Required</span>
                        </div>
                        <p className="text-xs text-amber-900">
                          {msg.pendingAction.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleExecutePendingAction(idx, msg.pendingAction)}
                            disabled={actionExecuting}
                            className="min-h-[36px] px-4 py-1.5 bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs cursor-pointer"
                          >
                            {actionExecuting ? 'Executing...' : 'Confirm & Execute'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTeacherAiMessages(prev =>
                                prev.map((m, i) => (i === idx ? { ...m, requiresConfirmation: false } : m))
                              );
                            }}
                            className="min-h-[36px] px-3 py-1.5 bg-white border border-neutral-300 text-neutral-700 rounded-xl text-xs font-semibold cursor-pointer hover:bg-neutral-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {teacherAiLoading && (
                <div className="flex items-center gap-2 text-xs text-neutral-600 p-2" role="status" aria-live="polite">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-800 animate-spin" />
                  <span>Verifying classroom records...</span>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendTeacherAi();
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1"
            >
              <label htmlFor="teacher-ai-query-input" className="sr-only">
                Ask Faculty AI Assistant
              </label>
              <input
                id="teacher-ai-query-input"
                type="text"
                value={teacherAiInput}
                onChange={e => setTeacherAiInput(e.target.value)}
                placeholder="Ask about your assigned classes, attendance, students, marks, or timetable..."
                disabled={teacherAiLoading}
                className="flex-1 min-h-[42px] text-xs sm:text-sm py-2.5 px-4 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 bg-white"
              />
              <button
                type="submit"
                disabled={teacherAiLoading || !teacherAiInput.trim()}
                className="min-h-[42px] px-5 py-2.5 bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask Assistant</span>
              </button>
            </form>
          </div>
        )}
        {/* ==================================================== */}
        {/* TAB: MY RESPONSIBILITIES & TASKS                     */}
        {/* ==================================================== */}
        {activeTab === 'tasks' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-neutral-900 font-display">
                  My Academic Duties &amp; Responsibilities
                </h3>
                <p className="text-xs text-neutral-500">
                  Official assignments, examination duties, and committee roles delegated by School Administration
                </p>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 p-1 bg-white border border-neutral-200 rounded-xl shadow-2xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setTaskFilter('all')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    taskFilter === 'all' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  All ({tasks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTaskFilter('pending')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    taskFilter === 'pending' ? 'bg-amber-800 text-white' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Pending ({tasks.filter(t => t.status !== 'Completed').length})
                </button>
                <button
                  type="button"
                  onClick={() => setTaskFilter('completed')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    taskFilter === 'completed' ? 'bg-emerald-800 text-white' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Completed ({tasks.filter(t => t.status === 'Completed').length})
                </button>
              </div>
            </div>

            {/* Task Cards List */}
            {(() => {
              const visibleTasks = tasks.filter(t => {
                if (taskFilter === 'pending') return t.status !== 'Completed';
                if (taskFilter === 'completed') return t.status === 'Completed';
                return true;
              });

              if (visibleTasks.length === 0) {
                return (
                  <div className="bg-white p-12 text-center rounded-2xl border border-neutral-200 shadow-xs space-y-3">
                    <div className="w-12 h-12 bg-neutral-100 text-neutral-500 rounded-full mx-auto flex items-center justify-center">
                      <ClipboardList className="w-6 h-6 text-emerald-800" />
                    </div>
                    <h4 className="text-base font-bold text-neutral-900">No Duties Found</h4>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto">
                      {taskFilter === 'completed'
                        ? 'You have not completed any tasks yet.'
                        : taskFilter === 'pending'
                        ? 'Great job! You have no pending duties or administrative responsibilities.'
                        : 'No institutional tasks have been assigned by Administration yet.'}
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {visibleTasks.map(t => (
                    <div
                      key={t.id}
                      className={`p-5 rounded-2xl border shadow-xs flex flex-col justify-between space-y-4 transition-all ${
                        t.status === 'Completed'
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : t.priority === 'Urgent'
                          ? 'bg-rose-50/30 border-rose-200'
                          : 'bg-white border-neutral-200'
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-neutral-900">{t.title}</h4>
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                              t.priority === 'Urgent'
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : t.priority === 'High'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : 'bg-neutral-100 text-neutral-700'
                            }`}
                          >
                            {t.priority}
                          </span>
                        </div>

                        {t.description && (
                          <p className="text-xs text-neutral-600 leading-relaxed">{t.description}</p>
                        )}

                        <div className="text-xs space-y-1 text-neutral-600 pt-1">
                          {t.class_name && (
                            <div>
                              <strong className="text-neutral-700">Class:</strong> {t.class_name}{' '}
                              {t.section ? `(${t.section})` : ''}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-neutral-400" />
                            <strong className="text-neutral-700">Due Date:</strong>{' '}
                            <span className="font-mono font-bold text-emerald-950">{t.due_date}</span>
                          </div>
                          <div>
                            <strong className="text-neutral-700">Assigned By:</strong>{' '}
                            <span>{t.assigned_by || 'Administration'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="pt-3 border-t border-neutral-200/60 flex items-center justify-between text-xs">
                        <span
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                            t.status === 'Completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : t.status === 'In Progress'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {t.status}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {t.status === 'Pending' && (
                            <button
                              type="button"
                              disabled={taskUpdatingId === t.task_id}
                              onClick={() => handleUpdateTaskStatus(t.task_id || t.id, 'In Progress')}
                              className="px-2.5 py-1 rounded-lg text-sky-800 bg-sky-50 hover:bg-sky-100 font-semibold text-[11px] cursor-pointer"
                            >
                              Start
                            </button>
                          )}

                          {t.status !== 'Completed' ? (
                            <button
                              type="button"
                              disabled={taskUpdatingId === t.task_id}
                              onClick={() => handleUpdateTaskStatus(t.task_id || t.id, 'Completed')}
                              className="px-3 py-1 rounded-lg text-white bg-emerald-900 hover:bg-emerald-800 font-bold text-[11px] cursor-pointer flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" />
                              <span>Done</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Completed</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB: HOMEWORK & ASSIGNMENTS                          */}
        {/* ==================================================== */}
        {activeTab === 'homework' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-neutral-900 font-display">
                  Class Homework &amp; Coursework
                </h3>
                <p className="text-xs text-neutral-500">
                  Assign homework tasks, reading assignments, and coursework to your enrolled classes
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <select
                  value={homeworkClassFilter}
                  onChange={e => setHomeworkClassFilter(e.target.value)}
                  className="text-xs py-2 px-3 bg-white border border-neutral-300 rounded-xl"
                >
                  <option value="all">All Classes</option>
                  {(teacher?.classes || []).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setHomeworkForm({
                      title: '',
                      description: '',
                      class_name: (teacher?.classes && teacher.classes[0]) || 'Class 9',
                      section: 'A',
                      subject: teacher?.subject || 'Mathematics',
                      due_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
                      total_marks: 10,
                      instructions: '',
                    });
                    setShowCreateHomeworkModal(true);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Assign Homework</span>
                </button>
              </div>
            </div>

            {homeworkMsg && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-center gap-2 ${
                  homeworkMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}
              >
                {homeworkMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                )}
                <span>{homeworkMsg.text}</span>
              </div>
            )}

            {/* Homework List */}
            {(() => {
              const visibleHw = homeworkList.filter(h => {
                if (homeworkClassFilter !== 'all' && h.class_name.toLowerCase() !== homeworkClassFilter.toLowerCase()) {
                  return false;
                }
                return true;
              });

              if (visibleHw.length === 0) {
                return (
                  <div className="bg-white p-12 text-center rounded-2xl border border-neutral-200 shadow-xs space-y-3">
                    <div className="w-12 h-12 bg-neutral-100 text-neutral-500 rounded-full mx-auto flex items-center justify-center">
                      <Briefcase className="w-6 h-6 text-emerald-800" />
                    </div>
                    <h4 className="text-base font-bold text-neutral-900">No Homework Posted Yet</h4>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto">
                      You have not assigned homework to your classes yet. Click &ldquo;Assign Homework&rdquo; to post coursework for your students.
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {visibleHw.map(hw => (
                    <div key={hw.id} className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs flex flex-col justify-between space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              {hw.subject}
                            </span>
                            <span className="text-[10px] font-bold text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full ml-1.5">
                              {hw.class_name} ({hw.section})
                            </span>
                          </div>
                          {hw.total_marks !== undefined && (
                            <span className="text-[10px] font-mono font-bold text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded">
                              {hw.total_marks} Marks
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-neutral-900">{hw.title}</h4>
                        <p className="text-xs text-neutral-600 leading-relaxed">{hw.description}</p>

                        {hw.instructions && (
                          <div className="p-2.5 bg-neutral-50 rounded-xl text-xs text-neutral-600">
                            <span className="font-semibold text-neutral-800 block">Instructions:</span>
                            <span>{hw.instructions}</span>
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
                        <div className="text-neutral-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Due: <strong className="text-neutral-800 font-mono">{hw.due_date}</strong></span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteHomework(hw.homework_id || hw.id)}
                          className="text-neutral-400 hover:text-rose-700 p-1 rounded cursor-pointer"
                          title="Delete Homework"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Create Homework Modal */}
            {showCreateHomeworkModal && (
              <div className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                    <h3 className="text-base font-bold text-neutral-900 font-display">Assign New Homework</h3>
                    <button
                      type="button"
                      onClick={() => setShowCreateHomeworkModal(false)}
                      className="p-1 text-neutral-400 hover:text-neutral-700 rounded cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleCreateHomework} className="space-y-3.5 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Homework Title *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Exercise 3.2 Quadratic Equations Q1-Q10"
                        value={homeworkForm.title}
                        onChange={e => setHomeworkForm({ ...homeworkForm, title: e.target.value })}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">
                          Class *
                        </label>
                        <select
                          value={homeworkForm.class_name}
                          onChange={e => setHomeworkForm({ ...homeworkForm, class_name: e.target.value })}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        >
                          {(teacher?.classes || ['Class 9', 'Class 10']).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">
                          Section *
                        </label>
                        <select
                          value={homeworkForm.section}
                          onChange={e => setHomeworkForm({ ...homeworkForm, section: e.target.value })}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        >
                          <option value="A">Section A</option>
                          <option value="B">Section B</option>
                          <option value="C">Section C</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">
                          Subject *
                        </label>
                        <input
                          type="text"
                          value={homeworkForm.subject}
                          onChange={e => setHomeworkForm({ ...homeworkForm, subject: e.target.value })}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-neutral-700 mb-1">
                          Due Date *
                        </label>
                        <input
                          type="date"
                          value={homeworkForm.due_date}
                          onChange={e => setHomeworkForm({ ...homeworkForm, due_date: e.target.value })}
                          className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Task Description *
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Detailed assignment problem statements or instructions..."
                        value={homeworkForm.description}
                        onChange={e => setHomeworkForm({ ...homeworkForm, description: e.target.value })}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 resize-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Submission Instructions (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Solve on neat registers and submit by morning assembly"
                        value={homeworkForm.instructions}
                        onChange={e => setHomeworkForm({ ...homeworkForm, instructions: e.target.value })}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div className="pt-3 border-t border-neutral-100 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={homeworkSaveLoading}
                        onClick={() => setShowCreateHomeworkModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={homeworkSaveLoading}
                        className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer shadow-2xs"
                      >
                        {homeworkSaveLoading ? 'Posting...' : 'Post Assignment'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
              </div>
</main>
    </div>
  );
};
