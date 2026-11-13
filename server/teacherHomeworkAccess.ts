import { TeacherAssignmentModel } from './models/TeacherAssignment.ts';
import { isClassAssignedToTeacher } from './classAccess.ts';

function normalizeSubjectLabel(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\\s+/g, ' ');
}

export function isTeacherSubjectAssigned(
  teacherSubject: unknown,
  assignmentSubjects: unknown[],
  requestedSubject: unknown
): boolean {
  const requested = normalizeSubjectLabel(requestedSubject);
  if (!requested) return false;
  const allowed = [teacherSubject, ...assignmentSubjects]
    .flatMap(value => String(value ?? '').split(/[,/&]/))
    .map(normalizeSubjectLabel)
    .filter(Boolean);
  return allowed.includes(requested);
}

export async function canAssignTeacherHomework(
  teacher: { id: string; classes: string[]; subject: string },
  teacherIds: string[],
  className: string,
  section: string,
  subject: string
): Promise<boolean> {
  if (!isClassAssignedToTeacher(teacher.classes || [], className)) return false;

  const assignments = await TeacherAssignmentModel.find({
    teacher_id: { $in: teacherIds },
    class_name: className,
    section,
  }).select('subject').lean();

  return isTeacherSubjectAssigned(
    teacher.subject,
    assignments.map((assignment: any) => assignment.subject),
    subject
  );
}
