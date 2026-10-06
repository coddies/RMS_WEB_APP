# RMS_WEB_APP

**Restaurant Management System (RMS)** — A multi-tenant restaurant ordering, billing, and counter operations platform built with **Next.js (App Router)** and **Supabase**.

---

## 🚀 Features

- **Dine-in QR Ordering**: Instant QR-code based ordering directly from table-specific links.
- **WhatsApp Delivery Ordering**: Seamless online ordering with WhatsApp deep-link confirmations (`wa.me`).
- **Live Cashier & Kitchen Counter**: Real-time order tracking, kitchen tickets, and counter operations.
- **Role-based Authentication**: Secure access control for Admin, Cashier, Kitchen, and Delivery staff.
- **Menu Management**: Categorized menu catalog, pricing, item availability, and photo uploads.
- **Multi-Tenant Architecture**: Robust tenant pairing, branch isolation, and Row-Level Security (RLS) in Supabase.
- **Local Bridge Support**: Built-in Windows counter service integration for local thermal receipt printing and offline sync.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router, React 19)
- **Database & Auth**: Supabase (PostgreSQL, Realtime, Row Level Security)
- **Deployment**: Vercel
- **Styling**: Modern dark theme (Black & Crimson Red accents)
- **Tooling**: TypeScript, PNPM / NPM

---

## ⚙️ Environment Variables Setup

Before running the application or deploying to Vercel, configure the required environment variables:

Refer to [`.env.example`](./.env.example):

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_or_anon_key
SUPABASE_SECRET_KEY=your_supabase_service_role_secret_key

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
RMS_WEB_APP_URL=https://your-project.vercel.app

# Staff Session Authentication
STAFF_SESSION_SECRET=your_minimum_32_char_random_secret

# Cloudinary (Menu photo uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

> ⚠️ **Important:** Do not commit your `.env` or `.env.local` files to version control. Set these in Vercel's **Project Settings > Environment Variables**.

---

## 📦 Getting Started

### 1. Install Dependencies
```bash
pnpm install
# or
npm install
```

### 2. Run Local Development Server
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Build for Production
```bash
npm run build
```

---

## 🌐 Deploying to Vercel

1. Push this repository to GitHub: `https://github.com/coddies/RMS_WEB_APP.git`
2. Go to [Vercel](https://vercel.com/) and click **Add New... > Project**.
3. Import the `coddies/RMS_WEB_APP` repository.
4. Keep the **Framework Preset** as **Next.js** and **Root Directory** as `./`.
5. Under **Environment Variables**, add the environment variables defined in `.env.example`.
6. Click **Deploy**.

---

## 📄 License
Private & Proprietary. All rights reserved.
