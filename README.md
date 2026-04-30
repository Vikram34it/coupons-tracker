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

This first version stores data and passwords in the browser on the same computer. Use the Export button regularly to keep a backup.

If devotees need to enter coupon details from their own phones at the same time, the next version should use a shared online database and login links for each devotee.