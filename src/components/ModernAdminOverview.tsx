import React from 'react';
import {
  Users, GraduationCap, UserPlus, Wallet, CalendarDays, Sparkles,
  BookOpen, ClipboardCheck, FileText, Bell, ArrowUpRight, ChevronRight,
  TrendingUp, School, Settings, ChartNoAxesCombined, Clock3, Mail,
} from 'lucide-react';

type OverviewProps = {
  stats: any;
  students: any[];
  teachers: any[];
  classes: any[];
  events: any[];
  admissions: any[];
  messages: any[];
  announcements: any[];
  onNavigate: (section: string) => void;
  onAskAI: (prompt: string) => void;
  isTeacher?: boolean;
};

const money = (value: number) => new Intl.NumberFormat('en-PK', {
  style: 'currency', currency: 'PKR', maximumFractionDigits: 0,
}).format(Number(value) || 0);

const dateLabel = (value: unknown) => {
  if (!value) return 'Date not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
};

export const ModernAdminOverview: React.FC<OverviewProps> = ({
  stats, students, teachers, classes, events, admissions, messages, announcements,
  onNavigate, onAskAI, isTeacher = false,
}) => {
  const totalStudents = Number(stats?.totalStudents) || students.length;
  const totalTeachers = Number(stats?.totalTeachers) || teachers.length;
  const collected = Number(stats?.totalCollectedFee) || 0;
  const outstanding = Number(stats?.totalPendingFee) || 0;
  const totalFee = collected + outstanding;
  const collectionRate = totalFee ? Math.min(100, Math.round(collected / totalFee * 100)) : 0;
  const attendanceRate = Number(stats?.attendanceRate) || 0;
  const classCounts = students.reduce((acc: Record<string, number>, student: any) => {
    const key = student.class_name || 'Unassigned';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const classRows = Object.entries(classCounts).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5);
  const maxClass = Math.max(1, ...classRows.map(([, count]) => Number(count)));
  const recentAdmissions = [...admissions].slice(0, 4);
  const recentNotices = [...announcements].slice(0, 3);
  const upcomingEvents = [...events].slice(0, 3);
  const teacherRows = [...teachers].slice(0, 4);

  const metrics = [
    { label: 'Total students', value: totalStudents.toLocaleString(), note: `${classes.length} academic classes`, icon: Users, tone: 'blue' },
    { label: 'Faculty members', value: totalTeachers.toLocaleString(), note: 'Teachers & academic staff', icon: GraduationCap, tone: 'mint' },
    { label: 'Today attendance', value: `${attendanceRate}%`, note: `${Number(stats?.presentToday)||0} present · ${Number(stats?.todayMarked)||0} marked`, icon: ClipboardCheck, tone: 'violet' },
    { label: 'Pending admissions', value: (Number(stats?.pendingAdmissions) || 0).toLocaleString(), note: `${Number(stats?.approvedAdmissions)||0} approved applications`, icon: UserPlus, tone: 'amber' },
  ];
  const modules = [
    { label: 'Students', detail: 'Profiles, classes & records', icon: Users, section: 'students', tone: 'blue' },
    { label: 'Teachers', detail: 'Faculty & assignments', icon: GraduationCap, section: 'teachers', tone: 'mint' },
    { label: 'Admissions', detail: 'Applications & approvals', icon: UserPlus, section: 'admissions', tone: 'violet' },
    { label: 'Fees & payments', detail: 'Vouchers, dues & approvals', icon: Wallet, section: 'fees', tone: 'amber' },
    { label: 'School settings', detail: 'Campus website & settings', icon: Settings, section: 'settings', tone: 'blue' },
    { label: 'Reports & analytics', detail: 'Academic & finance reports', icon: ChartNoAxesCombined, section: 'reports', tone: 'mint' },
    { label: 'Parent inquiries', detail: `${messages.length} messages in inbox`, icon: Mail, section: 'messages', tone: 'violet' },
  ];
  const teacherModules = [
    { label: 'My students', detail: 'Assigned student records', icon: Users, section: 'students', tone: 'blue' },
    { label: 'Attendance', detail: 'Class attendance register', icon: ClipboardCheck, section: 'attendance', tone: 'mint' },
    { label: 'Timetable', detail: 'Lessons & class schedule', icon: Clock3, section: 'timetable', tone: 'violet' },
    { label: 'Exams & results', detail: 'Marks and assessment', icon: FileText, section: 'exams', tone: 'amber' },
  ];
  const shortcuts = isTeacher ? teacherModules : modules;

  return (
    <div className="ssc-overview space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-blue-600">Shawan School & College · Paharpur</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">{isTeacher ? 'Faculty dashboard' : 'Admin dashboard'}</h1>
          <p className="mt-1 text-sm text-slate-500">{isTeacher ? 'Your classes, attendance and academic responsibilities.' : 'Manage your school operations from one workspace.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onNavigate(isTeacher ? 'attendance' : 'students')} className="ssc-secondary-btn"><Users size={16}/> {isTeacher ? 'My classes' : 'Student directory'}</button>
          {!isTeacher && <button type="button" onClick={() => onAskAI('Give me a current school operations summary using live records.')} className="ssc-primary-btn"><Sparkles size={16}/> Ask AI assistant</button>}
        </div>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
        {metrics.filter(metric => !isTeacher || metric.label !== 'Pending admissions').map(({ label, value, note, icon: Icon, tone }) => (
          <article key={label} className="ssc-stat-card">
            <div className={`ssc-icon-tile ${tone}`}><Icon size={20}/></div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 truncate">{value}</p>
              <p className="mt-1 text-[11px] text-slate-500">{note}</p>
            </div>
            <ArrowUpRight size={16} className="text-slate-300"/>
          </article>
        ))}
      </section>

      <section className="ssc-panel p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="ssc-panel-title">{isTeacher ? 'Teaching workspace' : 'School management modules'}</h2><p className="ssc-panel-subtitle">{isTeacher ? 'Open the tools you use for daily academic work.' : 'Each section has its own tools and management screens.'}</p></div>
          <span className="ssc-soft-pill"><School size={13}/> {shortcuts.length} modules</span>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shortcuts.map(({label,detail,icon:Icon,section,tone}) => (
            <button type="button" key={label} onClick={() => onNavigate(section)} className="ssc-module-card">
              <span className={`ssc-icon-tile ${tone}`}><Icon size={19}/></span>
              <span className="min-w-0 flex-1 text-left"><span className="block text-sm font-bold text-slate-800">{label}</span><span className="mt-1 block text-[11px] text-slate-500">{detail}</span></span>
              <ChevronRight size={17} className="text-slate-300"/>
            </button>
          ))}
        </div>
      </section>

      <section className={isTeacher ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 2xl:grid-cols-[1.15fr_.85fr] gap-4'}>
        <article className="ssc-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="ssc-panel-title">Enrollment by class</h2><p className="ssc-panel-subtitle">Distribution from current student records</p></div>
            <span className="ssc-soft-pill"><TrendingUp size={13}/> Live records</span>
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-[1fr_190px] gap-5 items-center">
            <div className="space-y-4">
              {classRows.length ? classRows.map(([name, count]) => (
                <div key={name}>
                  <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">{name}</span><span className="font-bold tabular-nums text-slate-600">{Number(count)}</span></div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${Number(count) / maxClass * 100}%` }}/></div>
                </div>
              )) : <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Class enrollment data will appear here when student records are available.</div>}
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-[#102b57] to-[#174d88] p-5 text-white min-h-[170px] flex flex-col justify-between">
              <div className="flex items-center justify-between"><School size={22}/><span className="text-[10px] uppercase tracking-widest text-blue-100">Academic snapshot</span></div>
              <div><p className="text-3xl font-extrabold tabular-nums">{totalStudents.toLocaleString()}</p><p className="text-xs text-blue-100 mt-1">Enrolled learners</p></div>
              <button type="button" onClick={() => onNavigate('students')} className="flex items-center gap-1 text-xs font-semibold text-cyan-200 hover:text-white">Explore students <ArrowUpRight size={14}/></button>
            </div>
          </div>
        </article>

        {!isTeacher && <article className="ssc-panel p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><h2 className="ssc-panel-title">Fee collection</h2><p className="ssc-panel-subtitle">Verified collections and outstanding balance</p></div><Wallet className="text-blue-500" size={20}/></div>
          <div className="mt-5"><p className="text-xs text-slate-500">Total collected</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{money(collected)}</p></div>
          <div className="mt-4 h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{width:`${collectionRate}%`}}/></div>
          <div className="mt-2 flex items-center justify-between text-xs"><span className="font-semibold text-emerald-700">{collectionRate}% collected</span><span className="text-slate-500">{money(totalFee)} total</span></div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] text-emerald-700">Collected</p><p className="mt-1 font-bold text-emerald-900 text-sm">{money(collected)}</p></div>
            <div className="rounded-xl bg-rose-50 p-3"><p className="text-[11px] text-rose-700">Outstanding</p><p className="mt-1 font-bold text-rose-900 text-sm">{money(outstanding)}</p></div>
          </div>
          <button type="button" onClick={() => onNavigate('fees')} className="mt-4 text-xs font-bold text-blue-700 flex items-center gap-1">Open fee records <ChevronRight size={14}/></button>
        </article>}
      </section>

      {!isTeacher && <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <article className="ssc-panel p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><h2 className="ssc-panel-title">Recent admissions</h2><p className="ssc-panel-subtitle">Latest applications received by the school</p></div><button type="button" onClick={() => onNavigate('admissions')} className="text-xs font-bold text-blue-700">All admissions <ArrowUpRight size={13} className="inline"/></button></div>
          <div className="mt-4 space-y-2">
            {recentAdmissions.length ? recentAdmissions.map((item:any,index:number)=><div key={item.id || item._id || index} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700"><UserPlus size={17}/></span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800 truncate">{item.student_name || item.full_name || 'Admission applicant'}</p><p className="text-[11px] text-slate-500">{item.class_applying || item.class_name || 'Class not specified'} · {item.application_no || 'Application'}</p></div><span className="text-[10px] font-bold text-slate-600">{item.status || 'Pending'}</span></div>) : <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">No admission applications are currently listed.</p>}
          </div>
        </article>
        <article className="ssc-panel p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><h2 className="ssc-panel-title">School updates</h2><p className="ssc-panel-subtitle">Announcements and upcoming events</p></div><button type="button" onClick={() => onNavigate('announcements')} className="text-xs font-bold text-blue-700">Manage updates <ArrowUpRight size={13} className="inline"/></button></div>
          <div className="mt-4 space-y-2">
            {recentNotices.length ? recentNotices.map((item:any,index:number)=><div key={item.id || item._id || index} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><span className="rounded-lg bg-white p-2 text-blue-600"><Bell size={16}/></span><div className="min-w-0"><p className="text-xs font-bold text-slate-800 truncate">{item.title || item.subject || 'School announcement'}</p><p className="mt-1 text-[11px] text-slate-500">{dateLabel(item.date || item.created_at || item.createdAt)}</p></div></div>) : upcomingEvents.length ? upcomingEvents.map((item:any,index:number)=><div key={item.id || item._id || index} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><span className="rounded-lg bg-white p-2 text-blue-600"><CalendarDays size={16}/></span><div className="min-w-0"><p className="text-xs font-bold text-slate-800 truncate">{item.title || item.name || 'School event'}</p><p className="mt-1 text-[11px] text-slate-500">{dateLabel(item.date || item.event_date)}</p></div></div>) : <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">No announcements or events are currently listed.</p>}
          </div>
        </article>
      </section>}

      <section className="ssc-panel p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><h2 className="ssc-panel-title">Need a quick answer?</h2><p className="ssc-panel-subtitle">{isTeacher ? 'Go directly to your attendance and academic tools.' : 'Use the school AI assistant for live administrative questions.'}</p></div>
          {!isTeacher && <button type="button" onClick={() => onAskAI('Summarize current attendance, admissions and fee collection using live school records.')} className="ssc-primary-btn"><Sparkles size={16}/> Open AI assistant</button>}
          {isTeacher && <button type="button" onClick={() => onNavigate('attendance')} className="ssc-secondary-btn"><ClipboardCheck size={16}/> Open attendance</button>}
        </div>
      </section>
    </div>
  );
};
