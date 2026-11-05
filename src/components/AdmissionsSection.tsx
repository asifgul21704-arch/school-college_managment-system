import React, { useState, useEffect } from 'react';
import { Send, Search, CheckCircle2, Clock, AlertCircle, Copy, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api';
import { ClassItem, AdmissionApplication } from '../types';

interface AdmissionsSectionProps {
  classes: ClassItem[];
  preselectedClass?: string;
}

export const AdmissionsSection: React.FC<AdmissionsSectionProps> = ({
  classes,
  preselectedClass,
}) => {
  const [activeTab, setActiveTab] = useState<'apply' | 'track'>('apply');

  // Form State
  const [studentName, setStudentName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [classApplying, setClassApplying] = useState(preselectedClass || '');
  const [previousSchool, setPreviousSchool] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [address, setAddress] = useState('');
  const [bFormProvided, setBFormProvided] = useState(true);
  const [slcProvided, setSlcProvided] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedApp, setSubmittedApp] = useState<AdmissionApplication | null>(null);
  const [copied, setCopied] = useState(false);

  // Tracking State
  const [trackRef, setTrackRef] = useState('');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackedApp, setTrackedApp] = useState<AdmissionApplication | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedClass) {
      setClassApplying(preselectedClass);
    }
  }, [preselectedClass]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!studentName.trim() || !fatherName.trim() || !parentPhone.trim() || !classApplying) {
      setSubmitError('Please fill out all required fields marked with (*).');
      return;
    }

    setSubmitting(true);
    try {
      const documents = [];
      if (bFormProvided) {
        documents.push({
          title: 'Student B-Form / Birth Certificate',
          filename: 'b_form_attached.pdf',
          verified: false,
        });
      }
      if (slcProvided) {
        documents.push({
          title: 'School Leaving Certificate / DMC',
          filename: 'slc_dmc_attached.pdf',
          verified: false,
        });
      }

      const res = await api.applyAdmission({
        student_name: studentName.trim(),
        father_name: fatherName.trim(),
        dob,
        gender,
        class_applying: classApplying,
        previous_school: previousSchool.trim(),
        parent_phone: parentPhone.trim(),
        parent_email: parentEmail.trim(),
        address: address.trim(),
        documents,
      });

      setSubmittedApp(res.application);
      const prefersReducedMotion =
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReducedMotion) {
        confetti({
          particleCount: 70,
          spread: 55,
          origin: { y: 0.6 },
        });
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to submit application. Please verify your details and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackRef.trim()) return;

    setTrackingLoading(true);
    setTrackError(null);
    setTrackedApp(null);

    try {
      const app = await api.trackAdmission(trackRef.trim());
      setTrackedApp(app);
    } catch {
      setTrackError('No application found with this reference number. Please verify the code and try again.');
    } finally {
      setTrackingLoading(false);
    }
  };

  const copyRefToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="admissions" className="py-16 sm:py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-10 sm:mb-12">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Admissions &amp; Student Registration
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Join Shawan School and College
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            Online admission applications are open for the 2026–2027 academic session. Submit an application online or
            track the real-time status of an existing reference number.
          </p>

          {/* Accessible Segmented Tabs (320px-safe) */}
          <div
            role="tablist"
            aria-label="Admission options"
            className="mt-6 grid grid-cols-1 sm:inline-grid sm:grid-cols-2 gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200 w-full sm:w-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'apply'}
              onClick={() => setActiveTab('apply')}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'apply'
                  ? 'bg-white text-neutral-900 shadow-2xs border border-neutral-200/80'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              1. Online Admission Form
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'track'}
              onClick={() => setActiveTab('track')}
              className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'track'
                  ? 'bg-white text-neutral-900 shadow-2xs border border-neutral-200/80'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              2. Track Application Status
            </button>
          </div>
        </div>

        {activeTab === 'apply' ? (
          <div>
            {submittedApp ? (
              <div
                role="status"
                className="max-w-2xl mx-auto bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6 sm:p-10 text-center"
              >
                <div className="w-12 h-12 bg-emerald-800 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xs">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-emerald-950 font-display mb-2">
                  Application Submitted Successfully
                </h3>
                <p className="text-xs sm:text-sm text-emerald-900 mb-6 max-w-md mx-auto leading-relaxed">
                  Your admission application for <strong>{submittedApp.student_name}</strong> into{' '}
                  <strong>{submittedApp.class_applying}</strong> has been recorded by the Admissions Office.
                </p>

                <div className="bg-white p-4 sm:p-5 rounded-xl border border-emerald-200 mb-6 inline-block w-full max-w-sm">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
                    Application Reference Number
                  </span>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-lg sm:text-2xl font-mono font-bold text-neutral-900 tracking-wider tabular-nums">
                      {submittedApp.application_no}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyRefToClipboard(submittedApp.application_no)}
                      aria-label="Copy application reference number"
                      className="min-h-[36px] min-w-[36px] p-1.5 text-neutral-500 hover:text-neutral-900 rounded-lg border border-neutral-200 hover:bg-neutral-50 cursor-pointer flex items-center justify-center"
                      title="Copy Reference"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="text-xs text-neutral-700 space-y-1.5 mb-8 max-w-md mx-auto">
                  <p>Save this reference number to check your admission review progress online.</p>
                  <p>
                    Our admissions office will contact the guardian at{' '}
                    <strong className="font-mono">{submittedApp.parent_phone}</strong>.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setTrackRef(submittedApp.application_no);
                      setActiveTab('track');
                    }}
                    className="min-h-[42px] px-5 py-2.5 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 rounded-xl cursor-pointer"
                  >
                    Track Status Now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmittedApp(null);
                      setStudentName('');
                      setFatherName('');
                      setParentPhone('');
                    }}
                    className="min-h-[42px] px-5 py-2.5 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-xl cursor-pointer"
                  >
                    Submit Another Application
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="bg-neutral-50 border border-neutral-200 rounded-2xl p-5 sm:p-10 shadow-2xs space-y-8"
              >
                {submitError && (
                  <div
                    role="alert"
                    className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Section 1: Desired Class */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900 mb-4 pb-2 border-b border-neutral-200">
                    1. Desired Academic Level &amp; Class
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="adm-class" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Class Applying For *
                      </label>
                      <select
                        id="adm-class"
                        value={classApplying}
                        onChange={e => setClassApplying(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      >
                        <option value="">Select Academic Level &amp; Class</option>
                        <option value="Nursery">Nursery</option>
                        <option value="Class 1">Class 1</option>
                        <option value="Class 2">Class 2</option>
                        <option value="Class 3">Class 3</option>
                        <option value="Class 4">Class 4</option>
                        <option value="Class 5">Class 5</option>
                        <option value="Class 6">Class 6</option>
                        <option value="Class 7">Class 7</option>
                        <option value="Class 8">Class 8</option>
                        <option value="Class 9">Class 9</option>
                        <option value="Class 10">Class 10</option>
                        <option value="Class 11 (1st Year)">Class 11 (1st Year)</option>
                        <option value="Class 12 (2nd Year)">Class 12 (2nd Year)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-1 lg:col-span-2">
                      <label htmlFor="adm-prev-school" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Previous School / Institution
                      </label>
                      <input
                        id="adm-prev-school"
                        type="text"
                        placeholder="e.g. Govt High School / Private Academy"
                        value={previousSchool}
                        onChange={e => setPreviousSchool(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Student Details */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900 mb-4 pb-2 border-b border-neutral-200">
                    2. Student Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="adm-student-name" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Student Full Name *
                      </label>
                      <input
                        id="adm-student-name"
                        type="text"
                        placeholder="As on B-Form / Birth Cert"
                        value={studentName}
                        onChange={e => setStudentName(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="adm-father-name" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Father / Guardian Name *
                      </label>
                      <input
                        id="adm-father-name"
                        type="text"
                        placeholder="Father's complete name"
                        value={fatherName}
                        onChange={e => setFatherName(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="adm-dob" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Date of Birth
                      </label>
                      <input
                        id="adm-dob"
                        type="date"
                        value={dob}
                        onChange={e => setDob(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label htmlFor="adm-gender" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Gender
                      </label>
                      <select
                        id="adm-gender"
                        value={gender}
                        onChange={e => setGender(e.target.value as 'Male' | 'Female' | 'Other')}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 3: Parent & Contact Details */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900 mb-4 pb-2 border-b border-neutral-200">
                    3. Parent / Guardian Contact Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="adm-phone" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Parent Mobile Phone *
                      </label>
                      <input
                        id="adm-phone"
                        type="tel"
                        placeholder="+92 300 0000000"
                        value={parentPhone}
                        onChange={e => setParentPhone(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="adm-email" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Email Address (Optional)
                      </label>
                      <input
                        id="adm-email"
                        type="email"
                        placeholder="parent@example.com"
                        value={parentEmail}
                        onChange={e => setParentEmail(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label htmlFor="adm-address" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Residential Address
                      </label>
                      <input
                        id="adm-address"
                        type="text"
                        placeholder="e.g. Rangpur Road, Paharpur, DI Khan"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Document Check & Declaration */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900 mb-3 pb-2 border-b border-neutral-200">
                    4. Required Documents Checklist
                  </h3>
                  <p className="text-xs text-neutral-500 mb-3">
                    Original documents are verified in person at the school office upon interview call:
                  </p>
                  <div className="space-y-2.5 text-xs text-neutral-700">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bFormProvided}
                        onChange={e => setBFormProvided(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600"
                      />
                      <span>NADRA B-Form or Union Council Official Birth Certificate copy</span>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={slcProvided}
                        onChange={e => setSlcProvided(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600"
                      />
                      <span>Previous School Leaving Certificate (SLC) / Matric DMC (for College applicants)</span>
                    </label>
                  </div>
                </div>

                {/* Submission CTA */}
                <div className="pt-4 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <span className="text-xs text-neutral-500">
                    No processing fee is charged for online pre-registration.
                  </span>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[44px] px-6 py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>{submitting ? 'Submitting Application...' : 'Submit Application'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* Track Application Tab */
          <div className="max-w-2xl mx-auto">
            <form onSubmit={handleTrack} className="flex flex-col sm:flex-row gap-2.5 mb-8">
              <div className="relative flex-1">
                <label htmlFor="track-ref-input" className="sr-only">
                  Application Reference Number
                </label>
                <input
                  id="track-ref-input"
                  type="text"
                  placeholder="Enter reference number (e.g. ADM-2026-7841)"
                  value={trackRef}
                  onChange={e => setTrackRef(e.target.value)}
                  className="w-full text-xs sm:text-sm py-3 px-4 bg-neutral-50 border border-neutral-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700 font-mono"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={trackingLoading}
                className="min-h-[44px] px-6 py-3 text-xs font-semibold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
              >
                <Search className="w-4 h-4 shrink-0" />
                <span>{trackingLoading ? 'Searching...' : 'Track Status'}</span>
              </button>
            </form>

            {trackError && (
              <div
                role="alert"
                className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-6 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{trackError}</span>
              </div>
            )}

            {trackedApp && (
              <div className="bg-white border border-neutral-200 rounded-2xl p-5 sm:p-8 shadow-2xs space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-100">
                  <div>
                    <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">
                      Application Tracking Record
                    </span>
                    <span className="text-lg font-mono font-bold text-neutral-900 tabular-nums">
                      {trackedApp.application_no}
                    </span>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block mb-0.5">
                      Review Status
                    </span>
                    <span
                      className={`text-xs font-bold inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                        trackedApp.status === 'Approved'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : trackedApp.status === 'Under Review'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : trackedApp.status === 'Rejected'
                          ? 'bg-rose-50 text-rose-800 border border-rose-200'
                          : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                      }`}
                    >
                      {trackedApp.status === 'Approved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {trackedApp.status === 'Under Review' && <Clock className="w-3.5 h-3.5" />}
                      {trackedApp.status}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-neutral-500 block">Candidate Name</span>
                    <span className="font-semibold text-neutral-900">{trackedApp.student_name}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block">Father Name</span>
                    <span className="font-semibold text-neutral-900">{trackedApp.father_name}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block">Class Applied</span>
                    <span className="font-semibold text-neutral-900">{trackedApp.class_applying}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block">Submission Date</span>
                    <span className="font-semibold text-neutral-900 font-mono">
                      {new Date(trackedApp.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block">Parent Contact</span>
                    <span className="font-semibold text-neutral-900 font-mono">{trackedApp.parent_phone}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500 block">Previous School</span>
                    <span className="font-semibold text-neutral-900">{trackedApp.previous_school || 'Not specified'}</span>
                  </div>
                </div>

                <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 text-xs">
                  <span className="font-bold text-neutral-900 block mb-1">
                    Administrative Remarks &amp; Next Steps:
                  </span>
                  <p className="text-neutral-700 leading-relaxed">
                    {trackedApp.remarks ||
                      'Your application is under evaluation by the admissions committee. Please bring original B-Form and previous report card to the school office for document verification.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
