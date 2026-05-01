# Coupon Seva Tracker

This is a browser app for tracking coupon assignment, sale, and settlement.

## What it does

- Requires login before using the app.
- Supports admin login and devotee login.
- Lets admin set the total number of coupons.
- Adds devotees with name, contact number, and admin-set password.
- Assigns coupon ranges to each devotee.
- Records the date when coupons are assigned.
- Lets admin reset one coupon by number, selected coupons for a devotee, all coupons assigned to one devotee, or all coupons in the app.
- Shows every devotee's assigned coupon numbers.
- Lets admin set or update a devotee password.
- Lets a devotee enter buyer name, buyer contact, amount received, and description for each assigned coupon.
- Lets admin mark whether money is settled for each coupon.
- Records the date when admin marks a coupon as settled.
- Shows admin a devotee-wise dashboard with issued, sold, left, settled amount, pending amount, and period-settled amount.
- Lets admin filter settlement totals by date range.
- Shows devotees a dashboard with issued, sold, left, amount settled, amount pending, and settled coupon count.
- Shows devotees pending coupons and settled coupons in separate tabs.
- Shows totals for assigned coupons, sold coupons, and money received.
- Exports a CSV report for Excel, including assigned date.
- Exports and imports a JSON backup.
- Syncs data through Firebase Realtime Database when `firebase-config.js` is enabled.
- Refreshes the browser's local cache from Firebase whenever realtime data changes.

## How to open

Open this file in a browser:

`index.html`

## Login

Admin login:

- Type: Admin
- First password: `admin123`

After logging in as admin, change the admin password from the Admin screen.

Devotee login:

- Type: Devotee
- Select the devotee name
- Enter the devotee password assigned by admin

Admin can set or change a devotee password at any time.

## What to upload

Upload these files to the GitHub repository:

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`
- `README.md`

## Deployment notes

The app uses Firebase Realtime Database as the shared source of truth. Browser `localStorage` is only a local cache and is automatically refreshed from Firebase realtime snapshots.

The `?v=...` values in `index.html` force browsers to download fresh copies of `styles.css`, `app.js`, and `firebase-config.js` after deployment. When you change those files again, update the version string in `index.html`.

Firebase web API keys are allowed to be public, but your Firebase Realtime Database rules must protect the data. Add your deployed GitHub Pages domain in Firebase Authentication authorized domains before using the deployed site.
