import React from 'react';
import { Megaphone, ArrowRight } from 'lucide-react';
import { Announcement } from '../types';

interface NoticeBannerProps {
  announcements: Announcement[];
  onViewNotice: (notice: Announcement) => void;
}

export const NoticeBanner: React.FC<NoticeBannerProps> = ({ announcements, onViewNotice }) => {
  const urgentNotice = announcements.find(a => a.priority === 'Urgent') || announcements[0];

  if (!urgentNotice) return null;

  return (
    <div className="bg-emerald-950 text-emerald-100 text-xs py-2 px-4 border-b border-emerald-900/60">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-hidden truncate">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-300 shrink-0">
            <Megaphone className="w-3.5 h-3.5" />
            <span>Notice:</span>
          </span>
          <span className="truncate text-emerald-200">{urgentNotice.title}</span>
        </div>

        <button
          onClick={() => onViewNotice(urgentNotice)}
          className="shrink-0 flex items-center gap-1 text-emerald-300 hover:text-white font-medium transition-colors cursor-pointer"
        >
          <span>Read Details</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
