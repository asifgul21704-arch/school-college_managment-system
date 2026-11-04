import React, { useState, useEffect } from 'react';
import { Clock, MapPin, AlertCircle, ChevronRight, X } from 'lucide-react';
import { Announcement, SchoolEvent } from '../types';

interface NewsEventsSectionProps {
  announcements: Announcement[];
  events: SchoolEvent[];
}

export const NewsEventsSection: React.FC<NewsEventsSectionProps> = ({
  announcements,
  events,
}) => {
  const [selectedNotice, setSelectedNotice] = useState<Announcement | null>(null);
  const [annCategory, setAnnCategory] = useState<string>('All');

  useEffect(() => {
    if (!selectedNotice) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNotice(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNotice]);

  const filteredAnnouncements =
    annCategory === 'All'
      ? announcements
      : announcements.filter(a => a.category === annCategory);

  return (
    <section id="news-events" className="py-16 sm:py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-10 sm:mb-12">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Campus Bulletin &amp; Calendar
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Official Announcements &amp; Upcoming Events
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            Stay updated with academic circulars, board exam schedules, and upcoming collegiate activities in Paharpur.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left Column: Announcements */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-neutral-900 font-display">
                Notice Board &amp; Circulars
              </h3>

              {/* 320px-safe Segmented Filter */}
              <div
                role="tablist"
                aria-label="Filter notices by category"
                className="flex items-center gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200 text-xs overflow-x-auto max-w-full no-scrollbar self-start sm:self-auto"
              >
                {['All', 'Admission', 'Exam', 'Academic'].map(cat => (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={annCategory === cat}
                    onClick={() => setAnnCategory(cat)}
                    className={`min-h-[34px] px-3 py-1.5 font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      annCategory === cat
                        ? 'bg-white text-neutral-900 shadow-2xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredAnnouncements.length > 0 ? (
              <div className="space-y-3">
                {filteredAnnouncements.map(ann => (
                  <button
                    key={ann.id}
                    type="button"
                    onClick={() => setSelectedNotice(ann)}
                    className="w-full text-left p-4 sm:p-5 rounded-2xl bg-neutral-50 border border-neutral-200 hover:border-emerald-800/40 hover:bg-emerald-50/20 transition-colors cursor-pointer group flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span className="font-semibold text-emerald-900">{ann.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{new Date(ann.date).toLocaleDateString()}</span>
                        {ann.priority === 'Urgent' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-700 font-bold inline-flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" /> Urgent
                            </span>
                          </>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-neutral-900 group-hover:text-emerald-900 transition-colors leading-snug">
                        {ann.title}
                      </h4>

                      <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
                        {ann.content}
                      </p>
                    </div>

                    <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-emerald-900 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-neutral-50 border border-neutral-200 text-center text-xs text-neutral-500">
                No notices published in the <strong>{annCategory}</strong> category right now.
              </div>
            )}
          </div>

          {/* Right Column: Upcoming Events */}
          <div className="lg:col-span-5 space-y-6">
            <h3 className="text-lg font-bold text-neutral-900 font-display">
              Upcoming Events Calendar
            </h3>

            {events.length > 0 ? (
              <div className="space-y-4">
                {events.map(ev => (
                  <article
                    key={ev.id}
                    className="rounded-2xl border border-neutral-200 overflow-hidden bg-white shadow-2xs group"
                  >
                    <div className="h-36 overflow-hidden bg-neutral-100 relative">
                      <img
                        src={ev.cover_image}
                        alt={ev.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-103"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute bottom-3 left-3 bg-neutral-950/85 backdrop-blur-xs text-white text-[11px] font-mono px-2.5 py-1 rounded-md">
                        {new Date(ev.date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                    </div>

                    <div className="p-5">
                      <h4 className="text-sm font-bold text-neutral-900 mb-2 font-display">
                        {ev.title}
                      </h4>
                      <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                        {ev.description}
                      </p>

                      <div className="pt-3 border-t border-neutral-100 flex flex-col gap-1.5 text-[11px] text-neutral-500">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span>{ev.time}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="truncate">{ev.location}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-neutral-50 border border-neutral-200 text-center text-xs text-neutral-500">
                No upcoming campus events scheduled right now.
              </div>
            )}
          </div>
        </div>

        {/* Accessible Notice Detail Modal */}
        {selectedNotice && (
          <div
            className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setSelectedNotice(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="notice-detail-title"
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-8 shadow-2xl border border-neutral-200 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                aria-label="Close notice details"
                className="absolute top-4 right-4 sm:top-5 sm:right-5 min-h-[36px] min-w-[36px] flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800 font-semibold mb-2 pr-8">
                <span>{selectedNotice.category} Notice</span>
                <span aria-hidden="true">·</span>
                <span className="text-neutral-500 font-mono font-normal">
                  {new Date(selectedNotice.date).toLocaleDateString()}
                </span>
              </div>

              <h3 id="notice-detail-title" className="text-lg sm:text-xl font-bold text-neutral-900 font-display mb-4 pr-6">
                {selectedNotice.title}
              </h3>

              <div className="text-xs sm:text-sm text-neutral-700 leading-relaxed space-y-3 mb-6 bg-neutral-50 p-4 rounded-xl border border-neutral-200">
                <p>{selectedNotice.content}</p>
              </div>

              <div className="pt-4 border-t border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
                <span>
                  Issued by: <strong className="text-neutral-800">{selectedNotice.author}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedNotice(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-semibold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
                >
                  Close Notice
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
