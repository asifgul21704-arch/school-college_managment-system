import mongoose, { Schema, type Document } from 'mongoose';

export interface ISchoolFeatureItem {
  title: string;
  description: string;
  icon: string;
}

export interface ISchoolAcademicLevelItem {
  level: string;
  grades: string;
  description: string;
  stream: string;
}

export interface ISchoolFacilityItem {
  name: string;
  description: string;
  image: string;
}

export interface ISchoolTestimonialItem {
  name: string;
  role: string;
  quote: string;
  year: string;
}

export interface ISchoolSettings extends Document {
  singleton_key: string;
  school_name: string;
  short_name: string;
  slogan: string;
  location: string;
  google_maps_code: string;
  google_maps_embed_query: string;
  phone: string;
  alt_phone: string;
  email: string;
  admission_email: string;
  affiliation: string;
  registration_info: string;
  school_timings_summer: string;
  school_timings_winter: string;
  principal_name: string;
  principal_message: string;
  about_text: string;
  mission: string;
  vision: string;
  core_values: string[];
  social_facebook: string;
  social_whatsapp: string;
  hero_badge: string;
  hero_title: string;
  hero_subtitle: string;
  features: ISchoolFeatureItem[];
  academic_levels: ISchoolAcademicLevelItem[];
  facilities: ISchoolFacilityItem[];
  testimonials: ISchoolTestimonialItem[];
  created_at: Date;
  updated_at: Date;
}

