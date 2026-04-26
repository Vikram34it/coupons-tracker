# Coupon Seva Tracker

This is a browser app for tracking coupon assignment, sale, and settlement.

## What it does

- Requires login before using the app.
- Supports admin login and devotee login.
- Lets admin set the total number of coupons.
- Adds devotees with name and contact number.
- Creates a 4 digit PIN for every devotee.
- Assigns coupon ranges to each devotee.
- Lets admin reset one coupon by number, selected coupons for a devotee, all coupons assigned to one devotee, or all coupons in the app.
- Shows every devotee's assigned coupon numbers.
- Lets a devotee enter buyer name, buyer contact, amount received, and description for each assigned coupon.
- Lets admin mark whether money is settled for each coupon.
- Records the date when admin marks a coupon as settled.
- Shows admin a devotee-wise dashboard with issued, sold, left, settled amount, pending amount, and period-settled amount.
- Lets admin filter settlement totals by date range.
- Shows devotees a dashboard with issued, sold, left, amount settled, amount pending, and settled coupon count.
- Shows devotees pending coupons and settled coupons in separate tabs.
- Shows totals for assigned coupons, sold coupons, and money received.
- Can sync data in realtime through Firebase Realtime Database.
- Exports a CSV report for Excel.
- Exports and imports a JSON backup.

## How to open

Open this file in a browser:

`C:\Users\vikra\Documents\Codex\2026-04-24\i-want-to-create-an-app\index.html`

## Login

Admin login:

- Type: Admin
- First password: `admin123`

After logging in as admin, change the admin password from the Admin screen.

Devotee login:

- Type: Devotee
- Select the devotee name
- Enter the devotee PIN shown in the admin's Devotees list

Admin can reset a devotee PIN at any time.

## Important note

Without Firebase, this app stores data and passwords in the browser on the same computer. Use the Export button regularly to keep a backup.

With Firebase configured, the app syncs one shared live database across devices.

## Realtime Firebase Setup

1. Go to `https://console.firebase.google.com/`.
2. Create a Firebase project.
3. Add a Web app and copy the Firebase config.
4. Go to Build -> Realtime Database and create a database.
5. Go to Build -> Authentication -> Sign-in method and enable Anonymous sign-in.
6. Edit `firebase-config.js`.
7. Paste your Firebase config into `config`.
8. Change `enabled: false` to `enabled: true`.
9. Upload `index.html`, `styles.css`, `app.js`, `README.md`, and `firebase-config.js` to GitHub.

Suggested temporary Realtime Database rules while testing:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

This gives all app users access to the same shared database after anonymous sign-in. For stronger production security, use Firebase Authentication accounts and role-based rules.
