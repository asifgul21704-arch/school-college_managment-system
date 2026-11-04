import React from 'react';
import { GraduationCap, Mail, Phone } from 'lucide-react';
import { Teacher } from '../types';

interface TeachersSectionProps {
  teachers: Teacher[];
}

export const TeachersSection: React.FC<TeachersSectionProps> = ({ teachers }) => {
  return (
    <section id="faculty" className="py-20 bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-12">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Faculty & Academic Mentors
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Subject Specialists Committed to Conceptual Clarity
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            Our educators possess postgraduate qualifications and deep familiarity with provincial board curricula,
            ensuring each learner receives focused intellectual guidance.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map(teacher => (
            <div
              key={teacher.id}
              className="bg-neutral-50 rounded-2xl border border-neutral-200/80 p-6 flex flex-col justify-between hover:border-neutral-300 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-base font-bold text-neutral-900 font-display">
                      {teacher.name}
                    </h3>
                    <div className="text-xs font-medium text-emerald-800 flex items-center gap-1.5 mt-0.5">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>{teacher.subject}</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-neutral-500 bg-white px-2 py-0.5 rounded border border-neutral-200">
                    {teacher.experience}
                  </span>
                </div>

                <div className="text-xs text-neutral-600 mb-3 font-medium">
                  {teacher.qualification}
                </div>

                <p className="text-xs text-neutral-600 leading-relaxed line-clamp-3 mb-4">
                  {teacher.bio}
                </p>
              </div>

              <div className="pt-3 border-t border-neutral-200/80 text-[11px] text-neutral-500 flex flex-wrap items-center justify-between gap-2">
                <span>Classes: {Array.isArray(teacher.classes) ? teacher.classes.join(', ') : teacher.classes}</span>
                <span className="text-emerald-700 font-semibold">{teacher.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
