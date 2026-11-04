import React from 'react';
import { SchoolSettings } from '../types';

interface FooterProps {
  settings: SchoolSettings;
  onNavigate: (sectionId: string) => void;
  onOpenPortal: () => void;
}

export const Footer: React.FC<FooterProps> = ({ settings, onNavigate, onOpenPortal }) => {
  return (
    <footer className="bg-neutral-950 text-neutral-400 py-16 border-t border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-4">
            <span className="text-xl font-bold tracking-tight text-white font-display block">
              {settings.school_name || 'Shawan School and College'}
            </span>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-sm">
              Premier educational and collegiate institution in Paharpur, Dera Ismail Khan, Pakistan.
              Affiliated with BISE D.I. Khan and registered under Khyber Pakhtunkhwa PSRA.
            </p>
            <div className="text-xs text-neutral-500 space-y-1">
              <p>Campus: 4X48+MRH, Rangpur Road, Paharpur, D.I. Khan</p>
              <p>Email: {settings.email}</p>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Navigation
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  onClick={() => onNavigate('about')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  About School
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('academics')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Academic Programs
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('admissions')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Online Admission
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('facilities')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Campus Facilities
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('fees')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Fee Structure
                </button>
              </li>
            </ul>
          </div>

          {/* Academic Portals */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Student Services
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  onClick={onOpenPortal}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Student & Parent Portal
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('admissions')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Track Admission Application
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('news-events')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Board Examination Notices
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('gallery')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Campus Photo Gallery
                </button>
              </li>
            </ul>
          </div>

          {/* Accreditation Notice */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              Recognition
            </h4>
            <div className="text-xs text-neutral-400 space-y-2 leading-relaxed">
              <p>• Board of Intermediate & Secondary Education (BISE) Dera Ismail Khan</p>
              <p>• Private Schools Regulatory Authority (PSRA) Khyber Pakhtunkhwa</p>
              <p className="text-[11px] text-neutral-500 pt-1">
                District Dera Ismail Khan, KP, Pakistan
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-neutral-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <p>© {new Date().getFullYear()} Shawan School and College Paharpur. All rights reserved.</p>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Rangpur Road, Paharpur</span>
            <span aria-hidden="true">·</span>
            <span>DI Khan Education Portal</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