export const DEFAULT_SCHOOL_SETTINGS = {
  school_name: 'Shawan School and College',
  short_name: 'Shawan College',
  slogan: 'Inspiring Young Minds Through Academic Rigor & Moral Character',
  location: '4X48+MRH, Rangpur Road, Paharpur, Dera Ismail Khan, Khyber Pakhtunkhwa, Pakistan',
  google_maps_code: '4X48+MRH',
  google_maps_embed_query: 'Rangpur Road, Paharpur, Dera Ismail Khan, Khyber Pakhtunkhwa, Pakistan',
  phone: '+92 300 0000000',
  alt_phone: '+92 966 000000',
  email: 'info@shawanschool.edu.pk',
  admission_email: 'admissions@shawanschool.edu.pk',
  affiliation: 'Affiliated with Board of Intermediate & Secondary Education (BISE) Dera Ismail Khan & Khyber Pakhtunkhwa PSRA',
  registration_info: 'Recognized Private Educational Institution, District Dera Ismail Khan',
  school_timings_summer: '07:45 AM - 01:30 PM (Mon - Thu, Sat) | Friday: 07:45 AM - 12:00 PM',
  school_timings_winter: '08:15 AM - 02:00 PM (Mon - Thu, Sat) | Friday: 08:15 AM - 12:30 PM',
  principal_name: 'Principal, Shawan School and College',
  principal_message:
    'Welcome to Shawan School and College Paharpur. Our mission is to democratize world-class scientific, intellectual, and moral instruction for the sons and daughters of Paharpur and Dera Ismail Khan. We foster an academic environment where disciplined study, modern laboratories, dedicated mentors, and Islamic ethical values empower each student to realize their highest academic and career aspirations.',
  about_text:
    'Shawan School and College is a forward-looking educational institution situated on Rangpur Road in Paharpur, Dera Ismail Khan, Pakistan. With comprehensive educational offerings spanning early childhood foundation, primary, middle schooling, and higher secondary college tiers (Pre-Medical, Pre-Engineering, Computer Science), the institution bridges contemporary technological pedagogy with proven academic discipline. Guided by certified subject specialists and equipped with advanced laboratories, we prepare youth for competitive university admissions and purposeful citizenship.',
  mission:
    'To cultivate intellectually competent, morally upright, and socially proactive leaders through rigorous academic training, innovative STEM education, and values-based character development.',
  vision:
    'To stand as the leading center of academic excellence in the Dera Ismail Khan division, nurturing students who excel in provincial board examinations, national higher education, and constructive nation-building.',
  core_values: [
    'Academic Rigor & Critical Thinking',
    'Moral Integrity & Ethical Conduct',
    'Scientific Inquiry & Technological Literacy',
    'Compassion, Discipline & Mutual Respect',
  ],
  social_facebook: 'https://facebook.com',
  social_whatsapp: '+923000000000',
  hero_badge: 'Admissions Open 2026–2027 · BISE DI Khan Registered',
  hero_title: 'Building Leaders of Tomorrow in Paharpur',
  hero_subtitle:
    'A premier educational institution in Paharpur, D.I. Khan offering comprehensive schooling and higher secondary college programs with modern science facilities, proven faculty, and individualized student care.',
  features: [
    {
      title: 'Modern Science & Computer Labs',
      description:
        'Fully equipped Physics, Chemistry, Biology, and ICT computer laboratories adhering to modern board examination specifications.',
      icon: 'FlaskConical',
    },
    {
      title: 'Distinguished Faculty',
      description:
        'Subject-matter experts with master’s credentials committed to individualized mentoring and conceptual mastery.',
      icon: 'GraduationCap',
    },
    {
      title: 'BISE DI Khan Track Record',
      description:
        'Consistent top grades, distinction certificates, and entry-test foundations for medical and engineering universities.',
      icon: 'Award',
    },
    {
      title: 'Holistic Character & Tarbiyah',
      description:
        'Balanced curriculum combining rigorous secular knowledge with Nazra Quran, ethics, speech competitions, and physical sports.',
      icon: 'HeartHandshake',
    },
  ],
  academic_levels: [
    {
      level: 'Early Childhood & Primary',
      grades: 'Playgroup to Grade 5',
      stream: 'National Single Curriculum (SNC)',
      description:
        'Activity-based foundational literacy, numeracy, phonics, general science, and Islamic character nurturing.',
    },
    {
      level: 'Middle School',
      grades: 'Grade 6 to 8',
      stream: 'Core STEM & Humanities',
      description: 'Analytical math, physical sciences, Urdu, English communication, and computer fundamentals.',
    },
    {
      level: 'Matriculation (SSC)',
      grades: 'Grade 9 & 10',
      stream: 'Science (Biology & Computer Groups)',
      description:
        'Rigorous preparation for BISE Dera Ismail Khan board examinations with daily lab practicals and model testing.',
    },
    {
      level: 'Intermediate College (HSSC)',
      grades: '1st & 2nd Year College',
      stream: 'F.Sc Pre-Medical, Pre-Engineering & ICS',
      description:
        'Collegiate level instruction oriented towards MDCAT, ECAT, university admissions, and professional disciplines.',
    },
  ],
  facilities: [
    {
      name: 'Advanced Science Laboratories',
      description:
        'Separated dedicated labs for Physics, Chemistry, and Biology equipped with optical microscopes, glassware, chemicals, and safety gear.',
      image: '/src/assets/images/school_science_lab_1790606594349.jpg',
    },
    {
      name: 'Central Academic Library',
      description:
        'Thousands of curriculum textbooks, scholarly references, international encyclopedias, and quiet study alcoves.',
      image: '/src/assets/images/school_library_hall_1790606612341.jpg',
    },
    {
      name: 'Sports Complex & Playing Grounds',
      description:
        'Expansive natural turf grounds for cricket, football, physical drill sessions, and inter-house athletic meets.',
      image: '/src/assets/images/school_sports_ground_1790606627159.jpg',
    },
    {
      name: 'Digital ICT Computer Center',
      description:
        'High-speed networked computer workstations running programming software, office tools, and digital learning modules.',
      image: '/src/assets/images/school_science_lab_1790606594349.jpg',
    },
  ],
  testimonials: [
    {
      name: 'Muhammad Asif (Parent)',
      role: 'Father of 10th Grade Student',
      quote:
        'Shawan School has provided exceptional academic discipline in Paharpur. The teachers give individual attention to each boy and girl, and their regular test reporting gives us complete peace of mind.',
      year: 'Session 2025–2026',
    },
    {
      name: 'Dr. Shahzad Khan (Alumnus)',
      role: 'Former F.Sc Pre-Medical Student, now MBBS Doctor',
      quote:
        'The conceptual foundation built by the faculty at Shawan College was instrumental in cracking the medical college entrance test. Truly a blessing for Paharpur students.',
      year: 'Class of 2021',
    },
    {
      name: 'Malik Tariq (Local Community Elder)',
      role: 'Resident of Rangpur Road, Paharpur',
      quote:
        'Having an institution of this caliber with equipped science labs and high moral environment on Rangpur Road has elevated education in our entire tehsil.',
      year: 'Paharpur, DI Khan',
    },
  ],
};

