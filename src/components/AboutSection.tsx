import React from 'react';
import { Target, Compass, CheckCircle2, Quote, MapPin, Clock } from 'lucide-react';
import { SchoolSettings } from '../types';

interface AboutSectionProps {
  settings: SchoolSettings;
  onExploreAcademics: () => void;
}

export const AboutSection: React.FC<AboutSectionProps> = ({ settings, onExploreAcademics }) => {
  return (
    <section id="about" className="py-16 sm:py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-3xl mb-12 sm:mb-16">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Institutional Identity &amp; Leadership
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Committed to Educational Distinction in Paharpur
          </h2>
          <p className="text-sm sm:text-base text-neutral-600 leading-relaxed text-pretty">
            {settings.about_text ||
              'Established to deliver modern academic standards in Paharpur, Dera Ismail Khan, Shawan School and College integrates rigorous science curricula with moral tarbiyah and disciplined pedagogy.'}
          </p>
        </div>

        {/* Asymmetric Grid: Story + Principal's Message */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-14 items-start">
          {/* Left: Academic Approach & Location Verification */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-neutral-50 rounded-2xl p-6 sm:p-8 border border-neutral-200">
              <h3 className="text-lg font-bold text-neutral-900 font-display mb-3">
                Academic Approach &amp; Regional Context
              </h3>
              <p className="text-sm text-neutral-600 leading-relaxed mb-4">
                Situated prominently on Rangpur Road in Paharpur, our institution serves students from across the tehsil
                seeking structured preparation for secondary board examinations (SSC) and higher secondary college (HSSC)
                in Science, Pre-Medical, Pre-Engineering, and Computer Science.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-neutral-200 text-xs text-neutral-700">
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-neutral-900">Verified Location</span>
                    <span>4X48+MRH, Rangpur Road, Paharpur, D.I. Khan</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-neutral-900">Operating Schedule</span>
                    <span>{settings.school_timings_summer || '07:45 AM - 01:30 PM'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Mission & Vision Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-2xs">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center mb-4">
                  <Target className="w-4 h-4" />
                </div>
                <h4 className="text-base font-bold text-neutral-900 font-display mb-2">Our Mission</h4>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {settings.mission ||
                    'To cultivate intellectually competent, morally upright, and socially proactive leaders through rigorous academic training and STEM education.'}
                </p>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-2xs">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center mb-4">
                  <Compass className="w-4 h-4" />
                </div>
                <h4 className="text-base font-bold text-neutral-900 font-display mb-2">Our Vision</h4>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {settings.vision ||
                    'To stand as the leading center of academic excellence in the Dera Ismail Khan division, nurturing students who excel nationally.'}
                </p>
              </div>
            </div>
          </div>

          {/* Right: Principal's Official Message */}
          <div className="lg:col-span-5 bg-emerald-950 text-white rounded-2xl p-6 sm:p-9 border border-emerald-900 shadow-md relative overflow-hidden">
            <div aria-hidden="true" className="absolute top-6 right-6 opacity-10 pointer-events-none">
              <Quote className="w-20 h-20 text-white" />
            </div>

            <div className="relative z-10">
              <div className="text-xs font-semibold text-emerald-400 tracking-wider uppercase mb-3">
                Message from Leadership
              </div>
              <h3 className="text-xl font-bold font-display mb-4 text-emerald-50">
                “Educating Minds, Cultivating Character”
              </h3>

              <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed mb-6 font-normal">
                {settings.principal_message ||
                  'Welcome to Shawan School and College Paharpur. Our mission is to democratize world-class scientific, intellectual, and moral instruction for the youth of Paharpur. We foster an academic environment where disciplined study, equipped laboratories, dedicated mentors, and Islamic ethical values empower each student to realize their highest academic and career aspirations.'}
              </p>

              <div className="pt-5 border-t border-emerald-900 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white font-display">
                    {settings.principal_name || 'Office of the Principal'}
                  </div>
                  <div className="text-xs text-emerald-400">Shawan School and College, Paharpur</div>
                </div>

                <button
                  type="button"
                  onClick={onExploreAcademics}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-xs font-semibold text-emerald-100 transition-colors cursor-pointer"
                >
                  View Programs →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Core Values Strip */}
        {(settings.core_values || []).length > 0 && (
          <div className="border-t border-neutral-200 pt-10">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-5">
              Institutional Values &amp; Guiding Pillars
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(settings.core_values || []).map((val, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-800 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-800">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
