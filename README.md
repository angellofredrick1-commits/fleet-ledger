# Bolt Fleet Ledger

A small web app for running a Bolt car business in Tanzania: register vehicles and drivers, record the weekly hesabu and every expense (repairs, accidents, traffic fines, service, tyres, insurance, licences), and see profit after the loan repayment.

- **Overview**: earnings, expenses, loan repayment and net profit for any month or all time; hesabu per car against break-even and target; alerts for missed hesabu, cars in the garage, repeated fines and recent accidents; a 12-month chart.
- **Vehicles**: plate, model, purchase price, status and weekly target, with a history of which driver had each car.
- **Drivers**: contact details, licence, NIDA, deposit held, assigned car, hesabu paid, fines and accidents.
- **Earnings & expenses**: every entry, filterable, with CSV export.
- **Loan**: monthly repayment, payments made, remaining balance and final payment date.

It is a plain static site (HTML, CSS, JavaScript, no build step) hosted on **Netlify**, with data and sign-in on **Supabase**.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Styles (light and dark mode) |
| `app.js` | The app |
| `config.js` | Your Supabase URL and publishable key |
| `netlify.toml` | Netlify settings: publish folder, redirects, security headers |
| `supabase/schema.sql` | Database tables and row-level security |

## Setup

### 1. Database (Supabase) — already done

The Supabase project **Fleet Ledger** (`zprtwbaaetkxhpiiwjas`, Frankfurt) is set up with `supabase/schema.sql`, and `config.js` already points at it. To rebuild it elsewhere: create a project, run `supabase/schema.sql` in the SQL Editor, and put the new Project URL and anon/publishable key into `config.js`.

The publishable key is meant to be public. Row-level security in the schema means each account can only read and change its own records.

### 2. Hosting (Netlify)

1. In Netlify, choose **Add new site → Import an existing project → GitHub** and pick this repo.
2. Leave the build command empty and the publish directory as `.` (both are already set in `netlify.toml`).
3. Deploy. Every push to `main` redeploys the site.

### 3. Connect sign-in to your Netlify address

In Supabase, go to **Authentication → URL Configuration** and set:

- **Site URL**: your Netlify address, e.g. `https://fleet-ledger.netlify.app`
- **Redirect URLs**: add the same address

This makes the email confirmation link open your site. Then open the site, create your account, confirm your email, and sign in.

## Notes

- Loan defaults (40,000,000 TZS at 14% over 7 years, from December 2026; break-even 219,000 per car per week; target 350,000) can be changed on the Loan tab.
- Amounts are in Tanzanian shillings.