const INTERNAL_SETTINGS_KEYS = new Set([
  '_id',
  '__v',
  'singleton_key',
  'created_at',
  'updated_at',
  '__proto__',
  'constructor',
  'prototype',
]);

export function toSchoolSettingsDto(doc: any): Record<string, any> {
  const raw =
    doc && typeof doc.toObject === 'function'
      ? doc.toObject({ flattenMaps: true })
      : doc && typeof doc === 'object'
      ? { ...doc }
      : {};

  const result: Record<string, any> = {
    ...DEFAULT_SCHOOL_SETTINGS,
  };

  for (const [key, val] of Object.entries(raw)) {
    if (INTERNAL_SETTINGS_KEYS.has(key) || key.startsWith('$')) {
      continue;
    }
    if (val !== undefined) {
      result[key] = val;
    }
  }

  result.core_values = Array.isArray(result.core_values)
    ? result.core_values.map((v: any) => String(v ?? ''))
    : [...DEFAULT_SCHOOL_SETTINGS.core_values];

  result.features = Array.isArray(result.features)
    ? result.features.map((f: any) => ({
        title: String(f?.title ?? ''),
        description: String(f?.description ?? ''),
        icon: String(f?.icon ?? 'Award'),
      }))
    : DEFAULT_SCHOOL_SETTINGS.features.map(f => ({ ...f }));

  result.academic_levels = Array.isArray(result.academic_levels)
    ? result.academic_levels.map((l: any) => ({
        level: String(l?.level ?? ''),
        grades: String(l?.grades ?? ''),
        description: String(l?.description ?? ''),
        stream: String(l?.stream ?? ''),
      }))
    : DEFAULT_SCHOOL_SETTINGS.academic_levels.map(l => ({ ...l }));

  result.facilities = Array.isArray(result.facilities)
    ? result.facilities.map((fac: any) => ({
        name: String(fac?.name ?? ''),
        description: String(fac?.description ?? ''),
        image: String(fac?.image ?? ''),
      }))
    : DEFAULT_SCHOOL_SETTINGS.facilities.map(f => ({ ...f }));

  result.testimonials = Array.isArray(result.testimonials)
    ? result.testimonials.map((t: any) => ({
        name: String(t?.name ?? ''),
        role: String(t?.role ?? ''),
        quote: String(t?.quote ?? ''),
        year: String(t?.year ?? ''),
      }))
    : DEFAULT_SCHOOL_SETTINGS.testimonials.map(t => ({ ...t }));

  return result;
}

const FeatureItemSchema = new Schema<ISchoolFeatureItem>(
  {
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    icon: { type: String, default: 'Award' },
  },
  { _id: false }
);

const AcademicLevelItemSchema = new Schema<ISchoolAcademicLevelItem>(
  {
    level: { type: String, default: '' },
    grades: { type: String, default: '' },
    description: { type: String, default: '' },
    stream: { type: String, default: '' },
  },
  { _id: false }
);

