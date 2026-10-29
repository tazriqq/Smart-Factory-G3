// sheets_webapp.gs  -  Google Apps Script: the OEE summary sheet
//
// The database on the server is the main store. Every 15 minutes the server (server/sheets-sync) POSTs
//   {"key", "updated", "tabs": {"OEE_Daily": {"header": [..], "rows": [[..], ..]}, "OEE_Hourly": {..}, "Machines": {..}}}
// (and "Events" alone within ~10 s of a button press), and this script replaces those tabs, so the sheet always matches the database and never fills up.
//
// Setup (once): Extensions -> Apps Script, paste this file,
// Project Settings -> Script properties -> add property KEY = your secret (the same as SHEETS_KEY in server/.env), run setup(),
// then Deploy -> New deployment -> Web app, "Execute as: Me", "Who has access: Anyone",
// and put the /exec URL into SHEETS_URL in server/.env.
// Later changes: paste, Save, run setup(), then Deploy -> Manage deployments -> Edit -> Version: New version.

// the secret is kept in Script properties (not in this file), so this file can be shared
const KEY = () => PropertiesService.getScriptProperties().getProperty('KEY');
const TZ = 'Asia/Bangkok';
const TAB_NAMES = ['Events', 'OEE_Daily', 'OEE_Hourly', 'Products', 'Machines'];
const PERCENT = ['availability', 'performance', 'quality', 'oee'];   // columns shown as %

const NOTES = [
  ['What the tabs mean (for people and for Claude)'],
  ['This sheet is a summary. The full data (every signal, every event, every minute) is in the PostgreSQL database on the server; the server rewrites these tabs every 15 minutes, so edits made here are lost.'],
  ['Events: the last 500 button / switch presses, newest first, updated about 10 seconds after each press. machine 0 = the whole line. event = part (a machine finished a part; the board makes them by itself), run_on / run_off (run switch), door_open / door_close (door button; an open door stops the machine), alarm_on / alarm_off (line E-stop), output (the last machine of a product route finished that product), good / reject (QC: the latest output part checked good / scrap), boot (the board restarted), route (the routes changed: route 12-34 = product A through machines 1 then 2, product B through 3 then 4). product = A / B.'],
  ['OEE_Daily: one row per machine (and the product it worked on) per day (Thailand date), all history. OEE_Hourly: the same per hour, last 14 days. An empty product = the machine was in no route (idle), or the row is from before products existed.'],
  ['Products: one row per product per day: output = parts off the end of its route, good / reject = QC presses for it, quality = good / (good + reject).'],
  ['Columns: logged_min = minutes the board was on and logging, run_min = running (run switch on, no alarm, speed above 0 %), stop_min = not running (alarm_min of them under the line alarm / E-stop), parts = parts finished, ideal_cycle_s = fastest normal cycle time, good / reject = QC presses for that product.'],
  ['Availability = run / logged time. Performance = ideal_cycle_s x parts / run time. Quality = good / (good + reject) of the product the machine worked on, so it is the same for every machine on that route. OEE = A x P x Q. Empty = nothing to divide by.'],
  ['Machines: names and ideal_cycle_s. To change them, change the machines table in the database (see README); every day is then recomputed.'],
];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  for (const name of TAB_NAMES) if (!ss.getSheetByName(name)) ss.insertSheet(name);
  writeNotes(ss, '');
  // the old version's tabs and triggers are no longer used
  for (const t of ScriptApp.getProjectTriggers()) if (['buildDaily', 'cleanup'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}

function writeNotes(ss, updated) {
  const notes = ss.getSheetByName('Notes') || ss.insertSheet('Notes');
  const rows = NOTES.concat([['Last update from the server: ' + (updated || 'not yet')]]);
  notes.clear();
  notes.getRange(1, 1, rows.length, 1).setValues(rows).setWrap(true);
  notes.setColumnWidth(1, 900);
  notes.getRange(1, 1).setFontWeight('bold');
  trimColumns(notes, 1);
}

// a sheet counts every cell of its grid towards Google's limit, so drop the empty rows and columns
function trimColumns(sh, keep) {
  const extra = sh.getMaxColumns() - keep;
  if (extra > 0) sh.deleteColumns(keep + 1, extra);
}

function trimRows(sh, keep) {
  const extra = sh.getMaxRows() - keep;
  if (extra > 0) sh.deleteRows(keep + 1, extra);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return reply('bad json'); }
  if (!KEY()) return reply('no KEY: add it in Project Settings -> Script properties');
  if (!d || d.key !== KEY()) return reply('bad key');
  const tabs = d.tabs || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let n = 0;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (const name of TAB_NAMES) {
      const t = tabs[name];
      if (t && Array.isArray(t.header) && Array.isArray(t.rows)) { replaceTab(ss, name, t.header, t.rows); n += t.rows.length; }
    }
    writeNotes(ss, String(d.updated || ''));
  } finally {
    lock.releaseLock();
  }
  return reply('ok ' + n + ' rows');
}

function replaceTab(ss, name, header, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const width = header.length;
  sh.clear();
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  sh.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');   // keep dates / hours as text
    sh.getRange(2, 1, rows.length, width).setValues(rows.map((r) => r.slice(0, width)));
    header.forEach((h, i) => { if (PERCENT.includes(h)) sh.getRange(2, i + 1, rows.length, 1).setNumberFormat('0.0%'); });
  }
  trimColumns(sh, width);
  trimRows(sh, Math.max(rows.length + 1, 2));
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
