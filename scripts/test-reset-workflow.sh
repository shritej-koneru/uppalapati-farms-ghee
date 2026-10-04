#!/bin/bash
# Runs the three steps of .github/workflows/reset-orders.yml against the LOCAL
# d1 database, so the shell is tested rather than assumed. Mirrors the workflow
# verbatim apart from --local, which is the one thing that must differ.
set -uo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false

step_one() {
  npx wrangler d1 execute ghee-orders --local --command \
    "SELECT reference, created_at, full_name, mobile, total FROM orders ORDER BY created_at DESC" 2>&1 | tail -20
}

step_two() {
  npx wrangler d1 execute ghee-orders --local --command \
    "DELETE FROM orders; DELETE FROM counters WHERE name LIKE 'order%';" 2>&1 | tail -3
}

step_three() {
  npx wrangler d1 execute ghee-orders --local --json --command \
    "SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM counters WHERE name LIKE 'order%') AS counters" \
    | tee result.json
  grep -q '"orders": 0' result.json || { echo "::error::The orders table is not empty."; return 1; }
  grep -q '"counters": 0' result.json || { echo "::error::The order counters were not reset."; return 1; }
  echo "Order book is empty and every day's counter is gone."
}

seed() {
  npx wrangler d1 execute ghee-orders --local --command \
    "INSERT INTO orders (id,reference,request_key,created_at,full_name,mobile,email,address,city,state,pincode,delivery_date,items,item_summary,total,has_preorder,notified,flagged,status) VALUES ('a','041026-001',NULL,'2026-10-04T08:02:09.145Z','Priya','9876543210',NULL,'12 Test St','Guntur','AP','522001','2026-10-12','[]','1 x ghee',4497,0,0,0,'pending')" >/dev/null 2>&1
  # Two days' worth, because the sequence is per day and a reset that only
  # zeroes one row would still leave the other behind.
  npx wrangler d1 execute ghee-orders --local --command \
    "INSERT INTO counters (name,value) VALUES ('order-041026',3),('order-051026',7) ON CONFLICT (name) DO NOTHING" >/dev/null 2>&1
}

echo "########## rebuild local database ##########"
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute ghee-orders --local --file=db/schema.sql >/dev/null 2>&1
seed

echo
echo "########## step 1: record what is about to be deleted ##########"
step_one

echo
echo "########## the guard must FAIL before the reset ##########"
if step_three >/dev/null 2>&1; then
  echo "UNEXPECTED: guard passed on a non-empty book - the check is broken"
else
  echo "Correctly refused: non-empty order book"
fi

echo
echo "########## step 2: the reset ##########"
step_two

echo
echo "########## step 3: the guard must now PASS ##########"
if step_three; then
  echo "Correctly passed: empty book, counter at zero"
else
  echo "UNEXPECTED: guard failed after a successful reset"
fi

echo
echo "########## login_attempts must survive ##########"
npx wrangler d1 execute ghee-orders --local --command \
  "INSERT INTO login_attempts (ip_key, window_started, failures) VALUES ('k', 1, 2)" >/dev/null 2>&1
step_two >/dev/null
left=$(npx wrangler d1 execute ghee-orders --local --json --command "SELECT COUNT(*) AS n FROM login_attempts" | grep -o '"n": [0-9]*')
if [ "$left" = '"n": 1' ]; then
  echo "Correct: the throttle table is untouched by the reset"
else
  echo "UNEXPECTED: login_attempts was modified ($left)"
fi

rm -f result.json
rm -rf .wrangler/state/v3/d1