const FacilityItemSchema = new Schema<ISchoolFacilityItem>(
  {
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
  },
  { _id: false }
);

const TestimonialItemSchema = new Schema<ISchoolTestimonialItem>(
  {
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    quote: { type: String, default: '' },
    year: { type: String, default: '' },
  },
  { _id: false }
);

const SchoolSettingsSchema = new Schema<ISchoolSettings>(
  {
    singleton_key: {
      type: String,
      default: 'default',
      unique: true,
      index: true,
    },
    school_name: { type: String, default: DEFAULT_SCHOOL_SETTINGS.school_name },
    short_name: { type: String, default: DEFAULT_SCHOOL_SETTINGS.short_name },
    slogan: { type: String, default: DEFAULT_SCHOOL_SETTINGS.slogan },
    location: { type: String, default: DEFAULT_SCHOOL_SETTINGS.location },
    google_maps_code: { type: String, default: DEFAULT_SCHOOL_SETTINGS.google_maps_code },
    google_maps_embed_query: { type: String, default: DEFAULT_SCHOOL_SETTINGS.google_maps_embed_query },
    phone: { type: String, default: DEFAULT_SCHOOL_SETTINGS.phone },
    alt_phone: { type: String, default: DEFAULT_SCHOOL_SETTINGS.alt_phone },
    email: { type: String, default: DEFAULT_SCHOOL_SETTINGS.email },
    admission_email: { type: String, default: DEFAULT_SCHOOL_SETTINGS.admission_email },
    affiliation: { type: String, default: DEFAULT_SCHOOL_SETTINGS.affiliation },
    registration_info: { type: String, default: DEFAULT_SCHOOL_SETTINGS.registration_info },
    school_timings_summer: { type: String, default: DEFAULT_SCHOOL_SETTINGS.school_timings_summer },
    school_timings_winter: { type: String, default: DEFAULT_SCHOOL_SETTINGS.school_timings_winter },
    principal_name: { type: String, default: DEFAULT_SCHOOL_SETTINGS.principal_name },
    principal_message: { type: String, default: DEFAULT_SCHOOL_SETTINGS.principal_message },
    about_text: { type: String, default: DEFAULT_SCHOOL_SETTINGS.about_text },
    mission: { type: String, default: DEFAULT_SCHOOL_SETTINGS.mission },
    vision: { type: String, default: DEFAULT_SCHOOL_SETTINGS.vision },
    core_values: { type: [String], default: () => [...DEFAULT_SCHOOL_SETTINGS.core_values] },
    social_facebook: { type: String, default: DEFAULT_SCHOOL_SETTINGS.social_facebook },
    social_whatsapp: { type: String, default: DEFAULT_SCHOOL_SETTINGS.social_whatsapp },
    hero_badge: { type: String, default: DEFAULT_SCHOOL_SETTINGS.hero_badge },
    hero_title: { type: String, default: DEFAULT_SCHOOL_SETTINGS.hero_title },
    hero_subtitle: { type: String, default: DEFAULT_SCHOOL_SETTINGS.hero_subtitle },
    features: { type: [FeatureItemSchema], default: () => DEFAULT_SCHOOL_SETTINGS.features.map(f => ({ ...f })) },
    academic_levels: {
      type: [AcademicLevelItemSchema],
      default: () => DEFAULT_SCHOOL_SETTINGS.academic_levels.map(l => ({ ...l })),
    },
    facilities: { type: [FacilityItemSchema], default: () => DEFAULT_SCHOOL_SETTINGS.facilities.map(f => ({ ...f })) },
    testimonials: {
      type: [TestimonialItemSchema],
      default: () => DEFAULT_SCHOOL_SETTINGS.testimonials.map(t => ({ ...t })),
    },
  },
  {
    strict: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const SchoolSettingsModel =
  mongoose.models.SchoolSettings || mongoose.model<ISchoolSettings>('SchoolSettings', SchoolSettingsSchema);
