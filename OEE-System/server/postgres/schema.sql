-- schema.sql  -  the main store of the smart factory (PostgreSQL + TimescaleDB)
--
-- Run by postgres/init.sh on the very first start. Safe to run again after editing this file:
--   docker compose exec timescaledb sh /docker-entrypoint-initdb.d/init.sh
--
-- Telegraf writes four tables from MQTT:  board, board_status (live signals), events, minutes (OEE input).
-- People and Claude read the views oee_daily / oee_hourly / product_daily, or call oee(bucket, since, until, bucket_offset).
-- Users:  telegraf (writes the tables)  ·  reader (read only: Claude's MCP, the Google Sheet sync)

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT 'CREATE ROLE telegraf LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telegraf') \gexec
SELECT 'CREATE ROLE reader LOGIN'   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reader') \gexec
ALTER ROLE telegraf PASSWORD :'telegraf_pass';
ALTER ROLE reader   PASSWORD :'reader_pass';
ALTER ROLE reader SET default_transaction_read_only = on;
ALTER ROLE reader SET statement_timeout = '30s';
ALTER DATABASE :"db" SET timezone TO 'Asia/Bangkok';
SET timezone TO 'Asia/Bangkok';
GRANT CREATE ON SCHEMA public TO telegraf;   -- lets Telegraf add a column if the board ever sends a new field

-- ---------------------------------------------------------------- tables Telegraf writes

