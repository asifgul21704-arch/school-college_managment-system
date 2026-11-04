import React from 'react';
import { SchoolSettings } from '../types';

interface FacilitiesSectionProps {
  settings: SchoolSettings;
}

export const FacilitiesSection: React.FC<FacilitiesSectionProps> = ({ settings }) => {
  const facilityItems = [
    {
      title: 'Advanced Science & Practical Laboratories',
      category: 'STEM Facilities',
      image: '/src/assets/images/school_science_lab_1790606594349.jpg',
      description:
        'Dedicated apparatus for Physics experiments, chemical testing workstations, and biological microscopic studies conforming to BISE Dera Ismail Khan practical examination standards.',
    },
    {
      title: 'Central Library & Reference Center',
      category: 'Research & Study',
      image: '/src/assets/images/school_library_hall_1790606612341.jpg',
      description:
        'A comprehensive repository of board-prescribed textbooks, national encyclopedias, past decade exam papers, and peaceful individual study desks.',
    },
    {
      title: 'Athletic Sports Grounds & Courtyards',
      category: 'Physical Education',
      image: '/src/assets/images/school_sports_ground_1790606627159.jpg',
      description:
        'Open natural green grounds supporting physical training (PT), cricket, volleyball, athletic drills, and inter-house annual sports tournaments.',
    },
    {
      title: 'Modern Campus Infrastructure on Rangpur Road',
      category: 'Campus Grounds',
      image: '/src/assets/images/hero_school_campus_1790606578302.jpg',
      description:
        'Secure walled campus with round-the-clock surveillance, backup generator power for uninterrupted study, and filtered mineral drinking water.',
    },
  ];

  return (
    <section id="facilities" className="py-20 bg-neutral-50 border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-12">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Campus Infrastructure
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Facilities Engineered for Active Learning
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            Providing students of Paharpur with modern experimental facilities and serene study spaces
            that rival major divisional colleges.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {facilityItems.map((item, idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm flex flex-col group"
            >
              <div className="relative h-64 overflow-hidden bg-neutral-100">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-103"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded">
                  {item.category}
                </div>
              </div>

              <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-neutral-900 font-display mb-2 group-hover:text-emerald-900 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs text-neutral-600 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
                  <span>Location: Main Campus, Rangpur Road</span>
                  <span className="text-emerald-800 font-semibold">Available to All Enrolled</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
