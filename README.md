# Aircraft Workshop Tool Tracking Website

Beginner-friendly React website for the Final Year Project:

```text
Aircraft Workshop Tool Tracking System using ESP32, PN532 NFC and Supabase
```

## What This Website Does

- Shows overall tool dashboard statistics.
- Shows today's borrow and return activity.
- Looks up a tool by NFC UID.
- Shows every physical tool in the inventory.
- Shows grouped tool quantities, such as total screwdrivers.
- Shows tools that are currently not available.
- Lets staff create a checkout by entering student details and scanning tool UIDs.
- Prevents the same tool from being added twice in one checkout.
- Requires staff verification before completing checkout.
- Shows borrowed tools grouped by student for easier returns.
- Lets staff verify a returned tool and update Supabase automatically.
- Lets staff add real tool UIDs to inventory.
- Lets staff delete unused mockup tools when allowed by Supabase.

Important project rule:

```text
NFC tag = UID only
Supabase = all tool information
```

## Before Running

You need your Supabase project URL and anon/publishable key.

In Supabase:

1. Open your project.
2. Go to Project Settings.
3. Open API or Data API.
4. Copy:
   - Project URL
   - anon key or publishable key

## Setup

Open this folder in VS Code:

```text
work/aircraft-tool-tracking-web
```

Create a new file named:

```text
.env
```

Copy the content from `.env.example` into `.env`:

