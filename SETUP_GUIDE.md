# Sri Baba Balaji Auto OS — Complete Setup Guide

## What You're Getting
A production-grade PWA Inventory System with:
- Offline-first (IndexedDB) — works even with no internet
- Real-time Firestore sync
- Voice search (Telugu + English)
- Barcode/QR scanner
- Role-based access (Admin vs Mechanic)
- WhatsApp auto-ordering
- CSV export
- Low stock "ORDER NOW" pulsing alerts

---

## STEP 1 — Install Tools on Your PC (One Time)

Install these if you don't have them:
1. **Node.js**: Download from https://nodejs.org — get the LTS version
2. **VS Code**: Download from https://code.visualstudio.com (optional but helpful)
3. **Git**: Download from https://git-scm.com

Verify installation by opening a terminal and running:
```
node --version   → should show v18 or higher
npm --version    → should show 9 or higher
```

---

## STEP 2 — Set Up Firebase (Free — 0 Rupees)

### 2a. Create Firebase Project
1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it: `balaji-auto-os`
4. Disable Google Analytics (not needed)
5. Click **"Create project"**

### 2b. Enable Firestore Database
1. In left sidebar → **Build → Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (we'll secure it later)
4. Select region: **asia-south1 (Mumbai)** — closest to Gajuwaka
5. Click **"Enable"**

### 2c. Enable Authentication
1. Left sidebar → **Build → Authentication**
2. Click **"Get started"**
3. Click **"Email/Password"** provider
4. Toggle it **ON**
5. Click **"Save"**

### 2d. Create User Accounts
1. Still in Authentication → **"Users"** tab
2. Click **"Add user"**
3. Create Admin account:
   - Email: `owner@balaji.com` (or any email you prefer)
   - Password: Choose a strong password (write it down!)
4. Create Staff accounts for each mechanic the same way

### 2e. Get Firebase Config Keys
1. Left sidebar → **Project Settings** (gear icon)
2. Scroll to **"Your apps"** section
3. Click **"Add app"** → choose **Web** icon (`</>`)
4. App nickname: `balaji-web`
5. Click **"Register app"**
6. You'll see a code block — **copy these values**:
   ```
   apiKey: "AIzaSy..."
   authDomain: "balaji-auto-os.firebaseapp.com"
   projectId: "balaji-auto-os"
   storageBucket: "balaji-auto-os.appspot.com"
   messagingSenderId: "123456789"
   appId: "1:123456789:web:abc123"
   ```

---

## STEP 3 — Set Up the Project on Your PC

### 3a. Download the project files
Copy all the provided files into a folder named `balaji-auto-os` on your PC.

Or if using Git:
```bash
cd Desktop
mkdir balaji-auto-os
cd balaji-auto-os
# Copy all the provided files here
```

### 3b. Install dependencies
Open a terminal inside the `balaji-auto-os` folder and run:
```bash
npm install
```
Wait for it to finish (downloads ~150MB of packages — needs internet).

### 3c. Create your .env.local file
In the project folder, create a file named exactly `.env.local` (note the dot at the start):
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...your key here...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=balaji-auto-os.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=balaji-auto-os
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=balaji-auto-os.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```
Replace each value with what you copied from Step 2e.

### 3d. Set Admin Role
Open `context/AuthContext.js` and find the `ROLE_MAP` object.
Add your owner's email as admin:
```js
const ROLE_MAP = {
  'owner@balaji.com': 'admin',    // ← add your owner email here
  // Mechanics will default to 'mechanic' role
};
```

### 3e. Test it locally
```bash
npm run dev
```
Open your browser and go to: http://localhost:3000

You should see the login screen. Sign in with the email/password you created in Firebase.

---

## STEP 4 — Deploy to Vercel (Free Hosting)

### 4a. Create Vercel account
Go to https://vercel.com and sign up with your GitHub account (free).

### 4b. Push your code to GitHub
```bash
cd balaji-auto-os
git init
git add .
git commit -m "Initial commit"
```
Then create a new repository on https://github.com and push:
```bash
git remote add origin https://github.com/YOUR_USERNAME/balaji-auto-os.git
git push -u origin main
```

### 4c. Deploy on Vercel
1. Go to https://vercel.com/new
2. Click **"Import Git Repository"**
3. Select your `balaji-auto-os` repository
4. **IMPORTANT**: Before clicking Deploy, click **"Environment Variables"**
5. Add each variable from your `.env.local` file one by one
6. Click **"Deploy"**

After 2–3 minutes, Vercel gives you a URL like:
`https://balaji-auto-os.vercel.app`

That's your live workshop app! Open it on any phone or tablet.

---

## STEP 5 — Secure Firestore (Important!)

Now that it works, lock down the database so only your staff can access it.

In Firebase Console → Firestore → **Rules** tab, replace with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users can read/write
    match /parts/{partId} {
      allow read, write: if request.auth != null;
    }
    match /auditLog/{logId} {
      allow read, write: if request.auth != null;
    }
  }
}
```
Click **"Publish"**.

---

## STEP 6 — Install as App on Android Tablet

1. Open Chrome on your Android tablet
2. Go to your Vercel URL (e.g. `https://balaji-auto-os.vercel.app`)
3. Tap the **three dots menu** (⋮) in Chrome
4. Tap **"Add to Home screen"**
5. Name it "Balaji Auto OS"
6. Tap **"Add"**

