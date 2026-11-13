import { TeacherAssignmentModel } from './models/TeacherAssignment.ts';
import { isClassAssignedToTeacher, normalizeClassAccessLabel } from './classAccess.ts';

function normalizeSubjectLabel(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().split(' ').filter(Boolean).join(' ');
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
  }).select('class_name section subject').lean();
  const matchingAssignments = assignments.filter((assignment: any) =>
    isClassAssignedToTeacher([String(assignment.class_name || '')], className) &&
    normalizeClassAccessLabel(assignment.section) === normalizeClassAccessLabel(section)
  );

  return isTeacherSubjectAssigned(
    teacher.subject,
    matchingAssignments.map((assignment: any) => assignment.subject),
    subject
  );
}
