# DHS Pharmacy - On-Premise Setup Guide (Windows)

This runs the pharmacy inventory & point-of-sale system entirely inside
your building - no internet connection needed once set up, no monthly
hosting bill.

**Read this whole document once before starting.** Steps 1-7 are one-time
setup. After that, staff never touch a command line again.

---

## What you'll need

- **One dedicated Windows computer** to act as the "server" - stays on,
  stays connected to your network. Minimum: Windows 10/11, 8GB RAM, SSD,
  wired network connection.
- Staff computers on the same network - just need a normal web browser.
- About 45 minutes for the one-time setup (this app is smaller and
  simpler than the full hospital system, so it goes faster).

---

## Step 1 - Install Node.js

1. Go to **nodejs.org**, download the **LTS** installer, run it with
   defaults.
2. Confirm: open Command Prompt, type `node -v`, expect something like
   `v20.x.x`.

## Step 2 - Install PostgreSQL

1. Go to **postgresql.org/download/windows**, download and run the
   installer.
2. **Write down the `postgres` user password** you set - needed again
   later.
3. Leave the port at the default **5432**.

## Step 3 - Create the database

1. Open **pgAdmin** (installed alongside PostgreSQL), enter the password.
2. Right-click **Databases** -> **Create** -> **Database...**
3. Name it `dhs_pharmacy`, click **Save**.

## Step 4 - Copy the app onto the machine

Extract the provided `dhs-pharmacy-onprem.zip` to `C:\DHSPharmacy` - you
should end up with `C:\DHSPharmacy\hms-backend` and
`C:\DHSPharmacy\hms-frontend` folders.

## Step 5 - Configure and build the backend

1. Command Prompt:
   ```
   cd C:\DHSPharmacy\hms-backend
   ```
2. Create a `.env` file in that folder with (replace the password):
   ```
   DATABASE_URL="postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/dhs_pharmacy?schema=public"
   JWT_SECRET="change-this-to-a-long-random-string-of-your-own"
   JWT_EXPIRES_IN="12h"
   PORT=4000
   CORS_ORIGIN="http://localhost:4000"
   ```
3. Run, one at a time:
   ```
   npm install
   npx prisma generate
   npx prisma db push --accept-data-loss
   npm run seed
   npm run build
   ```
4. The seed step prints an admin login - write it down:
   `admin@dhspharmacy.local / ChangeMe123!` (change this password
   immediately once you log in).

## Step 6 - Configure and build the frontend

1. Command Prompt:
   ```
   cd C:\DHSPharmacy\hms-frontend
   ```
2. Create a `.env` file with:
   ```
   VITE_API_URL="http://localhost:4000"
   ```
3. Run:
   ```
   npm install
   npm run build
   ```
   This produces a `dist` folder the backend serves automatically - one
   program to run, not two.

## Step 7 - Make it run automatically, forever

1. Go to **nssm.cc/download**, extract `win64\nssm.exe` into
   `C:\DHSPharmacy\tools\nssm.exe`.
2. Copy the `onprem-windows` folder to `C:\DHSPharmacy\onprem-windows`.
3. Right-click **`setup-service.ps1`** -> **Run with PowerShell** ->
   **Run as Administrator** (unblock the file first via Properties if
   Windows flags it).
4. Enter your PostgreSQL password when prompted (used for nightly
   backups).
5. Test: browse to `http://localhost:4000` on the server itself, then
   restart the computer and check it comes back on its own.

---

## Connect staff computers

1. On the server: Command Prompt -> `ipconfig` -> note the IPv4 address
   (e.g. `192.168.1.60`).
2. Ask whoever manages your router to reserve that address for this
   machine so it never changes.
3. On every staff computer, bookmark `http://<that-ip>:4000`.
4. If a staff PC can't reach it, add a Windows Firewall inbound rule
   allowing TCP port 4000.

---

## Backups

The nightly task writes to `C:\DHSPharmacy\Backups` automatically, with
old backups rotated out. **Copy this folder to a USB drive or cloud
folder at least weekly** - a backup that only lives on the same machine
as the database won't survive that machine failing.

---

## What's different from a cloud version

- No internet needed day-to-day.
- Backups are your responsibility (see above).
- Software updates are manual: stop the service
  (`C:\DHSPharmacy\tools\nssm.exe stop DHSPharmacyBackend`), replace the
  changed files, rebuild (`npm run build` in whichever folder changed),
  restart the service.
- No CORS issues - frontend and backend share one address.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser can't reach the app | Service not running - check `C:\DHSPharmacy\tools\nssm.exe status DHSPharmacyBackend` |
| Database connection errors | Confirm the PostgreSQL service is running and `.env`'s password is correct |
| Staff PCs can't connect | Firewall rule missing on the server |
| Need error details | Check `C:\DHSPharmacy\hms-backend\service-err.log` |
