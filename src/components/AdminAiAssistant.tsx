import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  MessageSquare,
  AlertCircle,
  X,
  ArrowRight,
  BookOpen,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AiResponseRenderer } from './ui/AiResponseRenderer';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isError?: boolean;
  toolUsed?: string;
  data?: any;
  disambiguationRequired?: boolean;
  candidates?: any[];
  requiresConfirmation?: boolean;
  pendingAction?: {
    actionType: string;
    title: string;
    description: string;
    payload: any;
    recipientCount?: number;
    previewText?: string;
  };
  auditLogId?: string;
}

interface AdminAiAssistantProps { initialPrompt?: string; onPromptConsumed?: () => void; }

export const AdminAiAssistant = ({ initialPrompt, onPromptConsumed }: AdminAiAssistantProps) => {
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `### Shawan School & College Admin AI Assistant\n\nQuery live school collections with role-authorized verification.\n\n* **Faculty Records:** Request complete teacher profiles, qualifications, or assigned classes (e.g. *"Give me the complete record of teacher Muhammad Ali"*)\n* **Student Dossiers:** Inspect student profiles, guardian contacts, attendance rates, or fee ledgers (e.g. *"Show me Ahmad Khan's complete student profile"*)\n* **Operational Audits:** Filter low attendance, check today's absentees, or list unpaid fee vouchers\n* **Controlled Actions:** Prepare parent alert drafts with administrator confirmation; SMS delivery remains disabled until a verified gateway is connected\n\nSelect a suggested inquiry below or enter a question:`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolUsed: 'systemInit',
    },
  ]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'audit' | 'categories'>('chat');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [categories, setCategories] = useState<{ title: string; prompts: string[] }[]>([]);
  const [activeEntity, setActiveEntity] = useState<{
    type: 'student' | 'teacher';
    id: string;
    name: string;
    className?: string;
    admissionNo?: string;
    rollNo?: string;
  } | null>(null);

  // Sensitive Action Confirmation Modal State
  const [pendingConfirmAction, setPendingConfirmAction] = useState<{
    actionType: string;
    title: string;
    description: string;
    payload: any;
    recipientCount?: number;
    previewText?: string;
  } | null>(null);
  const [actionExecuting, setActionExecuting] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    api
      .getAdminAiSamplePrompts()
      .then(res => {
        if (res?.categories) {
          setCategories(res.categories);
        }
      })
      .catch(err => console.warn('Failed to load sample prompts', err));
  }, []);

  useEffect(() => {
    if (!pendingConfirmAction) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !actionExecuting) {
        setPendingConfirmAction(null);
        setActionErrorMsg(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingConfirmAction, actionExecuting]);

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const logs = await api.getAdminAiAuditLogs();
      setAuditLogs(logs || []);
    } catch (err) {
      console.error('Failed to load AI audit logs', err);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleSend = async (
    queryText?: string,
    selectedCandidateId?: string,
    overrideEntity?: {
      type: 'student' | 'teacher';
      id: string;
      name: string;
      className?: string;
      admissionNo?: string;
      rollNo?: string;
    }
  ) => {
    const textToSend = (queryText || inputPrompt).trim();
    if (!textToSend || loading) return;

    setActionSuccessMsg(null);
    setActionErrorMsg(null);

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    const targetEntity = overrideEntity || activeEntity || undefined;

    try {
      const result = await api.queryAdminAi(textToSend, {
        selectedId: selectedCandidateId,
        activeEntity: targetEntity,
      });

      if (result.activeEntity) {
        setActiveEntity(result.activeEntity);
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: 'assistant',
        text: result.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolUsed: result.toolUsed,
        data: result.data,
        disambiguationRequired: result.disambiguationRequired,
        candidates: result.candidates,
        requiresConfirmation: result.requiresConfirmation,
        pendingAction: result.pendingAction,
        auditLogId: result.auditLogId,
      };

      setMessages(prev => [...prev, botMsg]);

      if (result.requiresConfirmation && result.pendingAction) {
        setPendingConfirmAction(result.pendingAction);
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        isError: true,
        text: `Error querying school database: ${err.message || 'Unable to retrieve records. Please verify your administrator session and try again.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const consumedPromptRef = useRef('');
  useEffect(() => {
    if (!initialPrompt) {
      consumedPromptRef.current = '';
      return;
    }
    if (consumedPromptRef.current === initialPrompt) return;
    consumedPromptRef.current = initialPrompt;
    void handleSend(initialPrompt);
    onPromptConsumed?.();
  }, [initialPrompt]);

  const handleConfirmAction = async () => {
    if (!pendingConfirmAction) return;
    setActionExecuting(true);
    setActionErrorMsg(null);
    try {
      const res = await api.executeAdminAiAction(
        pendingConfirmAction.actionType,
        pendingConfirmAction.payload,
        true
      );

      setActionSuccessMsg(res.message);
      setPendingConfirmAction(null);

      const confirmBotMsg: Message = {
        id: `confirmed-${Date.now()}`,
        sender: 'assistant',
        text: `### Action Recorded\n\n${res.message}\n\n* **Notification records:** ${res.recordedCount || 0}\n* **SMS dispatched:** ${res.smsDispatched ? 'Yes' : 'No'}\n* **Audit Reference:** \`${res.auditLogId || 'Logged'}\``,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolUsed: 'executeConfirmedAction',
      };
      setMessages(prev => [...prev, confirmBotMsg]);
    } catch (err: any) {
      setActionErrorMsg(err.message || 'Action execution failed. Please try again.');
    } finally {
      setActionExecuting(false);
    }
  };

  const quickInquiries = [
    { label: 'New Admitted Students', query: 'Show new admitted students.' },
    { label: 'Admissions This Month', query: 'Show recent admissions this month.' },
    { label: 'Teacher Details & Classes', query: 'Show teacher details and assigned classes.' },
    { label: 'Student Attendance & Fees', query: 'Show student attendance and fee status.' },
    { label: 'Parent Details', query: 'Show parent details for this student.' },
    { label: 'Student Complete Record', query: 'Give me the complete record of this student.' },
    { label: 'Attendance < 75%', query: 'Show students with attendance below 75%.' },
    { label: 'Muhammad Ali Record', query: 'Give me the complete record of teacher Muhammad Ali.' },
    { label: 'Ahmad Khan Profile', query: "Show me Ahmad Khan's complete student profile." },
    { label: 'Teachers for Class 9', query: 'Show teachers assigned to Class 9.' },
    { label: 'Class 8 Enrollment', query: 'How many students are enrolled in Class 8?' },
    { label: "Today's Absent", query: "Show today's absent students." },
    { label: 'Unpaid Fees List', query: 'Show students with unpaid fees.' },
    { label: 'Draft Fee Reminder', query: 'Draft fee reminder for students with unpaid fees.' },
    { label: 'Absent SMS Alert', query: 'Send SMS alert to absent students.' },
  ];

  const adminDisplayName = user?.name || 'Administrator';

  return (
    <div className="ssc-ai-panel flex flex-col min-h-[560px] lg:h-[calc(100vh-120px)] bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Top Header */}
      <div className="ssc-ai-header px-4 sm:px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-900 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-neutral-900 truncate">
              Admin AI Assistant
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>Authorized Administrative Access</span>
              <span aria-hidden="true">&middot;</span>
              <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                <Database className="w-3 h-3" />
                Live School Database
              </span>
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Admin AI Assistant sections"
          className="flex items-center bg-neutral-100 p-1 rounded-xl border border-neutral-200 text-xs overflow-x-auto no-scrollbar shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-white text-emerald-950 shadow-2xs border border-neutral-200/80'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>AI Chat</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'categories'}
            onClick={() => setActiveTab('categories')}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-white text-emerald-950 shadow-2xs border border-neutral-200/80'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Query Topics</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit'}
            onClick={() => {
              setActiveTab('audit');
              loadAuditLogs();
            }}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-white text-emerald-950 shadow-2xs border border-neutral-200/80'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Audit Logs</span>
          </button>
        </div>
      </div>

      {/* Action Status Feedback Banner */}
      {actionSuccessMsg && (
        <div
          role="status"
          className="px-4 sm:px-6 py-2.5 bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionSuccessMsg(null)}
            aria-label="Dismiss notification"
            className="p-1 text-emerald-700 hover:text-emerald-950 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Body: Chat */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0 bg-neutral-50/60">
          {/* Quick Suggestion Bar */}
          <div className="px-3 sm:px-6 py-2.5 bg-white border-b border-neutral-200 overflow-x-auto no-scrollbar flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-semibold text-neutral-500 shrink-0">
              Suggested:
            </span>
            {quickInquiries.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(item.query)}
                disabled={loading}
                className="min-h-[32px] shrink-0 text-xs px-3 py-1 rounded-lg bg-neutral-100 hover:bg-emerald-50 text-neutral-700 hover:text-emerald-900 border border-neutral-200 hover:border-emerald-300 transition-colors font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-5 space-y-5">
            {messages.map(msg => {
              const isUser = msg.sender === 'user';
              const showVerificationBanner = !isUser && msg.id !== 'welcome';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {/* Metadata Line */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5 px-1 text-[11px] text-neutral-500">
                    <span className="font-semibold text-neutral-700">
                      {isUser ? adminDisplayName : 'Admin AI Assistant'}
                    </span>
                    <span aria-hidden="true">&middot;</span>
                    <span className="font-mono tabular-nums">{msg.timestamp}</span>
                    {msg.toolUsed && msg.toolUsed !== 'systemInit' && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="font-mono text-emerald-800">
                          {msg.toolUsed}
                        </span>
                      </>
                    )}
                    {msg.auditLogId && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="text-neutral-500">Audit recorded</span>
                      </>
                    )}
                  </div>

                  {/* Message Card */}
                  <div
                    className={`${
                      isUser
                        ? 'max-w-[90%] sm:max-w-[75%] bg-emerald-900 text-white rounded-2xl rounded-tr-xs px-4 py-3 text-sm leading-relaxed shadow-2xs'
                        : 'w-full sm:max-w-[92%] bg-white text-neutral-800 border border-neutral-200 rounded-2xl rounded-tl-xs p-4 sm:p-5 shadow-2xs'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    ) : (
                      <AiResponseRenderer
                        text={msg.text}
                        isError={msg.isError}
                        showStatusBanner={showVerificationBanner}
                        intentLabel={msg.toolUsed !== 'systemInit' ? msg.toolUsed : undefined}
                      />
                    )}

                    {/* Candidate Disambiguation Cards */}
                    {msg.disambiguationRequired && msg.candidates && msg.candidates.length > 0 && (
                      <div className="mt-4 p-3.5 sm:p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                        <div className="flex items-start gap-2 text-amber-950 text-xs">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Multiple Matching Records Found</p>
                            <p className="text-amber-800 mt-0.5">
                              Select the exact student or faculty record below to load verified details:
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {msg.candidates.map((cand: any, idx: number) => {
                            const isStudentCandidate = Boolean(cand.class_name || cand.admission_no);
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() =>
                                  handleSend(cand.name, cand.databaseId || cand.id, {
                                    type: isStudentCandidate ? 'student' : 'teacher',
                                    id: cand.databaseId || cand.id,
                                    name: cand.name,
                                    className: cand.class_name,
                                    rollNo: cand.roll_no,
                                    admissionNo: cand.admission_no,
                                  })
                                }
                                className="min-h-[52px] p-3 bg-white hover:bg-emerald-50/60 rounded-xl text-left border border-amber-200/90 hover:border-emerald-400 transition-colors flex items-center justify-between gap-3 group cursor-pointer shadow-2xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-neutral-900 text-xs truncate">
                                    {cand.name}
                                  </div>
                                  <div className="text-[11px] text-neutral-600 mt-0.5 flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
                                    {isStudentCandidate ? (
                                      <>
                                        <span>{cand.class_name}</span>
                                        {cand.roll_no && (
                                          <>
                                            <span aria-hidden="true">&middot;</span>
                                            <span>Roll #{cand.roll_no}</span>
                                          </>
                                        )}
                                        {cand.admission_no && (
                                          <>
                                            <span aria-hidden="true">&middot;</span>
                                            <span>{cand.admission_no}</span>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <span>{cand.subject || cand.designation || 'Faculty'}</span>
                                    )}
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-emerald-700 transition-colors shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action Confirmation Prompt Card */}
                    {msg.requiresConfirmation && msg.pendingAction && (
                      <div className="mt-4 p-3.5 sm:p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                            <span>{msg.pendingAction.title}</span>
                          </div>
                          <p className="text-xs text-amber-900">
                            {msg.pendingAction.description}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActionErrorMsg(null);
                            setPendingConfirmAction(msg.pendingAction!);
                          }}
                          className="min-h-[38px] px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                        >
                          Review &amp; Confirm
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-start gap-2.5" role="status" aria-live="polite">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <RefreshCw className="w-4 h-4 text-emerald-800 animate-spin" />
                </div>
                <div className="bg-white border border-neutral-200 rounded-2xl rounded-tl-xs px-4 py-3 text-xs text-neutral-700 shadow-2xs">
                  Querying verified school database records...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Active Conversational Follow-up Context Bar */}
          {activeEntity && (
            <div className="px-3 sm:px-6 py-2.5 bg-emerald-50/80 border-t border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 text-emerald-950">
                <UserCheck className="w-4 h-4 text-emerald-800 shrink-0" />
                <span className="truncate">
                  Follow-up context ({activeEntity.type === 'student' ? 'Student' : 'Faculty'}):{' '}
                  <strong className="font-bold">{activeEntity.name}</strong>
                  {activeEntity.className ? ` · ${activeEntity.className}` : ''}
                  {activeEntity.admissionNo ? ` · ${activeEntity.admissionNo}` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveEntity(null)}
                className="min-h-[32px] px-2.5 py-1 rounded-lg text-emerald-900 hover:bg-emerald-100 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Clear Context
              </button>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-3 sm:p-4 bg-white border-t border-neutral-200">
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSend();
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <label htmlFor="admin-ai-query-input" className="sr-only">
                Ask Admin AI Assistant a question about school records
              </label>
              <input
                id="admin-ai-query-input"
                type="text"
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                placeholder="Ask about teachers, student attendance, fees, admissions, or draft reminders..."
                disabled={loading}
                className="flex-1 min-h-[44px] bg-neutral-50 border border-neutral-300 focus:bg-white focus:border-emerald-700 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !inputPrompt.trim()}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Ask Assistant</span>
                <Send className="w-4 h-4" />
              </button>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500 mt-2 px-1">
              <span>Grounded exclusively in verified database records</span>
              <span>Role-restricted &middot; Administrative audit trail active</span>
            </div>
          </div>
        </div>
      )}

      {/* Query Topics & Examples Tab */}
      {activeTab === 'categories' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-neutral-50/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900">Curated Inquiry Categories</h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Select any sample question below to run a live database lookup.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className="min-h-[38px] self-start sm:self-auto px-3.5 py-2 rounded-xl bg-white hover:bg-neutral-100 border border-neutral-200 text-xs font-semibold text-neutral-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              Back to Chat
            </button>
          </div>

          {categories.length === 0 ? (
            <div className="p-8 text-center bg-white border border-neutral-200 rounded-2xl text-xs text-neutral-500">
              No curated inquiry categories available right now. Use the AI Chat tab to enter any question directly.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {categories.map((cat, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-neutral-200 rounded-2xl p-4 sm:p-5 space-y-3"
                >
                  <h4 className="text-xs font-bold text-emerald-900 tracking-wide">
                    {cat.title}
                  </h4>
                  <div className="space-y-2">
                    {cat.prompts.map((p, pIdx) => (
                      <button
                        key={pIdx}
                        type="button"
                        onClick={() => {
                          setActiveTab('chat');
                          handleSend(p);
                        }}
                        className="w-full min-h-[42px] text-left p-3 rounded-xl bg-neutral-50 hover:bg-emerald-50/70 border border-neutral-200 hover:border-emerald-300 text-xs text-neutral-800 hover:text-emerald-950 transition-colors flex items-center justify-between gap-2 group cursor-pointer"
                      >
                        <span className="flex-1">{p}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover:text-emerald-800 transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audit Logs Tab */}
      {activeTab === 'audit' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-neutral-50/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-800 shrink-0" />
                <span>AI Assistant Governance &amp; Audit Trail</span>
              </h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Every database lookup and confirmed administrative action executed through the assistant is logged here.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={loadAuditLogs}
                disabled={auditLoading}
                className="min-h-[38px] px-3.5 py-2 rounded-xl bg-white hover:bg-neutral-100 border border-neutral-200 text-xs font-semibold text-neutral-700 flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className="min-h-[38px] px-3.5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
              >
                Back to Chat
              </button>
            </div>
          </div>

          {auditLoading ? (
            <div className="p-8 text-center bg-white border border-neutral-200 rounded-2xl text-neutral-600 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-800" />
              <span>Loading audit records...</span>
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="p-8 text-center bg-white border border-neutral-200 rounded-2xl text-neutral-500 text-xs">
              No AI assistant queries have been recorded yet. Run a query in the AI Chat tab to populate the audit trail.
            </div>
          ) : (
            <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-neutral-700 border-collapse">
                  <thead className="bg-neutral-50 text-neutral-600 border-b border-neutral-200">
                    <tr>
                      <th scope="col" className="py-3 px-4 font-semibold whitespace-nowrap">Action</th>
                      <th scope="col" className="py-3 px-4 font-semibold whitespace-nowrap">Admin User</th>
                      <th scope="col" className="py-3 px-4 font-semibold whitespace-nowrap">Target</th>
                      <th scope="col" className="py-3 px-4 font-semibold whitespace-nowrap">Details</th>
                      <th scope="col" className="py-3 px-4 font-semibold whitespace-nowrap">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {auditLogs.map((log, idx) => (
                      <tr key={idx} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-emerald-900 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-3 px-4 text-neutral-900 whitespace-nowrap">
                          {log.user_name} <span className="text-neutral-500">({log.user_role})</span>
                        </td>
                        <td className="py-3 px-4 text-neutral-600 whitespace-nowrap">{log.target_type}</td>
                        <td className="py-3 px-4 text-neutral-700 max-w-md truncate" title={log.details}>
                          {log.details}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-neutral-500 whitespace-nowrap">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sensitive Action Confirmation Modal */}
      {pendingConfirmAction && (
        <div
          className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!actionExecuting) {
              setPendingConfirmAction(null);
              setActionErrorMsg(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-confirm-action-title"
            onClick={e => e.stopPropagation()}
            className="bg-white border border-neutral-200 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="ai-confirm-action-title" className="text-base font-bold text-neutral-900">
                    Administrator Confirmation Required
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    Review the details below before dispatching this action.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmAction(null);
                  setActionErrorMsg(null);
                }}
                disabled={actionExecuting}
                aria-label="Close confirmation modal"
                className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionErrorMsg && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{actionErrorMsg}</span>
              </div>
            )}

            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 space-y-2 text-xs text-neutral-700">
              <div className="font-bold text-neutral-900 text-sm">{pendingConfirmAction.title}</div>
              <p className="text-neutral-600 leading-relaxed">{pendingConfirmAction.description}</p>
              {pendingConfirmAction.previewText && (
                <div className="mt-2 p-3 bg-white border border-neutral-200 rounded-lg text-neutral-800 font-mono text-xs whitespace-pre-wrap">
                  &ldquo;{pendingConfirmAction.previewText}&rdquo;
                </div>
              )}
              {pendingConfirmAction.recipientCount !== undefined && (
                <div className="text-xs font-semibold text-amber-900 pt-1 tabular-nums">
                  Target Recipients: {pendingConfirmAction.recipientCount} parent/guardian contact(s)
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmAction(null);
                  setActionErrorMsg(null);
                }}
                disabled={actionExecuting}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-semibold text-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={actionExecuting}
                className="min-h-[40px] px-5 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                {actionExecuting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm &amp; Execute</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
