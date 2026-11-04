import React, { useState, useEffect } from 'react';
import {
  Users,
  GraduationCap,
  BookOpen,
  Calendar,
  CreditCard,
  Clock,
  Award,
  Bell,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Mail,
  ChevronLeft,
  ChevronRight,
  Menu,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Search,
  Check,
  X,
  FileText,
  DollarSign,
  AlertCircle,
  Save,
  Shield,
  Printer,
  Phone,
  MapPin,
  User as UserIcon,
  UserCheck,
  UserPlus,
  Link as LinkIcon,
  Unlink,
  Eye,
  Download,
  ExternalLink,
  Filter,
  Sparkles,
  Database,
  Server,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AdminAiAssistant } from './AdminAiAssistant';
import { ConfirmDialog } from './ui/ConfirmDialog';
import {
  Student,
  Teacher,
  ClassItem,
  SubjectItem,
  AdmissionApplication,
  AttendanceRecord,
  FeeRecord,
  TimetableEntry,
  Exam,
  ResultRecord,
  Announcement,
  SchoolEvent,
  GalleryItem,
  ContactMessage,
  SchoolSettings,
} from '../types';

interface AdminDashboardProps {
  onBackToWebsite: () => void;
  onRefreshSiteSettings?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onBackToWebsite,
  onRefreshSiteSettings,
}) => {
  const { user, login } = useAuth();
  const [activeSection, setActiveSection] = useState<string>('dashboard');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Dashboard Stats State
  const [stats, setStats] = useState<any>({
    totalStudents: 0,
    totalTeachers: 0,
    pendingAdmissions: 0,
    approvedAdmissions: 0,
    todayMarked: 0,
    presentToday: 0,
    attendanceRate: 100,
    totalPendingFee: 0,
    totalCollectedFee: 0,
    upcomingEvents: 0,
    totalAnnouncements: 0,
    unreadMessages: 0,
    recentAnnouncements: [],
    recentAdmissions: [],
    recentFees: [],
  });
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Module States
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionApplication[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);

  // Filters, Pagination & Responsive Drawer States
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('all');
  const [studentStatusFilter, setStudentStatusFilter] = useState('all');
  const [studentPage, setStudentPage] = useState(1);

  const [admissionSearch, setAdmissionSearch] = useState('');
  const [admissionStatusFilter, setAdmissionStatusFilter] = useState('all');
  const [admissionPage, setAdmissionPage] = useState(1);

  const [feeSearch, setFeeSearch] = useState('');
  const [feeStatusFilter, setFeeStatusFilter] = useState('all');
  const [feeClassFilter, setFeeClassFilter] = useState('all');
  const [feePage, setFeePage] = useState(1);

  // Accessible Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileSidebarOpen]);

  const [selectedStudentForModal, setSelectedStudentForModal] = useState<Student | null>(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [studentDetailData, setStudentDetailData] = useState<{
    student: Student;
    attendance: AttendanceRecord[];
    fees: FeeRecord[];
    results: ResultRecord[];
    timetable: TimetableEntry[];
  } | null>(null);
  const [studentModalActiveTab, setStudentModalActiveTab] = useState<'overview' | 'attendance' | 'fees' | 'results' | 'timetable'>('overview');
  const [isEditingStudent, setIsEditingStudent] = useState(false);
  const [editStudentForm, setEditStudentForm] = useState<Partial<Student>>({});
  const [showPrintIdCard, setShowPrintIdCard] = useState(false);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);
  const [showAddClassModal, setShowAddClassModal] = useState(false);
  const [showAddNoticeModal, setShowAddNoticeModal] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [showRecordFeeModal, setShowRecordFeeModal] = useState<FeeRecord | null>(null);

  // Parent-Child Guardian Relationship Management States
  const [parentLinksData, setParentLinksData] = useState<{
    parents: Array<{
      id: string;
      name: string;
      email: string;
      phone: string;
      linked_students: Student[];
    }>;
    all_students: Array<{
      id: string;
      admission_no: string;
      full_name: string;
      father_name: string;
      class_name: string;
      section: string;
      roll_no: string;
      parent_user_id?: string;
    }>;
  } | null>(null);
  const [parentLinksLoading, setParentLinksLoading] = useState(false);
  const [parentLinksSearch, setParentLinksSearch] = useState('');
  const [showManualLinkModal, setShowManualLinkModal] = useState(false);
  const [manualLinkParentId, setManualLinkParentId] = useState('');
  const [manualLinkStudentId, setManualLinkStudentId] = useState('');
  const [manualLinkLoading, setManualLinkLoading] = useState(false);

  // Timetable State
  const [timetableClassFilter, setTimetableClassFilter] = useState<string>('All');
  const [timetableDayFilter, setTimetableDayFilter] = useState<string>('All');
  const [timetableViewMode, setTimetableViewMode] = useState<'cards' | 'grid'>('cards');
  const [timetableSearch, setTimetableSearch] = useState<string>('');
  const [editingTimetableId, setEditingTimetableId] = useState<string | null>(null);
  const [showAddTimetableModal, setShowAddTimetableModal] = useState(false);
  const [newTimetable, setNewTimetable] = useState<Partial<TimetableEntry>>({
    day: 'Monday',
    start_time: '08:30 AM',
    end_time: '09:15 AM',
    room: 'Room 101',
    section: 'A',
  });

  // Exams & Results State
  const [examsActiveTab, setExamsActiveTab] = useState<'exams' | 'results'>('exams');
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [showAddExamModal, setShowAddExamModal] = useState(false);
  const [newExam, setNewExam] = useState<Partial<Exam>>({
    term: 'First Term',
    academic_year: '2026-2027',
  });
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [showRecordResultModal, setShowRecordResultModal] = useState(false);
  const [selectedDmcResult, setSelectedDmcResult] = useState<ResultRecord | null>(null);
  const [showDmcModal, setShowDmcModal] = useState(false);
  const [resultSearch, setResultSearch] = useState<string>('');
  const [newResultForm, setNewResultForm] = useState<{
    exam_id: string;
    student_id: string;
    subjects: Array<{ subject_name: string; total_marks: number; obtained_marks: number; grade: string }>;
    remarks: string;
    published: boolean;
  }>({
    exam_id: '',
    student_id: '',
    subjects: [
      { subject_name: 'English', total_marks: 100, obtained_marks: 85, grade: 'A1' },
      { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 90, grade: 'A1' },
      { subject_name: 'Science / Physics', total_marks: 100, obtained_marks: 80, grade: 'A1' },
    ],
    remarks: 'Good progress. Continue dedicated studies.',
    published: true,
  });
  const [resultExamFilter, setResultExamFilter] = useState<string>('All');
  const [resultClassFilter, setResultClassFilter] = useState<string>('All');

  // Events Calendar State
  const [eventStatusFilter, setEventStatusFilter] = useState<string>('All');
  const [eventSearch, setEventSearch] = useState<string>('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState<Partial<SchoolEvent>>({
    status: 'Upcoming',
    location: 'Main Auditorium',
  });

  // Gallery Manager State
  const [galleryCategoryFilter, setGalleryCategoryFilter] = useState<string>('All');
  const [gallerySearch, setGallerySearch] = useState<string>('');
  const [editingGalleryId, setEditingGalleryId] = useState<string | null>(null);
  const [selectedGalleryPhoto, setSelectedGalleryPhoto] = useState<GalleryItem | null>(null);
  const [showAddGalleryModal, setShowAddGalleryModal] = useState(false);
  const [newGallery, setNewGallery] = useState<Partial<GalleryItem>>({
    category: 'Campus',
    date: new Date().toISOString().split('T')[0],
  });

  // Attendance Form
  const [attDate, setAttDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [attClass, setAttClass] = useState<string>('Grade 10 - Matric');
  const [attBatch, setAttBatch] = useState<{ [id: string]: 'Present' | 'Absent' | 'Late' | 'Leave' }>({});
  const [attLoading, setAttLoading] = useState<boolean>(false);

  // MongoDB Atlas Backend Management State
  const [mongoStatus, setMongoStatus] = useState<any>(null);
  const [mongoLoading, setMongoLoading] = useState(false);
  const [mongoSyncing, setMongoSyncing] = useState(false);
  const [mongoCollections, setMongoCollections] = useState<any[]>([]);
  const [mongoPingRes, setMongoPingRes] = useState<any>(null);

  const fetchMongoInfo = async () => {
    setMongoLoading(true);
    try {
      const [status, colls] = await Promise.all([
        api.getMongoStatus(),
        api.getMongoCollections().catch(() => []),
      ]);
      setMongoStatus(status);
      setMongoCollections(colls);
    } catch (e: any) {
      console.warn('MongoDB status fetch error:', e);
    } finally {
      setMongoLoading(false);
    }
  };

  const handleTestMongoPing = async () => {
    try {
      const res = await api.testMongoConnection();
      setMongoPingRes(res);
      showNotification(`Ping OK: ${res.latencyMs}ms response from database "${res.databaseName}"`);
    } catch (e: any) {
      showError(e.message || 'Failed to ping MongoDB');
    }
  };

  const fetchParentLinks = async () => {
    setParentLinksLoading(true);
    try {
      const res = await api.getAdminParentLinks();
      setParentLinksData(res);
    } catch (e: any) {
      console.warn('Error fetching parent links:', e);
      showError(e.message || 'Failed to load parent-child relationships');
    } finally {
      setParentLinksLoading(false);
    }
  };

  const fetchClassAttendance = async (targetClass: string, targetDate: string) => {
    if (!targetClass || !targetDate) return;
    setAttLoading(true);
    try {
      const records = await api.getAttendance({ date: targetDate, class_name: targetClass });
      setAttendance(records || []);
      const nextBatch: { [id: string]: 'Present' | 'Absent' | 'Late' | 'Leave' } = {};
      (records || []).forEach(r => {
        if (r.student_id && r.status) {
          nextBatch[r.student_id] = r.status;
        }
      });
      setAttBatch(nextBatch);
    } catch (err: any) {
      showError(err.message || 'Failed to load attendance records');
    } finally {
      setAttLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'mongodb') {
      fetchMongoInfo();
    } else if (activeSection === 'parent-links') {
      fetchParentLinks();
    } else if (activeSection === 'attendance' && user) {
      fetchClassAttendance(attClass, attDate);
    }
  }, [activeSection, attClass, attDate, user]);

  const handleAdminLinkParent = async (parentId?: string, studentId?: string) => {
    const pId = parentId || manualLinkParentId;
    const sId = studentId || manualLinkStudentId;
    if (!pId || !sId) {
      showError('Please select both a parent account and a student to link.');
      return;
    }

    setManualLinkLoading(true);
    try {
      const res = await api.adminLinkParentStudent(pId, sId);
      showNotification(res.message || 'Student successfully linked to parent account');
      setShowManualLinkModal(false);
      setManualLinkStudentId('');
      await fetchParentLinks();
    } catch (err: any) {
      showError(err.message || 'Failed to link parent and student');
    } finally {
      setManualLinkLoading(false);
    }
  };

  const handleAdminUnlinkParent = (parentId: string, studentId: string, studentName?: string) => {
    setConfirmDialog({
      title: 'Unlink Student from Guardian Account',
      description: `Unlink ${studentName || 'this student'} from the guardian account? The student academic record itself will not be deleted.`,
      confirmLabel: 'Unlink Student',
      variant: 'warning',
      onConfirm: async () => {
        try {
          const res = await api.adminUnlinkParentStudent(parentId, studentId);
          showNotification(res.message || 'Relationship successfully removed');
          await fetchParentLinks();
        } catch (err: any) {
          showError(err.message || 'Failed to unlink student');
        }
      },
    });
  };

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [
        statsRes,
        stdsRes,
        tchsRes,
        clsRes,
        subsRes,
        admsRes,
        feeRes,
        ttRes,
        exRes,
        resRes,
        annRes,
        evRes,
        galRes,
        msgRes,
        setRes,
      ] = await Promise.allSettled([
        api.getDashboardStats(),
        api.getStudents(),
        api.getTeachers(),
        api.getClasses(),
        api.getSubjects(),
        api.getAdmissions(),
        api.getFees(),
        api.getTimetable(),
        api.getExams(),
        api.getResults(),
        api.getAnnouncements(),
        api.getEvents(),
        api.getGallery(),
        api.getContactMessages(),
        api.getSettings(),
      ]);

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value);
      } else {
        const stdList = stdsRes.status === 'fulfilled' ? stdsRes.value : [];
        const tchList = tchsRes.status === 'fulfilled' ? tchsRes.value : [];
        const admList = admsRes.status === 'fulfilled' ? admsRes.value : [];
        const feeList = feeRes.status === 'fulfilled' ? feeRes.value : [];
        const evList = evRes.status === 'fulfilled' ? evRes.value : [];
        const annList = annRes.status === 'fulfilled' ? annRes.value : [];
        const msgList = msgRes.status === 'fulfilled' ? msgRes.value : [];
        setStats({
          totalStudents: stdList.length,
          totalTeachers: tchList.length,
          pendingAdmissions: admList.filter(a => a.status === 'Pending' || a.status === 'Under Review').length,
          approvedAdmissions: admList.filter(a => a.status === 'Approved').length,
          todayMarked: 0,
          presentToday: 0,
          attendanceRate: 100,
          totalPendingFee: feeList.reduce((acc: number, f: any) => acc + (f.pending_amount || 0), 0),
          totalCollectedFee: feeList.reduce((acc: number, f: any) => acc + (f.paid_amount || 0), 0),
          upcomingEvents: evList.filter(e => e.status === 'Upcoming').length,
          totalAnnouncements: annList.length,
          unreadMessages: msgList.filter(m => !m.read).length,
          recentAnnouncements: annList.slice(0, 4),
          recentAdmissions: admList.slice(0, 5),
          recentFees: feeList.slice(0, 5),
        });
      }
      if (stdsRes.status === 'fulfilled') setStudents(stdsRes.value);
      if (tchsRes.status === 'fulfilled') setTeachers(tchsRes.value);
      if (clsRes.status === 'fulfilled') setClasses(clsRes.value);
      if (subsRes.status === 'fulfilled') setSubjects(subsRes.value);
      if (admsRes.status === 'fulfilled') setAdmissions(admsRes.value);
      if (feeRes.status === 'fulfilled') setFees(feeRes.value);
      if (ttRes.status === 'fulfilled') setTimetable(ttRes.value);
      if (exRes.status === 'fulfilled') setExams(exRes.value);
      if (resRes.status === 'fulfilled') setResults(resRes.value);
      if (annRes.status === 'fulfilled') setAnnouncements(annRes.value);
      if (evRes.status === 'fulfilled') setEvents(evRes.value);
      if (galRes.status === 'fulfilled') setGallery(galRes.value);
      if (msgRes.status === 'fulfilled') setMessages(msgRes.value);
      if (setRes.status === 'fulfilled') setSettings(setRes.value);

      const coreRejections = [statsRes, stdsRes, feeRes, resRes].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (coreRejections.length > 0 && user?.role !== 'teacher') {
        const firstReason = coreRejections[0].reason?.message || 'Unable to synchronize some operational datasets.';
        showError(firstReason);
      }
    } catch (err: any) {
      console.warn('Sync issue in admin dashboard:', err);
      showError(err?.message || 'Failed to load management console data.');
    } finally {
      setLoading(false);
    }
  };

  // Timetable Handlers
  const handleCreateTimetableEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTimetable.class_name || !newTimetable.subject || !newTimetable.day || !newTimetable.start_time || !newTimetable.end_time) {
      showError('Please fill all required timetable fields.');
      return;
    }
    try {
      if (editingTimetableId) {
        const updated = await api.updateTimetableEntry(editingTimetableId, newTimetable);
        setTimetable(prev => prev.map(t => t.id === editingTimetableId ? updated : t));
        showNotification('Timetable period updated successfully');
      } else {
        const created = await api.createTimetableEntry(newTimetable);
        setTimetable(prev => [...prev, created]);
        showNotification('Timetable slot scheduled successfully');
      }
      setShowAddTimetableModal(false);
      setEditingTimetableId(null);
      setNewTimetable({ day: 'Monday', start_time: '08:30 AM', end_time: '09:15 AM', room: 'Room 101', section: 'A' });
    } catch (err: any) {
      showError(err.message || 'Failed to save timetable slot');
    }
  };

  const handleEditTimetableSlot = (slot: TimetableEntry) => {
    setEditingTimetableId(slot.id);
    setNewTimetable({
      class_name: slot.class_name,
      section: slot.section,
      subject: slot.subject,
      teacher_name: slot.teacher_name,
      day: slot.day,
      start_time: slot.start_time,
      end_time: slot.end_time,
      room: slot.room,
    });
    setShowAddTimetableModal(true);
  };

  const handleDeleteTimetableEntry = (id: string) => {
    setConfirmDialog({
      title: 'Remove Timetable Period',
      description: 'Are you sure you want to remove this scheduled class period from the timetable?',
      confirmLabel: 'Delete Period',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteTimetableEntry(id);
          setTimetable(prev => prev.filter(t => t.id !== id));
          showNotification('Timetable slot deleted');
        } catch (err: any) {
          showError(err.message || 'Failed to delete timetable entry');
        }
      },
    });
  };

  // Exam & Result Handlers
  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExam.title || !newExam.term) {
      showError('Please enter exam title and term.');
      return;
    }
    try {
      if (editingExamId) {
        const updated = await api.updateExam(editingExamId, newExam);
        setExams(prev => prev.map(ex => ex.id === editingExamId ? updated : ex));
        showNotification(`Exam "${updated.title}" updated successfully`);
      } else {
        const created = await api.createExam(newExam);
        setExams(prev => [...prev, created]);
        showNotification(`Exam "${created.title}" created successfully`);
      }
      setShowAddExamModal(false);
      setEditingExamId(null);
      setNewExam({ term: 'First Term', academic_year: '2026-2027' });
    } catch (err: any) {
      showError(err.message || 'Failed to save exam');
    }
  };

  const handleEditExam = (exam: Exam) => {
    setEditingExamId(exam.id);
    setNewExam({
      title: exam.title,
      term: exam.term,
      academic_year: exam.academic_year,
      start_date: exam.start_date,
      end_date: exam.end_date,
      classes: exam.classes,
    });
    setShowAddExamModal(true);
  };

  const handleDeleteExam = (id: string, title: string) => {
    setConfirmDialog({
      title: 'Delete Examination Schedule',
      description: `Are you sure you want to delete exam "${title}"?`,
      confirmLabel: 'Delete Exam',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteExam(id);
          setExams(prev => prev.filter(e => e.id !== id));
          showNotification(`Exam "${title}" removed`);
        } catch (err: any) {
          showError(err.message || 'Failed to delete exam');
        }
      },
    });
  };

  const handleSaveStudentResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResultForm.exam_id || !newResultForm.student_id) {
      showError('Please select both an exam and a student.');
      return;
    }
    try {
      const targetExam = exams.find(e => e.id === newResultForm.exam_id);
      const saved = await api.saveResult({
        ...newResultForm,
        exam_title: targetExam?.title || 'Academic Assessment',
      });
      setResults(prev => {
        const idx = prev.findIndex(r => r.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [saved, ...prev];
      });
      showNotification(`Result for ${saved.student_name} saved successfully!`);
      setShowRecordResultModal(false);
      setEditingResultId(null);
    } catch (err: any) {
      showError(err.message || 'Failed to record student result');
    }
  };

  const handleEditResult = (res: ResultRecord) => {
    setEditingResultId(res.id);
    setNewResultForm({
      exam_id: res.exam_id,
      student_id: res.student_id,
      subjects: res.subjects && res.subjects.length > 0 ? res.subjects : [
        { subject_name: 'English', total_marks: 100, obtained_marks: 85, grade: 'A1' }
      ],
      remarks: res.remarks || '',
      published: res.published !== false,
    });
    setShowRecordResultModal(true);
  };

  const handleDeleteResult = (id: string, studentName: string) => {
    setConfirmDialog({
      title: 'Delete Academic Result (DMC)',
      description: `Are you sure you want to permanently remove the result record for "${studentName}"?`,
      confirmLabel: 'Delete Result',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteResult(id);
          setResults(prev => prev.filter(r => r.id !== id));
          showNotification(`Result for ${studentName} deleted`);
        } catch (err: any) {
          showError(err.message || 'Failed to delete result');
        }
      },
    });
  };

  const handleTogglePublishResult = async (id: string, currentStatus: boolean, studentName: string) => {
    try {
      const updated = await api.togglePublishResult(id, !currentStatus);
      setResults(prev => prev.map(r => r.id === id ? updated : r));
      showNotification(`Result for ${studentName} marked as ${updated.published ? 'Published' : 'Draft'}`);
    } catch (err: any) {
      showError(err.message || 'Failed to update result status');
    }
  };

  // Event Handlers
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.title || !newEvent.date) {
      showError('Event title and date are required.');
      return;
    }
    try {
      if (editingEventId) {
        const updated = await api.updateEvent(editingEventId, newEvent);
        setEvents(prev => prev.map(ev => ev.id === editingEventId ? updated : ev));
        showNotification(`Event "${updated.title}" updated!`);
      } else {
        const created = await api.createEvent({
          ...newEvent,
          cover_image: newEvent.cover_image || 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&q=80&w=600',
          status: newEvent.status || 'Upcoming',
        });
        setEvents(prev => [...prev, created]);
        showNotification(`Event "${created.title}" scheduled!`);
      }
      setShowAddEventModal(false);
      setEditingEventId(null);
      setNewEvent({ status: 'Upcoming', location: 'Main Auditorium' });
    } catch (err: any) {
      showError(err.message || 'Failed to save event');
    }
  };

  const handleEditEvent = (ev: SchoolEvent) => {
    setEditingEventId(ev.id);
    setNewEvent({
      title: ev.title,
      description: ev.description,
      date: ev.date,
      time: ev.time,
      location: ev.location,
      cover_image: ev.cover_image,
      status: ev.status,
    });
    setShowAddEventModal(true);
  };

  const handleQuickStatusEvent = async (ev: SchoolEvent, newStatus: 'Upcoming' | 'Ongoing' | 'Completed') => {
    try {
      const updated = await api.updateEvent(ev.id, { status: newStatus });
      setEvents(prev => prev.map(e => e.id === ev.id ? updated : e));
      showNotification(`Event status changed to "${newStatus}"`);
    } catch (err: any) {
      showError(err.message || 'Failed to update event status');
    }
  };

  const handleDeleteEvent = (id: string, title: string) => {
    setConfirmDialog({
      title: 'Delete School Event',
      description: `Are you sure you want to remove "${title}" from the school events calendar?`,
      confirmLabel: 'Delete Event',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteEvent(id);
          setEvents(prev => prev.filter(e => e.id !== id));
          showNotification(`Event "${title}" removed`);
        } catch (err: any) {
          showError(err.message || 'Failed to delete event');
        }
      },
    });
  };

  // Gallery Handlers
  const handleCreateGalleryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGallery.title || !newGallery.image_url) {
      showError('Please provide photo title and image URL.');
      return;
    }
    try {
      if (editingGalleryId) {
        const updated = await api.updateGalleryItem(editingGalleryId, newGallery);
        setGallery(prev => prev.map(g => g.id === editingGalleryId ? updated : g));
        showNotification(`Gallery photo "${updated.title}" updated!`);
      } else {
        const created = await api.createGalleryItem({
          ...newGallery,
          date: newGallery.date || new Date().toISOString().split('T')[0],
          category: newGallery.category || 'Campus',
        });
        setGallery(prev => [created, ...prev]);
        showNotification(`Gallery photo "${created.title}" added!`);
      }
      setShowAddGalleryModal(false);
      setEditingGalleryId(null);
      setNewGallery({ category: 'Campus', date: new Date().toISOString().split('T')[0] });
    } catch (err: any) {
      showError(err.message || 'Failed to save gallery photo');
    }
  };

  const handleEditGalleryItem = (item: GalleryItem) => {
    setEditingGalleryId(item.id);
    setNewGallery({
      title: item.title,
      caption: item.caption,
      category: item.category,
      image_url: item.image_url,
      date: item.date,
    });
    setShowAddGalleryModal(true);
  };

  const handleDeleteGalleryItem = (id: string, title: string) => {
    setConfirmDialog({
      title: 'Delete Campus Gallery Photo',
      description: `Are you sure you want to delete "${title}" from the public campus gallery?`,
      confirmLabel: 'Delete Photo',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteGalleryItem(id);
          setGallery(prev => prev.filter(g => g.id !== id));
          showNotification(`Photo "${title}" removed`);
        } catch (err: any) {
          showError(err.message || 'Failed to delete photo');
        }
      },
    });
  };

  useEffect(() => {
    if (user && ['super_admin', 'admin', 'teacher'].includes(user.role)) {
      loadAllData();
    } else {
      setLoading(false);
    }
  }, [user]);

  // Initialize attendance batch when class or students change
  useEffect(() => {
    const classStudents = students.filter(s => s.class_name === attClass);
    const initial: { [id: string]: 'Present' | 'Absent' | 'Late' | 'Leave' } = {};
    classStudents.forEach(s => {
      initial[s.id] = 'Present';
    });
    setAttBatch(initial);
  }, [attClass, students]);

  // Handle Admission Status update & optional student enrollment
  const handleUpdateAdmissionStatus = async (
    id: string,
    status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected',
    remarks: string,
    enroll: boolean
  ) => {
    try {
      await api.updateAdmissionStatus(id, status, remarks, enroll);
      showNotification(`Application marked as ${status}${enroll ? ' and student enrolled' : ''}`);
      const updated = await api.getAdmissions();
      setAdmissions(updated);
      if (enroll) {
        const stds = await api.getStudents();
        setStudents(stds);
      }
    } catch (err: any) {
      showError(err.message || 'Failed to update application');
    }
  };

  // Handle Attendance submission
  const handleSaveAttendance = async () => {
    const classStudents = students.filter(s => s.class_name === attClass);
    const records = classStudents.map(s => ({
      student_id: s.id,
      student_name: s.full_name,
      class_name: s.class_name,
      section: s.section,
      status: attBatch[s.id] || 'Present',
    }));

    try {
      await api.saveBatchAttendance(attDate, records);
      showNotification(`Saved attendance for ${records.length} students on ${attDate}`);
      await fetchClassAttendance(attClass, attDate);
      const st = await api.getDashboardStats();
      setStats(st);
    } catch (err: any) {
      showError(err.message || 'Failed to save attendance');
    }
  };

  // Handle Fee Payment
  const handleFeePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRecordFeeModal) return;

    const form = e.target as any;
    const amount = Number(form.amount.value);
    const method = form.method.value;
    const notes = form.notes.value;

    try {
      const res = await api.recordFeePayment(showRecordFeeModal.id, amount, method, notes);
      showNotification(`Payment recorded. Receipt: ${res.receipt_no}`);
      setShowRecordFeeModal(null);
      const updatedFees = await api.getFees();
      setFees(updatedFees);
      const st = await api.getDashboardStats();
      setStats(st);
    } catch (err: any) {
      showError(err.message || 'Payment recording failed');
    }
  };

  // Handle Settings Save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    try {
      await api.updateSettings(settings);
      showNotification('Website content and school configuration updated live!');
      if (onRefreshSiteSettings) onRefreshSiteSettings();
    } catch (err: any) {
      showError(err.message || 'Failed to update settings');
    }
  };

  // Open Student Profile Modal
  const handleOpenStudentModal = async (student: Student) => {
    setSelectedStudentForModal(student);
    setEditStudentForm(student);
    setIsEditingStudent(false);
    setStudentModalActiveTab('overview');
    setStudentDetailLoading(true);

    // Immediate local state fallback for instant response
    setStudentDetailData({
      student,
      attendance: attendance.filter(a => a.student_id === student.id),
      fees: fees.filter(f => f.student_id === student.id),
      results: results.filter(r => r.student_id === student.id),
      timetable: timetable.filter(t => t.class_name === student.class_name),
    });

    try {
      const data = await api.getStudentById(student.id);
      if (data && data.student) {
        setStudentDetailData(data);
        setSelectedStudentForModal(data.student);
        setEditStudentForm(data.student);
      }
    } catch (err) {
      console.warn('Fetched local records for student modal fallback:', err);
    } finally {
      setStudentDetailLoading(false);
    }
  };

  // Save Student Profile Edits
  const handleSaveStudentEdit = async () => {
    if (!selectedStudentForModal) return;
    try {
      const updated = await api.updateStudent(selectedStudentForModal.id, editStudentForm);
      showNotification(`Student ${updated.full_name} updated successfully!`);
      setSelectedStudentForModal(updated);
      setStudents(prev => prev.map(s => (s.id === updated.id ? updated : s)));
      setIsEditingStudent(false);
      setStudentDetailData(prev => (prev ? { ...prev, student: updated } : null));
    } catch (err: any) {
      showError(err.message || 'Failed to update student profile');
    }
  };

  // Delete student with confirmation dialog
  const handleDeleteStudent = (id: string, name: string) => {
    setConfirmDialog({
      title: 'Delete Student Record',
      description: `Are you sure you want to permanently delete ${name}'s enrollment record? This action cannot be undone.`,
      confirmLabel: 'Delete Student',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteStudent(id);
          showNotification(`Student ${name} deleted`);
          setStudents(prev => prev.filter(s => s.id !== id));
          if (selectedStudentForModal?.id === id) {
            setSelectedStudentForModal(null);
          }
        } catch (err: any) {
          showError(err.message || 'Failed to delete student');
        }
      },
    });
  };

  // If not logged in or role not authorized, show institution admin login gate
  if (!user || !['super_admin', 'admin', 'teacher'].includes(user.role)) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-neutral-200">
          <div className="text-center mb-6">
            <span className="text-xs font-semibold text-emerald-800 tracking-wider uppercase block mb-1">
              Shawan School & College
            </span>
            <h2 className="text-2xl font-bold text-neutral-900 font-display">
              Admin & Faculty Console
            </h2>
            <p className="text-xs text-neutral-600 mt-1">
              {user
                ? `You are signed in as ${user.name} (${user.role}). Administrator or Faculty credentials are required.`
                : 'Authentication required to access student records and institutional controls.'}
            </p>
          </div>

          {user && !['super_admin', 'admin', 'teacher'].includes(user.role) && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 mb-4 flex items-start gap-2">
              <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Access Restricted</p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Your current account ({user.email}) does not have administrative privileges. Please switch to an Administrator or Faculty account below.
                </p>
              </div>
            </div>
          )}

          {loginError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {import.meta.env.DEV && (
            <div className="space-y-2.5 mb-6">
              <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                Quick 1-Click Access:
              </p>
              <button
                type="button"
                disabled={loginLoading}
                onClick={async () => {
                  try {
                    setLoginLoading(true);
                    setLoginError(null);
                    await login('admin@shawanschool.edu.pk', 'AdminPassword123!');
                  } catch (e: any) {
                    setLoginError(e.message || 'Login failed');
                  } finally {
                    setLoginLoading(false);
                  }
                }}
                className="w-full py-3 px-4 bg-emerald-900 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold flex items-center justify-between transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">👑</span>
                  <span>Sign In as Super Administrator</span>
                </div>
                <span className="text-[10px] bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded font-mono">
                  Principal
                </span>
              </button>

              <button
                type="button"
                disabled={loginLoading}
                onClick={async () => {
                  try {
                    setLoginLoading(true);
                    setLoginError(null);
                    await login('teacher@shawanschool.edu.pk', 'TeacherPassword123!');
                  } catch (e: any) {
                    setLoginError(e.message || 'Login failed');
                  } finally {
                    setLoginLoading(false);
                  }
                }}
                className="w-full py-2.5 px-4 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-900 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">🎓</span>
                  <span>Sign In as Faculty / Teacher</span>
                </div>
                <span className="text-[10px] bg-neutral-300 text-neutral-800 px-2 py-0.5 rounded font-mono">
                  Staff
                </span>
              </button>
            </div>
          )}

          <button
            onClick={onBackToWebsite}
            className="w-full py-2.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-xl transition-colors cursor-pointer"
          >
            ← Back to School Website
          </button>
        </div>
      </div>
    );
  }

  if (loading && !students.length && !teachers.length) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-neutral-400">Loading Management System...</p>
        </div>
      </div>
    );
  }

  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Users, teacherAllowed: true },
    { id: 'ai-assistant', label: 'Admin AI Assistant', icon: Sparkles, badge: 'AI', teacherAllowed: false },
    { id: 'mongodb', label: 'MongoDB Atlas', icon: Database, badge: 'Live', teacherAllowed: false },
    { id: 'students', label: 'Students', icon: GraduationCap, teacherAllowed: true },
    { id: 'parent-links', label: 'Parent-Child Links', icon: UserCheck, teacherAllowed: false },
    { id: 'teachers', label: 'Teachers', icon: Users, teacherAllowed: false },
    { id: 'classes', label: 'Classes & Subjects', icon: BookOpen, teacherAllowed: false },
    { id: 'admissions', label: 'Admissions', icon: FileText, badge: stats?.pendingAdmissions, teacherAllowed: false },
    { id: 'attendance', label: 'Attendance', icon: Calendar, teacherAllowed: true },
    { id: 'fees', label: 'Fees Management', icon: CreditCard, teacherAllowed: false },
    { id: 'timetable', label: 'Timetable', icon: Clock, teacherAllowed: true },
    { id: 'exams', label: 'Exams & Results', icon: Award, teacherAllowed: true },
    { id: 'announcements', label: 'Announcements', icon: Bell, teacherAllowed: true },
    { id: 'events', label: 'Events Calendar', icon: Calendar, teacherAllowed: false },
    { id: 'gallery', label: 'Gallery Manager', icon: ImageIcon, teacherAllowed: false },
    { id: 'messages', label: 'Inquiries', icon: Mail, badge: stats?.unreadMessages, teacherAllowed: false },
    { id: 'settings', label: 'Website CMS & Settings', icon: SettingsIcon, teacherAllowed: false },
  ];

  const isTeacher = user?.role === 'teacher';
  const navItems = isTeacher ? allNavItems.filter(item => item.teacherAllowed) : allNavItems;

  const activeNavLabel = navItems.find(n => n.id === activeSection)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col lg:flex-row">
      {/* Toast notifications */}
      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-50 bg-emerald-950 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-emerald-800 max-w-sm"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="fixed top-4 right-4 z-50 bg-rose-950 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-rose-800 max-w-sm"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Mobile & Tablet Sticky Header Bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-neutral-950 text-white border-b border-neutral-800 px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-expanded={mobileSidebarOpen}
            aria-controls="admin-sidebar-drawer"
            aria-label="Open administrative navigation menu"
            className="min-h-[40px] min-w-[40px] p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-200 flex items-center justify-center cursor-pointer shrink-0 border border-neutral-800"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <span className="text-xs font-bold text-white block truncate">
              Shawan Admin Console
            </span>
            <span className="text-[11px] text-emerald-400 block truncate">
              {activeNavLabel}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToWebsite}
          className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Website</span>
        </button>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-neutral-950/60 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation (Slide-over drawer below lg, static column on lg+) */}
      <aside
        id="admin-sidebar-drawer"
        aria-label="Administrative sections"
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-neutral-950 text-neutral-300 flex flex-col justify-between shrink-0 border-r border-neutral-800 transition-transform duration-200 lg:static lg:w-64 lg:max-w-none lg:translate-x-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Top Brand */}
          <div className="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <span className="text-sm font-bold text-white font-display block truncate">
                Shawan School &amp; College
              </span>
              <span className="text-[11px] text-emerald-400 font-mono block truncate">
                Admin Console &middot; {user?.role}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 shrink-0">
            <button
              type="button"
              onClick={onBackToWebsite}
              className="w-full min-h-[38px] py-2 px-3 text-xs font-semibold text-neutral-200 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Back to School Website</span>
            </button>
          </div>

          {/* Nav List */}
          <nav className="px-2.5 pb-3 space-y-0.5 flex-1 overflow-y-auto no-scrollbar">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full min-h-[38px] py-2 px-3 text-xs font-medium rounded-xl flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-emerald-900 text-white font-semibold'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge ? (
                    <span className="text-[10px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 shrink-0">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User bar */}
        <div className="p-4 border-t border-neutral-800 text-xs flex items-center justify-between shrink-0">
          <div className="truncate">
            <span className="text-white font-semibold block truncate">{user?.name}</span>
            <span className="text-neutral-400 text-[11px] block truncate">{user?.email}</span>
          </div>
        </div>
      </aside>

      {/* Main Administrative Viewport */}
      <main id="main-content" className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto lg:max-h-screen">
        {/* ==================================================== */}
        {/* 1. DASHBOARD OVERVIEW */}
        {/* ==================================================== */}
        {activeSection === 'dashboard' && stats && (() => {
          const totalFeeVolume = (stats.totalCollectedFee || 0) + (stats.totalPendingFee || 0);
          const collectionRate =
            totalFeeVolume > 0 ? Math.round(((stats.totalCollectedFee || 0) / totalFeeVolume) * 100) : 0;
          const paidVoucherCount = fees.filter(f => f.status === 'Paid').length;
          const partialVoucherCount = fees.filter(f => f.status === 'Partial').length;
          const pendingVoucherCount = fees.filter(f => f.status === 'Unpaid' || f.status === 'Overdue').length;

          // Class-wise enrollment breakdown
          const enrollmentCountsMap: Record<string, number> = {};
          students.forEach(s => {
            const cName = s.class_name || 'Unassigned';
            enrollmentCountsMap[cName] = (enrollmentCountsMap[cName] || 0) + 1;
          });
          const classEnrollmentRows = Object.entries(enrollmentCountsMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
          const maxClassCount = Math.max(1, ...classEnrollmentRows.map(r => r.count));

          return (
            <div className="space-y-6 sm:space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                    Administrative Overview
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Paharpur Campus &middot; Live Enrollment, Attendance &amp; Financial Summary
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveSection('students')}
                    className="min-h-[38px] px-3.5 py-2 text-xs font-semibold text-neutral-800 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Student Directory
                  </button>
                  {!isTeacher && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('ai-assistant')}
                      className="min-h-[38px] px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Open AI Assistant</span>
                    </button>
                  )}
                </div>
              </div>

              {/* KPI Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                  <span className="text-xs font-semibold text-neutral-500 block mb-1">
                    Enrolled Students
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-neutral-950 tabular-nums">
                    {stats.totalStudents}
                  </div>
                  <span className="text-xs text-neutral-500 mt-1.5 block">
                    Active across {classes.length || Object.keys(enrollmentCountsMap).length} academic classes
                  </span>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                  <span className="text-xs font-semibold text-neutral-500 block mb-1">
                    Faculty &amp; Staff
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-neutral-950 tabular-nums">
                    {stats.totalTeachers}
                  </div>
                  <span className="text-xs text-neutral-500 mt-1.5 block">
                    Verified subject teachers
                  </span>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                  <span className="text-xs font-semibold text-neutral-500 block mb-1">
                    Today’s Attendance
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-900 tabular-nums">
                    {stats.attendanceRate}%
                  </div>
                  <span className="text-xs text-neutral-500 mt-1.5 block tabular-nums">
                    {stats.presentToday} present &middot; {stats.todayMarked} marked today
                  </span>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-neutral-200">
                  <span className="text-xs font-semibold text-neutral-500 block mb-1">
                    Admission Pipeline
                  </span>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-amber-700 tabular-nums">
                    {stats.pendingAdmissions}
                  </div>
                  <span className="text-xs text-neutral-500 mt-1.5 block tabular-nums">
                    Pending review &middot; {stats.approvedAdmissions} approved
                  </span>
                </div>
              </div>

              {/* Visual Analytics Row: Financial Collection Chart & Enrollment by Class */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Financial Overview & Collection Chart */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 space-y-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900">
                        Fee Collection &amp; Receivables
                      </h3>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Verified tuition collection progress across issued vouchers
                      </p>
                    </div>
                    {!isTeacher && (
                      <button
                        type="button"
                        onClick={() => setActiveSection('fees')}
                        className="text-xs font-semibold text-emerald-900 hover:underline whitespace-nowrap cursor-pointer"
                      >
                        Manage Fees &rarr;
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
                      <span className="text-xs text-neutral-500 block">Collected Tuition</span>
                      <div className="text-lg sm:text-xl font-bold font-mono text-emerald-900 tabular-nums mt-0.5">
                        PKR {stats.totalCollectedFee.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80">
                      <span className="text-xs text-neutral-500 block">Outstanding Balance</span>
                      <div className="text-lg sm:text-xl font-bold font-mono text-rose-800 tabular-nums mt-0.5">
                        PKR {stats.totalPendingFee.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* SVG Collection Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-neutral-700">Session Collection Ratio</span>
                      <span className="font-mono font-bold text-emerald-900 tabular-nums">
                        {collectionRate}% recovered
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 4"
                      preserveAspectRatio="none"
                      className="w-full h-2.5 rounded-full overflow-hidden bg-neutral-100"
                      role="img"
                      aria-label={`Fee collection rate ${collectionRate} percent`}
                    >
                      <rect x="0" y="0" width="100" height="4" className="fill-neutral-200" />
                      <rect
                        x="0"
                        y="0"
                        width={Math.max(0, Math.min(100, collectionRate))}
                        height="4"
                        className="fill-emerald-700"
                      />
                    </svg>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600 pt-1 tabular-nums">
                      <span>Paid: <strong className="text-emerald-800">{paidVoucherCount}</strong></span>
                      <span aria-hidden="true">&middot;</span>
                      <span>Partial: <strong className="text-amber-800">{partialVoucherCount}</strong></span>
                      <span aria-hidden="true">&middot;</span>
                      <span>Pending: <strong className="text-rose-800">{pendingVoucherCount}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Class-wise Enrollment Distribution Chart */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900">
                        Enrollment by Academic Class
                      </h3>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Active student distribution across top enrolled classes
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection('classes')}
                      className="text-xs font-semibold text-emerald-900 hover:underline whitespace-nowrap cursor-pointer"
                    >
                      All Classes &rarr;
                    </button>
                  </div>

                  {classEnrollmentRows.length === 0 ? (
                    <div className="py-8 text-center text-xs text-neutral-500">
                      No class enrollment records available yet.
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      {classEnrollmentRows.map(row => {
                        const barWidth = Math.max(6, Math.round((row.count / maxClassCount) * 100));
                        return (
                          <div key={row.name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-neutral-800 truncate pr-2">{row.name}</span>
                              <span className="font-mono tabular-nums text-neutral-600 shrink-0">
                                {row.count} {row.count === 1 ? 'student' : 'students'}
                              </span>
                            </div>
                            <svg
                              viewBox="0 0 100 3"
                              preserveAspectRatio="none"
                              className="w-full h-2 rounded-full overflow-hidden bg-neutral-100"
                              aria-hidden="true"
                            >
                              <rect x="0" y="0" width="100" height="3" className="fill-neutral-100" />
                              <rect x="0" y="0" width={barWidth} height="3" className="fill-emerald-800" />
                            </svg>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Activity Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Admissions */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-neutral-900">
                      Recent Admission Applications
                    </h3>
                    {!isTeacher && (
                      <button
                        type="button"
                        onClick={() => setActiveSection('admissions')}
                        className="text-xs font-semibold text-emerald-900 hover:underline cursor-pointer tabular-nums"
                      >
                        View All ({admissions.length})
                      </button>
                    )}
                  </div>

                  {admissions.length === 0 ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
                      No admission applications submitted yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {admissions.slice(0, 4).map(adm => (
                        <div
                          key={adm.id}
                          className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-neutral-900 block truncate">
                              {adm.student_name}
                            </span>
                            <span className="text-neutral-500 text-[11px] block truncate">
                              {adm.class_applying} &middot; <span className="font-mono">{adm.application_no}</span>
                            </span>
                          </div>
                          <span
                            className={`text-[11px] font-semibold shrink-0 ${
                              adm.status === 'Approved'
                                ? 'text-emerald-800'
                                : adm.status === 'Under Review'
                                ? 'text-amber-800'
                                : adm.status === 'Rejected'
                                ? 'text-rose-800'
                                : 'text-neutral-600'
                            }`}
                          >
                            {adm.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Incoming Inquiries */}
                <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-neutral-900">
                      Parent &amp; Visitor Inquiries
                    </h3>
                    {!isTeacher && (
                      <button
                        type="button"
                        onClick={() => setActiveSection('messages')}
                        className="text-xs font-semibold text-emerald-900 hover:underline cursor-pointer tabular-nums"
                      >
                        View All ({messages.length})
                      </button>
                    )}
                  </div>

                  {messages.length === 0 ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
                      No visitor messages received yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {messages.slice(0, 4).map(msg => (
                        <div key={msg.id} className="py-3 first:pt-0 last:pb-0 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-neutral-900 truncate">{msg.name}</span>
                            <span className="text-[11px] text-neutral-500 font-mono tabular-nums shrink-0">
                              {new Date(msg.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-neutral-600 line-clamp-1">
                            {msg.subject}: {msg.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ==================================================== */}
        {/* 1.25. ADMIN-ONLY AI ASSISTANT (RESTRICTED) */}
        {/* ==================================================== */}
        {activeSection === 'ai-assistant' && (
          <div className="space-y-4">
            <AdminAiAssistant />
          </div>
        )}

        {/* ==================================================== */}
        {/* 1.5. MONGODB ATLAS CLOUD BACKEND MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'mongodb' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                    MongoDB Atlas Database Backend
                  </h2>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    {mongoStatus?.connected ? 'CONNECTED' : 'STANDBY'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Production MongoDB Atlas connection for Shawan School and College (Database: {mongoStatus?.databaseName || 'shawan_school'})
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={mongoLoading}
                  onClick={fetchMongoInfo}
                  className="px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded-lg cursor-pointer transition-colors"
                >
                  {mongoLoading ? 'Checking...' : 'Refresh Status'}
                </button>
                <button
                  type="button"
                  onClick={handleTestMongoPing}
                  className="px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Test Ping</span>
                </button>
                <button
                  type="button"
                  disabled={mongoSyncing}
                  onClick={async () => {
                    try {
                      setMongoSyncing(true);
                      const res = await api.syncAllToMongo();
                      showNotification(res.message || 'Data successfully synced to MongoDB!');
                      fetchMongoInfo();
                    } catch (e: any) {
                      showError(e.message || 'Sync failed.');
                    } finally {
                      setMongoSyncing(false);
                    }
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm transition-colors"
                >
                  {mongoSyncing ? 'Synchronizing...' : 'Sync Data to MongoDB'}
                </button>
              </div>
            </div>

            {/* Connection Credentials Card */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-neutral-900 font-display flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-800" />
                MongoDB Atlas Cluster Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
                    Database Name
                  </span>
                  <span className="font-mono font-bold text-neutral-900 text-sm">
                    {mongoStatus?.databaseName || 'shawan_school'}
                  </span>
                </div>

                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
                    Database Host
                  </span>
                  <span className="font-mono text-neutral-900 truncate block">
                    {mongoStatus?.host || 'localhost:27017'}
                  </span>
                </div>

                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
                    Ping Latency
                  </span>
                  <span className="font-semibold text-emerald-800 flex items-center gap-1.5 font-mono text-sm">
                    {mongoStatus?.latencyMs !== undefined ? `${mongoStatus.latencyMs} ms` : 'Active'}
                  </span>
                </div>

                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
                    ODM Architecture
                  </span>
                  <span className="font-semibold text-neutral-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Mongoose ODM v8+
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block">
                    Secured Connection URI (Masked)
                  </span>
                  <span className="font-mono text-neutral-800 text-[11px]">
                    {mongoStatus?.uriMasked || 'mongodb+srv://admin:*****@cluster0.mongodb.net/shawan_school'}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500">
                  Protected by Express Backend Proxy • Never exposed to browser
                </div>
              </div>
            </div>

            {/* Mongoose Collections Live Grid */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-900 font-display flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-800" />
                    Verified Mongoose Collections ({mongoCollections?.length || 20})
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Real-time MongoDB Atlas document counts and schema indexes
                  </p>
                </div>
                <span className="text-xs font-semibold text-neutral-600 font-mono">
                  Database: {mongoStatus?.databaseName || 'shawan_school'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 text-xs">
                {[
                  { name: 'users', label: 'Users & Auth' },
                  { name: 'students', label: 'Students' },
                  { name: 'teachers', label: 'Teachers' },
                  { name: 'parents', label: 'Parents' },
                  { name: 'classes', label: 'Classes' },
                  { name: 'sections', label: 'Sections' },
                  { name: 'subjects', label: 'Subjects' },
                  { name: 'enrollments', label: 'Enrollments' },
                  { name: 'attendances', label: 'Attendance' },
                  { name: 'exams', label: 'Exams' },
                  { name: 'results', label: 'Results & DMCs' },
                  { name: 'fees', label: 'Fee Invoices' },
                  { name: 'feepayments', label: 'Payments' },
                  { name: 'admissions', label: 'Admissions' },
                  { name: 'timetables', label: 'Timetable' },
                  { name: 'announcements', label: 'Announcements' },
                  { name: 'schoolevents', label: 'School Events' },
                  { name: 'galleries', label: 'Photo Gallery' },
                  { name: 'contactmessages', label: 'Contact Msgs' },
                  { name: 'auditlogs', label: 'Audit Logs' },
                ].map(col => {
                  const match = mongoCollections?.find(c => c.name === col.name);
                  const count = match ? match.count : 0;
                  return (
                    <div
                      key={col.name}
                      className="p-3 rounded-xl border bg-emerald-50/50 border-emerald-200 text-emerald-950 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium truncate text-[11px]">{col.name}</span>
                        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-neutral-500 text-[10px]">{col.label}</span>
                        <span className="font-bold font-mono text-emerald-900 bg-white px-1.5 py-0.5 rounded border border-emerald-300">
                          {count} docs
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MongoDB Atlas Setup Guide */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-neutral-900 font-display">
                MongoDB Atlas Setup & Cloud Integration Guide
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5">
                  <span className="font-bold text-neutral-900 flex items-center gap-1.5">
                    1. Create Cloud Cluster
                  </span>
                  <p className="text-neutral-600 text-[11px] leading-relaxed">
                    Log in to <strong>MongoDB Atlas</strong> (cloud.mongodb.com) and deploy a free M0 or production cluster in your preferred region.
                  </p>
                </div>

                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5">
                  <span className="font-bold text-neutral-900 flex items-center gap-1.5">
                    2. Configure Network & Users
                  </span>
                  <p className="text-neutral-600 text-[11px] leading-relaxed">
                    Under <strong>Network Access</strong>, add IP Whitelist <code className="bg-neutral-200 px-1 py-0.5 rounded text-[10px]">0.0.0.0/0</code>. Under <strong>Database Access</strong>, create a user with readWrite privileges.
                  </p>
                </div>

                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-1.5">
                  <span className="font-bold text-neutral-900 flex items-center gap-1.5">
                    3. Set MONGODB_URI
                  </span>
                  <p className="text-neutral-600 text-[11px] leading-relaxed">
                    Copy the connection string into your backend <code className="bg-neutral-200 px-1 py-0.5 rounded text-[10px]">.env</code>:
                    <br />
                    <code className="text-[10px] text-emerald-800 break-all font-mono">MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/shawan_school</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 2. STUDENTS MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'students' && (() => {
          const PAGE_SIZE = 10;
          const uniqueStudentClasses = Array.from(
            new Set([
              ...classes.map(c => c.name),
              ...students.map(s => s.class_name).filter(Boolean),
            ])
          );
          const filteredStudents = students.filter(s => {
            const q = studentSearch.trim().toLowerCase();
            const matchesSearch =
              !q ||
              s.full_name.toLowerCase().includes(q) ||
              s.father_name.toLowerCase().includes(q) ||
              s.admission_no.toLowerCase().includes(q) ||
              s.roll_no.toLowerCase().includes(q);
            const matchesClass = studentClassFilter === 'all' || s.class_name === studentClassFilter;
            const matchesStatus =
              studentStatusFilter === 'all' ||
              (s.academic_status || 'Active').toLowerCase() === studentStatusFilter.toLowerCase();
            return matchesSearch && matchesClass && matchesStatus;
          });
          const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
          const safeStudentPage = Math.min(studentPage, totalStudentPages);
          const paginatedStudents = filteredStudents.slice(
            (safeStudentPage - 1) * PAGE_SIZE,
            safeStudentPage * PAGE_SIZE
          );

          return (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                    Student Directory
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Enrolled students, academic profiles, guardian contacts, and roll numbers
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(true)}
                  className="min-h-[40px] px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Student</span>
                </button>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-neutral-200 flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <label htmlFor="admin-student-search" className="sr-only">
                    Search students by name, father name, roll number, or admission number
                  </label>
                  <input
                    id="admin-student-search"
                    type="text"
                    placeholder="Search student, father name, roll no, or admission no..."
                    value={studentSearch}
                    onChange={e => {
                      setStudentSearch(e.target.value);
                      setStudentPage(1);
                    }}
                    className="w-full min-h-[40px] text-xs py-2 pl-9.5 pr-4 bg-neutral-50 focus:bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                  />
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
                  <label htmlFor="admin-student-class-filter" className="sr-only">
                    Filter by Class
                  </label>
                  <select
                    id="admin-student-class-filter"
                    value={studentClassFilter}
                    onChange={e => {
                      setStudentClassFilter(e.target.value);
                      setStudentPage(1);
                    }}
                    className="min-h-[40px] text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="all">All Classes</option>
                    {uniqueStudentClasses.map(cName => (
                      <option key={cName} value={cName}>
                        {cName}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="admin-student-status-filter" className="sr-only">
                    Filter by Academic Status
                  </label>
                  <select
                    id="admin-student-status-filter"
                    value={studentStatusFilter}
                    onChange={e => {
                      setStudentStatusFilter(e.target.value);
                      setStudentPage(1);
                    }}
                    className="min-h-[40px] text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="all">All Statuses</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Graduated">Graduated</option>
                  </select>

                  {(studentSearch || studentClassFilter !== 'all' || studentStatusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setStudentSearch('');
                        setStudentClassFilter('all');
                        setStudentStatusFilter('all');
                        setStudentPage(1);
                      }}
                      className="min-h-[40px] px-3 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-xl whitespace-nowrap cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Students Table */}
              <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                {filteredStudents.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <p className="text-sm font-semibold text-neutral-800">No matching student records</p>
                    <p className="text-xs text-neutral-500">
                      Adjust your search or class filter, or add a new student enrollment record.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                          <tr>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Adm No</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Student Name</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Father Name</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Class &amp; Section</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Roll No</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Contact</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Status</th>
                            <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {paginatedStudents.map(student => (
                            <tr key={student.id} className="hover:bg-neutral-50/80 transition-colors">
                              <td className="py-3 px-4 font-mono tabular-nums font-medium text-neutral-800 whitespace-nowrap">
                                {student.admission_no}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenStudentModal(student)}
                                  className="font-semibold text-neutral-900 hover:text-emerald-800 hover:underline text-left cursor-pointer"
                                >
                                  {student.full_name}
                                </button>
                              </td>
                              <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{student.father_name}</td>
                              <td className="py-3 px-4 text-neutral-700 whitespace-nowrap">
                                {student.class_name} ({student.section})
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{student.roll_no}</td>
                              <td className="py-3 px-4 font-mono tabular-nums text-neutral-600 whitespace-nowrap">
                                {student.contact_no}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className="text-xs font-semibold text-emerald-800">
                                  {student.academic_status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStudentModal(student)}
                                    aria-label={`View profile of ${student.full_name}`}
                                    className="min-h-[34px] px-2.5 py-1.5 text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-[11px] font-semibold"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    <span>Dossier</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteStudent(student.id, student.full_name)}
                                    aria-label={`Delete ${student.full_name}`}
                                    className="min-h-[34px] min-w-[34px] p-1.5 text-neutral-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="px-4 py-3 bg-neutral-50/70 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
                      <span className="tabular-nums">
                        Showing <strong>{(safeStudentPage - 1) * PAGE_SIZE + 1}</strong>&ndash;
                        <strong>{Math.min(safeStudentPage * PAGE_SIZE, filteredStudents.length)}</strong> of{' '}
                        <strong>{filteredStudents.length}</strong> students
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={safeStudentPage <= 1}
                          onClick={() => setStudentPage(p => Math.max(1, p - 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Prev</span>
                        </button>
                        <span className="font-mono tabular-nums text-[11px] px-1">
                          Page {safeStudentPage} / {totalStudentPages}
                        </span>
                        <button
                          type="button"
                          disabled={safeStudentPage >= totalStudentPages}
                          onClick={() => setStudentPage(p => Math.min(totalStudentPages, p + 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ==================================================== */}
        {/* PARENT-CHILD GUARDIAN RELATIONSHIP MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'parent-links' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  Parent-Child Guardian Relationships
                </h2>
                <p className="text-xs text-neutral-500">
                  Manage institutional parent accounts, linked student dossiers, and administrative assignments
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchParentLinks}
                  disabled={parentLinksLoading}
                  className="py-2 px-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-xl border border-neutral-300 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManualLinkModal(true);
                    setManualLinkParentId('');
                    setManualLinkStudentId('');
                  }}
                  className="py-2 px-4 bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Manually Link Parent to Student</span>
                </button>
              </div>
            </div>

            {/* Metrics cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs">
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  Total Parents
                </div>
                <div className="text-2xl font-bold font-display text-neutral-900 mt-1">
                  {parentLinksData?.parents.length || 0}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs">
                <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                  Linked Relationships
                </div>
                <div className="text-2xl font-bold font-display text-emerald-900 mt-1">
                  {parentLinksData?.parents.reduce((acc, p) => acc + (p.linked_students?.length || 0), 0) || 0}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs">
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  Active Linked Parents
                </div>
                <div className="text-2xl font-bold font-display text-neutral-900 mt-1">
                  {parentLinksData?.parents.filter(p => p.linked_students?.length > 0).length || 0}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs">
                <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
                  Unlinked Parents
                </div>
                <div className="text-2xl font-bold font-display text-amber-900 mt-1">
                  {parentLinksData?.parents.filter(p => !p.linked_students || p.linked_students.length === 0).length || 0}
                </div>
              </div>
            </div>

            {/* Filter / Search Bar */}
            <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by parent name, email, phone, or student name/roll..."
                  value={parentLinksSearch}
                  onChange={e => setParentLinksSearch(e.target.value)}
                  className="w-full text-xs py-2 pl-9 pr-4 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div className="text-xs text-neutral-500">
                Showing{' '}
                <strong className="text-neutral-900">
                  {
                    (parentLinksData?.parents || []).filter(p => {
                      if (!parentLinksSearch) return true;
                      const q = parentLinksSearch.toLowerCase();
                      const parentMatch =
                        p.name.toLowerCase().includes(q) ||
                        p.email.toLowerCase().includes(q) ||
                        (p.phone && p.phone.toLowerCase().includes(q));
                      const kidMatch = (p.linked_students || []).some(
                        k =>
                          k.full_name.toLowerCase().includes(q) ||
                          k.roll_no.toLowerCase().includes(q) ||
                          k.admission_no.toLowerCase().includes(q)
                      );
                      return parentMatch || kidMatch;
                    }).length
                  }
                </strong>{' '}
                parent accounts
              </div>
            </div>

            {/* Parent Accounts & Linked Students Table */}
            <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
              {parentLinksLoading ? (
                <div className="p-8 text-center text-xs text-neutral-500">
                  <div className="w-6 h-6 border-2 border-emerald-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading parent accounts & institutional linkages...
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                      <tr>
                        <th className="py-3 px-4">Parent / Guardian Account</th>
                        <th className="py-3 px-4">Contact Info</th>
                        <th className="py-3 px-4">Linked Children / Students</th>
                        <th className="py-3 px-4 text-right">Relationship Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {(parentLinksData?.parents || [])
                        .filter(p => {
                          if (!parentLinksSearch) return true;
                          const q = parentLinksSearch.toLowerCase();
                          const parentMatch =
                            p.name.toLowerCase().includes(q) ||
                            p.email.toLowerCase().includes(q) ||
                            (p.phone && p.phone.toLowerCase().includes(q));
                          const kidMatch = (p.linked_students || []).some(
                            k =>
                              k.full_name.toLowerCase().includes(q) ||
                              k.roll_no.toLowerCase().includes(q) ||
                              k.admission_no.toLowerCase().includes(q)
                          );
                          return parentMatch || kidMatch;
                        })
                        .map(parent => (
                          <tr key={parent.id} className="hover:bg-neutral-50/60 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-bold text-neutral-900">{parent.name}</div>
                              <span className="text-[10px] font-mono text-neutral-400">ID: {parent.id}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-neutral-700">{parent.email}</div>
                              {parent.phone && (
                                <div className="text-[11px] text-neutral-500 font-mono mt-0.5">{parent.phone}</div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {parent.linked_students && parent.linked_students.length > 0 ? (
                                <div className="space-y-1.5">
                                  {parent.linked_students.map(kid => (
                                    <div
                                      key={kid.id}
                                      className="inline-flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1 mr-2 text-xs"
                                    >
                                      <span className="font-bold text-neutral-900">{kid.full_name}</span>
                                      <span className="text-neutral-500 font-medium">
                                        (Class {kid.class_name} · Roll #{kid.roll_no})
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleAdminUnlinkParent(parent.id, kid.id, kid.full_name)
                                        }
                                        className="text-rose-500 hover:text-rose-700 ml-1 p-0.5 rounded cursor-pointer"
                                        title="Unlink this child"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                  No child linked
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setManualLinkParentId(parent.id);
                                  setManualLinkStudentId('');
                                  setShowManualLinkModal(true);
                                }}
                                className="py-1 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Link Student</span>
                              </button>
                            </td>
                          </tr>
                        ))}

                      {(!parentLinksData || parentLinksData.parents.length === 0) && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-xs text-neutral-500">
                            No parent accounts registered in system yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Manual Link Modal */}
            {showManualLinkModal && (
              <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-neutral-200 relative">
                  <button
                    onClick={() => setShowManualLinkModal(false)}
                    className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
                  >
                    ✕
                  </button>

                  <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
                    Manually Link Student to Guardian Account
                  </h3>
                  <p className="text-xs text-neutral-500 mb-5">
                    Assign a student to a parent account. The relationship will be saved directly to the database.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Select Parent Account *
                      </label>
                      <select
                        value={manualLinkParentId}
                        onChange={e => setManualLinkParentId(e.target.value)}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="">-- Choose Parent --</option>
                        {(parentLinksData?.parents || []).map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.email})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Select Student to Link *
                      </label>
                      <select
                        value={manualLinkStudentId}
                        onChange={e => setManualLinkStudentId(e.target.value)}
                        className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="">-- Choose Student --</option>
                        {(parentLinksData?.all_students || []).map(s => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} · Class: {s.class_name} · Roll: {s.roll_no} (Adm #{s.admission_no})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowManualLinkModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminLinkParent()}
                        disabled={manualLinkLoading || !manualLinkParentId || !manualLinkStudentId}
                        className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer flex items-center gap-1.5"
                      >
                        {manualLinkLoading ? 'Saving...' : 'Confirm & Save Link'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* 3. ADMISSIONS MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'admissions' && (() => {
          const PAGE_SIZE = 10;
          const filteredAdmissions = admissions.filter(adm => {
            const q = admissionSearch.trim().toLowerCase();
            const matchesSearch =
              !q ||
              adm.student_name.toLowerCase().includes(q) ||
              adm.father_name.toLowerCase().includes(q) ||
              adm.application_no.toLowerCase().includes(q) ||
              (adm.parent_phone || '').toLowerCase().includes(q);
            const matchesStatus = admissionStatusFilter === 'all' || adm.status === admissionStatusFilter;
            return matchesSearch && matchesStatus;
          });
          const totalAdmPages = Math.max(1, Math.ceil(filteredAdmissions.length / PAGE_SIZE));
          const safeAdmPage = Math.min(admissionPage, totalAdmPages);
          const paginatedAdmissions = filteredAdmissions.slice(
            (safeAdmPage - 1) * PAGE_SIZE,
            safeAdmPage * PAGE_SIZE
          );

          return (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                  Online Admission Applications
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Review submitted applications, verify guardian details, and issue enrollment decisions
                </p>
              </div>

              {/* Search & Status Filter Bar */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-neutral-200 flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <label htmlFor="admin-admission-search" className="sr-only">
                    Search admission applications
                  </label>
                  <input
                    id="admin-admission-search"
                    type="text"
                    placeholder="Search reference no, applicant name, father name, or phone..."
                    value={admissionSearch}
                    onChange={e => {
                      setAdmissionSearch(e.target.value);
                      setAdmissionPage(1);
                    }}
                    className="w-full min-h-[40px] text-xs py-2 pl-9.5 pr-4 bg-neutral-50 focus:bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="admin-admission-status-filter" className="sr-only">
                    Filter by application status
                  </label>
                  <select
                    id="admin-admission-status-filter"
                    value={admissionStatusFilter}
                    onChange={e => {
                      setAdmissionStatusFilter(e.target.value);
                      setAdmissionPage(1);
                    }}
                    className="min-h-[40px] text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="all">All Statuses ({admissions.length})</option>
                    <option value="Pending">Pending</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>

                  {(admissionSearch || admissionStatusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdmissionSearch('');
                        setAdmissionStatusFilter('all');
                        setAdmissionPage(1);
                      }}
                      className="min-h-[40px] px-3 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-xl whitespace-nowrap cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                {filteredAdmissions.length === 0 ? (
                  <div className="p-10 text-center space-y-1.5">
                    <p className="text-sm font-semibold text-neutral-800">No matching admission applications</p>
                    <p className="text-xs text-neutral-500">
                      Try clearing your search or selecting a different status filter.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                          <tr>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Reference No</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Candidate</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Father Name</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Class Applying</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Parent Phone</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Status</th>
                            <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">Decision / Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {paginatedAdmissions.map(adm => (
                            <tr key={adm.id} className="hover:bg-neutral-50/80 transition-colors">
                              <td className="py-3 px-4 font-mono tabular-nums font-bold text-neutral-900 whitespace-nowrap">
                                {adm.application_no}
                              </td>
                              <td className="py-3 px-4 font-semibold text-neutral-900 whitespace-nowrap">
                                {adm.student_name}
                              </td>
                              <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{adm.father_name}</td>
                              <td className="py-3 px-4 whitespace-nowrap">{adm.class_applying}</td>
                              <td className="py-3 px-4 font-mono tabular-nums text-neutral-600 whitespace-nowrap">
                                {adm.parent_phone}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`text-xs font-semibold ${
                                    adm.status === 'Approved'
                                      ? 'text-emerald-800'
                                      : adm.status === 'Under Review'
                                      ? 'text-amber-800'
                                      : adm.status === 'Rejected'
                                      ? 'text-rose-800'
                                      : 'text-neutral-700'
                                  }`}
                                >
                                  {adm.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  {adm.status !== 'Approved' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateAdmissionStatus(
                                          adm.id,
                                          'Approved',
                                          'Admission confirmed and enrolled.',
                                          true
                                        )
                                      }
                                      className="min-h-[32px] px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer whitespace-nowrap"
                                    >
                                      Approve &amp; Enroll
                                    </button>
                                  )}
                                  {adm.status !== 'Under Review' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateAdmissionStatus(
                                          adm.id,
                                          'Under Review',
                                          'Documents pending verification.',
                                          false
                                        )
                                      }
                                      className="min-h-[32px] px-2.5 py-1 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg cursor-pointer whitespace-nowrap"
                                    >
                                      Mark Review
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="px-4 py-3 bg-neutral-50/70 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
                      <span className="tabular-nums">
                        Showing <strong>{(safeAdmPage - 1) * PAGE_SIZE + 1}</strong>&ndash;
                        <strong>{Math.min(safeAdmPage * PAGE_SIZE, filteredAdmissions.length)}</strong> of{' '}
                        <strong>{filteredAdmissions.length}</strong> applications
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={safeAdmPage <= 1}
                          onClick={() => setAdmissionPage(p => Math.max(1, p - 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Prev</span>
                        </button>
                        <span className="font-mono tabular-nums text-[11px] px-1">
                          Page {safeAdmPage} / {totalAdmPages}
                        </span>
                        <button
                          type="button"
                          disabled={safeAdmPage >= totalAdmPages}
                          onClick={() => setAdmissionPage(p => Math.min(totalAdmPages, p + 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ==================================================== */}
        {/* 4. ATTENDANCE MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'attendance' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                Class Attendance Register
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Mark daily morning attendance for any class and save to the academic database
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-neutral-200">
                <div>
                  <label htmlFor="admin-att-class" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Select Class
                  </label>
                  <select
                    id="admin-att-class"
                    value={attClass}
                    onChange={e => setAttClass(e.target.value)}
                    className="w-full min-h-[40px] text-xs py-2 px-3 bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-emerald-700/20"
                  >
                    {classes.map(c => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="admin-att-date" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Attendance Date
                  </label>
                  <input
                    id="admin-att-date"
                    type="date"
                    value={attDate}
                    onChange={e => setAttDate(e.target.value)}
                    className="w-full min-h-[40px] text-xs py-2 px-3 bg-white border border-neutral-300 rounded-xl focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleSaveAttendance}
                    className="w-full min-h-[40px] py-2.5 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Attendance Register</span>
                  </button>
                </div>
              </div>

              {/* Student Attendance List */}
              <div className="space-y-2.5">
                <div className="hidden sm:flex items-center justify-between text-xs text-neutral-500 px-2 pb-1 font-semibold">
                  <span>Student Name &amp; Roll</span>
                  <span>Attendance Status</span>
                </div>

                {attLoading ? (
                  <div className="p-8 text-center text-xs text-neutral-500">
                    Loading saved attendance register for {attClass} on {attDate}...
                  </div>
                ) : students.filter(s => s.class_name === attClass).length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-500">
                    No active students enrolled in {attClass}.
                  </div>
                ) : (
                  students
                    .filter(s => s.class_name === attClass)
                    .map(std => (
                      <div
                        key={std.id}
                        className="p-3 sm:p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-neutral-900 block truncate">{std.full_name}</span>
                          <span className="text-[11px] text-neutral-500 font-mono tabular-nums">
                            Roll: {std.roll_no} &middot; Adm: {std.admission_no}
                          </span>
                        </div>

                        <div className="grid grid-cols-4 sm:flex items-center gap-1.5 shrink-0">
                          {(['Present', 'Absent', 'Late', 'Leave'] as const).map(st => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setAttBatch({ ...attBatch, [std.id]: st })}
                              className={`min-h-[34px] px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                                attBatch[std.id] === st
                                  ? st === 'Present'
                                    ? 'bg-emerald-800 text-white'
                                    : st === 'Absent'
                                    ? 'bg-rose-800 text-white'
                                    : st === 'Late'
                                    ? 'bg-amber-700 text-white'
                                    : 'bg-blue-800 text-white'
                                  : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 5. FEES MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'fees' && (() => {
          const PAGE_SIZE = 10;
          const uniqueFeeClasses = Array.from(new Set(fees.map(f => f.class_name).filter(Boolean)));
          const filteredFees = fees.filter(f => {
            const q = feeSearch.trim().toLowerCase();
            const matchesSearch =
              !q ||
              f.student_name.toLowerCase().includes(q) ||
              `${f.fee_month} ${f.year}`.toLowerCase().includes(q);
            const matchesStatus = feeStatusFilter === 'all' || f.status === feeStatusFilter;
            const matchesClass = feeClassFilter === 'all' || f.class_name === feeClassFilter;
            return matchesSearch && matchesStatus && matchesClass;
          });
          const totalFeePages = Math.max(1, Math.ceil(filteredFees.length / PAGE_SIZE));
          const safeFeePage = Math.min(feePage, totalFeePages);
          const paginatedFees = filteredFees.slice(
            (safeFeePage - 1) * PAGE_SIZE,
            safeFeePage * PAGE_SIZE
          );

          return (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 font-display">
                    Tuition &amp; Fee Vouchers
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Manage monthly fee challans, record verified receipts, and monitor pending balances
                  </p>
                </div>
              </div>

              {/* Fee Search & Filter Bar */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-neutral-200 flex flex-col md:flex-row items-stretch md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <label htmlFor="admin-fee-search" className="sr-only">
                    Search fee vouchers by student name or billing month
                  </label>
                  <input
                    id="admin-fee-search"
                    type="text"
                    placeholder="Search student name or billing month..."
                    value={feeSearch}
                    onChange={e => {
                      setFeeSearch(e.target.value);
                      setFeePage(1);
                    }}
                    className="w-full min-h-[40px] text-xs py-2 pl-9.5 pr-4 bg-neutral-50 focus:bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                  />
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
                  <label htmlFor="admin-fee-status-filter" className="sr-only">
                    Filter by payment status
                  </label>
                  <select
                    id="admin-fee-status-filter"
                    value={feeStatusFilter}
                    onChange={e => {
                      setFeeStatusFilter(e.target.value);
                      setFeePage(1);
                    }}
                    className="min-h-[40px] text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="all">All Statuses</option>
                    <option value="Paid">Paid</option>
                    <option value="Partial">Partial</option>
                    <option value="Unpaid">Unpaid</option>
                    <option value="Overdue">Overdue</option>
                  </select>

                  <label htmlFor="admin-fee-class-filter" className="sr-only">
                    Filter by class
                  </label>
                  <select
                    id="admin-fee-class-filter"
                    value={feeClassFilter}
                    onChange={e => {
                      setFeeClassFilter(e.target.value);
                      setFeePage(1);
                    }}
                    className="min-h-[40px] text-xs py-2 px-3 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  >
                    <option value="all">All Classes</option>
                    {uniqueFeeClasses.map(cName => (
                      <option key={cName} value={cName}>
                        {cName}
                      </option>
                    ))}
                  </select>

                  {(feeSearch || feeStatusFilter !== 'all' || feeClassFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setFeeSearch('');
                        setFeeStatusFilter('all');
                        setFeeClassFilter('all');
                        setFeePage(1);
                      }}
                      className="min-h-[40px] px-3 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-xl whitespace-nowrap cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                {filteredFees.length === 0 ? (
                  <div className="p-10 text-center space-y-1.5">
                    <p className="text-sm font-semibold text-neutral-800">No matching fee vouchers</p>
                    <p className="text-xs text-neutral-500">
                      Adjust your search query or payment status filter.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                          <tr>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Student</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Class</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Month</th>
                            <th scope="col" className="py-3 px-4 font-mono whitespace-nowrap">Total</th>
                            <th scope="col" className="py-3 px-4 font-mono whitespace-nowrap">Paid</th>
                            <th scope="col" className="py-3 px-4 font-mono whitespace-nowrap">Pending</th>
                            <th scope="col" className="py-3 px-4 whitespace-nowrap">Status</th>
                            <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">Collect Payment</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {paginatedFees.map(f => (
                            <tr key={f.id} className="hover:bg-neutral-50/80 transition-colors">
                              <td className="py-3 px-4 font-semibold text-neutral-900 whitespace-nowrap">
                                {f.student_name}
                              </td>
                              <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{f.class_name}</td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                {f.fee_month} {f.year}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                                PKR {f.total_amount.toLocaleString()}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-emerald-800 font-bold whitespace-nowrap">
                                PKR {f.paid_amount.toLocaleString()}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-rose-800 font-bold whitespace-nowrap">
                                PKR {f.pending_amount.toLocaleString()}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`text-xs font-semibold ${
                                    f.status === 'Paid'
                                      ? 'text-emerald-800'
                                      : f.status === 'Partial'
                                      ? 'text-amber-800'
                                      : 'text-rose-800'
                                  }`}
                                >
                                  {f.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                {f.pending_amount > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setShowRecordFeeModal(f)}
                                    className="min-h-[32px] px-3 py-1 text-[11px] font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer whitespace-nowrap"
                                  >
                                    Receive Payment
                                  </button>
                                ) : (
                                  <span className="text-emerald-800 font-semibold text-[11px]">Paid Full</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="px-4 py-3 bg-neutral-50/70 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
                      <span className="tabular-nums">
                        Showing <strong>{(safeFeePage - 1) * PAGE_SIZE + 1}</strong>&ndash;
                        <strong>{Math.min(safeFeePage * PAGE_SIZE, filteredFees.length)}</strong> of{' '}
                        <strong>{filteredFees.length}</strong> fee vouchers
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={safeFeePage <= 1}
                          onClick={() => setFeePage(p => Math.max(1, p - 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Prev</span>
                        </button>
                        <span className="font-mono tabular-nums text-[11px] px-1">
                          Page {safeFeePage} / {totalFeePages}
                        </span>
                        <button
                          type="button"
                          disabled={safeFeePage >= totalFeePages}
                          onClick={() => setFeePage(p => Math.min(totalFeePages, p + 1))}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100 font-semibold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ==================================================== */}
        {/* 6. WEBSITE CMS & SETTINGS */}
        {/* ==================================================== */}
        {activeSection === 'settings' && settings && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 font-display">
                Website Content Management (CMS)
              </h2>
              <p className="text-xs text-neutral-500">
                Update school contact information, official timings, principal message, and mission without code changes.
              </p>
            </div>

            <form
              onSubmit={handleSaveSettings}
              className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Official School Name
                  </label>
                  <input
                    type="text"
                    value={settings.school_name}
                    onChange={e => setSettings({ ...settings, school_name: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Verified Location / Address
                  </label>
                  <input
                    type="text"
                    value={settings.location}
                    onChange={e => setSettings({ ...settings, location: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Primary Office Phone
                  </label>
                  <input
                    type="text"
                    value={settings.phone}
                    onChange={e => setSettings({ ...settings, phone: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Inquiry Email Address
                  </label>
                  <input
                    type="email"
                    value={settings.email}
                    onChange={e => setSettings({ ...settings, email: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Admissions Email
                  </label>
                  <input
                    type="email"
                    value={settings.admission_email}
                    onChange={e => setSettings({ ...settings, admission_email: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Summer Timings
                  </label>
                  <input
                    type="text"
                    value={settings.school_timings_summer}
                    onChange={e => setSettings({ ...settings, school_timings_summer: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Winter Timings
                  </label>
                  <input
                    type="text"
                    value={settings.school_timings_winter}
                    onChange={e => setSettings({ ...settings, school_timings_winter: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Principal’s Official Message
                </label>
                <textarea
                  rows={3}
                  value={settings.principal_message}
                  onChange={e => setSettings({ ...settings, principal_message: e.target.value })}
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Institutional Mission
                  </label>
                  <textarea
                    rows={2}
                    value={settings.mission}
                    onChange={e => setSettings({ ...settings, mission: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Institutional Vision
                  </label>
                  <textarea
                    rows={2}
                    value={settings.vision}
                    onChange={e => setSettings({ ...settings, vision: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-200 flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  <span>Save CMS Settings</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================================================== */}
        {/* 7. TEACHERS MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'teachers' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  Faculty & Staff Members
                </h2>
                <p className="text-xs text-neutral-500">
                  Subject specialists and academic teachers
                </p>
              </div>
              <button
                onClick={() => setShowAddTeacherModal(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Teacher</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {teachers.map(tch => (
                <div key={tch.id} className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 font-display">{tch.name}</h4>
                      <span className="text-xs text-emerald-800 font-medium">{tch.subject}</span>
                    </div>
                    <span className="text-[10px] font-mono bg-neutral-100 px-2 py-0.5 rounded text-neutral-600">
                      {tch.experience}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600">{tch.qualification}</p>
                  <div className="text-[11px] text-neutral-500 border-t border-neutral-100 pt-2 flex justify-between">
                    <span>Contact: {tch.contact_no}</span>
                    <span className="text-emerald-700 font-semibold">{tch.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 8. CLASSES & SUBJECTS */}
        {/* ==================================================== */}
        {activeSection === 'classes' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 font-display">
                Academic Classes & Subjects
              </h2>
              <p className="text-xs text-neutral-500">
                Grade level structures, tuition fees, and subject allocations
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                    <tr>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Class</th>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Level</th>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Stream</th>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Tuition Fee</th>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Capacity</th>
                      <th scope="col" className="py-3 px-4 whitespace-nowrap">Class Teacher</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {classes.map(c => (
                      <tr key={c.id} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-4 font-bold text-neutral-900 whitespace-nowrap">{c.name}</td>
                        <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{c.grade_level}</td>
                        <td className="py-3 px-4 whitespace-nowrap">{c.stream}</td>
                        <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-950 whitespace-nowrap">
                          PKR {c.monthly_tuition_fee.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">{c.capacity}</td>
                        <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{c.class_teacher}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 9. ANNOUNCEMENTS & NOTICES */}
        {/* ==================================================== */}
        {activeSection === 'announcements' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  School Circulars & Notices
                </h2>
                <p className="text-xs text-neutral-500">
                  Publish notices to public website and student portal
                </p>
              </div>
              <button
                onClick={() => setShowAddNoticeModal(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Publish Notice</span>
              </button>
            </div>

            <div className="space-y-3">
              {announcements.map(ann => (
                <div key={ann.id} className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-900">{ann.category} · Priority: {ann.priority}</span>
                    <span className="text-neutral-400 font-mono">{ann.date}</span>
                  </div>
                  <h4 className="text-sm font-bold text-neutral-900">{ann.title}</h4>
                  <p className="text-xs text-neutral-600">{ann.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 10. INQUIRIES & CONTACT MESSAGES */}
        {/* ==================================================== */}
        {activeSection === 'messages' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 font-display">
                Incoming Contact Messages
              </h2>
              <p className="text-xs text-neutral-500">
                Inquiries from website contact form
              </p>
            </div>

            <div className="space-y-3">
              {messages.map(m => (
                <div key={m.id} className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-neutral-900">{m.name} ({m.phone})</span>
                    <span className="text-neutral-400 font-mono">{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="text-xs font-semibold text-emerald-900">{m.subject} · {m.email}</div>
                  <p className="text-xs text-neutral-700 bg-neutral-50 p-3 rounded-lg border border-neutral-200">
                    {m.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 11. TIMETABLE SCHEDULES */}
        {/* ==================================================== */}
        {activeSection === 'timetable' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  Class Timetables & Schedules
                </h2>
                <p className="text-xs text-neutral-500">
                  Organize weekly lecture periods, faculty allocations, and classrooms
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-2 text-xs font-semibold text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-300 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Print Timetable"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Schedule</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditingTimetableId(null);
                    setNewTimetable({
                      class_name: classes[0]?.name || 'Grade 10 - Matric',
                      section: 'A',
                      subject: subjects[0]?.name || 'English',
                      teacher_name: teachers[0]?.name || 'Faculty Member',
                      day: 'Monday',
                      start_time: '08:30 AM',
                      end_time: '09:15 AM',
                      room: 'Room 101',
                    });
                    setShowAddTimetableModal(true);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Timetable Slot</span>
                </button>
              </div>
            </div>

            {/* Filter and View mode bar */}
            <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-500">Class:</span>
                  <select
                    value={timetableClassFilter}
                    onChange={e => setTimetableClassFilter(e.target.value)}
                    className="text-xs py-1.5 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                  >
                    <option value="All">All Classes ({classes.length})</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-500">Day:</span>
                  <select
                    value={timetableDayFilter}
                    onChange={e => setTimetableDayFilter(e.target.value)}
                    className="text-xs py-1.5 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                  >
                    <option value="All">All Days</option>
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                  </select>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={timetableSearch}
                    onChange={e => setTimetableSearch(e.target.value)}
                    placeholder="Search subject, teacher, room..."
                    className="text-xs pl-8 pr-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 w-48 sm:w-56"
                  />
                  {timetableSearch && (
                    <button
                      type="button"
                      onClick={() => setTimetableSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex bg-neutral-100 p-0.5 rounded-lg border border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setTimetableViewMode('cards')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      timetableViewMode === 'cards'
                        ? 'bg-white text-emerald-900 shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    Card View
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimetableViewMode('grid')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      timetableViewMode === 'grid'
                        ? 'bg-white text-emerald-900 shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    Weekly Schedule
                  </button>
                </div>

                <div className="text-xs text-neutral-500 font-medium hidden sm:block">
                  Total Slots:{' '}
                  <strong className="text-neutral-900">
                    {
                      timetable.filter(t => {
                        if (timetableClassFilter !== 'All' && t.class_name !== timetableClassFilter) return false;
                        if (timetableDayFilter !== 'All' && t.day !== timetableDayFilter) return false;
                        if (timetableSearch) {
                          const q = timetableSearch.toLowerCase();
                          const matches =
                            t.subject.toLowerCase().includes(q) ||
                            t.teacher_name.toLowerCase().includes(q) ||
                            (t.room && t.room.toLowerCase().includes(q)) ||
                            t.class_name.toLowerCase().includes(q);
                          if (!matches) return false;
                        }
                        return true;
                      }).length
                    }
                  </strong>
                </div>
              </div>
            </div>

            {/* Timetable Card View */}
            {timetableViewMode === 'cards' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {timetable
                  .filter(t => {
                    if (timetableClassFilter !== 'All' && t.class_name !== timetableClassFilter) return false;
                    if (timetableDayFilter !== 'All' && t.day !== timetableDayFilter) return false;
                    if (timetableSearch) {
                      const q = timetableSearch.toLowerCase();
                      const matches =
                        t.subject.toLowerCase().includes(q) ||
                        t.teacher_name.toLowerCase().includes(q) ||
                        (t.room && t.room.toLowerCase().includes(q)) ||
                        t.class_name.toLowerCase().includes(q);
                      if (!matches) return false;
                    }
                    return true;
                  })
                  .map(slot => (
                    <div
                      key={slot.id}
                      className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-3 relative hover:border-neutral-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-900 border border-emerald-200 mb-1">
                            {slot.day}
                          </span>
                          <h4 className="text-base font-bold text-neutral-900 font-display">
                            {slot.subject}
                          </h4>
                          <p className="text-xs font-semibold text-neutral-600">
                            {slot.class_name} · Section {slot.section || 'A'}
                          </p>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTimetableSlot(slot)}
                            className="text-neutral-400 hover:text-emerald-800 p-1 cursor-pointer transition-colors"
                            title="Edit slot"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTimetableEntry(slot.id)}
                            className="text-neutral-400 hover:text-rose-600 p-1 cursor-pointer transition-colors"
                            title="Delete slot"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-neutral-100 flex flex-col gap-1.5 text-xs text-neutral-600">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-neutral-400" />
                          <span className="font-mono font-medium">{slot.start_time} - {slot.end_time}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <UserIcon className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Teacher: <strong className="text-neutral-800">{slot.teacher_name}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Room / Hall: <strong className="text-neutral-800">{slot.room}</strong></span>
                        </div>
                      </div>
                    </div>
                  ))}

                {timetable.filter(t => {
                  if (timetableClassFilter !== 'All' && t.class_name !== timetableClassFilter) return false;
                  if (timetableDayFilter !== 'All' && t.day !== timetableDayFilter) return false;
                  if (timetableSearch) {
                    const q = timetableSearch.toLowerCase();
                    const matches =
                      t.subject.toLowerCase().includes(q) ||
                      t.teacher_name.toLowerCase().includes(q) ||
                      (t.room && t.room.toLowerCase().includes(q)) ||
                      t.class_name.toLowerCase().includes(q);
                    if (!matches) return false;
                  }
                  return true;
                }).length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-neutral-200 space-y-3">
                    <Clock className="w-8 h-8 text-neutral-300 mx-auto" />
                    <p className="text-xs text-neutral-500">No timetable slots found matching your criteria.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTimetableId(null);
                        setShowAddTimetableModal(true);
                      }}
                      className="px-4 py-2 bg-emerald-900 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                    >
                      + Schedule Timetable Period
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Timetable Weekly Day-by-Day Grid View */}
            {timetableViewMode === 'grid' && (
              <div className="space-y-4">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(dayName => {
                  const daySlots = timetable
                    .filter(t => t.day === dayName)
                    .filter(t => {
                      if (timetableClassFilter !== 'All' && t.class_name !== timetableClassFilter) return false;
                      if (timetableSearch) {
                        const q = timetableSearch.toLowerCase();
                        const matches =
                          t.subject.toLowerCase().includes(q) ||
                          t.teacher_name.toLowerCase().includes(q) ||
                          (t.room && t.room.toLowerCase().includes(q)) ||
                          t.class_name.toLowerCase().includes(q);
                        if (!matches) return false;
                      }
                      return true;
                    });

                  return (
                    <div key={dayName} className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
                      <div className="bg-neutral-50 px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-700"></span>
                          <h3 className="text-sm font-bold text-neutral-900 font-display">{dayName}</h3>
                        </div>
                        <span className="text-xs font-semibold text-neutral-500">
                          {daySlots.length} period{daySlots.length !== 1 ? 's' : ''} scheduled
                        </span>
                      </div>

                      {daySlots.length > 0 ? (
                        <div className="divide-y divide-neutral-100">
                          {daySlots.map(slot => (
                            <div key={slot.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/70 transition-colors">
                              <div className="flex items-start sm:items-center gap-4">
                                <div className="px-3 py-1.5 rounded-xl bg-neutral-100 border border-neutral-200 text-center min-w-[120px]">
                                  <div className="text-xs font-bold text-neutral-900 font-mono">{slot.start_time}</div>
                                  <div className="text-[10px] text-neutral-500 font-mono">to {slot.end_time}</div>
                                </div>

                                <div>
                                  <div className="text-sm font-bold text-neutral-900">{slot.subject}</div>
                                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2 mt-0.5">
                                    <span className="font-semibold text-emerald-900">{slot.class_name} ({slot.section || 'A'})</span>
                                    <span>·</span>
                                    <span>Faculty: {slot.teacher_name}</span>
                                    <span>·</span>
                                    <span>Room: {slot.room}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 self-end sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => handleEditTimetableSlot(slot)}
                                  className="px-2.5 py-1 text-xs font-medium text-neutral-600 hover:text-emerald-900 hover:bg-neutral-100 rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTimetableEntry(slot.id)}
                                  className="px-2.5 py-1 text-xs font-medium text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-xs text-neutral-400 italic">
                          No lecture periods scheduled for {dayName}.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* 12. EXAMS & RESULTS MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'exams' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  Examinations & Result Cards (DMC)
                </h2>
                <p className="text-xs text-neutral-500">
                  Manage examination terms, student grading rosters, and official transcripts
                </p>
              </div>

              <div className="flex items-center gap-2">
                {examsActiveTab === 'exams' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExamId(null);
                      setNewExam({
                        title: '',
                        term: 'First Term',
                        academic_year: '2026-2027',
                        start_date: new Date().toISOString().split('T')[0],
                        end_date: '',
                        classes: ['All Classes'],
                      });
                      setShowAddExamModal(true);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Exam Term</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingResultId(null);
                      setNewResultForm({
                        exam_id: exams[0]?.id || '',
                        student_id: students[0]?.id || '',
                        subjects: [
                          { subject_name: 'English', total_marks: 100, obtained_marks: 85, grade: 'A1' },
                          { subject_name: 'Mathematics', total_marks: 100, obtained_marks: 90, grade: 'A1' },
                          { subject_name: 'Science / Physics', total_marks: 100, obtained_marks: 82, grade: 'A1' },
                        ],
                        remarks: 'Good progress. Continue dedicated studies.',
                        published: true,
                      });
                      setShowRecordResultModal(true);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Record Student Result</span>
                  </button>
                )}
              </div>
            </div>

            {/* Sub-navigation tabs */}
            <div className="flex border-b border-neutral-200">
              <button
                type="button"
                onClick={() => setExamsActiveTab('exams')}
                className={`py-3 px-5 text-xs font-bold border-b-2 cursor-pointer transition-colors ${
                  examsActiveTab === 'exams'
                    ? 'border-emerald-900 text-emerald-900'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Examination Terms ({exams.length})
              </button>
              <button
                type="button"
                onClick={() => setExamsActiveTab('results')}
                className={`py-3 px-5 text-xs font-bold border-b-2 cursor-pointer transition-colors ${
                  examsActiveTab === 'results'
                    ? 'border-emerald-900 text-emerald-900'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Student DMC Results ({results.length})
              </button>
            </div>

            {/* TAB 1: Examination Terms */}
            {examsActiveTab === 'exams' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {exams.map(ex => (
                  <div
                    key={ex.id}
                    className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-3 hover:border-neutral-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-900 border border-emerald-200 mb-1">
                          {ex.term} · {ex.academic_year}
                        </span>
                        <h4 className="text-base font-bold text-neutral-900 font-display">
                          {ex.title}
                        </h4>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditExam(ex)}
                          className="text-neutral-400 hover:text-emerald-800 p-1 cursor-pointer transition-colors"
                          title="Edit exam"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExam(ex.id, ex.title)}
                          className="text-neutral-400 hover:text-rose-600 p-1 cursor-pointer transition-colors"
                          title="Delete exam"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-neutral-600 pt-2 border-t border-neutral-100">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Date Range:</span>
                        <span className="font-mono font-medium">{ex.start_date} {ex.end_date ? `to ${ex.end_date}` : ''}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Classes:</span>
                        <span className="font-semibold text-neutral-800">
                          {Array.isArray(ex.classes) ? ex.classes.join(', ') : 'All Classes'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Recorded Results:</span>
                        <button
                          type="button"
                          onClick={() => {
                            setResultExamFilter(ex.id);
                            setExamsActiveTab('results');
                          }}
                          className="font-bold text-emerald-900 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <span>{results.filter(r => r.exam_id === ex.id).length} Students</span>
                          <ChevronLeft className="w-3 h-3 rotate-180" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {exams.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-neutral-200 space-y-3">
                    <Award className="w-8 h-8 text-neutral-300 mx-auto" />
                    <p className="text-xs text-neutral-500">No examination terms created yet.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExamId(null);
                        setShowAddExamModal(true);
                      }}
                      className="px-4 py-2 bg-emerald-900 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                    >
                      + Create First Exam Term
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Student DMC Results */}
            {examsActiveTab === 'results' && (
              <div className="space-y-4">
                {/* Filters & Search */}
                <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-500">Exam:</span>
                      <select
                        value={resultExamFilter}
                        onChange={e => setResultExamFilter(e.target.value)}
                        className="text-xs py-1.5 px-3 border border-neutral-300 rounded-lg bg-white"
                      >
                        <option value="All">All Examinations</option>
                        {exams.map(e => (
                          <option key={e.id} value={e.id}>
                            {e.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-500">Class:</span>
                      <select
                        value={resultClassFilter}
                        onChange={e => setResultClassFilter(e.target.value)}
                        className="text-xs py-1.5 px-3 border border-neutral-300 rounded-lg bg-white"
                      >
                        <option value="All">All Classes</option>
                        {classes.map(c => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input
                        type="text"
                        value={resultSearch}
                        onChange={e => setResultSearch(e.target.value)}
                        placeholder="Search student or roll no..."
                        className="text-xs pl-8 pr-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 w-44 sm:w-52"
                      />
                      {resultSearch && (
                        <button
                          type="button"
                          onClick={() => setResultSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-neutral-500">
                    Showing <strong className="text-neutral-900">{
                      results.filter(r => {
                        if (resultExamFilter !== 'All' && r.exam_id !== resultExamFilter) return false;
                        if (resultClassFilter !== 'All' && r.class_name !== resultClassFilter) return false;
                        if (resultSearch) {
                          const q = resultSearch.toLowerCase();
                          const matches =
                            r.student_name.toLowerCase().includes(q) ||
                            (r.class_name && r.class_name.toLowerCase().includes(q)) ||
                            (r.exam_title && r.exam_title.toLowerCase().includes(q));
                          if (!matches) return false;
                        }
                        return true;
                      }).length
                    }</strong> results
                  </div>
                </div>

                {/* Results Table with Full Action Suite */}
                <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                        <tr>
                          <th className="py-3 px-4">Student</th>
                          <th className="py-3 px-4">Class & Exam</th>
                          <th className="py-3 px-4">Marks & Percentage</th>
                          <th className="py-3 px-4">Overall Grade</th>
                          <th className="py-3 px-4">Subjects Breakdown</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200">
                        {results
                          .filter(r => {
                            if (resultExamFilter !== 'All' && r.exam_id !== resultExamFilter) return false;
                            if (resultClassFilter !== 'All' && r.class_name !== resultClassFilter) return false;
                            if (resultSearch) {
                              const q = resultSearch.toLowerCase();
                              const matches =
                                r.student_name.toLowerCase().includes(q) ||
                                (r.class_name && r.class_name.toLowerCase().includes(q)) ||
                                (r.exam_title && r.exam_title.toLowerCase().includes(q));
                              if (!matches) return false;
                            }
                            return true;
                          })
                          .map(res => (
                            <tr key={res.id} className="hover:bg-neutral-50/60 transition-colors">
                              <td className="py-3 px-4">
                                <div className="font-bold text-neutral-900">{res.student_name}</div>
                                {res.student_id && (
                                  <div className="text-[10px] text-neutral-400 font-mono">ID: {res.student_id}</div>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-semibold text-neutral-800">{res.class_name} {res.section ? `(${res.section})` : ''}</div>
                                <div className="text-[11px] text-neutral-500">{res.exam_title}</div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-mono font-bold text-neutral-900">
                                  {res.obtained_marks} / {res.total_marks}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-800">
                                  {res.percentage}%
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                  res.overall_grade.includes('A')
                                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                    : res.overall_grade.includes('B')
                                    ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                    : 'bg-amber-100 text-amber-900 border border-amber-200'
                                }`}>
                                  {res.overall_grade}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1 max-w-xs">
                                  {(res.subjects || []).map((sub, i) => (
                                    <span key={i} className="text-[10px] bg-neutral-100 px-1.5 py-0.5 rounded font-mono">
                                      {sub.subject_name}: {sub.obtained_marks}/{sub.total_marks}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePublishResult(res.id, res.published !== false, res.student_name)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                    res.published !== false
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                                  }`}
                                  title="Click to toggle publish status"
                                >
                                  {res.published !== false ? 'Published' : 'Draft'}
                                </button>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedDmcResult(res);
                                      setShowDmcModal(true);
                                    }}
                                    className="p-1.5 text-neutral-500 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="View & Print Official DMC Certificate"
                                  >
                                    <Printer className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEditResult(res)}
                                    className="p-1.5 text-neutral-500 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit Result Marks"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteResult(res.id, res.student_name)}
                                    className="p-1.5 text-neutral-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Result"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}

                        {results.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-xs text-neutral-500">
                              No student marks records entered yet. Click "Record Student Result" above to create one.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* 13. EVENTS CALENDAR MANAGEMENT */}
        {/* ==================================================== */}
        {activeSection === 'events' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  School Events & Activities Calendar
                </h2>
                <p className="text-xs text-neutral-500">
                  Manage institutional academic events, parent-teacher conferences, and sports galas
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingEventId(null);
                  setNewEvent({
                    title: '',
                    description: '',
                    date: new Date().toISOString().split('T')[0],
                    time: '10:00 AM',
                    location: 'Main Auditorium',
                    cover_image: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&q=80&w=600',
                    status: 'Upcoming',
                  });
                  setShowAddEventModal(true);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add School Event</span>
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {['All', 'Upcoming', 'Ongoing', 'Completed'].map(st => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setEventStatusFilter(st)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                      eventStatusFilter === st
                        ? 'bg-emerald-900 text-white border-emerald-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={eventSearch}
                    onChange={e => setEventSearch(e.target.value)}
                    placeholder="Search events or venue..."
                    className="text-xs pl-8 pr-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 w-44 sm:w-56"
                  />
                  {eventSearch && (
                    <button
                      type="button"
                      onClick={() => setEventSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="text-xs text-neutral-500 font-medium hidden sm:block">
                  Total Events:{' '}
                  <strong className="text-neutral-900">
                    {
                      events.filter(ev => {
                        if (eventStatusFilter !== 'All' && ev.status !== eventStatusFilter) return false;
                        if (eventSearch) {
                          const q = eventSearch.toLowerCase();
                          const matches =
                            ev.title.toLowerCase().includes(q) ||
                            ev.location.toLowerCase().includes(q) ||
                            (ev.description && ev.description.toLowerCase().includes(q));
                          if (!matches) return false;
                        }
                        return true;
                      }).length
                    }
                  </strong>
                </div>
              </div>
            </div>

            {/* Events Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {events
                .filter(ev => eventStatusFilter === 'All' || ev.status === eventStatusFilter)
                .filter(ev => {
                  if (eventSearch) {
                    const q = eventSearch.toLowerCase();
                    const matches =
                      ev.title.toLowerCase().includes(q) ||
                      ev.location.toLowerCase().includes(q) ||
                      (ev.description && ev.description.toLowerCase().includes(q));
                    if (!matches) return false;
                  }
                  return true;
                })
                .map(ev => (
                  <div
                    key={ev.id}
                    className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden flex flex-col hover:border-neutral-300 transition-colors"
                  >
                    <div className="h-44 relative bg-neutral-100 overflow-hidden">
                      <img
                        src={ev.cover_image}
                        alt={ev.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <select
                          value={ev.status}
                          onChange={e => handleQuickStatusEvent(ev, e.target.value as any)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border-0 shadow-xs cursor-pointer ${
                            ev.status === 'Upcoming'
                              ? 'bg-emerald-900 text-white'
                              : ev.status === 'Ongoing'
                              ? 'bg-amber-600 text-white'
                              : 'bg-neutral-800 text-neutral-200'
                          }`}
                          title="Change event status"
                        >
                          <option value="Upcoming">Upcoming</option>
                          <option value="Ongoing">Ongoing</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </div>
                    </div>

                    <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <h4 className="text-base font-bold text-neutral-900 font-display">
                          {ev.title}
                        </h4>
                        <p className="text-xs text-neutral-600 mt-1 line-clamp-3">
                          {ev.description}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-neutral-100 space-y-1.5 text-xs text-neutral-500">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{ev.date} · {ev.time}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{ev.location}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
                        <span className="text-[10px] text-neutral-400 font-mono">ID: {ev.id.slice(0, 8)}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditEvent(ev)}
                            className="text-xs text-neutral-600 hover:text-emerald-900 font-medium cursor-pointer inline-flex items-center gap-1"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEvent(ev.id, ev.title)}
                            className="text-xs text-rose-600 hover:text-rose-800 font-medium cursor-pointer inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

              {events.filter(ev => eventStatusFilter === 'All' || ev.status === eventStatusFilter).length === 0 && (
                <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-neutral-200 space-y-3">
                  <Calendar className="w-8 h-8 text-neutral-300 mx-auto" />
                  <p className="text-xs text-neutral-500">No events found in this category.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEventId(null);
                      setShowAddEventModal(true);
                    }}
                    className="px-4 py-2 bg-emerald-900 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                  >
                    + Schedule New Event
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 14. GALLERY MANAGER */}
        {/* ==================================================== */}
        {activeSection === 'gallery' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 font-display">
                  Institutional Photo Gallery Manager
                </h2>
                <p className="text-xs text-neutral-500">
                  Manage photographs showcasing campus facilities, sports, laboratories, and convocations
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingGalleryId(null);
                  setNewGallery({
                    title: '',
                    caption: '',
                    category: 'Campus',
                    image_url: '',
                    date: new Date().toISOString().split('T')[0],
                  });
                  setShowAddGalleryModal(true);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Gallery Photo</span>
              </button>
            </div>

            {/* Category Filter and Search */}
            <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {['All', 'Campus', 'Academics', 'Sports', 'Events', 'Laboratories'].map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setGalleryCategoryFilter(cat)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                      galleryCategoryFilter === cat
                        ? 'bg-emerald-900 text-white border-emerald-900'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={gallerySearch}
                    onChange={e => setGallerySearch(e.target.value)}
                    placeholder="Search photos..."
                    className="text-xs pl-8 pr-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 w-44 sm:w-56"
                  />
                  {gallerySearch && (
                    <button
                      type="button"
                      onClick={() => setGallerySearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="text-xs text-neutral-500 font-medium hidden sm:block">
                  Total Photos:{' '}
                  <strong className="text-neutral-900">
                    {
                      gallery.filter(item => {
                        if (galleryCategoryFilter !== 'All' && item.category !== galleryCategoryFilter) return false;
                        if (gallerySearch) {
                          const q = gallerySearch.toLowerCase();
                          const matches =
                            item.title.toLowerCase().includes(q) ||
                            (item.caption && item.caption.toLowerCase().includes(q)) ||
                            item.category.toLowerCase().includes(q);
                          if (!matches) return false;
                        }
                        return true;
                      }).length
                    }
                  </strong>
                </div>
              </div>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {gallery
                .filter(item => galleryCategoryFilter === 'All' || item.category === galleryCategoryFilter)
                .filter(item => {
                  if (gallerySearch) {
                    const q = gallerySearch.toLowerCase();
                    const matches =
                      item.title.toLowerCase().includes(q) ||
                      (item.caption && item.caption.toLowerCase().includes(q)) ||
                      item.category.toLowerCase().includes(q);
                    if (!matches) return false;
                  }
                  return true;
                })
                .map(item => (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden group flex flex-col hover:border-neutral-300 transition-colors"
                  >
                    <div
                      className="h-44 bg-neutral-100 relative overflow-hidden cursor-pointer"
                      onClick={() => setSelectedGalleryPhoto(item)}
                      title="Click to preview enlarged photograph"
                    >
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded bg-black/60 text-white backdrop-blur-xs">
                        {item.category}
                      </span>
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="bg-white/90 text-neutral-900 text-xs font-semibold px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Full</span>
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                      <div>
                        <h4 className="text-xs font-bold text-neutral-900 font-display line-clamp-1">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-neutral-500 line-clamp-2 mt-0.5">
                          {item.caption}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-[10px] text-neutral-400">
                        <span>{item.date}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditGalleryItem(item)}
                            className="text-neutral-500 hover:text-emerald-900 font-medium cursor-pointer flex items-center gap-0.5"
                            title="Edit photo details"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGalleryItem(item.id, item.title)}
                            className="text-rose-500 hover:text-rose-700 font-medium cursor-pointer flex items-center gap-0.5"
                            title="Delete photo"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

              {gallery.filter(item => galleryCategoryFilter === 'All' || item.category === galleryCategoryFilter).length === 0 && (
                <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-neutral-200 space-y-3">
                  <ImageIcon className="w-8 h-8 text-neutral-300 mx-auto" />
                  <p className="text-xs text-neutral-500">No photos in this category yet.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGalleryId(null);
                      setShowAddGalleryModal(true);
                    }}
                    className="px-4 py-2 bg-emerald-900 text-white rounded-xl text-xs font-semibold hover:bg-emerald-800 cursor-pointer"
                  >
                    + Add Photo to Gallery
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Record Fee Payment Modal */}
      {showRecordFeeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => setShowRecordFeeModal(null)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display text-neutral-900 mb-1">
              Record Fee Collection
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Student: <strong>{showRecordFeeModal.student_name}</strong> · Pending: PKR {showRecordFeeModal.pending_amount}
            </p>

            <form onSubmit={handleFeePaymentSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Collection Amount (PKR)
                </label>
                <input
                  type="number"
                  name="amount"
                  defaultValue={showRecordFeeModal.pending_amount}
                  max={showRecordFeeModal.pending_amount}
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Payment Mode
                </label>
                <select
                  name="method"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                >
                  <option value="Cash">Cash at Counter</option>
                  <option value="Bank Deposit">Bank Deposit (Allied / HBL)</option>
                  <option value="Easypaisa / JazzCash">Easypaisa / JazzCash</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Receipt Notes / Challan No
                </label>
                <input
                  type="text"
                  name="notes"
                  placeholder="e.g. Bank slip #9841"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecordFeeModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg"
                >
                  Issue Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Notice Modal */}
      {showAddNoticeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => setShowAddNoticeModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display text-neutral-900 mb-4">
              Publish School Notice
            </h3>

            <form
              onSubmit={async e => {
                e.preventDefault();
                const form = e.target as any;
                try {
                  await api.createAnnouncement({
                    title: form.title.value,
                    content: form.content.value,
                    category: form.category.value,
                    priority: form.priority.value,
                    audience: 'All',
                  });
                  showNotification('Notice published live!');
                  setShowAddNoticeModal(false);
                  const updated = await api.getAnnouncements();
                  setAnnouncements(updated);
                } catch (err: any) {
                  showError(err.message || 'Failed to publish');
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Title</label>
                <input
                  type="text"
                  name="title"
                  placeholder="e.g. Schedule for Board Practical Exams"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category</label>
                  <select name="category" className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg">
                    <option value="General">General</option>
                    <option value="Exam">Exam</option>
                    <option value="Admission">Admission</option>
                    <option value="Holiday">Holiday</option>
                    <option value="Academic">Academic</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Priority</label>
                  <select name="priority" className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg">
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Content</label>
                <textarea
                  rows={3}
                  name="content"
                  placeholder="Details of the announcement..."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddNoticeModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg"
                >
                  Publish Notice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Profile & Academic Dossier Modal */}
      {selectedStudentForModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-neutral-200 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 bg-linear-to-r from-emerald-950 via-emerald-900 to-neutral-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-xl font-bold font-display shadow-inner">
                  {selectedStudentForModal.full_name
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-xl font-bold font-display text-white">
                      {selectedStudentForModal.full_name}
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-white/20 text-emerald-100 border border-white/20">
                      {selectedStudentForModal.academic_status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-emerald-200/90 font-mono">
                    <span>Adm: {selectedStudentForModal.admission_no}</span>
                    <span>•</span>
                    <span>Roll: {selectedStudentForModal.roll_no}</span>
                    <span>•</span>
                    <span className="font-sans font-medium text-white bg-emerald-800/80 px-2 py-0.5 rounded">
                      {selectedStudentForModal.class_name} ({selectedStudentForModal.section})
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => setShowPrintIdCard(true)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-white/20"
                  title="Print Official Student ID Card"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>ID Card / Report</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingStudent(!isEditingStudent)}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>{isEditingStudent ? 'Cancel Edit' : 'Edit Profile'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudentForModal(null);
                    setIsEditingStudent(false);
                  }}
                  className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Tabs Bar */}
            <div className="flex border-b border-neutral-200 bg-neutral-50 px-5 sm:px-6 overflow-x-auto gap-2">
              <button
                type="button"
                onClick={() => setStudentModalActiveTab('overview')}
                className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 cursor-pointer transition-colors ${
                  studentModalActiveTab === 'overview'
                    ? 'border-emerald-800 text-emerald-900 bg-white'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <UserIcon className="w-3.5 h-3.5" />
                <span>Overview & Bio</span>
              </button>

              <button
                type="button"
                onClick={() => setStudentModalActiveTab('attendance')}
                className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 cursor-pointer transition-colors ${
                  studentModalActiveTab === 'attendance'
                    ? 'border-emerald-800 text-emerald-900 bg-white'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Attendance Log</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-800 font-mono">
                  {studentDetailData?.attendance?.length || 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStudentModalActiveTab('fees')}
                className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 cursor-pointer transition-colors ${
                  studentModalActiveTab === 'fees'
                    ? 'border-emerald-800 text-emerald-900 bg-white'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Fees & Challans</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-800 font-mono">
                  {studentDetailData?.fees?.length || 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStudentModalActiveTab('results')}
                className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 cursor-pointer transition-colors ${
                  studentModalActiveTab === 'results'
                    ? 'border-emerald-800 text-emerald-900 bg-white'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                <span>Exams & Results</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-800 font-mono">
                  {studentDetailData?.results?.length || 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStudentModalActiveTab('timetable')}
                className={`py-3 px-3 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 cursor-pointer transition-colors ${
                  studentModalActiveTab === 'timetable'
                    ? 'border-emerald-800 text-emerald-900 bg-white'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Class Timetable</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-800 font-mono">
                  {studentDetailData?.timetable?.length || 0}
                </span>
              </button>
            </div>

            {/* Modal Body Scroll Area */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 max-h-[calc(92vh-180px)]">
              {studentDetailLoading && !studentDetailData ? (
                <div className="flex items-center justify-center p-12">
                  <div className="w-8 h-8 border-2 border-emerald-800 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* TAB 1: OVERVIEW */}
                  {studentModalActiveTab === 'overview' && (
                    <div className="space-y-6">
                      {isEditingStudent ? (
                        /* EDIT MODE FORM */
                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            handleSaveStudentEdit();
                          }}
                          className="space-y-4"
                        >
                          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
                            <span>Editing profile for <strong>{selectedStudentForModal.full_name}</strong></span>
                            <span className="font-mono text-[11px]">Adm No: {selectedStudentForModal.admission_no}</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Full Name *</label>
                              <input
                                type="text"
                                value={editStudentForm.full_name || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, full_name: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Father Name *</label>
                              <input
                                type="text"
                                value={editStudentForm.father_name || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, father_name: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                                required
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Class *</label>
                              <select
                                value={editStudentForm.class_name || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, class_name: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              >
                                {classes.map(c => (
                                  <option key={c.id} value={c.name}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Section</label>
                              <input
                                type="text"
                                value={editStudentForm.section || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, section: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Roll No</label>
                              <input
                                type="text"
                                value={editStudentForm.roll_no || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, roll_no: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-700"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Guardian Contact Phone</label>
                              <input
                                type="tel"
                                value={editStudentForm.contact_no || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, contact_no: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Emergency Contact</label>
                              <input
                                type="tel"
                                value={editStudentForm.emergency_contact || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, emergency_contact: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Academic Status</label>
                              <select
                                value={editStudentForm.academic_status || 'Active'}
                                onChange={e => setEditStudentForm({ ...editStudentForm, academic_status: e.target.value as any })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              >
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                                <option value="Graduated">Graduated</option>
                                <option value="Suspended">Suspended</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Date of Birth</label>
                              <input
                                type="date"
                                value={editStudentForm.dob || ''}
                                onChange={e => setEditStudentForm({ ...editStudentForm, dob: e.target.value })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-neutral-700 mb-1">Gender</label>
                              <select
                                value={editStudentForm.gender || 'Male'}
                                onChange={e => setEditStudentForm({ ...editStudentForm, gender: e.target.value as any })}
                                className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                              >
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-neutral-700 mb-1">Residential Address</label>
                            <input
                              type="text"
                              value={editStudentForm.address || ''}
                              onChange={e => setEditStudentForm({ ...editStudentForm, address: e.target.value })}
                              className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-700"
                            />
                          </div>

                          <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200">
                            <button
                              type="button"
                              onClick={() => setIsEditingStudent(false)}
                              className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer flex items-center gap-1.5 shadow-xs"
                            >
                              <Save className="w-4 h-4" />
                              <span>Save Changes</span>
                            </button>
                          </div>
                        </form>
                      ) : (
                        /* VIEW MODE */
                        <div className="space-y-6">
                          {/* Quick Summary Cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">Admission No</span>
                              <span className="text-sm font-bold font-mono text-neutral-900">{selectedStudentForModal.admission_no}</span>
                            </div>
                            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">Class / Roll</span>
                              <span className="text-sm font-bold text-neutral-900">{selectedStudentForModal.class_name} • #{selectedStudentForModal.roll_no}</span>
                            </div>
                            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">Attendance Rate</span>
                              <span className="text-sm font-bold text-emerald-800">
                                {(() => {
                                  const attList = studentDetailData?.attendance || [];
                                  if (attList.length === 0) return '100% (New)';
                                  const pres = attList.filter(a => a.status === 'Present').length;
                                  return `${Math.round((pres / attList.length) * 100)}%`;
                                })()}
                              </span>
                            </div>
                            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">Pending Fees</span>
                              <span className="text-sm font-bold text-rose-700 font-mono">
                                PKR {studentDetailData?.fees?.reduce((acc, f) => acc + (f.pending_amount || 0), 0) || 0}
                              </span>
                            </div>
                          </div>

                          {/* Detailed 2-Column Info Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Academic & Identity Info */}
                            <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-xs space-y-4">
                              <h4 className="text-sm font-bold text-neutral-900 font-display flex items-center gap-2 pb-2 border-b border-neutral-100">
                                <GraduationCap className="w-4 h-4 text-emerald-800" />
                                <span>Academic & Student Identity</span>
                              </h4>

                              <div className="space-y-2.5 text-xs">
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Student Full Name:</span>
                                  <span className="text-neutral-900 font-bold">{selectedStudentForModal.full_name}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Father / Guardian Name:</span>
                                  <span className="text-neutral-900 font-semibold">{selectedStudentForModal.father_name}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Class & Section:</span>
                                  <span className="text-neutral-900 font-semibold">{selectedStudentForModal.class_name} ({selectedStudentForModal.section})</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Roll Number:</span>
                                  <span className="text-neutral-900 font-mono font-bold">{selectedStudentForModal.roll_no}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Admission Date:</span>
                                  <span className="text-neutral-900 font-mono">{selectedStudentForModal.admission_date || '2024-08-15'}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-neutral-500 font-medium">Enrollment Status:</span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800">
                                    {selectedStudentForModal.academic_status}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Personal & Contact Info */}
                            <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-xs space-y-4">
                              <h4 className="text-sm font-bold text-neutral-900 font-display flex items-center gap-2 pb-2 border-b border-neutral-100">
                                <Phone className="w-4 h-4 text-emerald-800" />
                                <span>Personal, Bio & Contact Details</span>
                              </h4>

                              <div className="space-y-2.5 text-xs">
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Date of Birth:</span>
                                  <span className="text-neutral-900 font-mono">{selectedStudentForModal.dob || 'Not specified'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Gender:</span>
                                  <span className="text-neutral-900 font-semibold">{selectedStudentForModal.gender}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Primary Contact Phone:</span>
                                  <a href={`tel:${selectedStudentForModal.contact_no}`} className="text-emerald-800 font-mono font-bold hover:underline">
                                    {selectedStudentForModal.contact_no || 'N/A'}
                                  </a>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Emergency Contact:</span>
                                  <span className="text-neutral-900 font-mono font-medium">{selectedStudentForModal.emergency_contact || selectedStudentForModal.contact_no || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-neutral-100">
                                  <span className="text-neutral-500 font-medium">Residential Address:</span>
                                  <span className="text-neutral-900 font-medium text-right max-w-[200px] truncate">{selectedStudentForModal.address || 'Paharpur, Dera Ismail Khan'}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-neutral-500 font-medium">Parent Portal Access:</span>
                                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Sync Active</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Quick Actions Footer inside overview */}
                          <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-neutral-600">
                              Database ID: <code className="font-mono text-neutral-800">{selectedStudentForModal.id}</code>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsEditingStudent(true)}
                                className="px-3 py-1.5 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-100 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-2xs"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>Edit Information</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteStudent(
                                    selectedStudentForModal.id,
                                    selectedStudentForModal.full_name
                                  )
                                }
                                className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete Student</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: ATTENDANCE */}
                  {studentModalActiveTab === 'attendance' && (
                    <div className="space-y-6">
                      {/* Attendance Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(() => {
                          const attList = studentDetailData?.attendance || [];
                          const total = attList.length;
                          const present = attList.filter(a => a.status === 'Present').length;
                          const absent = attList.filter(a => a.status === 'Absent').length;
                          const rate = total > 0 ? Math.round((present / total) * 100) : 100;
                          return (
                            <>
                              <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                                <span className="text-[11px] font-semibold text-neutral-500 block">Total Marked</span>
                                <span className="text-xl font-bold font-mono text-neutral-900">{total} Days</span>
                              </div>
                              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                                <span className="text-[11px] font-semibold text-emerald-700 block">Present</span>
                                <span className="text-xl font-bold font-mono text-emerald-900">{present} Days</span>
                              </div>
                              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
                                <span className="text-[11px] font-semibold text-rose-700 block">Absent</span>
                                <span className="text-xl font-bold font-mono text-rose-900">{absent} Days</span>
                              </div>
                              <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200">
                                <span className="text-[11px] font-semibold text-blue-700 block">Attendance Rate</span>
                                <span className="text-xl font-bold font-mono text-blue-900">{rate}%</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Attendance Table */}
                      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-2xs">
                        <div className="p-3 bg-neutral-50 border-b border-neutral-200 font-semibold text-xs text-neutral-800 flex justify-between items-center">
                          <span>Recorded Attendance Entries</span>
                          <span className="text-neutral-500 font-normal">Class: {selectedStudentForModal.class_name}</span>
                        </div>
                        {(!studentDetailData?.attendance || studentDetailData.attendance.length === 0) ? (
                          <div className="p-8 text-center text-xs text-neutral-500">
                            No individual attendance entries logged yet for this student. Mark attendance in the Attendance module.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                                <tr>
                                  <th className="py-2.5 px-4">Date</th>
                                  <th className="py-2.5 px-4">Class</th>
                                  <th className="py-2.5 px-4">Section</th>
                                  <th className="py-2.5 px-4">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-200">
                                {studentDetailData.attendance.map(a => (
                                  <tr key={a.id} className="hover:bg-neutral-50">
                                    <td className="py-2.5 px-4 font-mono font-medium text-neutral-900">{a.date}</td>
                                    <td className="py-2.5 px-4">{a.class_name}</td>
                                    <td className="py-2.5 px-4 font-mono">{a.section}</td>
                                    <td className="py-2.5 px-4">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          a.status === 'Present'
                                            ? 'bg-emerald-50 text-emerald-800'
                                            : a.status === 'Absent'
                                            ? 'bg-rose-50 text-rose-800'
                                            : 'bg-amber-50 text-amber-800'
                                        }`}
                                      >
                                        {a.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: FEES & CHALLANS */}
                  {studentModalActiveTab === 'fees' && (
                    <div className="space-y-6">
                      {/* Fees Metric Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {(() => {
                          const feeList = studentDetailData?.fees || [];
                          const total = feeList.reduce((acc, f) => acc + (f.total_amount || 0), 0);
                          const paid = feeList.reduce((acc, f) => acc + (f.paid_amount || 0), 0);
                          const pending = feeList.reduce((acc, f) => acc + (f.pending_amount || 0), 0);
                          return (
                            <>
                              <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                                <span className="text-[11px] font-semibold text-neutral-500 block">Total Invoiced</span>
                                <span className="text-lg font-bold font-mono text-neutral-900">PKR {total}</span>
                              </div>
                              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                                <span className="text-[11px] font-semibold text-emerald-700 block">Total Paid</span>
                                <span className="text-lg font-bold font-mono text-emerald-900">PKR {paid}</span>
                              </div>
                              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
                                <span className="text-[11px] font-semibold text-rose-700 block">Pending Balance</span>
                                <span className="text-lg font-bold font-mono text-rose-900">PKR {pending}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Fee Records Table */}
                      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-2xs">
                        <div className="p-3 bg-neutral-50 border-b border-neutral-200 font-semibold text-xs text-neutral-800 flex justify-between items-center">
                          <span>Challans & Tuition Invoices</span>
                          <span className="text-xs text-neutral-500">Student: {selectedStudentForModal.full_name}</span>
                        </div>
                        {(!studentDetailData?.fees || studentDetailData.fees.length === 0) ? (
                          <div className="p-8 text-center text-xs text-neutral-500">
                            No fee records currently generated for this student.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                                <tr>
                                  <th className="py-2.5 px-4">Month / Term</th>
                                  <th className="py-2.5 px-4 font-mono">Total</th>
                                  <th className="py-2.5 px-4 font-mono">Paid</th>
                                  <th className="py-2.5 px-4 font-mono">Pending</th>
                                  <th className="py-2.5 px-4">Status</th>
                                  <th className="py-2.5 px-4 text-right">Collect Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-200">
                                {studentDetailData.fees.map(f => (
                                  <tr key={f.id} className="hover:bg-neutral-50">
                                    <td className="py-2.5 px-4 font-medium text-neutral-900">
                                      {f.fee_month} {f.year}
                                    </td>
                                    <td className="py-2.5 px-4 font-mono font-medium">PKR {f.total_amount}</td>
                                    <td className="py-2.5 px-4 font-mono text-emerald-800 font-bold">PKR {f.paid_amount}</td>
                                    <td className="py-2.5 px-4 font-mono text-rose-800 font-bold">PKR {f.pending_amount}</td>
                                    <td className="py-2.5 px-4">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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
                                    <td className="py-2.5 px-4 text-right">
                                      {f.pending_amount > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setShowRecordFeeModal(f);
                                          }}
                                          className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-md cursor-pointer shadow-2xs"
                                        >
                                          Receive Payment
                                        </button>
                                      ) : (
                                        <span className="text-emerald-700 font-semibold text-[11px]">Paid in Full</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: EXAMS & RESULTS */}
                  {studentModalActiveTab === 'results' && (
                    <div className="space-y-6">
                      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-2xs">
                        <div className="p-3 bg-neutral-50 border-b border-neutral-200 font-semibold text-xs text-neutral-800 flex justify-between items-center">
                          <span>Official Examination Transcripts</span>
                          <span className="text-xs text-neutral-500">Board & Term Evaluation</span>
                        </div>
                        {(!studentDetailData?.results || studentDetailData.results.length === 0) ? (
                          <div className="p-8 text-center text-xs text-neutral-500">
                            No exam results published for this student yet. Marks can be entered via the Exams module.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                                <tr>
                                  <th className="py-2.5 px-4">Exam / Evaluation</th>
                                  <th className="py-2.5 px-4 font-mono">Obtained</th>
                                  <th className="py-2.5 px-4 font-mono">Total</th>
                                  <th className="py-2.5 px-4 font-mono">%</th>
                                  <th className="py-2.5 px-4">Grade</th>
                                  <th className="py-2.5 px-4">Remarks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-200">
                                {studentDetailData.results.map(r => (
                                  <tr key={r.id} className="hover:bg-neutral-50">
                                    <td className="py-2.5 px-4 font-semibold text-neutral-900">
                                      <div>{r.exam_title}</div>
                                      {r.subjects && r.subjects.length > 0 && (
                                        <div className="text-[10px] text-neutral-500 font-normal mt-0.5">
                                          {r.subjects.map(s => `${s.subject_name}: ${s.obtained_marks}/${s.total_marks}`).join(' • ')}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-900">{r.obtained_marks}</td>
                                    <td className="py-2.5 px-4 font-mono">{r.total_marks}</td>
                                    <td className="py-2.5 px-4 font-mono font-bold text-emerald-900">{r.percentage}%</td>
                                    <td className="py-2.5 px-4">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-800">
                                        {r.overall_grade}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-4 text-neutral-600 italic">{r.remarks || 'Satisfactory progress'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 5: TIMETABLE */}
                  {studentModalActiveTab === 'timetable' && (
                    <div className="space-y-6">
                      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-2xs">
                        <div className="p-3 bg-neutral-50 border-b border-neutral-200 font-semibold text-xs text-neutral-800 flex justify-between items-center">
                          <span>Weekly Class Schedule for {selectedStudentForModal.class_name}</span>
                          <span className="text-xs text-neutral-500">Section {selectedStudentForModal.section}</span>
                        </div>
                        {(!studentDetailData?.timetable || studentDetailData.timetable.length === 0) ? (
                          <div className="p-8 text-center text-xs text-neutral-500">
                            No timetable entries assigned yet for class {selectedStudentForModal.class_name}.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                                <tr>
                                  <th className="py-2.5 px-4">Day</th>
                                  <th className="py-2.5 px-4">Timing</th>
                                  <th className="py-2.5 px-4">Subject</th>
                                  <th className="py-2.5 px-4">Teacher</th>
                                  <th className="py-2.5 px-4">Room</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-200">
                                {studentDetailData.timetable.map(t => (
                                  <tr key={t.id} className="hover:bg-neutral-50">
                                    <td className="py-2.5 px-4 font-semibold text-neutral-900">{t.day}</td>
                                    <td className="py-2.5 px-4 font-mono text-neutral-600">{t.start_time} - {t.end_time}</td>
                                    <td className="py-2.5 px-4 font-medium text-emerald-950">{t.subject}</td>
                                    <td className="py-2.5 px-4 text-neutral-700">{t.teacher_name}</td>
                                    <td className="py-2.5 px-4 font-mono text-neutral-500">{t.room || 'Room 101'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Bottom Bar */}
            <div className="p-4 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between">
              <span className="text-xs text-neutral-500">
                Shawan School & College Paharpur · Academic Session 2025-2026
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedStudentForModal(null);
                  setIsEditingStudent(false);
                }}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-100 rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Student ID Card & Academic Dossier */}
      {showPrintIdCard && selectedStudentForModal && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-neutral-300 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
              <h3 className="text-sm font-bold text-neutral-900 font-display flex items-center gap-2">
                <Printer className="w-4 h-4 text-emerald-800" />
                <span>Student Identification & Academic Dossier</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowPrintIdCard(false)}
                className="p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ID Card Front Card Container */}
            <div className="bg-linear-to-br from-emerald-950 via-emerald-900 to-neutral-900 text-white p-6 rounded-2xl shadow-lg border border-emerald-700/40 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8 blur-lg pointer-events-none" />
              
              <div className="flex items-start justify-between border-b border-white/20 pb-3 mb-4">
                <div>
                  <h4 className="text-base font-bold font-display tracking-tight text-white">SHAWAN SCHOOL & COLLEGE</h4>
                  <p className="text-[10px] text-emerald-200">Paharpur, Dera Ismail Khan, KP, Pakistan</p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/20 text-white font-mono">
                  SESSION 2025-26
                </span>
              </div>

              <div className="flex gap-4 items-center">
                <div className="w-20 h-24 rounded-xl bg-white/10 border-2 border-white/30 flex flex-col items-center justify-center shadow-inner">
                  <span className="text-2xl font-bold font-display text-white">
                    {selectedStudentForModal.full_name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-[8px] text-emerald-200 uppercase mt-1">PHOTO</span>
                </div>

                <div className="space-y-1.5 flex-1 text-xs">
                  <div>
                    <span className="text-[10px] text-emerald-300 block">Student Name:</span>
                    <span className="font-bold text-sm text-white">{selectedStudentForModal.full_name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[9px] text-emerald-300 block">Father Name:</span>
                      <span className="text-neutral-100">{selectedStudentForModal.father_name}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-emerald-300 block">Class & Sec:</span>
                      <span className="text-neutral-100 font-semibold">{selectedStudentForModal.class_name} ({selectedStudentForModal.section})</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-[9px] text-emerald-300 block">Adm No:</span>
                      <span className="font-mono font-bold text-emerald-100">{selectedStudentForModal.admission_no}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-emerald-300 block">Roll No:</span>
                      <span className="font-mono font-bold text-emerald-100">{selectedStudentForModal.roll_no}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-[10px] text-emerald-200">
                <span>Emergency: {selectedStudentForModal.contact_no}</span>
                <span className="font-mono tracking-widest bg-white/15 px-2 py-0.5 rounded text-white">|||| | ||||| ||| |||</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPrintIdCard(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Print Document</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => setShowAddStudentModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display text-neutral-900 mb-4">
              Add New Student to Register
            </h3>

            <form
              onSubmit={async e => {
                e.preventDefault();
                const form = e.target as any;
                try {
                  const newStd = await api.createStudent({
                    full_name: form.full_name.value,
                    father_name: form.father_name.value,
                    class_name: form.class_name.value,
                    section: form.section.value,
                    contact_no: form.contact_no.value,
                    dob: form.dob.value,
                    roll_no: form.roll_no.value,
                    gender: form.gender.value,
                    academic_status: 'Active',
                  });
                  showNotification(`Student ${newStd.full_name} enrolled successfully!`);
                  setShowAddStudentModal(false);
                  const updated = await api.getStudents();
                  setStudents(updated);
                } catch (err: any) {
                  showError(err.message || 'Failed to create student');
                }
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    name="full_name"
                    required
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Father Name *</label>
                  <input
                    type="text"
                    name="father_name"
                    required
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Class *</label>
                  <select name="class_name" className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg">
                    {classes.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Section</label>
                  <input
                    type="text"
                    name="section"
                    defaultValue="A"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Roll No</label>
                  <input
                    type="text"
                    name="roll_no"
                    defaultValue={String(students.length + 101)}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Guardian Phone</label>
                  <input
                    type="tel"
                    name="contact_no"
                    placeholder="+92 300 0000000"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    name="dob"
                    defaultValue="2010-01-01"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Gender</label>
                <select name="gender" className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg"
                >
                  Save Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Teacher Modal */}
      {showAddTeacherModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => setShowAddTeacherModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display text-neutral-900 mb-4">
              Add Faculty Member
            </h3>

            <form
              onSubmit={async e => {
                e.preventDefault();
                const form = e.target as any;
                try {
                  const res = await api.createTeacher({
                    name: form.name.value,
                    email: form.email.value,
                    password: form.password.value,
                    subject: form.subject.value,
                    qualification: form.qualification.value,
                    experience: form.experience.value,
                    contact_no: form.contact_no.value,
                    classes: [form.classes.value],
                    bio: form.bio.value,
                    status: 'Active',
                  });
                  showNotification(`Teacher added successfully! Account created for ${form.email.value}`);
                  setShowAddTeacherModal(false);
                  const updated = await api.getTeachers();
                  setTeachers(updated);
                } catch (err: any) {
                  showError(err.message || 'Failed to add teacher');
                }
              }}
              className="space-y-3.5 max-h-[75vh] overflow-y-auto pr-1"
            >
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Teacher Full Name *</label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Prof. Tariq Mahmood"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Portal Login Email *</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="tariq@shawanschool.edu.pk"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Initial Password *</label>
                  <input
                    type="password"
                    name="password"
                    placeholder="Minimum 6 characters"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Subject Specialization *</label>
                  <input
                    type="text"
                    name="subject"
                    placeholder="e.g. Physics"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Experience</label>
                  <input
                    type="text"
                    name="experience"
                    defaultValue="5+ Years"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Qualification *</label>
                <input
                  type="text"
                  name="qualification"
                  placeholder="e.g. M.Sc Physics / M.Ed"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Phone Contact</label>
                  <input
                    type="tel"
                    name="contact_no"
                    placeholder="+92 300 0000000"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Classes Assigned</label>
                  <input
                    type="text"
                    name="classes"
                    defaultValue="Grade 9 - Matric, F.Sc"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Bio / Profile</label>
                <textarea
                  rows={2}
                  name="bio"
                  placeholder="Short pedagogical overview..."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddTeacherModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  Save & Provision Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Timetable Entry Modal */}
      {showAddTimetableModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => {
                setShowAddTimetableModal(false);
                setEditingTimetableId(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
              {editingTimetableId ? 'Edit Timetable Period' : 'Schedule Timetable Period'}
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Allocate a class period with assigned subject, faculty instructor, and room.
            </p>

            <form onSubmit={handleCreateTimetableEntry} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Class *</label>
                  <select
                    value={newTimetable.class_name}
                    onChange={e => setNewTimetable({ ...newTimetable, class_name: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                    required
                  >
                    {classes.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                    {classes.length === 0 && <option value="Grade 10 - Matric">Grade 10 - Matric</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Section</label>
                  <input
                    type="text"
                    value={newTimetable.section || 'A'}
                    onChange={e => setNewTimetable({ ...newTimetable, section: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    placeholder="e.g. A or B"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Subject Name *</label>
                <input
                  type="text"
                  value={newTimetable.subject || ''}
                  onChange={e => setNewTimetable({ ...newTimetable, subject: e.target.value })}
                  placeholder="e.g. Physics / Mathematics / English"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Teacher / Instructor</label>
                <select
                  value={newTimetable.teacher_name}
                  onChange={e => setNewTimetable({ ...newTimetable, teacher_name: e.target.value })}
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                >
                  <option value="Assigned Faculty">Assigned Faculty</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.name}>{t.name} ({t.subject})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Day *</label>
                  <select
                    value={newTimetable.day}
                    onChange={e => setNewTimetable({ ...newTimetable, day: e.target.value as any })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Room / Hall</label>
                  <input
                    type="text"
                    value={newTimetable.room || 'Room 101'}
                    onChange={e => setNewTimetable({ ...newTimetable, room: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                    placeholder="e.g. Room 204 or Lab 1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Start Time *</label>
                  <input
                    type="text"
                    value={newTimetable.start_time || '08:30 AM'}
                    onChange={e => setNewTimetable({ ...newTimetable, start_time: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                    placeholder="08:30 AM"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">End Time *</label>
                  <input
                    type="text"
                    value={newTimetable.end_time || '09:15 AM'}
                    onChange={e => setNewTimetable({ ...newTimetable, end_time: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                    placeholder="09:15 AM"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddTimetableModal(false);
                    setEditingTimetableId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  {editingTimetableId ? 'Update Period' : 'Schedule Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Exam Term Modal */}
      {showAddExamModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative">
            <button
              onClick={() => {
                setShowAddExamModal(false);
                setEditingExamId(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
              {editingExamId ? 'Edit Examination Term' : 'Create Examination Term'}
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Define a new examination term, date schedules, and participating classes.
            </p>

            <form onSubmit={handleCreateExam} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Exam Title *</label>
                <input
                  type="text"
                  value={newExam.title || ''}
                  onChange={e => setNewExam({ ...newExam, title: e.target.value })}
                  placeholder="e.g. Midterm Examination 2026 or Annual Final 2026"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Term *</label>
                  <select
                    value={newExam.term}
                    onChange={e => setNewExam({ ...newExam, term: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Midterm">Midterm</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Annual Final">Annual Final</option>
                    <option value="Pre-Board">Pre-Board</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Academic Year</label>
                  <input
                    type="text"
                    value={newExam.academic_year || '2026-2027'}
                    onChange={e => setNewExam({ ...newExam, academic_year: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                    placeholder="2026-2027"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newExam.start_date || ''}
                    onChange={e => setNewExam({ ...newExam, start_date: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={newExam.end_date || ''}
                    onChange={e => setNewExam({ ...newExam, end_date: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddExamModal(false);
                    setEditingExamId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  {editingExamId ? 'Update Exam Term' : 'Create Exam Term'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record / Edit Student Result / DMC Modal */}
      {showRecordResultModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-7 shadow-2xl border border-neutral-200 relative my-8">
            <button
              onClick={() => {
                setShowRecordResultModal(false);
                setEditingResultId(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
              {editingResultId ? 'Edit Student Examination Result' : 'Record Student Examination DMC Result'}
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Enter subject-wise obtained marks to calculate percentage, grade, and transcript records.
            </p>

            <form onSubmit={handleSaveStudentResult} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Examination Term *</label>
                  <select
                    value={newResultForm.exam_id}
                    onChange={e => setNewResultForm({ ...newResultForm, exam_id: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                    required
                  >
                    <option value="">-- Choose Exam Term --</option>
                    {exams.map(ex => (
                      <option key={ex.id} value={ex.id}>{ex.title} ({ex.term})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Student *</label>
                  <select
                    value={newResultForm.student_id}
                    onChange={e => setNewResultForm({ ...newResultForm, student_id: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                    required
                  >
                    <option value="">-- Choose Student --</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} · {s.class_name} (Roll #{s.roll_no})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Subjects Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-neutral-800">
                    Subject Marks Allocation
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setNewResultForm({
                        ...newResultForm,
                        subjects: [
                          ...newResultForm.subjects,
                          { subject_name: 'Urdu', total_marks: 100, obtained_marks: 75, grade: 'A' },
                        ],
                      });
                    }}
                    className="text-xs text-emerald-800 hover:text-emerald-950 font-semibold cursor-pointer"
                  >
                    + Add Subject
                  </button>
                </div>

                <div className="space-y-2 border border-neutral-200 rounded-xl p-3 bg-neutral-50 max-h-48 overflow-y-auto">
                  {newResultForm.subjects.map((sub, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-neutral-200">
                      <input
                        type="text"
                        value={sub.subject_name}
                        onChange={e => {
                          const updated = [...newResultForm.subjects];
                          updated[idx].subject_name = e.target.value;
                          setNewResultForm({ ...newResultForm, subjects: updated });
                        }}
                        placeholder="Subject"
                        className="flex-1 text-xs py-1 px-2 border border-neutral-300 rounded"
                        required
                      />
                      <input
                        type="number"
                        value={sub.obtained_marks}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const updated = [...newResultForm.subjects];
                          updated[idx].obtained_marks = val;
                          const tm = updated[idx].total_marks || 100;
                          const pct = (val / tm) * 100;
                          updated[idx].grade = pct >= 80 ? 'A1' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : 'F';
                          setNewResultForm({ ...newResultForm, subjects: updated });
                        }}
                        placeholder="Obtained"
                        className="w-20 text-xs py-1 px-2 border border-neutral-300 rounded font-mono text-center"
                        required
                      />
                      <span className="text-xs text-neutral-400">/</span>
                      <input
                        type="number"
                        value={sub.total_marks}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const updated = [...newResultForm.subjects];
                          updated[idx].total_marks = val;
                          setNewResultForm({ ...newResultForm, subjects: updated });
                        }}
                        placeholder="Total"
                        className="w-20 text-xs py-1 px-2 border border-neutral-300 rounded font-mono text-center"
                        required
                      />
                      {newResultForm.subjects.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewResultForm({
                              ...newResultForm,
                              subjects: newResultForm.subjects.filter((_, i) => i !== idx),
                            });
                          }}
                          className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Faculty Remarks</label>
                <input
                  type="text"
                  value={newResultForm.remarks}
                  onChange={e => setNewResultForm({ ...newResultForm, remarks: e.target.value })}
                  placeholder="e.g. Excellent conceptual clarity and class participation."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pubCheck"
                  checked={newResultForm.published}
                  onChange={e => setNewResultForm({ ...newResultForm, published: e.target.checked })}
                  className="w-4 h-4 text-emerald-900 rounded border-neutral-300 focus:ring-emerald-700 cursor-pointer"
                />
                <label htmlFor="pubCheck" className="text-xs text-neutral-700 cursor-pointer">
                  Publish to Student Portal & Parent DMC Card immediately
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecordResultModal(false);
                    setEditingResultId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  {editingResultId ? 'Update Result Card' : 'Save Result Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit School Event Modal */}
      {showAddEventModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowAddEventModal(false);
                setEditingEventId(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
              {editingEventId ? 'Edit School Event' : 'Add School Event'}
            </h3>
            <p className="text-xs text-neutral-500 mb-3">
              Schedule an institutional event, ceremony, sports gala, or meeting.
            </p>

            {/* Quick Presets */}
            {!editingEventId && (
              <div className="mb-4 bg-emerald-50/60 p-3 rounded-xl border border-emerald-100 space-y-1.5">
                <div className="text-[11px] font-bold text-emerald-900 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Quick Templates:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { title: 'Annual Sports Gala 2026', loc: 'Main Sports Complex', img: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&q=80&w=600', desc: 'Inter-house athletics track, cricket, football, and martial arts competitions.' },
                    { title: 'Inter-School Science Fair', loc: 'Science Block Labs', img: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&q=80&w=600', desc: 'Robotics, chemistry demonstrations, and student innovation showcase.' },
                    { title: 'Annual Prize Distribution', loc: 'Main Auditorium', img: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&q=80&w=600', desc: 'Honoring academic toppers, position holders, and distinguished alumni.' },
                    { title: 'Parent-Teacher Council Meet', loc: 'Conference Hall', img: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&q=80&w=600', desc: 'Academic progress review and one-on-one parent faculty discussions.' },
                  ].map((tpl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setNewEvent({
                        ...newEvent,
                        title: tpl.title,
                        location: tpl.loc,
                        cover_image: tpl.img,
                        description: tpl.desc,
                      })}
                      className="text-[10px] font-semibold bg-white text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      {tpl.title.split(' ')[0]} {tpl.title.split(' ')[1]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Event Title *</label>
                <input
                  type="text"
                  value={newEvent.title || ''}
                  onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="e.g. Annual Prize Distribution Ceremony 2026"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={newEvent.date || ''}
                    onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Time</label>
                  <input
                    type="text"
                    value={newEvent.time || '10:00 AM'}
                    onChange={e => setNewEvent({ ...newEvent, time: e.target.value })}
                    placeholder="10:00 AM"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Location / Venue</label>
                  <input
                    type="text"
                    value={newEvent.location || 'Main Auditorium'}
                    onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                    placeholder="Main Auditorium"
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Status</label>
                  <select
                    value={newEvent.status}
                    onChange={e => setNewEvent({ ...newEvent, status: e.target.value as any })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="Upcoming">Upcoming</option>
                    <option value="Ongoing">Ongoing</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Cover Image URL</label>
                <input
                  type="url"
                  value={newEvent.cover_image || ''}
                  onChange={e => setNewEvent({ ...newEvent, cover_image: e.target.value })}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newEvent.description || ''}
                  onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                  placeholder="Event details, schedule outline, and chief guest invitation..."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddEventModal(false);
                    setEditingEventId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  {editingEventId ? 'Update Event' : 'Schedule Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Gallery Item Modal */}
      {showAddGalleryModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowAddGalleryModal(false);
                setEditingGalleryId(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold font-display text-neutral-900 mb-1">
              {editingGalleryId ? 'Edit Gallery Photograph' : 'Add Photo to Institutional Gallery'}
            </h3>
            <p className="text-xs text-neutral-500 mb-3">
              Upload or link a showcase photograph with category classification.
            </p>

            {/* Quick Photo Presets */}
            {!editingGalleryId && (
              <div className="mb-4 bg-emerald-50/60 p-3 rounded-xl border border-emerald-100 space-y-1.5">
                <div className="text-[11px] font-bold text-emerald-900 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Curated School Presets:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { title: 'Physics Research Laboratory', cat: 'Laboratories', url: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&q=80&w=800', cap: 'High school students performing optical reflection and refraction practicals.' },
                    { title: 'Advanced Computer & AI Lab', cat: 'Laboratories', url: 'https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&q=80&w=800', cap: 'Modern computing lab equipped with high-speed internet and programming workstations.' },
                    { title: 'Central Reference Library', cat: 'Academics', url: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=800', cap: 'Peaceful reading hall housing over 15,000 academic titles and journals.' },
                    { title: 'Campus Football & Athletics Turf', cat: 'Sports', url: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&q=80&w=800', cap: 'Lush green sports ground for annual athletic meets and physical education.' },
                  ].map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setNewGallery({
                        ...newGallery,
                        title: preset.title,
                        category: preset.cat as any,
                        image_url: preset.url,
                        caption: preset.cap,
                      })}
                      className="text-[10px] font-semibold bg-white text-emerald-900 border border-emerald-200 px-2 py-0.5 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      {preset.title.split(' ')[0]} {preset.title.split(' ')[1]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleCreateGalleryItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Photo Title *</label>
                <input
                  type="text"
                  value={newGallery.title || ''}
                  onChange={e => setNewGallery({ ...newGallery, title: e.target.value })}
                  placeholder="e.g. Modern Physics Laboratory"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category *</label>
                  <select
                    value={newGallery.category}
                    onChange={e => setNewGallery({ ...newGallery, category: e.target.value as any })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="Campus">Campus</option>
                    <option value="Academics">Academics</option>
                    <option value="Sports">Sports</option>
                    <option value="Events">Events</option>
                    <option value="Laboratories">Laboratories</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={newGallery.date || ''}
                    onChange={e => setNewGallery({ ...newGallery, date: e.target.value })}
                    className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Image URL *</label>
                <input
                  type="url"
                  value={newGallery.image_url || ''}
                  onChange={e => setNewGallery({ ...newGallery, image_url: e.target.value })}
                  placeholder="https://images.unsplash.com/photo-..."
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg font-mono"
                  required
                />
              </div>

              {newGallery.image_url && (
                <div className="h-32 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-100">
                  <img
                    src={newGallery.image_url}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Caption / Description</label>
                <input
                  type="text"
                  value={newGallery.caption || ''}
                  onChange={e => setNewGallery({ ...newGallery, caption: e.target.value })}
                  placeholder="e.g. Senior secondary students conducting optics experiments"
                  className="w-full text-xs py-2 px-3 border border-neutral-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddGalleryModal(false);
                    setEditingGalleryId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-lg cursor-pointer shadow-sm"
                >
                  {editingGalleryId ? 'Update Photo' : 'Upload to Gallery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official DMC Detailed Marks Certificate Printable Modal */}
      {showDmcModal && selectedDmcResult && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 relative my-8">
            <button
              onClick={() => {
                setShowDmcModal(false);
                setSelectedDmcResult(null);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer print:hidden"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Official Certificate Container */}
            <div className="border-4 border-double border-emerald-900/40 p-6 sm:p-8 rounded-2xl bg-white space-y-6">
              {/* Header */}
              <div className="text-center border-b-2 border-emerald-900/30 pb-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-900 text-amber-300 font-bold text-xl mb-2 shadow-xs">
                  SSC
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-emerald-950 font-display uppercase tracking-wide">
                  Shawan School & College Paharpur
                </h2>
                <p className="text-xs text-neutral-600 font-medium">
                  Affiliated with BISE Dera Ismail Khan · Khyber Pakhtunkhwa
                </p>
                <div className="mt-2 inline-block px-4 py-1 rounded-full bg-emerald-900 text-white font-bold text-xs uppercase tracking-wider">
                  Detailed Marks Certificate (DMC)
                </div>
              </div>

              {/* Student Bio */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-neutral-50 p-4 rounded-xl border border-neutral-200">
                <div>
                  <span className="text-neutral-500">Student Name:</span>
                  <div className="font-bold text-neutral-900 text-sm">{selectedDmcResult.student_name}</div>
                </div>
                <div>
                  <span className="text-neutral-500">Class & Section:</span>
                  <div className="font-bold text-neutral-900">{selectedDmcResult.class_name} {selectedDmcResult.section ? `(${selectedDmcResult.section})` : ''}</div>
                </div>
                <div>
                  <span className="text-neutral-500">Exam Term:</span>
                  <div className="font-semibold text-emerald-900">{selectedDmcResult.exam_title}</div>
                </div>
                <div>
                  <span className="text-neutral-500">Certificate Status:</span>
                  <div className="font-semibold text-emerald-800">
                    {selectedDmcResult.published !== false ? 'Official / Published' : 'Provisional Draft'}
                  </div>
                </div>
              </div>

              {/* Subjects Table */}
              <div className="border border-neutral-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-emerald-900 text-white font-bold">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-center">Total Marks</th>
                      <th className="py-2.5 px-3 text-center">Marks Obtained</th>
                      <th className="py-2.5 px-3 text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {(selectedDmcResult.subjects || []).map((sub, i) => (
                      <tr key={i} className="hover:bg-neutral-50/70">
                        <td className="py-2.5 px-3 font-mono text-neutral-400">{i + 1}</td>
                        <td className="py-2.5 px-3 font-semibold text-neutral-900">{sub.subject_name}</td>
                        <td className="py-2.5 px-3 font-mono text-center">{sub.total_marks}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-center text-emerald-950">{sub.obtained_marks}</td>
                        <td className="py-2.5 px-3 font-bold text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            sub.grade.includes('A') ? 'bg-emerald-100 text-emerald-900' : 'bg-blue-100 text-blue-900'
                          }`}>
                            {sub.grade}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-neutral-100/80 font-bold">
                      <td colSpan={2} className="py-3 px-3 text-neutral-900">Aggregate Total:</td>
                      <td className="py-3 px-3 font-mono text-center">{selectedDmcResult.total_marks}</td>
                      <td className="py-3 px-3 font-mono text-center text-emerald-950 text-sm">{selectedDmcResult.obtained_marks}</td>
                      <td className="py-3 px-3 text-center text-emerald-900">{selectedDmcResult.overall_grade}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Remarks and Grading Summary */}
              <div className="grid grid-cols-2 gap-4 text-xs pt-2">
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70 space-y-1">
                  <div className="font-bold text-emerald-950">Overall Percentage: <span className="font-mono text-base">{selectedDmcResult.percentage}%</span></div>
                  <div className="text-neutral-600">Overall Grade: <strong className="text-emerald-900">{selectedDmcResult.overall_grade}</strong></div>
                  <div className="text-neutral-600">Faculty Remarks: <em>"{selectedDmcResult.remarks}"</em></div>
                </div>

                <div className="flex flex-col justify-end text-center pt-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4 text-[10px] text-neutral-500 pt-8 border-t border-dashed border-neutral-300">
                    <div>
                      <div className="font-bold text-neutral-800">Controller of Examinations</div>
                      <div>Shawan School & College</div>
                    </div>
                    <div>
                      <div className="font-bold text-neutral-800">Principal / Headmaster</div>
                      <div>Official Institutional Seal</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-5 flex items-center justify-end gap-3 print:hidden">
              <button
                type="button"
                onClick={() => {
                  setShowDmcModal(false);
                  setSelectedDmcResult(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Print Official DMC</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Photo Preview Modal */}
      {selectedGalleryPhoto && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-neutral-800 flex flex-col">
            <button
              onClick={() => setSelectedGalleryPhoto(null)}
              className="absolute top-4 right-4 z-10 bg-black/60 hover:bg-black text-white p-2 rounded-full cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="h-[60vh] bg-black flex items-center justify-center overflow-hidden">
              <img
                src={selectedGalleryPhoto.image_url}
                alt={selectedGalleryPhoto.title}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="p-6 bg-neutral-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-900/60 text-emerald-300 border border-emerald-700 mb-1">
                  {selectedGalleryPhoto.category}
                </span>
                <h3 className="text-lg font-bold font-display">{selectedGalleryPhoto.title}</h3>
                <p className="text-xs text-neutral-400 mt-1 max-w-xl">{selectedGalleryPhoto.caption}</p>
              </div>

              <div className="text-right text-xs text-neutral-400 shrink-0">
                <div>Date: {selectedGalleryPhoto.date}</div>
                <div className="text-[10px] font-mono mt-0.5 text-neutral-500">ID: {selectedGalleryPhoto.id}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Accessible Administrative Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || 'Confirm Action'}
        description={confirmDialog?.description || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Confirm'}
        variant={confirmDialog?.variant || 'danger'}
        loading={confirmLoading}
        onCancel={() => {
          if (!confirmLoading) setConfirmDialog(null);
        }}
        onConfirm={async () => {
          if (!confirmDialog) return;
          setConfirmLoading(true);
          try {
            await confirmDialog.onConfirm();
            setConfirmDialog(null);
          } finally {
            setConfirmLoading(false);
          }
        }}
      />
    </div>
  );
};