```text
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Replace the values with your real Supabase details.

## Install And Run

In the VS Code terminal, run:

```bash
npm install
```

Then run:

```bash
npm run dev
```

If PowerShell blocks `npm`, use:

```bash
npm.cmd run dev
```

Vite will show a local website link, usually:

```text
http://localhost:5173
```

Open that link in your browser.

`npm.cmd run dev` starts the local development server. It does not upload the website. It only runs the website on your computer so you can test it in the browser while coding.

## Supabase Tables And Views Used

The website reads from:

```text
tools
tool_summary
dashboard_stats
today_dashboard_stats
today_borrow_list
current_not_available_tools
scan_events
```

The return feature also writes to:

```text
tools
borrow_history
borrow_sessions
audit_logs
```

The inventory manager writes to:

```text
tools
```

The checkout feature writes to:

```text
borrow_sessions
borrow_history
audit_logs
tools
scan_events
```

## Checkout Flow

Because the student ID card does not contain NFC/RFID, staff enters:

```text
Student Name
Student ID
```

Then staff scans or types each tool UID. The website:

1. Checks that the tool exists.
2. Checks that the tool is `Available`.
3. Blocks duplicate scans in the same checkout.
4. Adds the tool to the checkout list.

When all tools are added, staff enters their name, ticks the verification checkbox, and clicks:

```text
Complete Checkout
```

The website then:

1. Creates one `borrow_sessions` row.
2. Updates all selected tools to `Not Available`.
3. Sets `availability_reason` to `Borrowed`.
4. Adds rows to `borrow_history`.
5. Adds verification records to `audit_logs`.

## Return Flow

The return panel is designed to reduce staff mistakes.

The website shows borrowed tools grouped by student name:

```text
Ali Ahmad
- Screwdriver TOOL002-01
- Torque Wrench TOOL003
```

Staff enters their name, ticks the verification checkbox, then clicks `Return` beside the tool being returned.

The website then:

1. Sets the tool back to `Available`.
2. Clears `availability_reason`.
3. Clears `current_borrower`.
4. Records the return time.
5. Adds a `Returned` record to `borrow_history`.
6. Adds a staff verification record to `audit_logs`.
7. Closes the borrow session as `Completed` when all tools in that session have been returned.

## Add Real Tool UID

When you are ready to use real NFC tags:

1. Go to the `Inventory` tab.
2. Use `Manage Inventory`.
3. Enter:

```text
UID
Tool Name
Tool Code
```

Example:

```text
UID: F9D99729
Tool Name: Screwdriver
Tool Code: TOOL002-05
```

Then click:

```text
Add Tool
```

The website will add the tool to Supabase as:

```text
status: Available
workshop: Aircraft Tools Workshop
```

## Delete Mockup Tools

In `Manage Inventory`, click `Delete` beside a tool.

The website only allows delete for tools with:

```text
status: Available
```

If the tool already has borrow history, Supabase may block deletion because old history records still refer to that UID. In that case, keep the row instead of deleting it.

For your FYP demo, use delete mainly for mockup/sample tools that have no real history.

If Supabase shows a row-level security error when deleting, run this in SQL Editor:

```sql
create policy "Allow public delete tools"
on tools for delete
to anon
using (true);
```

If Supabase shows a row-level security error when adding tools, run this:

```sql
create policy "Allow public insert tools"
on tools for insert
to anon
with check (true);
```

## Add UniKL Logo

Put your UniKL logo image in:

```text
public/logo-unikl.png
```

The website header already points to:

```text
/logo-unikl.png
```

After putting the image there, refresh the browser. If the logo does not appear, make sure the file name is exactly:

```text
logo-unikl.png
```

## ESP32 Scan Event Flow

The ESP32 and PN532 should only scan tool NFC tag UIDs.

Recommended flow:

```text
PN532 reads tool UID
ESP32 sends UID to Supabase scan_events
Website uses latest unconsumed scan event
Staff verifies checkout
Website updates tools and history
```

The `scan_events` table should contain:

```text
id
uid
device_id
scan_mode
consumed
created_at
```

Example SQL:

```sql
create table scan_events (
  id bigint generated always as identity primary key,
  uid text not null,
  device_id text default 'ESP32-PN532-01',
  scan_mode text default 'checkout',
  consumed boolean default false,
  created_at timestamptz default now()
);
```

When ESP32 scans a tag, it inserts one row:

```text
uid: F9D99729
device_id: ESP32-PN532-01
scan_mode: checkout
consumed: false
```

On the website, click:

```text
Use Latest ESP32 Scan
```

The website will:

1. Find the newest `scan_events` row where `consumed = false`.
2. Look up that UID in `tools`.
3. Add the tool to the checkout if it is available.
4. Mark that scan event as `consumed = true`.

## Bluetooth Laptop Bridge (ESP32 without Wi-Fi)

The same `scan_events` workflow can be used when the ESP32 has no Wi-Fi:

```text
PN532 -> ESP32 -> Bluetooth Classic SPP -> Windows Python bridge -> scan_events -> website
```

The ESP32 firmware is at:

```text
firmware/ESP32_PN532_Bluetooth/ESP32_PN532_Bluetooth.ino
```

It sends one Bluetooth line only when a tag is read:

```text
UID:F9D99729
```

Run the Windows bridge from `bluetooth_bridge` after pairing the laptop with
`ToolTracker-ESP32`. The bridge inserts the existing scan-event shape; it does
not create tables or change the React application.

```powershell
cd bluetooth_bridge
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python bridge.py --list-ports
python bridge.py --port COM11
```

### ESP32 online status

To show a genuine Bluetooth online/offline status in the website, run this file
**once** in the Supabase SQL Editor:

```text
supabase/scanner_status.sql
```

The ESP32 sends `STATUS:ONLINE` through Bluetooth every 10 seconds while the
laptop bridge is connected. The bridge upserts one `scanner_status` row; it
never inserts this heartbeat into `scan_events`. The website labels the scanner
online when the most recent heartbeat is less than 25 seconds old.

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `bluetooth_bridge/.env` to the
same values used by the React app. If Windows assigns another Bluetooth COM
port, change `BLUETOOTH_COM_PORT` in that file or pass `--port COM<number>`.
Close Tera Term before running the bridge because only one application can open
the Bluetooth COM port at a time.

For a safe first test that never writes to Supabase:

```powershell
python bridge.py --port COM11 --dry-run
```

## Time Display

Supabase stores timestamps in UTC format. The website displays them in Malaysia time:

```text
Asia/Kuala_Lumpur
```
