# PayPal x AI — PayPilot AI

**PayPilot AI** is an AI-powered invoice and payment management platform designed to help freelancers and small businesses create invoices, track payments, and manage their finances more easily.

Our goal is to combine AI capabilities with PayPal's payment ecosystem to make everyday financial tasks simpler and faster.

## Features

- **AI Invoice Generation:** Convert written requests into structured invoice details using Gemini AI.
- **Invoice Management:** Create, edit, review, and manage invoices from one dashboard.
- **Payment Tracking:** Monitor invoice statuses, including pending, paid, and overdue.
- **PayPal Integration:** Create and send invoices using PayPal Sandbox.
- **Payment Verification:** Verify completed Sandbox payments through the backend.
- **Smart Dashboard:** View invoices and payment summaries in one place.
- **Guest Access:** Explore the application without creating an account.

## How It Works

1. Enter a written request describing the invoice.
2. AI extracts details such as customer information, amount, description, and due date.
3. Review and edit the generated invoice before confirming it.
4. Save the invoice and use the available PayPal Sandbox payment workflow.
5. Check payment status through the application.

AI-generated information is reviewed by the user before an invoice is created.

## Built With

| Technology | Purpose |
|---|---|
| React | Frontend |
| TypeScript | Application development |
| Vite | Build tool |
| Tailwind CSS | Styling |
| Node.js | Backend runtime |
| Express | Backend API |
| Prisma | Database management |
| SQLite | Database |
| Gemini API | AI invoice extraction |
| PayPal REST API | Invoice and payment integration |
| Render | Deployment |

## Architecture

The application connects the frontend, backend, database, AI service, and PayPal Sandbox.

- React handles the user interface.
- Express manages backend requests and validation.
- Prisma and SQLite store invoice information.
- Gemini processes invoice requests and extracts structured information.
- PayPal Sandbox handles invoice and payment workflows.

## Challenges

During development, we faced challenges with API integration, database configuration, environment variables, and deployment. Connecting different services and debugging backend errors required considerable effort. These challenges helped us understand how full-stack applications work in real-world scenarios.

## What We Learned

We gained practical experience in frontend and backend development, API integration, database management, AI integration, and cloud deployment. We also learned the importance of testing, debugging, and building reliable applications.

## What's Next?

We plan to improve AI invoice generation, introduce more reliable payment tracking, add automated email reminders, and improve database persistence and account management.

Our vision is to make PayPilot AI a smarter and more convenient financial assistant for freelancers and small businesses.

## Getting Started

### Prerequisites
- Node.js 24.14.0
- npm
- PayPal Sandbox account (for payment testing)
- Gemini API key (for AI features)

### Installation

Clone the repository:

```bash
git clone https://github.com/jsbinaryrepo/Paypilot-AI.git
cd Paypilot-AI
```

Install dependencies:

```bash
npm ci
```

Configure environment variables using the example file:

```bash
cp .env.example .env
```

Generate the Prisma client and run migrations:

```bash
npm run db:generate
npm run db:migrate
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

## Testing

Run the automated test suite:

```bash
npm test
```

The project includes automated tests for invoice management, API behavior, database operations, and payment workflows. External provider responses are mocked in automated tests, so live Gemini and PayPal Sandbox functionality must be tested separately.

## Important Notes

- The public demo uses guest access.
- The free Render deployment uses temporary SQLite storage, so records may be lost after a restart.
- Gemini and PayPal Sandbox features require valid server-side credentials.
- Freelancer account registration and persistent cloud storage are prepared but not currently enabled in the public demo.
- PayPal integration currently uses the Sandbox environment, not real-money transactions.

## Links

- **GitHub Repository:** https://github.com/jsbinaryrepo/Paypilot-AI
- **Live Demo:** https://paypilot-ai-3sho.onrender.com