CREATE TABLE IF NOT EXISTS board (
  time  timestamptz NOT NULL,
  line  text,
  pot_0 double precision, pot_1 double precision, pot_2 double precision, pot_3 double precision,
  run_0 double precision, run_1 double precision, run_2 double precision, run_3 double precision,
  al    double precision,
  cnt_0 double precision, cnt_1 double precision, cnt_2 double precision, cnt_3 double precision,
  good  double precision,
  rej   double precision,
  ms    double precision
);
CREATE TABLE IF NOT EXISTS board_status (
  time  timestamptz NOT NULL,
  line  text,
  value text
);
CREATE TABLE IF NOT EXISTS events (
  time    timestamptz NOT NULL,
  line    text,
  machine bigint,
  event   text
);
CREATE TABLE IF NOT EXISTS minutes (
  time      timestamptz NOT NULL,
  line      text,
  machine   bigint,
  run_s     bigint,
  stop_s    bigint,
  alarm_s   bigint,
  parts     bigint,
  speed_pct bigint
);
-- added later (the board's door buttons); Telegraf would add them by itself too
ALTER TABLE board ADD COLUMN IF NOT EXISTS door_0 double precision;
ALTER TABLE board ADD COLUMN IF NOT EXISTS door_1 double precision;
ALTER TABLE board ADD COLUMN IF NOT EXISTS door_2 double precision;
ALTER TABLE board ADD COLUMN IF NOT EXISTS door_3 double precision;
-- added later (two products, each with its own route through the machines)
ALTER TABLE board   ADD COLUMN IF NOT EXISTS route text;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS out_0 double precision;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS out_1 double precision;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS qg_0  double precision;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS qg_1  double precision;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS qr_0  double precision;
ALTER TABLE board   ADD COLUMN IF NOT EXISTS qr_1  double precision;
ALTER TABLE events  ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE events  ADD COLUMN IF NOT EXISTS route   text;
ALTER TABLE events  ADD COLUMN IF NOT EXISTS source  text;
ALTER TABLE events  ADD COLUMN IF NOT EXISTS code    text;   -- product_info: the product's code and name (control page)
ALTER TABLE events  ADD COLUMN IF NOT EXISTS name    text;   -- website = pressed on the control page (server/control-hub), empty = the board
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS source  text;   -- sim = the server's simulated line (control-hub), empty = the board
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS output  bigint;  -- sim: parts off the end of the route that minute (the board sends output events)
ALTER TABLE board        OWNER TO telegraf;
ALTER TABLE board_status OWNER TO telegraf;
ALTER TABLE events       OWNER TO telegraf;
ALTER TABLE minutes      OWNER TO telegraf;

SELECT create_hypertable('board',        by_range('time', INTERVAL '1 day'),  if_not_exists => true);
SELECT create_hypertable('board_status', by_range('time', INTERVAL '30 days'), if_not_exists => true);
SELECT create_hypertable('events',       by_range('time', INTERVAL '7 days'), if_not_exists => true);
SELECT create_hypertable('minutes',      by_range('time', INTERVAL '7 days'), if_not_exists => true);
CREATE INDEX IF NOT EXISTS events_line_event_time ON events (line, event, time DESC);
CREATE INDEX IF NOT EXISTS minutes_line_machine_time ON minutes (line, machine, time DESC);

-- board: about one row a second, so squeeze it after a week and drop it after a year
-- (events / minutes are kept for good, as every OEE number comes from them: squeezed after a week too, about 10x)
ALTER TABLE board SET (timescaledb.compress, timescaledb.compress_segmentby = 'line');
SELECT add_compression_policy('board', INTERVAL '7 days', if_not_exists => true);
SELECT add_retention_policy('board', INTERVAL '365 days', if_not_exists => true);
ALTER TABLE events  SET (timescaledb.compress, timescaledb.compress_segmentby = 'line', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE minutes SET (timescaledb.compress, timescaledb.compress_segmentby = 'line', timescaledb.compress_orderby = 'time DESC');
SELECT add_compression_policy('events',  INTERVAL '7 days', if_not_exists => true);
SELECT add_compression_policy('minutes', INTERVAL '7 days', if_not_exists => true);

-- ---------------------------------------------------------------- settings people edit

CREATE TABLE IF NOT EXISTS machines (
  line          text    NOT NULL,
  machine       int     NOT NULL,
  name          text    NOT NULL,
  ideal_cycle_s numeric NOT NULL CHECK (ideal_cycle_s > 0),
  PRIMARY KEY (line, machine)
);
INSERT INTO machines VALUES
  ('line1', 1, 'M1 Okuma LNC-8',       18),   -- the board makes a part every this many seconds at 100 % speed
  ('line1', 2, 'M2 GFIR CK0620',       30),
  ('line1', 3, 'M3 GFIR CK0620',       24),
  ('line1', 4, 'M4 Okuma GENOS L250E', 36)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- OEE

-- one row per machine (and product it worked on) per time bucket, buckets in Thailand time (bucket_offset
-- moves where they start, e.g. oee('12 hours', bucket_offset => '8 hours') gives 08:00-20:00 and 20:00-08:00 shifts).
-- Quality comes from the QC presses of the machine's product (rows from before products existed: product is
-- empty on both sides, so they match as before). source keeps the two lines apart: board = the ESP32 (minutes
-- and QC presses without a source), sim = the line simulated on the server while the control page drives it
-- (minutes with source sim, QC presses made on the control page: source website), test = the simulated line on the
-- control page's simulated clock (minutes and presses with source test, at the simulated time). Dropped first
-- because the columns changed.
DROP VIEW IF EXISTS oee_daily, oee_hourly, product_daily;
DROP FUNCTION IF EXISTS oee(interval, timestamptz, timestamptz, interval);
DROP FUNCTION IF EXISTS products(timestamptz);
CREATE FUNCTION oee(bucket interval,
                               since timestamptz DEFAULT '-infinity',
                               until timestamptz DEFAULT 'infinity',
                               bucket_offset interval DEFAULT '0')
RETURNS TABLE (period_start timestamptz, line text, machine int, product text, name text,
               logged_min numeric, run_min numeric, stop_min numeric, alarm_min numeric, parts bigint,
               ideal_cycle_s numeric, good bigint, reject bigint,
               availability numeric, performance numeric, quality numeric, oee numeric, source text)
LANGUAGE sql STABLE AS $$
  WITH m AS (
    SELECT time_bucket(bucket, x.time, 'Asia/Bangkok', "offset" => bucket_offset) AS b, x.line, x.machine::int AS mach,
           x.product AS prod, coalesce(x.source, 'board') AS src,
           sum(x.run_s) AS run_s, sum(x.stop_s) AS stop_s, sum(x.alarm_s) AS alarm_s, sum(x.parts) AS parts
    FROM minutes x
    WHERE x.time >= since AND x.time < until
    GROUP BY 1, 2, 3, 4, 5
  ), qc AS (
    SELECT time_bucket(bucket, x.time, 'Asia/Bangkok', "offset" => bucket_offset) AS b, x.line, x.product AS prod,
           CASE x.source WHEN 'website' THEN 'sim' WHEN 'test' THEN 'test' ELSE 'board' END AS src,
           count(*) FILTER (WHERE x.event = 'good') AS good, count(*) FILTER (WHERE x.event = 'reject') AS reject
    FROM events x
    WHERE x.event IN ('good', 'reject') AND (x.source IS NULL OR x.source IN ('website', 'test')) AND x.time >= since AND x.time < until
    GROUP BY 1, 2, 3, 4
  ), r AS (
    SELECT m.*, mc.name AS mname, mc.ideal_cycle_s AS ideal,
           coalesce(qc.good, 0) AS n_good, coalesce(qc.reject, 0) AS n_reject,
           CASE WHEN m.run_s + m.stop_s > 0 THEN m.run_s / (m.run_s + m.stop_s) END AS a,
           CASE WHEN m.run_s > 0 THEN mc.ideal_cycle_s * m.parts / m.run_s END AS p,
           CASE WHEN qc.good + qc.reject > 0 THEN qc.good::numeric / (qc.good + qc.reject) END AS q
    FROM m
    LEFT JOIN qc ON qc.b = m.b AND qc.line = m.line AND qc.prod IS NOT DISTINCT FROM m.prod AND qc.src = m.src
    LEFT JOIN machines mc ON mc.line = m.line AND mc.machine = m.mach
  )
  SELECT b, r.line, mach, prod, mname,
         round((run_s + stop_s) / 60, 1), round(run_s / 60, 1), round(stop_s / 60, 1), round(alarm_s / 60, 1),
         parts::bigint, ideal, n_good, n_reject,
         round(a, 4), round(p, 4), round(q, 4), round(a * p * q, 4), src
  FROM r
  ORDER BY 1, 2, 3
$$;

CREATE OR REPLACE VIEW oee_daily AS
  SELECT (period_start AT TIME ZONE 'Asia/Bangkok')::date AS day, line, machine, product, name,
         logged_min, run_min, stop_min, alarm_min, parts, ideal_cycle_s, good, reject,
         availability, performance, quality, oee, source
  FROM oee('1 day');

CREATE OR REPLACE VIEW oee_hourly AS
  SELECT period_start AS hour, line, machine, product, name,
         logged_min, run_min, stop_min, alarm_min, parts, ideal_cycle_s, good, reject,
         availability, performance, quality, oee, source
  FROM oee('1 hour', date_trunc('day', now()) - INTERVAL '30 days');

-- what each product of a line is (the latest code and name set on the control page)
CREATE OR REPLACE VIEW product_info AS
  SELECT DISTINCT ON (line, product) line, product, code, name, time AS since
  FROM events
  WHERE event = 'product_info'
  ORDER BY line, product, time DESC;

-- per product per day from since on: parts off the end of its route, and its QC result; source as in oee() (board:
-- the board's output events and QC buttons; sim: the simulated line's output, counted in its minutes rows (older
-- rows: output events), and the control page's QC buttons). Ask with a since (products(now() - interval '14 days'))
-- so only those days are read; product_daily is all of it.
CREATE FUNCTION products(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (day date, line text, product text, output bigint, good bigint, reject bigint, quality numeric,
               code text, name text, source text)
LANGUAGE sql STABLE AS $$
  WITH x AS (
    SELECT e.time, e.line, e.product, CASE WHEN e.source IN ('sim', 'website') THEN 'sim' WHEN e.source = 'test' THEN 'test' ELSE 'board' END AS src,
           (e.event = 'output')::int AS o, (e.event = 'good')::int AS g, (e.event = 'reject')::int AS r
    FROM events e
    WHERE e.time >= since AND e.product IS NOT NULL
      AND (e.event = 'output' AND (e.source IS NULL OR e.source = 'sim')
           OR e.event IN ('good', 'reject') AND (e.source IS NULL OR e.source IN ('website', 'test')))
    UNION ALL
    SELECT m.time, m.line, m.product, m.source, m.output::int, 0, 0
    FROM minutes m
    WHERE m.time >= since AND m.source IN ('sim', 'test') AND m.product IS NOT NULL AND m.output > 0
  )
  SELECT (time_bucket('1 day', x.time, 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')::date, x.line, x.product,
         sum(x.o)::bigint, sum(x.g)::bigint, sum(x.r)::bigint, round(sum(x.g)::numeric / nullif(sum(x.g) + sum(x.r), 0), 4),
         (SELECT i.code FROM product_info i WHERE i.line = x.line AND i.product = x.product),
         (SELECT i.name FROM product_info i WHERE i.line = x.line AND i.product = x.product), x.src
  FROM x
  GROUP BY 1, 2, 3, 10
  ORDER BY 1, 2, 3
$$;

CREATE OR REPLACE VIEW product_daily AS SELECT * FROM products();

-- every route the line has had: from this time on, product A / B went through these machines
CREATE OR REPLACE VIEW route_history AS
  SELECT time, line, route,
         split_part(route, '-', 1) AS product_a_machines, split_part(route, '-', 2) AS product_b_machines,
         coalesce(source, 'board') AS source
  FROM events
  WHERE event = 'route';

-- is the board on, and when did each kind of data last arrive
CREATE OR REPLACE VIEW line_status AS
  SELECT l.line,
         (SELECT s.value FROM board_status s WHERE s.line = l.line ORDER BY s.time DESC LIMIT 1) AS board,
         (SELECT max(b.time) FROM board b WHERE b.line = l.line AND b.time > now() - INTERVAL '7 days') AS last_signal,
         (SELECT max(x.time) FROM minutes x WHERE x.line = l.line) AS last_minute_row,
         (SELECT max(x.time) FROM events x WHERE x.line = l.line) AS last_event
  FROM (SELECT DISTINCT line FROM machines) l;

-- the board's not-recorded time from since to until: gaps of more than 90 s between its minutes rows (each covers the
-- minute before its time), and from its last row until now, with why: an "offline" from the broker in the gap (power,
-- Wi-Fi), a boot at its end (restart), else no data reached the server (server / MQTT / database). The board keeps
-- about 2 hours of rows while MQTT is down and sends them late, so short drops leave no gap.
DROP FUNCTION IF EXISTS not_recorded(timestamptz, timestamptz);
CREATE FUNCTION not_recorded(since timestamptz, until timestamptz DEFAULT now())
RETURNS TABLE (line text, gap_from timestamptz, gap_to timestamptz, minutes numeric, reason text)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT m.line, m.time FROM minutes m
    WHERE m.source IS NULL AND m.machine = 1 AND m.time >= since AND m.time < until
    UNION ALL      -- the last row before since: a gap may start before it
    SELECT m.line, max(m.time) FROM minutes m WHERE m.source IS NULL AND m.machine = 1 AND m.time < since GROUP BY m.line
  ), g AS (
    SELECT r.line, lag(r.time) OVER (PARTITION BY r.line ORDER BY r.time) AS a, r.time - INTERVAL '1 minute' AS b FROM r
    UNION ALL      -- from the last row until now
    SELECT r.line, max(r.time), least(until, now()) FROM r GROUP BY r.line
  )
  SELECT g.line, greatest(g.a, since), g.b, round(extract(epoch FROM g.b - greatest(g.a, since))::numeric / 60, 1),
         CASE WHEN EXISTS (SELECT 1 FROM board_status s WHERE s.line = g.line AND s.value = 'offline' AND s.time >= g.a AND s.time < g.b + INTERVAL '1 minute')
                THEN 'บอร์ดออฟไลน์ (ปิดเครื่อง / ไฟดับ / Wi-Fi หลุด)'
              WHEN EXISTS (SELECT 1 FROM events e WHERE e.line = g.line AND e.event = 'boot' AND e.source IS NULL AND e.time >= g.a AND e.time <= g.b + INTERVAL '2 minutes')
                THEN 'บอร์ดรีสตาร์ต'
              ELSE 'ข้อมูลไม่ถึง server (server / MQTT / database ไม่ทำงาน)' END
  FROM g
  WHERE g.a IS NOT NULL AND g.b - greatest(g.a, since) > INTERVAL '90 seconds'
  ORDER BY 2
$$;

-- ---------------------------------------------------------------- notes (Claude reads these through MCP)

COMMENT ON TABLE board IS 'Raw signal from the ESP32, about one row a second (more when something changes). Suffix _0.._3 = machine 1..4. pot = speed knob 0..1023 (speed % = round(pot/1023*40)*5, 0..200 %), run = run switch 1/0, door = door open 1/0, al = line alarm / E-stop 1/0, cnt = parts made since the board powered on, good / rej = QC presses since power-on, ms = ms since power-on (drops to ~0 when the board restarts), route = the products'' routes (e.g. 12-34: product A = machines 1, 2; B = 3, 4), out_0 / out_1 = output parts of product A / B, qg_ / qr_ = their QC good / reject presses (these three count from power-on or the last route change). Compressed after 7 days, deleted after 365 days. For OEE use minutes / events / oee_* instead.';
COMMENT ON TABLE board_status IS 'value = online / offline of the board, posted by the MQTT broker (offline = the board dropped off Wi-Fi or lost power).';
COMMENT ON TABLE events IS 'One row per signal, kept for good. machine 1-4, or 0 = the whole line. event: part (a machine finished a part; the board makes them by itself, one per cycle while the machine runs), run_on / run_off (run switch), door_open / door_close (door button; an open door stops the machine), alarm_on / alarm_off (line E-stop, machine 0), output (the last machine of a product''s route finished that product), good / reject (QC buttons, machine 0: the latest output part checked good / scrap), boot (the board restarted, machine 0), route (the routes changed, machine 0; column route, e.g. 12-34). product = A / B on part, output, good and reject (empty before products existed). source = website for presses made on the control page (also setup_on / setup_off, undo, reset, use_board / use_simulator, sim_run / sim_pause), sim = part / output of the line simulated on the server (early rows only: its output now goes in its minutes rows), test = presses made while the control page''s simulated clock runs (at the simulated time), empty = the board. OEE keeps board and sim apart (source column of oee_*).';
COMMENT ON TABLE minutes IS 'One row per machine per minute while the board is on, kept for good; time = end of that minute. run_s = seconds running (run switch on, no alarm, door closed, speed above 0 %), stop_s = seconds not running (alarm_s of them under the alarm), parts = parts finished in that minute, speed_pct = speed knob 0-200 % at the end of the minute, product = the product the machine was making (empty = in no route, idle). run_s + stop_s = time the board was logging. source = sim: the line simulated on the server (control-hub) while the control page drives it and within the shift set on the control page, the same rules as the board; its output = parts off the end of the route that minute (it sends no part / output events); empty = the board; test = the same on the control page''s simulated clock (test cases), at the simulated time.';
COMMENT ON TABLE machines IS 'Settings: name and ideal_cycle_s (the fastest normal cycle time in seconds) of each machine. Performance depends on ideal_cycle_s. oee_* recompute from it every time, so changing it changes past days too.';
COMMENT ON FUNCTION oee(interval, timestamptz, timestamptz, interval) IS 'OEE per machine per time bucket (Thailand time). Example: SELECT * FROM oee(''1 day'', now() - interval ''7 days''); shifts 08-20 / 20-08: oee(''12 hours'', bucket_offset => ''8 hours''). Availability = run / logged time, Performance = ideal_cycle_s x parts / run time, Quality = good / (good + reject) of the machine''s product (product column), OEE = A x P x Q. Ratios are 0..1; null when there is nothing to divide by. source = board (the ESP32; quality from its QC buttons), sim (the line simulated on the server in real time; quality from the control page''s QC buttons) or test (the same on the control page''s simulated clock, at simulated times: test cases, not real data): filter on it, never add them up.';
COMMENT ON VIEW oee_daily IS 'OEE per machine per day (Thailand date), all history. Same formulas as the oee() function.';
COMMENT ON VIEW oee_hourly IS 'OEE per machine per hour, from the start of the day 30 days ago until now. Same formulas as the oee() function.';
COMMENT ON FUNCTION products(timestamptz) IS 'Per product per day from since on, the same as product_daily but reading only those days: SELECT * FROM products(now() - interval ''14 days'') WHERE source = ''board''.';
COMMENT ON VIEW product_daily IS 'Per product per day (Thailand date): output = parts off the end of its route, good / reject = QC presses for it, quality = good / (good + reject), code / name = what the product is (the latest set on the control page), source = board or sim as in oee().';
COMMENT ON VIEW product_info IS 'What each product (A / B) of a line is: the latest code and name set on the control page, and since when.';
COMMENT ON VIEW route_history IS 'Each route change: from time on, product A went through product_a_machines and B through product_b_machines, in that order (e.g. 12 = machine 1 then 2).';
COMMENT ON FUNCTION not_recorded(timestamptz, timestamptz) IS 'The board''s not-recorded time from since to until (the real line is the board only): gap_from / gap_to, minutes, and reason (board offline, board restarted, or no data reached the server). Example: SELECT * FROM not_recorded(now() - interval ''1 day'');';
COMMENT ON VIEW line_status IS 'Per line: board online / offline and when each kind of data last arrived.';

-- ---------------------------------------------------------------- reader: read only

GRANT USAGE ON SCHEMA public TO reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader;
ALTER DEFAULT PRIVILEGES FOR ROLE telegraf IN SCHEMA public GRANT SELECT ON TABLES TO reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reader;
