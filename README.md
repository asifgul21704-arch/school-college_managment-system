# Shawan School & College Management System

A full-stack school and college management application built with React, TypeScript, Vite, Node.js, Express, and MongoDB/Mongoose.

## Project overview

The application is designed to support day-to-day academic and administrative workflows for a school or college. The codebase includes a React client, an Express API, MongoDB integration, authentication utilities, and deployment configuration.

## Main areas

- Role-based access for school administration and academic users
- Student, parent, and teacher management
- Class, section, and subject organization
- Attendance, fees, exams, and results workflows
- Admissions and school communication modules
- Server-side API routes and database models
- Security-focused request handling and environment-based configuration

> Feature availability and deployment configuration can vary by branch/environment. Use the source code and configured environment as the final reference.

## Technology

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS |
| Backend | Node.js, Express |
| Database | MongoDB Atlas, Mongoose |
| Authentication | JWT, bcryptjs |
| Build tooling | Vite, TypeScript, tsx |

## Requirements

- Node.js **22.18.0 or newer**
- npm
- A MongoDB Atlas database (or compatible MongoDB instance)

## Run locally

1. Clone the repository:

   ```bash
   git clone https://github.com/asifgul21704-arch/school-college_managment-system.git
   cd school-college_managment-system
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your local environment file.

   **Windows PowerShell:**

   ```powershell
   Copy-Item .env.example .env
   ```

   Add your own values to `.env`. At minimum, configure `MONGODB_URI`, `JWT_SECRET`, and the appropriate `CORS_ORIGIN`. Keep all real credentials out of Git.

4. Start development:

   ```bash
   npm run dev
   ```

   The default API/development server port is **3000**. Check your terminal output if the port is overridden.

5. Run checks and create a production client build:

   ```bash
   npm run lint
   npm run build
   ```

6. Start the configured server:

   ```bash
   npm start
   ```

## Environment variables

See [`.env.example`](.env.example) for the complete template. Important server-side settings include:

- `NODE_ENV`, `PORT`
- `MONGODB_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `UPLOAD_STORAGE_DIR`
- Optional `GEMINI_API_KEY` and SMTP settings
- Optional one-time bootstrap configuration

Never commit `.env`, database credentials, JWT secrets, SMTP passwords, or API keys. Use your hosting provider's secret/environment-variable manager for production.

## Deployment notes

The repository includes Railway configuration. Configure the production environment variables in the hosting dashboard, use a strong unique JWT secret, restrict CORS to trusted frontend origins, and attach persistent storage if uploads are enabled. Do not enable production seeding unless you have reviewed the seed guard settings and data impact.

## Security and engineering notes

- Keep secrets server-side; never expose them through `VITE_*` variables.
- Use a unique production JWT secret (at least 32 random characters).
- Keep `ALLOW_PRODUCTION_SEED=false` and `DISABLE_AUTO_SEED=true` unless a deliberate migration is being performed.
- Test authentication, authorization, database connectivity, and critical workflows in the target deployment before describing it as production-ready.

## Project status

Active development. Build, lint, database connectivity, and role-based runtime behavior should be verified in the target environment before each release.
