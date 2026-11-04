import React from 'react';
import { CreditCard, Award, HelpCircle } from 'lucide-react';
import { ClassItem } from '../types';

interface FeesSectionProps {
  classes: ClassItem[];
  onOpenAdmission: () => void;
}

export const FeesSection: React.FC<FeesSectionProps> = ({ classes, onOpenAdmission }) => {
  return (
    <section id="fees" className="py-16 sm:py-20 bg-neutral-50 border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-10 sm:mb-12">
          <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
            Tuition &amp; Scholarship Policies
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance mb-4">
            Transparent and Affordable Academic Structure
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed text-pretty">
            We maintain structured, transparent tuition fees with merit scholarships for high-achieving students
            and welfare concessions for deserving families.
          </p>
        </div>

        {/* Responsive Fee Table */}
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-2xs mb-10">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-700 font-semibold border-b border-neutral-200">
                <tr>
                  <th scope="col" className="py-3.5 px-4 sm:px-6 whitespace-nowrap">Class / Program</th>
                  <th scope="col" className="py-3.5 px-4 sm:px-6 whitespace-nowrap">Curriculum Level</th>
                  <th scope="col" className="py-3.5 px-4 sm:px-6 whitespace-nowrap">Stream / Group</th>
                  <th scope="col" className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">Monthly Tuition</th>
                  <th scope="col" className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {classes.map(cls => (
                  <tr key={cls.id} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="py-3.5 px-4 sm:px-6 font-semibold text-neutral-900 whitespace-nowrap">
                      {cls.name}
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-neutral-600 whitespace-nowrap">
                      {cls.grade_level}
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-neutral-600 whitespace-nowrap">
                      {cls.stream}
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-right font-mono font-bold text-neutral-900 tabular-nums whitespace-nowrap">
                      PKR {cls.monthly_tuition_fee.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={onOpenAdmission}
                        className="min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scholarships & Payment Modes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-white rounded-2xl border border-neutral-200 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center mb-3">
              <Award className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-neutral-900 mb-1">Merit Scholarships</h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Up to 50% tuition waiver for students securing 85%+ in BISE Matric exams or distinction positions in annual evaluations.
            </p>
          </div>

          <div className="p-6 bg-white rounded-2xl border border-neutral-200 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center mb-3">
              <CreditCard className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-neutral-900 mb-1">Payment Methods</h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Fees are payable by the 10th of every month via bank challan (Allied Bank / HBL Paharpur Branch) or direct school cash counter.
            </p>
          </div>

          <div className="p-6 bg-white rounded-2xl border border-neutral-200 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-900 flex items-center justify-center mb-3">
              <HelpCircle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-neutral-900 mb-1">Financial Concessions</h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Kinship discount (20% for 2nd sibling) and special welfare concessions for deserving families upon committee verification.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
