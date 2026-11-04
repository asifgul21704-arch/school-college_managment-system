import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { api } from '../services/api';
import { SchoolSettings } from '../types';

interface ContactLocationSectionProps {
  settings: SchoolSettings;
}

export const ContactLocationSection: React.FC<ContactLocationSectionProps> = ({ settings }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('Admission Inquiry');
  const [message, setMessage] = useState('');

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      setError('Please enter your name and inquiry message.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.sendContactMessage({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        subject,
        message: message.trim(),
      });
      setSuccess(true);
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
      setTimeout(() => setSuccess(false), 6000);
    } catch (err: any) {
      setError(err.message || 'Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="contact" className="py-16 sm:py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-10 sm:mb-12">
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
          {/* Left Column: Contact Form */}
          <div className="lg:col-span-6 bg-neutral-50 rounded-2xl border border-neutral-200 p-5 sm:p-8">
            <h3 className="text-lg font-bold text-neutral-900 font-display mb-1.5">
              Send an Official Inquiry
            </h3>
            <p className="text-xs text-neutral-600 mb-6">
              Inquiries are answered directly by our administrative staff within 24 working hours.
            </p>

            {success && (
              <div
                role="status"
                className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 mb-6 flex items-start gap-2.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>Thank you. Your inquiry has been received by the school administration office.</span>
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
                  placeholder="How can our administration assist you?"
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
                <span>{loading ? 'Sending Message...' : 'Send Inquiry'}</span>
              </button>
            </form>
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