The app now appears on your home screen like a real app — works offline too!

---

## STEP 7 — Add Your Initial Inventory

1. Login with Admin account
2. Tap **"+ Add Part"**
3. Fill in:
   - Part Name (e.g. "Maruti Swift Brake Pads")
   - SKU/Part Number
   - Category (Brakes)
   - Vehicle Model (Maruti Swift)
   - Current Stock (e.g. 6)
   - Minimum Stock Alert (e.g. 3)
   - Purchase Price (e.g. 650)
   - Selling Price (e.g. 950)
   - Supplier Name (e.g. Krishna Auto Parts)
   - Supplier Phone: 919848012345 (91 + mobile number, no spaces)
4. Tap **"Add Part"**

Repeat for all your parts.

---

## How Each Feature Works

### Stock Update (Mechanics)
- Tap **−** to use a part (e.g. mechanic fits brake pads → tap −)
- Tap **+** when new stock arrives
- The number updates instantly across ALL devices

### Voice Search (Telugu/English)
1. Tap the 🎤 microphone button
2. Allow microphone permission (first time only)
3. Say the part name: "Swift Brake Pads" or in Telugu
4. Results filter instantly

Note: Works best on Chrome for Android. Not all browsers support it.

### Barcode Scanner
1. Tap the 📷 camera button
2. Allow camera permission (first time only)
3. Point camera at any barcode or QR code on a part box
4. If the SKU matches, that part appears in search

### WhatsApp Auto-Order
When a part hits low stock, tap it to expand → tap **"Order via WhatsApp"**
This opens WhatsApp with a pre-filled message to the supplier like:
> "Hi, Sri Baba Balaji Maruti Care (Gajuwaka) needs 10 units of Maruti Swift Brake Pads (SKU: BP-SWF-001). Current stock is only 2. Please send availability and price."

### CSV Export
Tap **"⬇️ Export CSV"** button → downloads full inventory as an Excel-compatible CSV file to your device.

### Offline Mode
- No internet? The app still works from local cache
- Any + or − changes are saved locally
- When internet returns, everything syncs automatically to cloud

### Admin vs Staff
- **Admin** sees: purchase prices, selling prices, profit margins, delete button
- **Staff/Mechanic** sees: part name, stock count, +/− buttons only (no prices)

---

## Troubleshooting

**"Login failed"** → Check your email/password match what you set in Firebase Auth

**"Database error"** → Check your .env.local file has correct Firebase keys

**Voice search not working** → Must use Chrome browser, and on HTTPS (works on Vercel, not on http://localhost)

**Scanner not opening camera** → Allow camera permission in browser settings

**WhatsApp button missing** → Add the supplier's phone number when editing the part (format: 919848012345)

**Offline data not loading** → Clear browser cache once, then reload. IndexedDB builds its cache after the first online visit.

---

## Monthly Cost

| Service | Cost |
|---------|------|
| Firebase (Firestore + Auth) | ₹0 (free tier) |
| Vercel hosting | ₹0 (free hobby plan) |
| WhatsApp API (wa.me links) | ₹0 (no API key needed) |
| Domain name (optional) | ~₹700/year |
| **Total** | **₹0/month** |

The app is completely free to run unless you exceed Firebase's free limits:
- 50,000 reads/day and 20,000 writes/day
- A workshop with 5 mechanics doing 100 stock updates/day is well within limits.

---

## Next Upgrades to Add (Future Modules)

Tell Claude: "Add this to the Balaji Auto OS project:"

1. **Digital Job Cards** — Link parts used to each customer's vehicle and job number
2. **Customer CRM** — Track vehicle history by license plate, send WhatsApp service reminders
3. **OBD2 Bluetooth** — Connect ELM327 dongle, auto-read VIN and error codes
4. **Mechanic Payroll** — Track which mechanic did which job, calculate commissions
5. **AI Mechanic Assistant** — Ask "Swift timing chain torque spec" and get an instant answer
