import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, AlertCircle, ExternalLink, Search, Copy, Check, MessageSquareText } from 'lucide-react';
import { api } from '../services/api';
import { SchoolSettings } from '../types';

interface ContactLocationSectionProps {
  settings: SchoolSettings;
}

export const ContactLocationSection: React.FC<ContactLocationSectionProps> = ({ settings }) => {
  const [activeTab, setActiveTab] = useState<'send' | 'track'>('send');

  // Send form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('Admission Inquiry');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track status states
  const [trackRef, setTrackRef] = useState('');
  const [trackEmail, setTrackEmail] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      setError('Please enter your name and inquiry message.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.sendContactMessage({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        subject,
        message: message.trim(),
      });
      const generatedRef = res.reference_no || null;
      setSubmittedRef(generatedRef);
      if (generatedRef) {
        setTrackRef(generatedRef);
      }
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
    } catch (err: any) {
      setError(err.message || 'Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyRef = () => {
    if (!submittedRef) return;
    navigator.clipboard.writeText(submittedRef).then(() => {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2500);
    }).catch(() => {});
  };

  const handleTrackInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackRef.trim()) {
      setTrackError('Please provide an Inquiry Reference Number.');
      return;
    }
    setTrackLoading(true);
    setTrackError(null);
    setTrackResult(null);

    try {
      const res = await api.trackInquiry(trackRef.trim(), trackEmail.trim() || undefined);
      setTrackResult(res);
    } catch (err: any) {
      setTrackError(err.message || 'Inquiry not found or invalid reference number.');
    } finally {
      setTrackLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">Pending Review</span>;
      case 'Processing':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">Processing</span>;
      case 'Awaiting Admin Approval':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">Awaiting Approval</span>;
      case 'Replied':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">Official Reply Sent</span>;
      case 'Resolved':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-300">Resolved</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700">{status}</span>;
    }
  };

  return (
    <section id="contact" className="py-16 sm:py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-8 sm:mb-10">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Campus Location &amp; Inquiries
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Visit Our Campus or Get in Touch
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            Located on Rangpur Road in Paharpur, Dera Ismail Khan. Our administrative office is open six days a week
            during school hours to assist parents, prospective students, and visitors.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* Left Column: Contact Form & Tracking Tabs */}
          <div className="lg:col-span-6 bg-neutral-50 rounded-2xl border border-neutral-200 p-5 sm:p-8">
            {/* Header Tabs */}
            <div className="flex items-center border-b border-neutral-200 pb-3 mb-6 gap-2">
              <button
                type="button"
                onClick={() => { setActiveTab('send'); setError(null); }}
                className={`text-xs font-bold px-3.5 py-2 rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'send'
                    ? 'bg-emerald-900 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60'
                }`}
              >
                Send Official Inquiry
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('track'); setTrackError(null); }}
                className={`text-xs font-bold px-3.5 py-2 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'track'
                    ? 'bg-emerald-900 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Track Inquiry Status</span>
              </button>
            </div>

            {activeTab === 'send' && (
              <div>
                <p className="text-xs text-neutral-600 mb-6">
                  Inquiries are assigned a reference ID and processed by our administrative staff within 24 working hours.
                </p>

                {submittedRef && (
                  <div
                    role="status"
                    className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 mb-6 space-y-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-emerald-950">Inquiry Logged Successfully</p>
                        <p className="text-emerald-800 text-[11px] mt-0.5">
                          Your message has been assigned a tracking reference number:
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-emerald-200">
                      <span className="font-mono font-bold text-emerald-900 text-sm tracking-wide">
                        {submittedRef}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyRef}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 px-2 py-1 bg-emerald-100/60 rounded hover:bg-emerald-100 transition cursor-pointer"
                      >
                        {copiedRef ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-700" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-emerald-700">Save this code to check response status at any time.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTrackRef(submittedRef);
                          setActiveTab('track');
                        }}
                        className="text-[11px] font-bold text-emerald-900 underline hover:text-emerald-700 cursor-pointer"
                      >
                        Track Status Now &rarr;
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-6 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="contact-name" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Your Name *
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        placeholder="Full name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-phone" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        id="contact-phone"
                        type="tel"
                        placeholder="+92 300 0000000"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="contact-email" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Email Address
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        placeholder="email@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-subject" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                        Inquiry Subject
                      </label>
                      <select
                        id="contact-subject"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      >
                        <option value="Admission Inquiry">Admission Inquiry</option>
                        <option value="Fee Structure & Concession">Fee Structure &amp; Concession</option>
                        <option value="Verification of Records">Verification of Records</option>
                        <option value="Employment & Faculty Careers">Employment &amp; Faculty Careers</option>
                        <option value="General Question">General Question</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-message" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Message *
                    </label>
                    <textarea
                      id="contact-message"
                      rows={4}
                      placeholder="How can our administration assist you? (If inquiring about your enrolled child, please mention their full name or admission roll)."
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="min-h-[44px] w-full py-3 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>{loading ? 'Submitting Inquiry...' : 'Submit Inquiry'}</span>
                  </button>
                </form>
              </div>
            )}

            {activeTab === 'track' && (
              <div>
                <p className="text-xs text-neutral-600 mb-6">
                  Check the current review status and official replies for an inquiry submitted to Shawan School &amp; College.
                </p>

                <form onSubmit={handleTrackInquiry} className="space-y-4 mb-6">
                  <div>
                    <label htmlFor="track-ref" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Inquiry Reference Number *
                    </label>
                    <input
                      id="track-ref"
                      type="text"
                      placeholder="e.g. INQ-2026-A1B2C3D4"
                      value={trackRef}
                      onChange={e => setTrackRef(e.target.value.toUpperCase())}
                      className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="track-email" className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Contact Email (Optional for Verification)
                    </label>
                    <input
                      id="track-email"
                      type="email"
                      placeholder="e.g. email provided at submission"
                      value={trackEmail}
                      onChange={e => setTrackEmail(e.target.value)}
                      className="w-full text-xs py-2.5 px-3 bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={trackLoading}
                    className="min-h-[44px] w-full py-2.5 text-xs font-bold text-white bg-emerald-900 hover:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{trackLoading ? 'Verifying Reference...' : 'Check Status'}</span>
                  </button>
                </form>

                {trackError && (
                  <div
                    role="alert"
                    className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 mb-4 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{trackError}</span>
                  </div>
                )}

                {trackResult && (
                  <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                      <div>
                        <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 block">
                          Reference ID
                        </span>
                        <span className="font-mono font-bold text-neutral-900 text-xs">
                          {trackResult.reference_no}
                        </span>
                      </div>
                      {getStatusBadge(trackResult.status)}
                    </div>

                    <div className="text-xs space-y-2">
                      <div className="flex items-center justify-between text-neutral-600">
                        <span>Subject:</span>
                        <strong className="text-neutral-900">{trackResult.subject}</strong>
                      </div>
                      <div className="flex items-center justify-between text-neutral-600">
                        <span>Submitted On:</span>
                        <span>{new Date(trackResult.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200/70 text-[11px] text-neutral-700 leading-relaxed">
                        <strong className="text-neutral-900">Current Status Note: </strong>
                        {trackResult.status_description}
                      </div>
                    </div>

                    {trackResult.replies && trackResult.replies.length > 0 ? (
                      <div className="space-y-3 pt-2 border-t border-neutral-100">
                        <h4 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                          <MessageSquareText className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Official Administrative Replies</span>
                        </h4>
                        <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                          {trackResult.replies.map((reply: any, index: number) => (
                            <div key={index} className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-lg text-xs">
                              <div className="flex items-center justify-between text-[11px] text-emerald-950 font-semibold mb-1">
                                <span>{reply.sent_by || 'Shawan Administration'}</span>
                                <span className="text-[10px] text-neutral-500 font-normal">
                                  {new Date(reply.sent_at).toLocaleDateString()}
                                </span>
                              </div>
                              <p className="text-neutral-800 text-[11px] whitespace-pre-wrap leading-relaxed">
                                {reply.message}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-neutral-500 italic text-center pt-2">
                        No public administrative replies have been dispatched yet. Our staff will update this ticket once reviewed.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Verified Map & Official Contact Cards */}
          <div className="lg:col-span-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider block">
                      Campus Address &amp; Plus Code
                    </span>
                    <h4 className="text-sm font-bold text-neutral-900 mt-0.5">
                      {settings.location}
                    </h4>
                    <p className="text-xs text-neutral-600 mt-1">
                      Plus Code: <strong className="font-mono text-emerald-900">{settings.google_maps_code}</strong>
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200">
                  <div className="flex items-center gap-2 text-emerald-900 text-xs font-bold mb-1">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    <span>Office Telephone</span>
                  </div>
                  <p className="text-xs text-neutral-900 font-mono font-semibold">
                    {settings.phone || '+92 300 0000000'}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Monday – Saturday during school hours
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200">
                  <div className="flex items-center gap-2 text-emerald-900 text-xs font-bold mb-1">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span>Official Email</span>
                  </div>
                  <p className="text-xs text-neutral-900 font-medium break-all">
                    {settings.email || 'info@shawanschool.edu.pk'}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5 break-all">
                    Admissions: {settings.admission_email || 'admissions@shawanschool.edu.pk'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200">
                <div className="flex items-center gap-2 text-emerald-900 text-xs font-bold mb-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Official Campus Timings</span>
                </div>
                <div className="text-xs text-neutral-700 space-y-1 mt-1">
                  <p><strong>Summer:</strong> {settings.school_timings_summer}</p>
                  <p><strong>Winter:</strong> {settings.school_timings_winter}</p>
                </div>
              </div>
            </div>

            {/* Google Maps Embed Frame with Tailwind border-0 */}
            <div className="rounded-2xl overflow-hidden border border-neutral-200 bg-neutral-100 shadow-2xs relative">
              <iframe
                title="Shawan School and College Google Maps Location"
                src="https://maps.google.com/maps?q=4X48%2BMRH%2C%20Rangpur%20Road%2C%20Paharpur%2C%20Pakistan&t=&z=15&ie=UTF8&iwloc=&output=embed"
                className="w-full h-56 border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div className="p-3 bg-white border-t border-neutral-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-neutral-600 font-medium truncate">
                  4X48+MRH, Rangpur Road, Paharpur
                </span>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=4X48%2BMRH%2C+Rangpur+Road%2C+Paharpur%2C+Pakistan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[34px] px-3 py-1.5 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5 shrink-0 font-semibold"
                >
                  <span>Directions</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

