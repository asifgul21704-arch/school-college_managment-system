import React from 'react';
import { X, Printer, CheckCircle2, ShieldCheck, Download, School } from 'lucide-react';
import { PaymentTransaction, FeeRecord } from '../../types';

interface PaymentReceiptModalProps {
  payment: PaymentTransaction;
  fee?: FeeRecord | null;
  onClose: () => void;
}

export const PaymentReceiptModal: React.FC<PaymentReceiptModalProps> = ({
  payment,
  fee,
  onClose,
}) => {
  const handlePrint = () => {
    window.print();
  };

  const receiptNo = payment.receipt_no || (fee?.payment_history?.find(p => p.receipt_no)?.receipt_no) || 'PENDING';
  const displayDate = payment.date || new Date().toISOString().split('T')[0];
  const totalAmount = fee?.total_amount || payment.amount;
  const remainingBalance = fee ? fee.pending_amount : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-neutral-950/70 backdrop-blur-xs flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-neutral-200 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-w-none print:rounded-none">
        {/* Top Control Bar (Hidden when printing) */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-neutral-900 text-white print:hidden">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Official Institution Fee Voucher &amp; Receipt</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Receipt</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              aria-label="Close receipt modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Receipt Body */}
        <div id="official-fee-receipt" className="p-6 sm:p-8 space-y-6 text-neutral-800 print:p-6">
          {/* Institutional Header */}
          <div className="border-b-2 border-neutral-900 pb-5 text-center space-y-1">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div className="w-9 h-9 rounded-xl bg-emerald-900 text-emerald-100 flex items-center justify-center font-bold">
                <School className="w-5 h-5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-neutral-950 font-display uppercase">
                Shawan School &amp; College
              </h1>
            </div>
            <p className="text-xs font-medium text-neutral-600">
              Rangpur Road, Paharpur, District Dera Ismail Khan, Khyber Pakhtunkhwa, Pakistan
            </p>
            <p className="text-[11px] text-neutral-500 font-mono">
              BISE D.I. Khan Affiliated &middot; KP-PSRA Registered &middot; Ph: +92 300 0000000
            </p>
            <div className="pt-2">
              <span className="inline-block px-3 py-1 text-xs font-extrabold uppercase tracking-wider bg-neutral-900 text-white rounded-md">
                Official Fee Payment Receipt
              </span>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 text-xs">
            <div>
              <span className="text-[11px] text-neutral-500 block">Receipt No:</span>
              <strong className="font-mono text-neutral-900 font-bold">{receiptNo}</strong>
            </div>
            <div>
              <span className="text-[11px] text-neutral-500 block">Payment Ref:</span>
              <strong className="font-mono text-neutral-900 font-bold">{payment.payment_reference}</strong>
            </div>
            <div>
              <span className="text-[11px] text-neutral-500 block">Date Issued:</span>
              <span className="font-mono text-neutral-900">{displayDate}</span>
            </div>
            <div>
              <span className="text-[11px] text-neutral-500 block">Payment Mode:</span>
              <span className="font-semibold text-emerald-900">{payment.method}</span>
            </div>
          </div>

          {/* Student & Parent Info Table */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5 p-3 rounded-lg border border-neutral-200 bg-neutral-50/50">
              <span className="font-bold text-neutral-900 block pb-1 border-b border-neutral-200 uppercase tracking-wider text-[10px]">
                Student Particulars
              </span>
              <div className="flex justify-between">
                <span className="text-neutral-500">Student Name:</span>
                <span className="font-bold text-neutral-900">{payment.student_name || fee?.student_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Admission / Roll No:</span>
                <span className="font-mono font-semibold text-neutral-800">{payment.admission_no || payment.student_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Class &amp; Stream:</span>
                <span className="font-semibold text-neutral-800">{payment.class_name || fee?.class_name || 'N/A'}</span>
              </div>
            </div>

            <div className="space-y-1.5 p-3 rounded-lg border border-neutral-200 bg-neutral-50/50">
              <span className="font-bold text-neutral-900 block pb-1 border-b border-neutral-200 uppercase tracking-wider text-[10px]">
                Parent &amp; Billing Info
              </span>
              <div className="flex justify-between">
                <span className="text-neutral-500">Father / Guardian:</span>
                <span className="font-semibold text-neutral-900">{payment.parent_name || 'Verified Guardian'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Contact Mobile:</span>
                <span className="font-mono text-neutral-800">{payment.parent_phone || 'On Record'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Billing Month:</span>
                <span className="font-bold text-neutral-900">{payment.fee_month || fee?.fee_month} {payment.year || fee?.year}</span>
              </div>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-neutral-100 text-neutral-700 font-bold border-b border-neutral-200">
                <tr>
                  <th className="py-2.5 px-4">Fee Head / Description</th>
                  <th className="py-2.5 px-4 text-center">Month / Session</th>
                  <th className="py-2.5 px-4 text-right">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                <tr>
                  <td className="py-2.5 px-4 font-semibold text-neutral-900">
                    Tuition Fee &amp; Instructional Support
                  </td>
                  <td className="py-2.5 px-4 text-center font-mono text-neutral-600">
                    {payment.fee_month || fee?.fee_month} {payment.year || fee?.year}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">
                    PKR {(fee?.tuition_fee || payment.amount).toLocaleString()}
                  </td>
                </tr>
                {fee && fee.other_charges > 0 && (
                  <tr>
                    <td className="py-2.5 px-4 text-neutral-700">Science Lab, ICT &amp; Exam Charges</td>
                    <td className="py-2.5 px-4 text-center font-mono text-neutral-600">Standard</td>
                    <td className="py-2.5 px-4 text-right font-mono">PKR {fee.other_charges.toLocaleString()}</td>
                  </tr>
                )}
                {fee && fee.admission_fee > 0 && (
                  <tr>
                    <td className="py-2.5 px-4 text-neutral-700">Admission / Registration Dues</td>
                    <td className="py-2.5 px-4 text-center font-mono text-neutral-600">One-time</td>
                    <td className="py-2.5 px-4 text-right font-mono">PKR {fee.admission_fee.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-neutral-50 divide-y divide-neutral-200 font-medium">
                <tr>
                  <td colSpan={2} className="py-2 px-4 text-neutral-600 text-right">
                    Total Voucher Amount:
                  </td>
                  <td className="py-2 px-4 text-right font-mono font-semibold text-neutral-800">
                    PKR {totalAmount.toLocaleString()}
                  </td>
                </tr>
                <tr className="bg-emerald-50 text-emerald-950 font-bold">
                  <td colSpan={2} className="py-2.5 px-4 text-right text-xs">
                    Amount Received &amp; Credited:
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-sm font-extrabold text-emerald-800">
                    PKR {payment.amount.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} className="py-2 px-4 text-neutral-600 text-right">
                    Remaining Pending Balance:
                  </td>
                  <td className={`py-2 px-4 text-right font-mono font-bold ${remainingBalance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    PKR {remainingBalance.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Transaction & Verification Stamp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-[11px] space-y-1">
              <span className="font-bold text-neutral-800 block">Bank / Gateway Audit Trail:</span>
              <div className="text-neutral-600">
                <span>Transaction Ref: </span>
                <span className="font-mono text-neutral-800">{payment.transaction_id || payment.payment_reference}</span>
              </div>
              {payment.bank_name && (
                <div className="text-neutral-600">
                  <span>Deposited Bank: </span>
                  <span className="font-semibold text-neutral-800">{payment.bank_name}</span>
                </div>
              )}
              {payment.deposit_slip_ref && (
                <div className="text-neutral-600">
                  <span>Slip Number / Note: </span>
                  <span className="font-mono text-neutral-800">{payment.deposit_slip_ref}</span>
                </div>
              )}
              <div className="text-neutral-600">
                <span>Received / Processed By: </span>
                <span className="text-neutral-800 font-semibold">{payment.received_by || 'Accounts Section'}</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 flex flex-col justify-between text-[11px]">
              <div>
                <div className="flex items-center gap-1 text-emerald-900 font-bold uppercase text-[10px] tracking-wider mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Verified &amp; Officially Stamped</span>
                </div>
                <p className="text-neutral-600 text-[10px]">
                  Verified by: {payment.verified_by_name || 'Accounts Officer'}{' '}
                  {payment.verified_at ? `on ${payment.verified_at.split('T')[0]}` : ''}
                </p>
              </div>
              <div className="pt-4 border-t border-dashed border-emerald-300 flex justify-between items-end text-[10px] text-neutral-500">
                <span>System Computer Generated</span>
                <span className="font-semibold text-neutral-800 border-t border-neutral-400 pt-1 px-4">
                  Authorized Signatory
                </span>
              </div>
            </div>
          </div>

          {/* Footer Note */}
          <div className="text-[10px] text-neutral-400 text-center pt-2 border-t border-neutral-200">
            Note: Fee once deposited is non-refundable and non-transferable. Please preserve this receipt for academic verification and board examination clearances.
          </div>
        </div>

        {/* Modal Bottom Footer (Hidden when printing) */}
        <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between gap-3 print:hidden">
          <span className="text-xs text-neutral-500">
            Receipt generated for student admission record {payment.admission_no || payment.student_id}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 text-xs font-semibold bg-emerald-900 hover:bg-emerald-800 text-white rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 rounded-xl cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
