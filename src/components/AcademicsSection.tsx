import React, { useState } from 'react';
import { BookOpen, Check, Award, Calendar, FileText, ChevronRight } from 'lucide-react';
import { ClassItem, SubjectItem } from '../types';

interface AcademicsSectionProps {
  classes: ClassItem[];
  subjects: SubjectItem[];
  onApplyForClass: (className: string) => void;
}

export const AcademicsSection: React.FC<AcademicsSectionProps> = ({
  classes,
  subjects,
  onApplyForClass,
}) => {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[3]?.id || classes[0]?.id || '');

  const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];
  const classSubjects = subjects.filter(s => s.class_name === selectedClass?.name);

  return (
    <section id="academics" className="py-20 bg-neutral-50 border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
              Academic Curricula & Programs
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance">
              Rigorous Education from Early Years to College
            </h2>
          </div>
          <p className="text-sm text-neutral-600 max-w-md text-pretty">
            Structured in full alignment with the Board of Intermediate and Secondary Education (BISE) Dera Ismail Khan
            and National Single Curriculum standards.
          </p>
        </div>

        {/* Academic Program Segmented Selector (Functional interactive tabs) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar">
          {classes.map(cls => (
            <button
              key={cls.id}
              onClick={() => setSelectedClassId(cls.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                cls.id === selectedClass?.id
                  ? 'bg-emerald-950 text-white shadow-sm'
                  : 'bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              {cls.name}
            </button>
          ))}
        </div>

        {/* Selected Program Showcase */}
        {selectedClass && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 sm:p-10 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 space-y-6">
              <div>
                <div className="text-xs font-medium text-emerald-700 uppercase tracking-wider mb-1">
                  {selectedClass.grade_level}
                </div>
                <h3 className="text-2xl font-bold text-neutral-900 font-display">
                  {selectedClass.name}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                  <span>Stream: <strong className="text-neutral-800">{selectedClass.stream}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Head Teacher: <strong className="text-neutral-800">{selectedClass.class_teacher}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Capacity: <strong className="text-neutral-800">{selectedClass.capacity} Students</strong></span>
                </div>
              </div>

              {/* Curriculum Overview */}
              <div className="pt-4 border-t border-neutral-100">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3">
                  Core Subjects & Period Allocations
                </h4>
                {classSubjects.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {classSubjects.map(sub => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-neutral-150 text-xs"
                      >
                        <div>
                          <span className="font-semibold text-neutral-900 block">{sub.name}</span>
                          <span className="text-neutral-500 text-[11px]">Instructor: {sub.teacher_name}</span>
                        </div>
                        <span className="text-[11px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {sub.weekly_periods} Periods/wk
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500 italic">
                    Comprehensive multi-disciplinary curriculum with specialized periods for English, Urdu, Mathematics, General Science, and Nazra Quran.
                  </p>
                )}
              </div>

              {/* Assessment and Pedagogy */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-neutral-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-900 flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-neutral-900 mb-0.5">Board Examination Focus</h5>
                    <p className="text-[11px] text-neutral-600">
                      Regular diagnostic model tests aligned with BISE Dera Ismail Khan question patterns.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-900 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-neutral-900 mb-0.5">Continuous Monitoring</h5>
                    <p className="text-[11px] text-neutral-600">
                      Monthly progress cards and scheduled Parent-Teacher Conferences (PTM) each term.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Summary & Application Card */}
            <div className="lg:col-span-5 bg-neutral-900 text-white rounded-xl p-6 sm:p-7 space-y-6">
              <div>
                <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider block mb-1">
                  Tuition & Enrollment
                </span>
                <div className="text-2xl font-bold font-mono text-white">
                  PKR {selectedClass.monthly_tuition_fee.toLocaleString()}
                  <span className="text-xs font-sans text-neutral-400 font-normal"> / month</span>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Merit-based scholarships available for students scoring 85%+ in previous school examinations.
                </p>
              </div>

              <div className="space-y-2.5 text-xs text-neutral-300 pt-4 border-t border-neutral-800">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Free laboratory practical sessions included</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Library reading and computer access</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Digital student & parent portal record access</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => onApplyForClass(selectedClass.name)}
                  className="w-full py-3 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Apply for {selectedClass.name}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
