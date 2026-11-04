import React from 'react';
import { ArrowRight, MapPin, CheckCircle2, BookOpen, ShieldCheck } from 'lucide-react';
import { SchoolSettings } from '../types';

interface HeroSectionProps {
  settings: SchoolSettings;
  onApplyClick: () => void;
  onExploreClick: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  settings,
  onApplyClick,
  onExploreClick,
}) => {
  return (
    <section className="relative overflow-hidden bg-neutral-950 text-white min-h-[560px] sm:min-h-[620px] flex items-center">
      {/* Background Campus Image with balanced contrast scrim */}
      <div className="absolute inset-0 z-0">
        <img
          src="/src/assets/images/hero_school_campus_1790606578302.jpg"
          alt="Shawan School and College Campus in Paharpur"
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/95 via-neutral-950/85 to-neutral-950/50" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-22 lg:py-28 w-full">
        <div className="max-w-3xl">
          {/* Institutional Credential Line */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-emerald-400 mb-4 tracking-wide">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Paharpur, Dera Ismail Khan</span>
            </span>
            <span aria-hidden="true" className="text-neutral-500">·</span>
            <span>BISE D.I. Khan Affiliated</span>
            <span aria-hidden="true" className="text-neutral-500 hidden sm:inline">·</span>
            <span className="hidden sm:inline">Pre-School to Intermediate (HSSC)</span>
          </div>

          {/* Primary Brand & Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white font-display mb-5 text-balance leading-[1.12]">
            {settings.school_name || 'Shawan School and College'}
          </h1>

          <p className="text-sm sm:text-lg text-neutral-300 font-normal leading-relaxed mb-8 max-w-2xl text-pretty">
            {settings.hero_subtitle ||
              'A premier educational institution on Rangpur Road in Paharpur, D.I. Khan offering comprehensive schooling and collegiate programs with modern science facilities, experienced faculty, and rigorous academic discipline.'}
          </p>

          {/* Responsive CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mb-12">
            <button
              type="button"
              onClick={onApplyClick}
              className="min-h-[46px] px-6 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Apply for Admission</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={onExploreClick}
              className="min-h-[46px] px-6 py-3 text-sm font-semibold text-neutral-100 bg-white/10 hover:bg-white/15 backdrop-blur-xs border border-white/20 rounded-xl transition-colors flex items-center justify-center cursor-pointer"
            >
              Explore Our School
            </button>
          </div>

          {/* Verified Trust Markers */}
          <div className="pt-7 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
            <div>
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Accreditation</span>
              </div>
              <p className="text-xs text-neutral-300">
                BISE D.I. Khan &amp; KP PSRA Registered
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                <span>Academic Streams</span>
              </div>
              <p className="text-xs text-neutral-300">
                Early Years, Matric Science, F.Sc &amp; ICS
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Campus Location</span>
              </div>
              <p className="text-xs text-neutral-300 font-mono">
                4X48+MRH, Rangpur Road
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
