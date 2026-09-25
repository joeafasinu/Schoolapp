-- ===================== SCHOOLAPP SCHEMA (PostgreSQL) =====================

CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  logo_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- role: 'platform_admin' | 'school_admin' | 'teacher'
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('platform_admin','school_admin','teacher')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS terms (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  session_name TEXT NOT NULL,
  term_name TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  total_school_days INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  form_teacher_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  admission_no TEXT,
  full_name TEXT NOT NULL,
  gender TEXT,
  guardian_name TEXT,
  guardian_email TEXT,
  guardian_phone TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  UNIQUE(teacher_id, class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS score_components (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  max_score REAL NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  component_id INTEGER NOT NULL REFERENCES score_components(id),
  score REAL NOT NULL DEFAULT 0,
  entered_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(term_id, student_id, subject_id, component_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
  marked_by INTEGER REFERENCES users(id),
  UNIQUE(term_id, student_id, date)
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  teacher_comment TEXT,
  admin_comment TEXT
);

CREATE INDEX IF NOT EXISTS idx_scores_lookup ON scores(term_id, student_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance(term_id, student_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

-- ===================== MIGRATIONS (idempotent - safe to run every boot) =====================
-- Platform/billing fields on schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial'
  CHECK (subscription_status IN ('trial','active','suspended'));
ALTER TABLE schools ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS platform_notes TEXT;

-- Branding fields on schools (logo stored inline as base64 - simplest option with no external storage account needed)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_data TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_mime TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_color TEXT;

-- Add 'bursar' as a valid user role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('platform_admin','school_admin','teacher','bursar'));

-- ===================== FEE TRACKING =====================
CREATE TABLE IF NOT EXISTS fee_structures (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE,
  UNIQUE(term_id, class_id)
);

CREATE TABLE IF NOT EXISTS fee_payments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_payments_lookup ON fee_payments(term_id, student_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_lookup ON fee_structures(term_id, class_id);

-- ===================== CUSTOM REPORT CARD SECTIONS (skills/behavioural ratings) =====================
CREATE TABLE IF NOT EXISTS report_traits (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other' CHECK (category IN ('Affective','Psychomotor','Other')),
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_trait_ratings (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  trait_id INTEGER NOT NULL REFERENCES report_traits(id),
  rating TEXT,
  UNIQUE(term_id, student_id, trait_id)
);

CREATE INDEX IF NOT EXISTS idx_trait_ratings_lookup ON student_trait_ratings(term_id, student_id);

