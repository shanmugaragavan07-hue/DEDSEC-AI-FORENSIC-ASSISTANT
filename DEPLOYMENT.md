# DEDSEC AI Forensic Assistant — Deployment & Infrastructure Guide

## 1. Overview & Architecture
DEDSEC AI Forensic Assistant runs as a unified full-stack Node.js + Express + React (Vite) + TypeScript application on port `3000`:
- **Frontend**: React 19 SPA with Tailwind CSS v4 (Apple Liquid Glass dark studio + separate Public Marketing Website).
- **Backend (`server.ts`)**: Express server providing session-authenticated REST APIs (`/api/*`), server-side rate limiting, AI orchestration, Razorpay/Sandbox HMAC payment verification, and image serving (`/api/images/:filename`).
- **Primary Operational Database (`/data/dedsec.sqlite`)**: Local SQLite (`better-sqlite3` in WAL mode) storing users, scrypt password hashes, SHA-256 OTP hashes, cases, composite version histories, subscription plans, payment ledgers, usage logs, and cost-protection settings.
- **Cloud Cross-Session Sync (Firebase Auth + Firestore)**: Provisioned Firebase project (`firebase-applet-config.json`) with hardened `firestore.rules` for Google Sign-In and non-sensitive case metadata backup.

---

## 2. Required & Optional Environment Variables
Configure environment variables in `.env` (see `.env.example` for template). Never expose secret variables (`GEMINI_API_KEY`, `RAZORPAY_KEY_SECRET`, `SMTP_PASS`, `PAYMENT_SANDBOX_SECRET`) with `VITE_` prefixes.

| Variable | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Recommended | Injected by runtime | Used server-side for `gemini-3.8-flash` (23-attribute facial profile extraction & refinement delta parsing) and `gemini-3.5-transcribe` (voice transcription). |
| `APP_URL` | Optional | `http://localhost:3000` | Public origin URL for callbacks and self-referential links. |
| `ADMIN_BOOTSTRAP_EMAIL` | Optional | `shanmugaragavan07@gmail.com` | Automatically grants `admin` role upon registration or login for this email address. |
| `AI_HORDE_API_KEY` | Optional | `0000000000` | Open-source Stable Horde community worker key (`0000000000` works at zero cost without registration). |
| `LOCAL_SD_WEBUI_URL` | Optional | Empty | URL for self-hosted Automatic1111 / Forge SD WebUI (`http://127.0.0.1:7860`) when `local_sd_webui` provider is selected in Admin Console. |
| `HF_API_TOKEN` | Optional | Empty | Hugging Face Inference API token if switching image provider to `huggingface`. |
| `SMTP_HOST` | Optional | Empty | SMTP hostname for real Email OTP verification, 2FA, and password reset codes. |
| `SMTP_PORT` | Optional | `587` | SMTP port (`587` STARTTLS or `465` TLS). |
| `SMTP_USER` | Optional | Empty | SMTP username. |
| `SMTP_PASS` | Optional | Empty | SMTP password or app password. |
| `SMTP_FROM` | Optional | `DEDSEC Studio <no-reply@dedsec.local>` | Sender header for transactional OTP emails. |
| `RAZORPAY_KEY_ID` | Optional | Empty | Merchant Razorpay Key ID (enables live UPI QR, GPay, PhonePe, Paytm, Cards, Netbanking). |
| `RAZORPAY_KEY_SECRET` | Optional | Empty | Merchant Razorpay Key Secret used strictly server-side to verify `razorpay_signature` HMAC-SHA256 digests and webhooks. |
| `PAYMENT_SANDBOX_SECRET` | Optional | Auto-generated | Server-only secret for signing Development Sandbox checkout verifications when live gateway keys are absent. |

---

## 3. Database & File Storage Configuration
- **SQLite Database**: Stored automatically at `/data/dedsec.sqlite` (relative to project root: `./data/dedsec.sqlite`). Ensure the `/data` directory is mounted on a persistent volume in production container deployments.
- **Generated Composite Storage**: High-resolution `1024×1024` monochrome graphite PNG composites are written to `./data/composites/` and served via `/api/images/:filename` with path-traversal protection and immutable cache headers.
- **Firebase / Firestore**: Configured via `firebase-applet-config.json` and secured by `firestore.rules`. Deploy updated rules anytime using Firebase CLI or AI Studio's rules deployment tool after validating with `npx eslint firestore.rules`.

---

## 4. AI Provider & Cost-Protection Configuration
- **Zero-Surprise Billing Guarantee**: Paid image generation APIs are **disabled by default** (`paid_gemini_image_approved = false`). No paid API or automatic credit top-up is ever triggered without explicit administrator approval inside **Admin Console → AI & Cost Protection**.
- **Default Image Pipeline**: Uses open-source diffusion (`stablehorde.net` with `Deliberate` / `AbsoluteReality` / `stable_diffusion`), supporting both initial generation and true `img2img` facial composite refinement (`denoising_strength: 0.46`), post-processed via `sharp` into authentic `1024×1024` black-and-white graphite paper composites.
- **Monthly Spend Cap**: Configurable in Admin Console (`monthly_spend_cap_inr`, default `₹500`). Any paid provider request automatically halts before execution if estimated monthly spend reaches the cap.

---

## 5. Email (SMTP) Configuration
- When `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are unset, the server honestly reports `smtpConfigured: false` (`HTTP 503`) on OTP delivery requests and never displays fake OTPs or false "email sent" confirmations.
- Once SMTP credentials are provided, 6-digit OTPs are generated with `crypto.randomInt`, hashed with SHA-256 + 10-minute expiry in SQLite, and delivered via `nodemailer`.

---

## 6. Payment Gateway & Google Pay UPI QR Verification
- **Configured Google Pay UPI QR (Default Live Mode)**: Serves the configured Google Pay QR (`/assets/aistudio/1000109412_84c02ce5.jpg`, Payee: `shanmuga ragavan`, UPI ID: `shanmugaragavan15@okicici`) with exact plan pricing (`₹499` / `₹1,499`). Customers scan & pay in their UPI app and submit their 12-digit UPI transaction reference (UTR).
- **Why Automatic Verification Is Not Supported on Static UPI QR**: Personal/static VPA QR transfers are peer-to-peer bank transfers and do **not** emit signed bank or payment-gateway webhooks to a web server. Therefore, UTR submission sets the order to `pending_verification` (**never** auto-activating the plan); subscriptions activate **only** after the administrator verifies receipt in Google Pay / bank statements and approves the transaction in **Admin Console → Payments**.
- **Optional Automatic Merchant Verification**: Setting `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` from a registered business merchant account enables cryptographic `HMAC-SHA256` signature and webhook verification (`/api/payments/verify-razorpay`, `/api/payments/webhook/razorpay`) for automatic activation.
- **Isolated Admin Sandbox Diagnostics**: Admin-only HMAC test orders (`gateway = 'sandbox'`) are strictly separated from customer checkout, never upgrade customer subscriptions, and are excluded from live revenue metrics.

---

## 7. Local Development & Production Commands
```bash
# Install dependencies
npm install

# Type-check & validate Firestore security rules
npm run lint
npx eslint firestore.rules

# Start full-stack development server on port 3000
npm run dev

# Build production frontend bundle into dist/
npm run build

# Start production Express + static bundle server on port 3000
npm start
```
